"""
Living Wiki Watchdog Service

PROMPT #241 - Continuous background job that never stops.
Scans code, commits, specs, enriches project wiki, and auto-discovers cards.

PROMPT #245 - Batch processing pipeline with incremental context enrichment.
After initial scan, remaining files are processed in batches. Each batch
enriches wiki + creates cards. When idle, enriches existing stub cards.

Architecture:
- Each cycle runs as a LOW priority job via PriorityJobExecutor
- After completing a cycle, it sleeps then re-queues itself
- Yields to higher-priority jobs between cycles
- Self-heals: re-queues even on failure (with longer cooldown)
- On startup, bootstrap ensures every active project has a cycle queued
- PROMPT #245: batch_processing_cycle runs at NORMAL priority with 5s cooldown
  for aggressive initial ingestion, then transitions to watchdog_cycle
"""

import asyncio
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Dict
from uuid import UUID

from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def _is_shutting_down() -> bool:
    """PROMPT #226 - Check if the server is shutting down (reload or stop)."""
    try:
        from app.services.job_executor import PriorityJobExecutor
        return PriorityJobExecutor.is_shutting_down()
    except Exception:
        return False


def _submit_to_executor(executor, priority: int, coro_func, *args):
    """
    PROMPT #255 - Submit a coroutine to the executor, handling both async and sync contexts.
    """
    if _is_shutting_down():
        logger.info("Server shutting down, skipping job submission")
        return
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(executor.submit(priority, coro_func, *args))
    except RuntimeError:
        import threading
        def _submit():
            new_loop = asyncio.new_event_loop()
            new_loop.run_until_complete(executor.submit(priority, coro_func, *args))
            new_loop.close()
        threading.Thread(target=_submit, daemon=True).start()


def _get_resilient_session(max_retries: int = 3, delay: float = 5.0):
    """
    Create a DB session with retry logic for transient connection failures.
    Waits between retries to give PostgreSQL time to recover.
    PROMPT #251
    """
    from sqlalchemy import text as sql_text
    from app.database import SessionLocal
    for attempt in range(1, max_retries + 1):
        try:
            db = SessionLocal()
            # Force a lightweight query to verify the connection is alive
            db.execute(sql_text("SELECT 1"))
            return db
        except OperationalError:
            try:
                db.close()
            except Exception:
                pass
            if attempt < max_retries:
                logger.warning(f"DB connection failed (attempt {attempt}/{max_retries}), retrying in {delay}s...")
                time.sleep(delay)
            else:
                logger.error(f"DB connection failed after {max_retries} attempts")
                raise


def _safe_db_call(db, fn, *args, **kwargs):
    """
    Execute a DB operation with automatic rollback on connection errors.
    Prevents a single failed query from poisoning the entire session.
    """
    try:
        return fn(*args, **kwargs)
    except OperationalError:
        try:
            db.rollback()
        except Exception:
            pass
        raise

# Cooldown between cycles (seconds)
CYCLE_COOLDOWN = 60          # When there's active work
IDLE_COOLDOWN = 300           # PROMPT #259 - 5 min when no work detected
ERROR_COOLDOWN = 120
# PROMPT #245 - Aggressive cooldown for batch processing
# PROMPT #228 - Reduced from 5→2 for faster indexing throughput
BATCH_COOLDOWN = 2


def _load_generation_counts():
    """PROMPT #256 - Load generation counts from contract YAML."""
    try:
        from app.contracts import get_contract_loader
        data = get_contract_loader().load_data("business/generation_counts")
        return data.get("max_cards_per_cycle", 5)
    except Exception as e:
        logger.warning(f"Failed to load generation_counts contract, using inline fallback: {e}")
        return 5


# Max auto-discovered cards per cycle (loaded from contract)
MAX_CARDS_PER_CYCLE = _load_generation_counts()


# =============================================================================
# PROMPT #228 - Wiki Enrichment as Sub-Jobs
# =============================================================================

