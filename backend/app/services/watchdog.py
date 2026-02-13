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


def _submit_to_executor(executor, priority: int, coro_func, *args):
    """
    PROMPT #255 - Submit a coroutine to the executor, handling both async and sync contexts.
    """
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
BATCH_COOLDOWN = 5


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


async def watchdog_cycle(job_id: UUID, project_id: UUID):
    """
    One cycle of the living wiki watchdog for a single project.

    Steps:
    1. RAG file scan (detect new/changed/deleted files, extract rules)
    2. Git commit sync (index new commits in RAG)
    3. Pattern discovery + spec sync
    4. Wiki enrichment (merge RAG findings into project description)
    5. Auto-discover cards (create suggestions for new findings)
    6. Enrich existing stub cards when idle (PROMPT #245)
    7. Sleep then re-queue self

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
            jm.complete_job(job_id, {"skipped": True, "reason": "Project not ready"})
            return  # Don't re-queue if project is gone or invalid

        code_path = project.code_path
        project_name = project.name or str(project_id)[:8]
        logger.info(f"Watchdog cycle started for '{project_name}'")

        # --- Step 1: RAG file scan ---
        jm.update_progress(job_id, 10.0, "Escaneando arquivos por mudancas...")
        rag_result = {}
        try:
            from app.services.continuous_rag_service import ContinuousRAGService
            rag_service = ContinuousRAGService(db)
            rag_result = await rag_service.run_full_cycle(project_id)
            logger.info(f"RAG scan done for '{project_name}'")
        except Exception as e:
            logger.warning(f"RAG scan failed (non-blocking): {e}")

        # --- Step 2: Git commit sync ---
        jm.update_progress(job_id, 30.0, "Sincronizando commits git...")
        git_result = {}
        try:
            from app.services.prompt_doc_rag_sync import GitCommitRAGSync
            git_sync = GitCommitRAGSync(db, project_id, code_path)
            git_result = git_sync.sync(max_commits=50)
            logger.info(f"Git sync done for '{project_name}'")
        except Exception as e:
            logger.warning(f"Git sync failed (non-blocking): {e}")

        # --- Step 3: Pattern discovery + spec sync ---
        jm.update_progress(job_id, 50.0, "Descobrindo padroes no codigo...")
        try:
            from app.services.pattern_discovery import PatternDiscoveryService
            from app.api.routes.projects import _effective_max_patterns
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

        # --- Step 4: Wiki enrichment ---
        # PROMPT #243 - Skip if already enriched in RAG scan (run_full_cycle)
        # PROMPT #252 - Use boolean return to track actual enrichment
        already_enriched = False
        if isinstance(rag_result, dict):
            already_enriched = rag_result.get("wiki_enriched", False)

        if already_enriched:
            jm.update_progress(job_id, 70.0, "Wiki ja enriquecida com novas descobertas")
            logger.info(f"Wiki enrichment skipped for '{project_name}' (already done in RAG scan)")
        else:
            jm.update_progress(job_id, 70.0, "Enriquecendo wiki do projeto...")
            try:
                from app.api.routes.projects import _enrich_context_from_rag
                enriched = await _enrich_context_from_rag(db, project_id)
                if enriched:
                    logger.info(f"Wiki enrichment done for '{project_name}'")
                else:
                    logger.info(f"Wiki enrichment skipped for '{project_name}' (no update needed)")
            except Exception as e:
                logger.warning(f"Wiki enrichment failed (non-blocking): {e}", exc_info=True)

        # --- Step 5: Auto-discover cards ---
        jm.update_progress(job_id, 85.0, "Verificando novas descobertas...")
        card_result = {}
        try:
            card_result = await _auto_discover_cards(db, project_id)
            if card_result.get("created", 0) > 0:
                epics_msg = f" ({card_result.get('epics_created', 0)} epics)" if card_result.get('epics_created', 0) > 0 else ""
                logger.info(f"Auto-discovered {card_result['created']} cards{epics_msg} for '{project_name}'")
        except Exception as e:
            logger.warning(f"Auto card discovery failed (non-blocking): {e}")

        # --- Step 6: Enrich existing stub cards when idle (PROMPT #245) ---
        enriched_cards = 0
        new_cards = card_result.get("created", 0) if isinstance(card_result, dict) else 0
        rag_rules = 0
        if isinstance(rag_result, dict):
            processed = rag_result.get("processed", {})
            if isinstance(processed, dict):
                rag_rules = processed.get("rules_extracted", 0)

        if new_cards == 0 and rag_rules == 0:
            jm.update_progress(job_id, 92.0, "Enriquecendo cards existentes (modo idle)...")
            try:
                enriched_cards = await _auto_enrich_stub_cards(db, project_id, max_cards=1)
                if enriched_cards > 0:
                    logger.info(f"Auto-enriched {enriched_cards} cards in idle mode for '{project_name}'")
            except Exception as e:
                logger.warning(f"Idle card enrichment failed (non-blocking): {e}")

        jm.complete_job(job_id, {
            "project_id": str(project_id),
            "rag_scan": rag_result.get("processed", {}).get("processed_count", 0) if isinstance(rag_result, dict) else 0,
            "git_commits": git_result.get("new_commits", 0) if isinstance(git_result, dict) else 0,
            "cards_created": card_result.get("created", 0),
            "cards_enriched": enriched_cards,
        })

        logger.info(f"Watchdog cycle completed for '{project_name}'")

        # PROMPT #259 - Conditional cooldown: check if there's pending work
        has_work = False
        try:
            from app.models.rag_file_state import RAGFileState, FileProcessingStatus
            pending_files = db.query(RAGFileState).filter(
                RAGFileState.project_id == project_id,
                RAGFileState.status == FileProcessingStatus.PENDING,
            ).count()
            has_work = pending_files > 0 or card_result.get("created", 0) > 0 or enriched_cards > 0
        except Exception:
            pass

        cooldown = CYCLE_COOLDOWN if has_work else IDLE_COOLDOWN
        logger.info(f"Watchdog cooldown for '{project_name}': {cooldown}s ({'active' if has_work else 'idle'})")
        await asyncio.sleep(cooldown)
        submit_watchdog_cycle(db, project_id)

    except Exception as e:
        logger.error(f"Watchdog cycle failed for project {project_id}: {e}", exc_info=True)
        try:
            jm.fail_job(job_id, str(e))
        except Exception:
            pass
        # Re-queue even on failure (with longer cooldown)
        await asyncio.sleep(ERROR_COOLDOWN)
        # Use a fresh session for re-queuing since the original may be dead
        requeue_db = None
        try:
            requeue_db = _get_resilient_session()
            submit_watchdog_cycle(requeue_db, project_id)
        except Exception:
            logger.warning(f"Failed to re-queue watchdog for {project_id} (DB unavailable)")
        finally:
            if requeue_db:
                requeue_db.close()
    finally:
        db.close()


# =============================================================================
# PROMPT #245 - Batch Processing Cycle
# =============================================================================

async def batch_processing_cycle(job_id: UUID, project_id: UUID, batch_size: int = 30):
    """
    Aggressive batch processing cycle for initial project ingestion.

    Unlike watchdog_cycle (60s cooldown, all 5 steps), this:
    - Processes files in batches of batch_size
    - After each batch: enriches wiki + creates cards
    - When all files processed: transitions to normal watchdog
    - When idle (no new rules): enriches existing stub cards
    - Short cooldown (5s) between batches
    - Runs at NORMAL priority (higher than watchdog's LOW)

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
            jm.complete_job(job_id, {"skipped": True, "reason": "Project not ready"})
            return

        project_name = project.name or str(project_id)[:8]
        logger.info(f"Batch processing cycle for '{project_name}' (batch_size={batch_size})")

        # --- Step 1: Process next batch of pending files ---
        jm.update_progress(job_id, 10.0, f"Processando proximo lote ({batch_size} arquivos max)...")
        process_result = {}
        try:
            from app.services.continuous_rag_service import ContinuousRAGService
            rag_service = ContinuousRAGService(db)
            process_result = await rag_service.process_pending_files(project_id, batch_size=batch_size)
            actual = process_result.get('processed', 0)
            remaining = process_result.get('pending_remaining', 0)
            rules = process_result.get('rules_extracted', 0)
            logger.info(f"Batch processed for '{project_name}': {actual} files, {rules} rules")
            jm.update_progress(job_id, 30.0, f"Processados {actual} arquivos, {remaining} restantes, {rules} regras extraidas")
        except Exception as e:
            logger.warning(f"Batch processing failed (non-blocking): {e}")

        rules_extracted = process_result.get("rules_extracted", 0)
        pending_remaining = process_result.get("pending_remaining", 0)

        # --- Step 2: Enrich wiki if new rules found ---
        # PROMPT #255 - Use boolean return from _enrich_context_from_rag (PROMPT #252 fix)
        wiki_enriched = False
        if rules_extracted > 0:
            jm.update_progress(job_id, 50.0, f"Enriquecendo wiki com {rules_extracted} novas regras...")
            try:
                from app.api.routes.projects import _enrich_context_from_rag
                wiki_enriched = await _enrich_context_from_rag(db, project_id)
                if wiki_enriched:
                    logger.info(f"Wiki enriched after batch for '{project_name}'")
                else:
                    logger.info(f"Wiki enrichment skipped for '{project_name}' (no update needed)")
            except Exception as e:
                logger.warning(f"Wiki enrichment failed (non-blocking): {e}", exc_info=True)

        # --- Step 3: Create cards from new business rules ---
        # PROMPT #260 - Batch mode uses higher card limit (15) for faster initial coverage
        card_result = {}
        if rules_extracted > 0:
            jm.update_progress(job_id, 70.0, "Criando cards a partir de novas descobertas...")
            try:
                card_result = await _auto_discover_cards(db, project_id, max_cards=15)
                if card_result.get("created", 0) > 0:
                    epics_msg = f" ({card_result.get('epics_created', 0)} epics)" if card_result.get('epics_created', 0) > 0 else ""
                    logger.info(f"Auto-discovered {card_result['created']} cards{epics_msg} for '{project_name}'")
            except Exception as e:
                logger.warning(f"Auto card discovery failed (non-blocking): {e}")

        # --- Step 4: If idle (no new rules), enrich existing stub cards ---
        enriched_cards = 0
        if rules_extracted == 0 and card_result.get("created", 0) == 0:
            jm.update_progress(job_id, 80.0, "Enriquecendo cards existentes...")
            try:
                enriched_cards = await _auto_enrich_stub_cards(db, project_id, max_cards=2)
                if enriched_cards > 0:
                    logger.info(f"Auto-enriched {enriched_cards} stub cards for '{project_name}'")
            except Exception as e:
                logger.warning(f"Card enrichment failed (non-blocking): {e}")

        jm.complete_job(job_id, {
            "project_id": str(project_id),
            "batch_processed": process_result.get("processed", 0),
            "rules_extracted": rules_extracted,
            "pending_remaining": pending_remaining,
            "wiki_enriched": wiki_enriched,
            "cards_created": card_result.get("created", 0),
            "cards_enriched": enriched_cards,
        })

        # --- Decide next action ---
        await asyncio.sleep(BATCH_COOLDOWN)

        if pending_remaining > 0:
            # More files to process - queue another batch cycle
            submit_batch_processing_cycle(db, project_id, batch_size=batch_size)
        else:
            # All files processed - transition to normal watchdog
            logger.info(f"All files processed for '{project_name}', transitioning to watchdog mode")
            submit_watchdog_cycle(db, project_id)

    except Exception as e:
        logger.error(f"Batch processing failed for project {project_id}: {e}", exc_info=True)
        try:
            jm.fail_job(job_id, str(e))
        except Exception:
            pass
        # Re-queue even on failure
        await asyncio.sleep(ERROR_COOLDOWN)
        # Use a fresh session for re-queuing since the original may be dead
        requeue_db = None
        try:
            requeue_db = _get_resilient_session()
            submit_batch_processing_cycle(requeue_db, project_id, batch_size=batch_size)
        except Exception:
            logger.warning(f"Failed to re-queue batch processing for {project_id} (DB unavailable)")
        finally:
            if requeue_db:
                requeue_db.close()
    finally:
        db.close()


def submit_batch_processing_cycle(db: Session, project_id: UUID, batch_size: int = 30):
    """
    PROMPT #245 - Submit a batch processing cycle.
    PROMPT #252: Cleans up stale jobs (>30min) before checking.
    Uses NORMAL priority (higher than watchdog's LOW) because initial
    ingestion is more important than maintenance scanning.
    """
    from datetime import timedelta
    from app.models.async_job import AsyncJob, JobStatus, JobType, JobPriority
    from app.services.job_manager import JobManager
    from app.services.job_executor import PriorityJobExecutor

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
            job.result = {"error": "Stale job cleaned up"}
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

    jm = JobManager(db)
    job = jm.create_job(
        job_type=JobType.RAG_CONTINUOUS_SCAN,
        input_data={
            "project_id": str(project_id),
            "batch_processing": True,
            "batch_size": batch_size,
        },
        project_id=project_id,
        notification_title=None,  # Silent
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
    Creates a silent (no notification) LOW priority job.
    """
    from datetime import timedelta
    from app.models.async_job import AsyncJob, JobStatus, JobType, JobPriority
    from app.services.job_manager import JobManager
    from app.services.job_executor import PriorityJobExecutor

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
            job.result = {"error": "Stale job cleaned up"}
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
        ("Auth/", "Autenticacao", "autenticacao"), ("auth/", "Autenticacao", "autenticacao"),
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
        ("notificacoes/", "Notificacoes", "notificacoes"), ("Notification", "Notificacoes", "notificacoes"),
        ("checkout", "Pagamentos", "pagamentos"),
        ("Enrollment", "Inscricoes", "inscricoes"), ("inscricao", "Inscricoes", "inscricoes"),
        ("inscricoes", "Inscricoes", "inscricoes"),
        ("ajuda/", "Ajuda", "ajuda"),
        ("Models/", "Modelos", "modelos"), ("Observers/", "Modelos", "modelos"),
        ("Policies/", "Modelos", "modelos"),
        ("Requests/", "Validacao", "validacao"),
        ("config/", "Configuracao", "configuracao"), ("bootstrap/", "Configuracao", "configuracao"),
        ("docker-", "Configuracao", "configuracao"), ("composer.", "Configuracao", "configuracao"),
        ("package.", "Configuracao", "configuracao"),
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
    Epic (domain) > Story (rule) > Task (activated later) > Subtask (activated later)

    Uses SimilarityDetector (384-dim embeddings, threshold 0.90) to avoid duplicates.

    Args:
        max_cards: Override MAX_CARDS_PER_CYCLE. 0 = use default.
    """
    from sqlalchemy import text as sql_text
    from collections import defaultdict
    from app.models.task import Task, ItemType, TaskStatus, PriorityLevel

    # Get recent business rules from RAG (last 24 hours) WITH source_file for domain classification
    result = db.execute(sql_text("""
        SELECT content, COALESCE(metadata->>'source_file', '') as source_file
        FROM rag_documents
        WHERE project_id = :pid
        AND (metadata->>'content_type' = 'business_rule' OR metadata->>'type' = 'business_rule')
        AND created_at > NOW() - INTERVAL '24 hours'
        ORDER BY created_at DESC
        LIMIT 20
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
            elif card.item_type == ItemType.SUBTASK:
                await context_service.activate_suggested_subtask(card.id)
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
                job.result = {"error": "Zombie job cleaned up on restart"}
            db.commit()
            logger.info(f"Cleaned up {len(zombie_jobs)} zombie running jobs on restart (all types)")

        # PROMPT #259 - Clean up ALL stale pending jobs (>30 min, any type)
        stale_cutoff = datetime.utcnow() - timedelta(minutes=30)
        stale_jobs = db.query(AsyncJob).filter(
            AsyncJob.status == JobStatus.PENDING,
            AsyncJob.created_at < stale_cutoff,
        ).all()
        if stale_jobs:
            for job in stale_jobs:
                job.status = JobStatus.FAILED
                job.result = {"error": "Stale job cleaned up by bootstrap"}
            db.commit()
            logger.info(f"Cleaned up {len(stale_jobs)} stale pending jobs (all types)")

        # PROMPT #255 - Re-submit orphaned pending jobs to in-memory executor.
        # After restart, DB jobs may be 'pending' but not in the executor's in-memory queue.
        orphaned_jobs = db.query(AsyncJob).filter(
            AsyncJob.job_type == JobType.RAG_CONTINUOUS_SCAN,
            AsyncJob.status == JobStatus.PENDING,
        ).all()
        if orphaned_jobs:
            executor = PriorityJobExecutor.get_instance()
            for orphan in orphaned_jobs:
                input_data = orphan.input_data or {}
                project_id_str = input_data.get("project_id")
                if not project_id_str:
                    continue
                orphan_project_id = UUID(project_id_str)

                if input_data.get("batch_processing"):
                    batch_size = input_data.get("batch_size", 30)
                    await executor.submit(
                        JobPriority.NORMAL,
                        batch_processing_cycle,
                        orphan.id,
                        orphan_project_id,
                        batch_size,
                    )
                    logger.info(f"Re-submitted orphaned batch job {orphan.id} for project {project_id_str}")
                else:
                    await executor.submit(
                        JobPriority.LOW,
                        watchdog_cycle,
                        orphan.id,
                        orphan_project_id,
                    )
                    logger.info(f"Re-submitted orphaned watchdog job {orphan.id} for project {project_id_str}")
            logger.info(f"Re-submitted {len(orphaned_jobs)} orphaned jobs to executor")
            db.close()
            return  # Don't create new jobs - orphaned ones will handle it

        projects = db.query(Project).filter(
            Project.code_path.isnot(None),
            Project.code_path != "",
            Project.initial_scan_complete == True,
        ).all()

        count = 0
        for project in projects:
            try:
                # PROMPT #245 - Check if project has pending files (still in initial ingestion)
                pending_count = db.query(RAGFileState).filter(
                    RAGFileState.project_id == project.id,
                    RAGFileState.status == FileProcessingStatus.PENDING,
                ).count()

                if pending_count > 0:
                    # Still processing initial files - use batch mode
                    # PROMPT #260 - Reduced batch sizes to avoid flooding
                    batch_size = {"quick": 15, "normal": 30}.get(project.scan_depth, 20)
                    submit_batch_processing_cycle(db, project.id, batch_size=batch_size)
                    logger.info(f"Batch processing resumed for {project.name} ({pending_count} pending)")
                else:
                    # All files processed - use regular watchdog
                    submit_watchdog_cycle(db, project.id)
                count += 1
            except Exception as e:
                logger.warning(f"Failed to bootstrap watchdog for {project.name}: {e}")

        if count > 0:
            logger.info(f"Watchdog/batch bootstrapped for {count} project(s)")
    except Exception as e:
        logger.error(f"Watchdog bootstrap failed: {e}")
    finally:
        db.close()