async def wiki_enrichment_job(job_id: UUID, project_id: UUID):
    """
    PROMPT #228 - Generate wiki pages as individual sub-jobs (like file reading).

    Order: fast DB-only pages first, slow AI page last.
    1-5. RAG data pages (DB queries only — instant)
    6.   Business rule pages (DB — instant)
    7.   Semantic linking (DB — instant)
    8.   Visão Geral via AI (slow — Ollama call)
    """
    from app.models.project import Project
    from app.models.async_job import AsyncJob, JobType
    from app.services.job_manager import JobManager

    db = _get_resilient_session()
    try:
        jm = JobManager(db)
        jm.start_job(job_id)

        project = db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.code_path:
            jm.complete_job(job_id, {"skipped": True, "reason": "Projeto não encontrado"})
            return

        project_name = project.name or str(project_id)[:8]
        logger.info(f"Wiki enrichment job started for '{project_name}'")

        # --- Check if there are rules in RAG ---
        from sqlalchemy import text as sql_text
        rule_count_result = db.execute(sql_text("""
            SELECT COUNT(*) FROM rag_documents
            WHERE project_id = :pid
            AND (metadata->>'content_type' = 'business_rule' OR metadata->>'type' = 'business_rule')
        """), {"pid": str(project_id)})
        total_rules = rule_count_result.scalar() or 0

        if total_rules == 0:
            jm.complete_job(job_id, {"skipped": True, "reason": "Sem regras no RAG"})
            logger.info(f"Wiki enrichment skipped for '{project_name}' (no rules)")
            return

        # --- Imports ---
        from app.services.wiki_service import (
            _upsert_wiki_page,
            _build_architecture_patterns_page,
            _build_code_conventions_page,
            _build_ui_components_page,
            _build_code_structure_page,
            _build_git_history_page,
            _build_business_rules_wiki_pages,
            _apply_semantic_links_to_project_fs,
        )
        code_path = project.code_path

        # --- Plan sub-jobs (DB-first, AI-last) ---
        rag_page_builders = [
            ("padrões-arquitetura", "Padrões de Arquitetura", _build_architecture_patterns_page, 6),
            ("convencoes-código", "Convencoes de Código", _build_code_conventions_page, 7),
            ("componentes-interface", "Componentes e Interface", _build_ui_components_page, 8),
            ("estrutura-código", "Estrutura de Código", _build_code_structure_page, 9),
            ("histórico-desenvolvimento", "Histórico de Desenvolvimento", _build_git_history_page, 10),
        ]

        # Order: 5 RAG pages + 1 business rules + 1 linking + 1 AI
        total_subjobs = len(rag_page_builders) + 3
        subjob_labels = (
            [title for _, title, _, _ in rag_page_builders]
            + ["Regras de Negócio (hierarquia)"]
            + ["Links semânticos"]
            + ["Visão Geral (IA)"]
        )

        # Resolve AI model name for display
        ai_model_name = None
        try:
            from app.services.ai_orchestrator import AIOrchestrator
            orch = AIOrchestrator(db)
            model_info = await orch.choose_model("general")
            ai_model_name = model_info.get("db_model_name") if model_info else None
        except Exception:
            pass

        # Create child jobs upfront
        child_ids = []
        for i, label in enumerate(subjob_labels, 1):
            child = jm.create_child_job(
                parent_job_id=job_id,
                job_type=JobType.WIKI_GENERATION,
                input_data={"page": label},
                phase_label=f"Página {i}/{total_subjobs}: {label}",
            )
            # Set AI model name on the AI sub-job (last one)
            if i == total_subjobs and ai_model_name:
                child.ai_model_name = ai_model_name
            child_ids.append(child.id)

        # Set model name on parent job too
        if ai_model_name:
            parent_job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
            if parent_job:
                parent_job.ai_model_name = ai_model_name

        db.commit()

        pages_created = 0
        rule_pages = []

        # --- Sub-jobs 1-5: RAG data pages (DB only — instant) ---
        for i, (slug, title, builder, order) in enumerate(rag_page_builders):
            jm.start_job(child_ids[i])
            try:
                content = builder(db, project_id)
                if content:
                    _upsert_wiki_page(code_path, project_id, slug, title, content, order, "ai_generated")
                    pages_created += 1
                    jm.complete_child_job(child_ids[i], {"status": "created", "chars": len(content)})
                    logger.info(f"Wiki {i+1}/{total_subjobs}: {title} ({len(content)} chars)")
                else:
                    jm.complete_child_job(child_ids[i], {"status": "skipped", "reason": "No data"})
            except Exception as e:
                logger.warning(f"Wiki page {title} failed: {e}")
                jm.fail_child_job(child_ids[i], str(e))

            if _is_shutting_down():
                return

        # --- Sub-job 6: Business rules hierarchy (DB only) ---
        idx_rules = len(rag_page_builders)
        jm.start_job(child_ids[idx_rules])
        try:
            rule_pages = _build_business_rules_wiki_pages(db, code_path, project_id)
            rule_count = len(rule_pages) if rule_pages else 0
            if rule_count > 0:
                pages_created += rule_count
                jm.complete_child_job(child_ids[idx_rules], {"status": "created", "pages": rule_count})
                logger.info(f"Wiki {idx_rules+1}/{total_subjobs}: {rule_count} business rule pages")
            else:
                jm.complete_child_job(child_ids[idx_rules], {"status": "skipped", "reason": "No rules"})
        except Exception as e:
            logger.warning(f"Business rules wiki pages failed: {e}")
            jm.fail_child_job(child_ids[idx_rules], str(e))

        if _is_shutting_down():
            return

        # --- Sub-job 7: Semantic linking (DB only) ---
        idx_links = len(rag_page_builders) + 1
        jm.start_job(child_ids[idx_links])
        try:
            _apply_semantic_links_to_project_fs(code_path, project_id)
            jm.complete_child_job(child_ids[idx_links], {"status": "linked"})
            logger.info(f"Wiki {idx_links+1}/{total_subjobs}: semantic links applied")
        except Exception as e:
            logger.warning(f"Semantic linking failed: {e}")
            jm.fail_child_job(child_ids[idx_links], str(e))

        if _is_shutting_down():
            return

        # --- Sub-job 8: AI enrichment (slow — Ollama call, runs LAST) ---
        idx_ai = len(rag_page_builders) + 2
        jm.start_job(child_ids[idx_ai])
        try:
            from app.services.project_service import _enrich_context_from_rag
            enriched = await _enrich_context_from_rag(db, project_id)
            if enriched:
                pages_created += 1
                jm.complete_child_job(child_ids[idx_ai], {"status": "enriched"})
                logger.info(f"Wiki {idx_ai+1}/{total_subjobs}: AI enrichment done for '{project_name}'")
            else:
                jm.complete_child_job(child_ids[idx_ai], {"status": "skipped", "reason": "No enrichment needed"})
        except Exception as e:
            logger.warning(f"Wiki AI enrichment failed: {e}")
            jm.fail_child_job(child_ids[idx_ai], str(e))

        # PROMPT #233 - Pipeline is read-only: rule enrichment is triggered
        # manually by the user, not automatically after wiki generation.

        jm.complete_job(job_id, {
            "project_id": str(project_id),
            "pages_created": pages_created,
            "total_subjobs": total_subjobs,
        })
        logger.info(f"Wiki enrichment completed for '{project_name}': {pages_created} pages")

    except Exception as e:
        logger.error(f"Wiki enrichment job failed for {project_id}: {e}", exc_info=True)
        try:
            jm.fail_job(job_id, str(e))
        except Exception:
            pass
    finally:
        db.close()


def submit_wiki_enrichment(db: Session, project_id: UUID, rules_count: int):
    """
    PROMPT #228 - Submit wiki enrichment as a separate job with sub-jobs.
    Called from batch_processing_cycle when new rules are found.
    """
    from app.models.async_job import AsyncJob, JobStatus, JobType, JobPriority
    from app.services.job_manager import JobManager
    from app.services.job_executor import PriorityJobExecutor

    # Don't duplicate — check if a wiki job is already running
    existing = db.query(AsyncJob).filter(
        AsyncJob.job_type == JobType.WIKI_GENERATION,
        AsyncJob.project_id == project_id,
        AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
    ).first()
    if existing:
        logger.info(f"Wiki enrichment already in progress for {project_id}, skipping")
        return

    jm = JobManager(db)
    job = jm.create_job(
        job_type=JobType.WIKI_GENERATION,
        input_data={"project_id": str(project_id), "rules_count": rules_count},
        project_id=project_id,
        notification_title=f"Gerando wiki ({rules_count} regras)",
        deep_link=f"/projects/{project_id}/knowledge",
    )
    db.commit()

    executor = PriorityJobExecutor.get_instance()
    _submit_to_executor(executor, JobPriority.NORMAL, wiki_enrichment_job, job.id, project_id)
    logger.info(f"Wiki enrichment job queued for project {project_id} ({rules_count} rules)")


async def watchdog_cycle(job_id: UUID, project_id: UUID):
    """
    One cycle of the watchdog for a single project (read-only pipeline).

    PROMPT #233 - Pipeline is now 100% read-only:
    Steps:
    1. RAG file scan (detect new/changed/deleted files, extract rules)
    2. Git commit sync (index new commits in RAG)
    3. Pattern discovery + spec sync
    4. Sleep then re-queue self

    No auto-generation of wiki, cards, description, or enrichment.
    All generation is manual via buttons.

    Runs at LOW priority, yielding to higher-priority jobs between cycles.
    PROMPT #251 - Resilient DB connection with retry on transient failures.
    """
    from app.models.project import Project
    from app.services.job_manager import JobManager

    db = _get_resilient_session()
    try:
        jm = JobManager(db)
        jm.start_job(job_id)

        project = db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.code_path or not project.initial_scan_complete:
            jm.complete_job(job_id, {"skipped": True, "reason": "Projeto não esta pronto"})
            return  # Don't re-queue if project is gone or invalid

        code_path = project.code_path
        project_name = project.name or str(project_id)[:8]
        logger.info(f"Watchdog cycle started for '{project_name}'")

        # --- Step 1: RAG file scan ---
        jm.update_progress(job_id, 10.0, "Escaneando arquivos por alterações...")
        rag_result = {}
        try:
            from app.services.continuous_rag_service import ContinuousRAGService
            rag_service = ContinuousRAGService(db)
            rag_result = await rag_service.run_full_cycle(project_id, job_id=job_id)
            logger.info(f"RAG scan done for '{project_name}'")
        except Exception as e:
            logger.warning(f"RAG scan failed (non-blocking): {e}")

        # --- Step 2: Git commit sync ---
        jm.update_progress(job_id, 40.0, "Sincronizando commits git...")
        git_result = {}
        try:
            from app.services.prompt_doc_rag_sync import GitCommitRAGSync
            git_sync = GitCommitRAGSync(db, project_id, code_path)
            git_result = git_sync.sync(max_commits=50)
            logger.info(f"Git sync done for '{project_name}'")
        except Exception as e:
            logger.warning(f"Git sync failed (non-blocking): {e}")

        # --- Step 3: Pattern discovery + spec sync ---
        jm.update_progress(job_id, 70.0, "Descobrindo padrões de código...")
        try:
            from app.services.pattern_discovery import PatternDiscoveryService
            from app.services.project_service import _effective_max_patterns
            effective_max = _effective_max_patterns(db, project_id)
            if effective_max > 0:
                discovery = PatternDiscoveryService(db)
                await discovery.discover_patterns(
                    project_path=Path(code_path),
                    project_id=project_id,
                    max_patterns=effective_max,
                    min_occurrences=2,
                )

            from app.services.spec_rag_sync import SpecRAGSync
            SpecRAGSync(db).sync_all_framework_specs()
            logger.info(f"Patterns/specs done for '{project_name}'")
        except Exception as e:
            logger.warning(f"Pattern discovery failed (non-blocking): {e}")

        # PROMPT #233 - No auto-generation: wiki, cards, description, enrichment
        # are all manual via buttons now. Pipeline only scans and extracts.

        # --- Step 4: Orbit result scan (PROMPT #242) ---
        jm.update_progress(job_id, 85.0, "Verificando resultados orbit/...")
        orbit_processed = 0
        try:
            from app.services.orbit_folder import OrbitFolderService
            orbit_service = OrbitFolderService(db)
            orbit_results = orbit_service.scan_results(project)
            for result_item in orbit_results:
                try:
                    orbit_service.process_result(result_item)
                    orbit_processed += 1
                except Exception as e:
                    logger.warning(f"Failed to process orbit result {result_item['filename']}: {e}")
            if orbit_processed > 0:
                logger.info(f"Processed {orbit_processed} orbit results for '{project_name}'")
        except Exception as e:
            logger.warning(f"Orbit result scan failed (non-blocking): {e}")

        jm.complete_job(job_id, {
            "project_id": str(project_id),
            "rag_scan": rag_result.get("processed", {}).get("processed_count", 0) if isinstance(rag_result, dict) else 0,
            "git_commits": git_result.get("new_commits", 0) if isinstance(git_result, dict) else 0,
            "orbit_results": orbit_processed,
        })

        logger.info(f"Watchdog cycle completed for '{project_name}'")

        # PROMPT #251 - No auto-requeue. Scan is now manual via button.

    except Exception as e:
        logger.error(f"Watchdog cycle failed for project {project_id}: {e}", exc_info=True)
        try:
            jm.fail_job(job_id, str(e))
        except Exception:
            pass
    finally:
        db.close()


# =============================================================================
# PROMPT #245 - Batch Processing Cycle
# =============================================================================

async def batch_processing_cycle(job_id: UUID, project_id: UUID, batch_size: int = 10):
    """
    Batch processing cycle for project ingestion (read-only pipeline).

    PROMPT #233 - Pipeline is now 100% read-only:
    - Only reads files and extracts business rules to RAG
    - NO automatic wiki, description, card, or enrichment generation
    - All generation (wiki, cards, description) is manual via buttons

    PROMPT #237 - Single notification for entire scan:
    - One job loops through ALL batches until 0 pending files remain
    - Notification shows "Processando: X/Y arquivos" with global progress %
    - No new notifications per batch — single persistent progress bar
    - Cooldown (5s) between batches to avoid overloading

    PROMPT #251 - Resilient DB connection with retry on transient failures.
    """
    from app.models.project import Project
    from app.models.async_job import AsyncJob, JobStatus, JobType
    from app.services.job_manager import JobManager

    db = _get_resilient_session()
    try:
        jm = JobManager(db)
        jm.start_job(job_id)

        project = db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.code_path or not project.initial_scan_complete:
            jm.complete_job(job_id, {"skipped": True, "reason": "Projeto não esta pronto"})
            return

        project_name = project.name or str(project_id)[:8]

        # PROMPT #237 - Count total files for global progress calculation
        from app.models.rag_file_state import RAGFileState, FileProcessingStatus
        total_files = db.query(RAGFileState).filter(
            RAGFileState.project_id == project_id,
            RAGFileState.status != FileProcessingStatus.DELETED,
        ).count()

        if total_files == 0:
            jm.complete_job(job_id, {"skipped": True, "reason": "Nenhum arquivo para processar"})
            return

        # Set initial notification title
        job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if job:
            job.notification_title = f"Processando: 0/{total_files} arquivos - '{project_name}'"
            db.commit()

        logger.info(f"Batch processing cycle for '{project_name}' - {total_files} total files (batch_size={batch_size})")

        total_processed = 0
        total_rules = 0
        total_errors = 0

        from app.services.continuous_rag_service import ContinuousRAGService

        # PROMPT #237 - Loop through all batches in a single job
        while True:
            # Check shutdown before each batch
            if _is_shutting_down():
                logger.info(f"Server shutting down, pausing batch for '{project_name}'")
                break

            # Count how many files are done so far (global progress)
            done_count = db.query(RAGFileState).filter(
                RAGFileState.project_id == project_id,
                RAGFileState.status.in_([FileProcessingStatus.COMPLETED, FileProcessingStatus.FAILED]),
            ).count()

            pct = round(min((done_count / total_files) * 100, 99.0), 1) if total_files > 0 else 0
            jm.update_progress(job_id, pct, f"Processando: {done_count}/{total_files} arquivos")

            # Update notification title with current progress
            job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
            if job:
                job.notification_title = f"Processando: {done_count}/{total_files} arquivos - '{project_name}'"
                db.commit()

            # Process one batch
            process_result = {}
            try:
                rag_service = ContinuousRAGService(db)
                process_result = await rag_service.process_pending_files(project_id, batch_size=batch_size, parent_job_id=job_id)
                actual = process_result.get('processed', 0)
                rules = process_result.get('rules_extracted', 0)
                total_processed += actual
                total_rules += rules
                total_errors += process_result.get('errors', 0)
                logger.info(f"Batch done for '{project_name}': {actual} files, {rules} rules")
            except Exception as e:
                logger.warning(f"Batch processing failed (non-blocking): {e}")
                total_errors += 1

            pending_remaining = process_result.get("pending_remaining", 0)

            if pending_remaining <= 0:
                # PROMPT #237 - Retry failed files up to 3 times
                MAX_RETRIES = 3
                retryable = db.query(RAGFileState).filter(
                    RAGFileState.project_id == project_id,
                    RAGFileState.status == FileProcessingStatus.FAILED,
                    RAGFileState.retry_count < MAX_RETRIES,
                ).all()

                if retryable:
                    for f in retryable:
                        f.status = FileProcessingStatus.PENDING
                    db.commit()
                    logger.info(f"Retrying {len(retryable)} failed files for '{project_name}' (< {MAX_RETRIES} attempts)")
                    # Update notification
                    job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
                    if job:
                        job.notification_title = f"Retry: {len(retryable)} arquivos - '{project_name}'"
                        db.commit()
                    await asyncio.sleep(BATCH_COOLDOWN)
                    continue  # Re-enter loop to process retryable files

                # No more retries — all done
                break

            # Cooldown between batches
            await asyncio.sleep(BATCH_COOLDOWN)

        # PROMPT #233 - No auto-generation: wiki, cards, description, enrichment
        # are all manual via buttons now. Pipeline only extracts rules to RAG.

        # Final progress: 100%
        final_done = db.query(RAGFileState).filter(
            RAGFileState.project_id == project_id,
            RAGFileState.status.in_([FileProcessingStatus.COMPLETED, FileProcessingStatus.FAILED]),
        ).count()

        # Update final notification title
        job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if job:
            job.notification_title = f"Concluido: {final_done}/{total_files} arquivos - '{project_name}'"
            db.commit()

        jm.complete_job(job_id, {
            "project_id": str(project_id),
            "total_processed": total_processed,
            "total_files": total_files,
            "rules_extracted": total_rules,
            "errors": total_errors,
        })

        # PROMPT #251 - No auto-transition to watchdog. Scan is manual.
        logger.info(f"All files processed for '{project_name}'. Batch cycle complete.")

    except Exception as e:
        logger.error(f"Batch processing failed for project {project_id}: {e}", exc_info=True)
        try:
            jm.fail_job(job_id, str(e))
        except Exception:
            pass
        # PROMPT #251 - No auto-requeue on failure. User triggers manually.
    finally:
        db.close()


def submit_batch_processing_cycle(db: Session, project_id: UUID, batch_size: int = 10):
    """
    PROMPT #245 - Submit a batch processing cycle.
    PROMPT #252: Cleans up stale jobs (>30min) before checking.
    PROMPT #279: Checks if project still exists before submitting.
    Uses NORMAL priority (higher than watchdog's LOW) because initial
    ingestion is more important than maintenance scanning.
    """
    from datetime import timedelta
    from app.models.async_job import AsyncJob, JobStatus, JobType, JobPriority
    from app.services.job_manager import JobManager
    from app.services.job_executor import PriorityJobExecutor
    from app.models.project import Project

    # PROMPT #279 - Don't submit if project was deleted
    project_exists = db.query(Project).filter(Project.id == project_id).first()
    if not project_exists:
        logger.info(f"Project {project_id} no longer exists, skipping batch processing submit")
        return

    # PROMPT #252 / #237 - Clean up stale jobs before checking for duplicates
    # Increased to 4h since single job now loops through all batches
    stale_cutoff = datetime.utcnow() - timedelta(hours=4)
    stale_jobs = db.query(AsyncJob).filter(
        AsyncJob.job_type == JobType.RAG_CONTINUOUS_SCAN,
        AsyncJob.project_id == project_id,
        AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
        AsyncJob.created_at < stale_cutoff,
    ).all()
    if stale_jobs:
        for job in stale_jobs:
            job.status = JobStatus.FAILED
            job.result = {"error": "Job obsoleta removida"}
        db.commit()
        logger.info(f"Cleaned up {len(stale_jobs)} stale batch jobs for project {project_id}")

    # Check no pending/running cycle exists
    existing = db.query(AsyncJob).filter(
        AsyncJob.job_type == JobType.RAG_CONTINUOUS_SCAN,
        AsyncJob.project_id == project_id,
        AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING])
    ).first()

    if existing:
        # PROMPT #255 - Re-submit pending job to executor if queue is empty
        if existing.status == JobStatus.PENDING:
            executor = PriorityJobExecutor.get_instance()
            if executor.queue_size == 0:
                bs = (existing.input_data or {}).get("batch_size", batch_size)
                _submit_to_executor(executor, JobPriority.NORMAL, batch_processing_cycle, existing.id, project_id, bs)
                logger.info(f"Re-submitted existing pending batch job {existing.id} to executor")
        return

    # PROMPT #237 - Set project name for visible notification
    project_name = project_exists.name or str(project_id)[:8]

    jm = JobManager(db)
    job = jm.create_job(
        job_type=JobType.RAG_CONTINUOUS_SCAN,
        input_data={
            "project_id": str(project_id),
            "batch_processing": True,
            "batch_size": batch_size,
        },
        project_id=project_id,
        notification_title=f"Processando arquivos - '{project_name}'",
    )

    executor = PriorityJobExecutor.get_instance()
    _submit_to_executor(executor, JobPriority.NORMAL, batch_processing_cycle, job.id, project_id, batch_size)
    logger.debug(f"Batch processing cycle queued for project {project_id} (batch_size={batch_size}, job {job.id})")


# =============================================================================
# Original submit + auto-discover + bootstrap functions
# =============================================================================

def submit_watchdog_cycle(db: Session, project_id: UUID):
    """
    Submit a new watchdog cycle for a project.
    Checks for existing pending/running jobs to avoid duplicates.
    PROMPT #252: Cleans up stale jobs (>30min) before checking.
    PROMPT #279: Checks if project still exists before submitting.
    Creates a silent (no notification) LOW priority job.
    """
    from datetime import timedelta
    from app.models.async_job import AsyncJob, JobStatus, JobType, JobPriority
    from app.services.job_manager import JobManager
    from app.services.job_executor import PriorityJobExecutor
    from app.models.project import Project

    # PROMPT #279 - Don't submit if project was deleted
    project_exists = db.query(Project).filter(Project.id == project_id).first()
    if not project_exists:
        logger.info(f"Project {project_id} no longer exists, skipping watchdog submit")
        return

    # PROMPT #252 - Clean up stale jobs before checking for duplicates
    stale_cutoff = datetime.utcnow() - timedelta(minutes=30)
    stale_jobs = db.query(AsyncJob).filter(
        AsyncJob.job_type == JobType.RAG_CONTINUOUS_SCAN,
        AsyncJob.project_id == project_id,
        AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
        AsyncJob.created_at < stale_cutoff,
    ).all()
    if stale_jobs:
        for job in stale_jobs:
            job.status = JobStatus.FAILED
            job.result = {"error": "Job obsoleta removida"}
        db.commit()
        logger.info(f"Cleaned up {len(stale_jobs)} stale jobs for project {project_id}")

    # Check no pending/running cycle exists
    existing = db.query(AsyncJob).filter(
        AsyncJob.job_type == JobType.RAG_CONTINUOUS_SCAN,
        AsyncJob.project_id == project_id,
        AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING])
    ).first()

    if existing:
        # PROMPT #255 - If pending job exists in DB but executor might not have it
        # (after restart), re-submit to executor to ensure it runs
        if existing.status == JobStatus.PENDING:
            executor = PriorityJobExecutor.get_instance()
            if executor.queue_size == 0:
                _submit_to_executor(executor, JobPriority.LOW, watchdog_cycle, existing.id, project_id)
                logger.info(f"Re-submitted existing pending watchdog job {existing.id} to executor")
        return

    jm = JobManager(db)
    job = jm.create_job(
        job_type=JobType.RAG_CONTINUOUS_SCAN,
        input_data={"project_id": str(project_id), "watchdog": True},
        project_id=project_id,
        notification_title=None,  # Silent - no notification for background cycles
    )

    executor = PriorityJobExecutor.get_instance()
    _submit_to_executor(executor, JobPriority.LOW, watchdog_cycle, job.id, project_id)
    logger.debug(f"Watchdog cycle queued for project {project_id} (job {job.id})")


def _classify_rule_domain(source_file: str):
    """
    PROMPT #271 - Classify a source file into a business domain.
    Returns (domain_name, domain_slug).
    Reuses the same domain map from wiki.py for consistency.
    """
    _DOMAIN_MAP = [
        ("Aluno/", "Aluno", "aluno"), ("aluno/", "Aluno", "aluno"),
        ("Aulas/", "Aulas", "aulas"), ("aulas/", "Aulas", "aulas"),
        ("Auth/", "Autenticação", "autenticação"), ("auth/", "Autenticação", "autenticação"),
        ("Categorias/", "Categorias", "categorias"), ("categorias/", "Categorias", "categorias"),
        ("Cursos/", "Cursos", "cursos"), ("cursos/", "Cursos", "cursos"),
        ("Instrutor/", "Instrutor", "instrutor"), ("instrutor/", "Instrutor", "instrutor"),
        ("Instrutores", "Instrutor", "instrutor"), ("instrutores/", "Instrutor", "instrutor"),
        ("Trilhas/", "Trilhas", "trilhas"), ("trilhas/", "Trilhas", "trilhas"),
        ("Planos", "Planos", "planos"), ("planos/", "Planos", "planos"),
        ("avaliacoes/", "Avaliacoes", "avaliacoes"), ("Avaliacoes/", "Avaliacoes", "avaliacoes"),
        ("Review", "Avaliacoes", "avaliacoes"),
        ("certificado", "Certificados", "certificados"), ("Certificado", "Certificados", "certificados"),
        ("Certificate", "Certificados", "certificados"),
        ("mensagens/", "Mensagens", "mensagens"),
        ("notificações/", "Notificações", "notificações"), ("Notification", "Notificações", "notificações"),
        ("checkout", "Pagamentos", "pagamentos"),
        ("Enrollment", "Inscricoes", "inscricoes"), ("inscricao", "Inscricoes", "inscricoes"),
        ("inscricoes", "Inscricoes", "inscricoes"),
        ("ajuda/", "Ajuda", "ajuda"),
        ("Models/", "Modelos", "modelos"), ("Observers/", "Modelos", "modelos"),
        ("Policies/", "Modelos", "modelos"),
        ("Requests/", "Validação", "validação"),
        ("config/", "Configuração", "configuração"), ("bootstrap/", "Configuração", "configuração"),
        ("docker-", "Configuração", "configuração"), ("composer.", "Configuração", "configuração"),
        ("package.", "Configuração", "configuração"),
        ("routes/", "Rotas", "rotas"),
    ]
    if not source_file:
        return ("Geral", "geral")
    for fragment, name, slug in _DOMAIN_MAP:
        if fragment in source_file:
            return (name, slug)
    return ("Geral", "geral")


def _find_existing_domain_epic(db, project_id: UUID, domain_name: str):
    """
    PROMPT #271 - Find an existing Epic for a business domain.
    Searches by label 'domain-epic' and title similarity.
    Returns Task or None.
    """
    from app.models.task import Task, ItemType

    # Search by label and domain name in title
    epics = db.query(Task).filter(
        Task.project_id == project_id,
        Task.item_type == ItemType.EPIC,
        Task.labels.contains(["domain-epic"]),
    ).all()

    domain_lower = domain_name.lower()
    for epic in epics:
        if epic.title and domain_lower in epic.title.lower():
            return epic

    return None


async def _create_domain_epic_with_ai(db, project_id: UUID, domain_name: str, domain_rules: list) -> "Task":
    """
    PROMPT #271 - Generate an Epic for a business domain using AI.
    Uses epic_from_rules.yaml prompt to create rich Epic content.
    Falls back to simple Epic creation if AI fails.
    """
    from app.models.task import Task, ItemType, TaskStatus, PriorityLevel
    import json

    rules_text = "\n\n".join([f"- {r['content']}" for r in domain_rules])
    rule_count = len(domain_rules)

    # Try AI generation
    epic_title = f"Gestao de {domain_name}"
    epic_description = rules_text
    epic_acceptance = []

    try:
        from app.prompts.loader import PromptLoader
        from app.services.ai_orchestrator import AIOrchestrator

        loader = PromptLoader()

        # Get project context if available
        from app.models.project import Project
        project = db.query(Project).filter(Project.id == project_id).first()
        project_name = project.name if project else ""
        project_context = project.context_human if project and hasattr(project, 'context_human') else ""

        template_vars = {
            "domain_name": domain_name,
            "rules_text": rules_text,
            "rule_count": str(rule_count),
            "project_name": project_name,
            "project_context": project_context or "",
        }

        sys_prompt, usr_prompt = loader.render("backlog/epic_from_rules", template_vars)

        orchestrator = AIOrchestrator(db)
        response = await orchestrator.execute(
            usage_type="prompt_generation",
            messages=[{"role": "user", "content": usr_prompt}],
            system_prompt=sys_prompt,
            max_tokens=4000,
            project_id=str(project_id),
            metadata={"type": "epic_from_rules", "domain": domain_name},
        )

        ai_text = response.get("content", "") if isinstance(response, dict) else str(response)

        # Parse JSON from AI response
        try:
            # Clean markdown fences if present
            clean = ai_text.strip()
            if clean.startswith("```"):
                clean = clean.split("\n", 1)[1] if "\n" in clean else clean[3:]
                if clean.endswith("```"):
                    clean = clean[:-3]
                clean = clean.strip()

            parsed = json.loads(clean)
            epic_title = parsed.get("title", epic_title)
            epic_description = parsed.get("description_markdown", rules_text)
            raw_criteria = parsed.get("acceptance_criteria", [])
            # Convert to [{text, completed}] format expected by Task model
            epic_acceptance = [
                {"text": c, "completed": False} if isinstance(c, str) else c
                for c in raw_criteria
            ]
        except (json.JSONDecodeError, KeyError) as e:
            logger.warning(f"Failed to parse AI Epic response for domain '{domain_name}': {e}")
            # Fallback: use AI text as description if it's substantial
            if len(ai_text) > 100:
                epic_description = ai_text

    except Exception as e:
        logger.warning(f"AI Epic generation failed for domain '{domain_name}': {e}")

    new_epic = Task(
        project_id=project_id,
        title=epic_title,
        description=epic_description,
        item_type=ItemType.EPIC,
        status=TaskStatus.BACKLOG,
        priority=PriorityLevel.MEDIUM,
        labels=["suggested", "auto-discovered", "domain-epic"],
        workflow_state="draft",
        reporter="watchdog",
        acceptance_criteria=epic_acceptance,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(new_epic)
    db.flush()  # Get the ID without committing
    logger.info(f"Created domain Epic '{epic_title}' for project {project_id}")
    return new_epic


def _create_story_from_rule(db, project_id: UUID, epic_id, rule_content: str, domain_name: str, source_file: str = "") -> "Task":
    """
    PROMPT #271 - Create a Story card from a business rule, linked to its domain Epic.
    Story content focuses on contextual business rules (the rule itself + domain context).
    """
    from app.models.task import Task, ItemType, TaskStatus, PriorityLevel

    # Create title from rule content (first sentence, max 100 chars)
    title = rule_content.split(".")[0].strip()
    if len(title) > 100:
        title = title[:97] + "..."
    if not title or len(title) < 10:
        title = rule_content[:100]

    # Build contextual description with domain and source info
    description_parts = [
        f"## Regra de Negocio\n\n{rule_content}",
        f"\n\n## Dominio\n\n{domain_name}",
    ]
    if source_file:
        description_parts.append(f"\n\n## Arquivo Fonte\n\n`{source_file}`")

    description = "".join(description_parts)

    new_story = Task(
        project_id=project_id,
        title=title,
        description=description,
        item_type=ItemType.STORY,
        status=TaskStatus.BACKLOG,
        priority=PriorityLevel.LOW,
        parent_id=epic_id,
        labels=["suggested", "auto-discovered"],
        workflow_state="draft",
        reporter="watchdog",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(new_story)
    return new_story


async def _auto_discover_cards(db: Session, project_id: UUID, max_cards: int = 0) -> Dict:
    """
    PROMPT #271 - Check for new business rules in RAG and create hierarchical cards.

    Creates Epics per domain, with Stories as children. Respects hierarchy:
    Epic (domain) > Story (rule) > Task (activated later)

    Uses SimilarityDetector (384-dim embeddings, threshold 0.90) to avoid duplicates.

    Args:
        max_cards: Override MAX_CARDS_PER_CYCLE. 0 = use default.
    """
    from sqlalchemy import text as sql_text
    from collections import defaultdict
    from app.models.task import Task, ItemType, TaskStatus, PriorityLevel

    # PROMPT #228 - Extended from 24h→7d and limit 20→50 for complete initial indexing
    result = db.execute(sql_text("""
        SELECT content, COALESCE(metadata->>'source_file', '') as source_file
        FROM rag_documents
        WHERE project_id = :pid
        AND (metadata->>'content_type' = 'business_rule' OR metadata->>'type' = 'business_rule')
        AND created_at > NOW() - INTERVAL '7 days'
        ORDER BY created_at DESC
        LIMIT 50
    """), {"pid": str(project_id)})
    recent_rules = [{"content": row[0], "source_file": row[1]} for row in result.fetchall()]

    if not recent_rules:
        return {"checked": 0, "created": 0, "epics_created": 0}

    # Get all existing card titles + descriptions for similarity check
    existing_tasks = db.query(Task).filter(
        Task.project_id == project_id,
    ).all()

    existing_texts = []
    for t in existing_tasks:
        text = f"{t.title or ''}\n{t.description or ''}"
        existing_texts.append(text)

    try:
        from app.services.similarity_detector import calculate_semantic_similarity
    except ImportError:
        logger.warning("SimilarityDetector not available, skipping card discovery")
        return {"checked": len(recent_rules), "created": 0, "epics_created": 0}

    # Step 1: Filter out duplicate rules (against existing cards + within cycle)
    new_rules = []
    created_texts = []
    effective_max = max_cards if max_cards > 0 else MAX_CARDS_PER_CYCLE

    for rule in recent_rules:
        rule_content = rule["content"]
        if not rule_content or len(rule_content) < 30:
            continue

        if len(new_rules) >= effective_max:
            break

        # Check against existing cards
        is_duplicate = False
        for existing_text in existing_texts:
            if not existing_text.strip():
                continue
            try:
                similarity = calculate_semantic_similarity(rule_content, existing_text)
                if similarity >= 0.90:
                    is_duplicate = True
                    break
            except Exception:
                continue

        if is_duplicate:
            continue

        # Check against rules we already accepted this cycle
        for created_text in created_texts:
            try:
                similarity = calculate_semantic_similarity(rule_content, created_text)
                if similarity >= 0.90:
                    is_duplicate = True
                    break
            except Exception:
                continue

        if is_duplicate:
            continue

        new_rules.append(rule)
        created_texts.append(rule_content)
        existing_texts.append(rule_content)

    if not new_rules:
        return {"checked": len(recent_rules), "created": 0, "epics_created": 0}

    # Step 2: Classify rules by domain
    domains = defaultdict(list)
    for rule in new_rules:
        domain_name, domain_slug = _classify_rule_domain(rule["source_file"])
        domains[domain_name].append(rule)

    # Step 3: For each domain, find or create Epic, then create Stories as children
    created_cards = []
    epics_created = 0

    for domain_name, domain_rules in domains.items():
        # Find existing Epic for this domain
        epic = _find_existing_domain_epic(db, project_id, domain_name)

        if not epic:
            # Create Epic with AI
            try:
                epic = await _create_domain_epic_with_ai(db, project_id, domain_name, domain_rules)
                epics_created += 1
            except Exception as e:
                logger.warning(f"Failed to create Epic for domain '{domain_name}': {e}")
                # Fallback: create simple Epic without AI
                epic = Task(
                    project_id=project_id,
                    title=f"Gestao de {domain_name}",
                    description=f"Epic do dominio {domain_name} com {len(domain_rules)} regras de negocio.",
                    item_type=ItemType.EPIC,
                    status=TaskStatus.BACKLOG,
                    priority=PriorityLevel.MEDIUM,
                    labels=["suggested", "auto-discovered", "domain-epic"],
                    workflow_state="draft",
                    reporter="watchdog",
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                )
                db.add(epic)
                db.flush()
                epics_created += 1

        # Create Stories as children of the Epic
        for rule in domain_rules:
            story = _create_story_from_rule(
                db, project_id, epic.id,
                rule["content"], domain_name, rule["source_file"]
            )
            created_cards.append(story.title)

    if created_cards or epics_created > 0:
        db.commit()

    return {
        "checked": len(recent_rules),
        "created": len(created_cards),
        "epics_created": epics_created,
        "cards": created_cards,
    }


async def _auto_enrich_stub_cards(db: Session, project_id: UUID, max_cards: int = 2) -> int:
    """
    PROMPT #245 - When idle (no new rules), automatically enrich existing stub cards.

    Finds auto-discovered cards with minimal content (no generated_prompt)
    and enriches them using the existing activation flow from ContextGeneratorService.

    Returns number of cards enriched.
    """
    from app.models.task import Task, ItemType

    # Find stub cards that need enrichment
    stub_cards = db.query(Task).filter(
        Task.project_id == project_id,
        Task.labels.contains(["auto-discovered"]),
        Task.generated_prompt.is_(None),
    ).order_by(Task.created_at.asc()).limit(max_cards).all()

    if not stub_cards:
        return 0

    enriched = 0

    try:
        from app.services.context_generator import ContextGeneratorService
        context_service = ContextGeneratorService(db)
    except Exception as e:
        logger.warning(f"ContextGeneratorService not available: {e}")
        return 0

    for card in stub_cards:
        try:
            if card.item_type == ItemType.EPIC:
                await context_service.activate_suggested_epic(card.id)
            elif card.item_type == ItemType.STORY:
                await context_service.activate_suggested_story(card.id)
            elif card.item_type == ItemType.TASK:
                await context_service.activate_suggested_task(card.id)
            else:
                await context_service.activate_suggested_story(card.id)
            enriched += 1
            logger.info(f"Auto-enriched card: {card.title[:60]} ({card.item_type.value if card.item_type else 'story'})")
        except Exception as e:
            logger.warning(f"Failed to enrich card {card.id}: {e}")
            continue

    return enriched


async def bootstrap_watchdog():
    """
    On startup, ensure every active project has appropriate cycle queued.
    PROMPT #245: Projects with pending files resume batch processing.
    PROMPT #251: Uses resilient session with retry on startup.
    PROMPT #252: Cleans up stale jobs before queuing new cycles.
    PROMPT #255: Re-submits orphaned pending DB jobs to in-memory executor.
    Called once from main.py lifespan.
    """
    from datetime import timedelta
    from app.models.async_job import AsyncJob, JobStatus, JobType, JobPriority
    from app.models.project import Project
    from app.models.rag_file_state import RAGFileState, FileProcessingStatus
    from app.services.job_executor import PriorityJobExecutor

    db = _get_resilient_session(max_retries=5, delay=10.0)
    try:
        # PROMPT #259 - Clean up ALL zombie running jobs on startup (any type).
        # On restart, ALL running jobs are zombies (threads died with process).
        zombie_jobs = db.query(AsyncJob).filter(
            AsyncJob.status == JobStatus.RUNNING,
        ).all()
        if zombie_jobs:
            for job in zombie_jobs:
                job.status = JobStatus.FAILED
                job.result = {"error": "Job zumbi removida ao reiniciar"}
            db.commit()
            logger.info(f"Cleaned up {len(zombie_jobs)} zombie running jobs on restart (all types)")

        # PROMPT #259 - Clean up ALL stale pending jobs (>5 min, any type)
        # PROMPT #226 - Reduced from 30min to 5min to handle reload scenarios faster
        stale_cutoff = datetime.utcnow() - timedelta(minutes=5)
        stale_jobs = db.query(AsyncJob).filter(
            AsyncJob.status == JobStatus.PENDING,
            AsyncJob.created_at < stale_cutoff,
        ).all()
        if stale_jobs:
            for job in stale_jobs:
                job.status = JobStatus.FAILED
                job.result = {"error": "Job obsoleta removida ao inicializar"}
            db.commit()
            logger.info(f"Cleaned up {len(stale_jobs)} stale pending jobs (all types)")

        # PROMPT #251 - No automatic watchdog/batch bootstrap on startup.
        # RAG scan is now manual, triggered by user via "Scan Documentos" button.
        logger.info("Watchdog bootstrap: automatic scan disabled. Users trigger scans manually.")
    except Exception as e:
        logger.error(f"Watchdog bootstrap failed: {e}")
    finally:
        db.close()
