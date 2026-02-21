"""
Project Service - Business logic extracted from project routes.

Contains background job handlers, context merging, wiki enrichment,
and card generation logic.
Extracted during Frente 4 refactoring (PROMPT #252).

Route handlers in projects.py import from this module.
"""

import re
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.project import Project
from app.models.async_job import AsyncJob, JobType, JobStatus
from app.models.spec import Spec
from app.models.system_settings import SystemSettings
from app.services.codebase_memory import CodebaseMemoryService
from app.services.job_manager import JobManager
from app.services.pattern_discovery import PatternDiscoveryService

logger = logging.getLogger(__name__)

MAX_SPECS_PER_PROJECT = 50


def initialize_project_knowledge_base(code_path: str, project_name: str) -> str:
    """
    PROMPT #235 - Create satellite/ KB structure inside code_path.

    Creates code_path itself if it doesn't exist.
    Creates satellite/ and all subfolders (idempotent).
    Creates satellite/README.md if not present (REGRA #0 - never overwrites).

    Returns the satellite/ path as string.
    """
    from app.services.orbit_folder import ensure_satellite_dirs

    path = Path(code_path)
    satellite_path = ensure_satellite_dirs(path)

    # Create README.md only if not present (REGRA #0)
    readme = satellite_path / "README.md"
    if not readme.exists():
        readme.write_text(
            f"# {project_name}\n\n"
            "Base de conhecimento gerenciada pelo ORBIT.\n\n"
            "## Estrutura\n\n"
            "- `prompts/` — Prompts gerados para cards e logs de execucao de IA\n"
            "- `results/` — Resultados de execucao de tasks pelo Claude Code\n"
            "- `knowledge/` — Arquivos de contexto e documentacao adicional\n"
            "- `docs/` — Documentacao publica do projeto\n"
            "- `rag/internal/` — Reports de implementacao\n"
            "- `rag/docs/` — Documentacao geral\n",
            encoding="utf-8"
        )
        logger.info(f"Created satellite/README.md for project '{project_name}'")

    return str(satellite_path)


def _get_max_patterns(db: Session) -> int:
    """Read max_discovery_patterns from system_settings, default 20.
    Auto-creates the setting with default value if it doesn't exist."""
    setting = db.query(SystemSettings).filter(
        SystemSettings.key == "max_discovery_patterns"
    ).first()
    if not setting:
        setting = SystemSettings(
            key="max_discovery_patterns",
            value="20",
            description="Max patterns per discovery scan (default 20, cap 50 per project)"
        )
        db.add(setting)
        db.commit()
    return int(setting.value)


def _merge_memory_context(existing: dict, new_scan: dict) -> dict:
    """
    PROMPT #285 - Smart merge of memory context to prevent data loss on re-scan.

    Strategy:
    - List fields (business_rules, key_features, entities): union with dedup
    - Scalar fields (suggested_title, scan_summary, stack_info): new scan wins
      (these are factual observations that improve with each scan)
    - Preserves any keys from existing that new scan doesn't produce

    This ensures manually-added rules are never lost during re-scan.
    """
    if not existing:
        return new_scan
    if not new_scan:
        return existing

    merged = dict(existing)

    # List fields: merge with case-insensitive dedup
    list_fields = ["business_rules", "key_features", "entities"]
    for field in list_fields:
        old_items = existing.get(field, [])
        new_items = new_scan.get(field, [])
        if not isinstance(old_items, list):
            old_items = []
        if not isinstance(new_items, list):
            new_items = []

        # Case-insensitive dedup using lowercase set
        seen = set()
        merged_list = []
        for item in new_items + old_items:
            key = str(item).strip().lower()
            if key and key not in seen:
                seen.add(key)
                merged_list.append(item)
        merged[field] = merged_list

    # Scalar/dict fields: new scan wins (more recent data)
    scalar_fields = [
        "suggested_title", "scan_summary", "stack_info",
        "interview_context", "detected_stack"
    ]
    for field in scalar_fields:
        if field in new_scan:
            merged[field] = new_scan[field]

    # Any other keys from new scan that aren't in merged yet
    for key, value in new_scan.items():
        if key not in merged:
            merged[key] = value

    return merged


def _effective_max_patterns(db: Session, project_id) -> int:
    """Calculate effective max patterns considering the 50 specs cap."""
    max_patterns = _get_max_patterns(db)
    existing_count = db.query(Spec).filter(Spec.project_id == project_id).count()
    return max(0, min(max_patterns, MAX_SPECS_PER_PROJECT - existing_count))

def _sanitize_project_name(name: str) -> str:
    """
    Sanitize project name for filesystem usage.
    Converts to lowercase, replaces spaces/special chars with hyphens.
    """
    sanitized = name.lower()
    sanitized = re.sub(r'[^\w\s-]', '', sanitized)
    sanitized = re.sub(r'[\s_]+', '-', sanitized)
    sanitized = sanitized.strip('-')
    return sanitized or 'project'

async def _process_memory_scan_async(
    job_id: UUID,
    code_path: str,
    project_id: Optional[UUID],
    scan_depth: str = "normal"
):
    """
    Background task to process codebase memory scan.

    PROMPT #133 - Background jobs for memory scan
    PROMPT #163 - Now accepts scan_depth parameter for multi-phase analysis
    """
    from app.database import SessionLocal

    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        logger.info(f"🚀 Memory scan background task started for job {job_id} (depth={scan_depth})")

        # Get folder name for notification
        folder_name = Path(code_path).name

        job_manager.update_progress(job_id, 10.0, f"Iniciando scan {scan_depth}...")

        memory_service = CodebaseMemoryService(db)

        # PROMPT #168 - Progress callback for granular updates
        def progress_callback(percent: float, message: str):
            job_manager.update_progress(job_id, percent, message)

        # PROMPT #163 - Pass scan_depth to memory service
        # PROMPT #168 - Pass progress callback for granular updates
        # PROMPT #298 - Pass job_id for sub-job hierarchy
        result = await memory_service.scan_and_memorize(
            code_path=code_path,
            project_id=project_id,
            scan_depth=scan_depth,
            progress_callback=progress_callback,
            job_id=job_id
        )

        # PROMPT #284 - Write scan result back to project.initial_memory_context
        # PROMPT #285 - Merge with existing data instead of blind overwrite
        if project_id:
            project = db.query(Project).filter(Project.id == project_id).first()
            if project:
                # PROMPT #247 - Title is always manual, never auto-generated
                # suggested_title from scan is stored in initial_memory_context but NOT applied

                # PROMPT #285 - Smart merge: preserve existing data, add new findings
                existing_ctx = project.initial_memory_context or {}
                merged_ctx = _merge_memory_context(existing_ctx, result)
                project.initial_memory_context = merged_ctx
                project.initial_scan_complete = True
                # PROMPT #232 - IC-5/IA-5: promote to active on scan success
                from app.models.project import ProjectStatus
                if project.status == ProjectStatus.draft:
                    project.status = ProjectStatus.active
                    logger.info(f"📦 Project '{project.name}' promoted to active (scan complete)")
                project.scan_depth = scan_depth
                project.updated_at = datetime.utcnow()
                db.commit()
                logger.info(
                    f"Updated initial_memory_context (merged): "
                    f"rules={len(merged_ctx.get('business_rules', []))}, "
                    f"features={len(merged_ctx.get('key_features', []))}"
                )

                # PROMPT #233 - Pipeline is read-only: wiki enrichment and card generation
                # are triggered manually by the user, not automatically after scan.
                job_manager.update_progress(job_id, 85.0, "Scan concluido. Cards e wiki podem ser gerados manualmente.")

        # PROMPT #202 - Discover specs and sync to RAG after memory scan
        if project_id:
            effective_max = _effective_max_patterns(db, project_id)
            if effective_max > 0:
                job_manager.update_progress(job_id, 90.0, "Descobrindo padrões de código e gerando specs...")
                try:
                    discovery_service = PatternDiscoveryService(db)
                    discovered_patterns = await discovery_service.discover_patterns(
                        project_path=Path(code_path),
                        project_id=project_id,
                        max_patterns=effective_max,
                        min_occurrences=2
                    )
                    logger.info(f"📋 Discovered {len(discovered_patterns)} patterns for project {project_id}")

                    from app.services.spec_rag_sync import SpecRAGSync
                    spec_sync = SpecRAGSync(db)
                    sync_result = spec_sync.sync_all_framework_specs()
                    logger.info(f"📡 Specs synced to RAG: {sync_result.get('synced', 0)} new, {sync_result.get('skipped', 0)} skipped")
                except Exception as e:
                    logger.warning(f"⚠️ Spec discovery/sync failed (non-blocking): {e}")
            else:
                logger.info(f"📋 Project {project_id} already has {MAX_SPECS_PER_PROJECT} specs, skipping discovery")

        job_manager.update_progress(job_id, 98.0, "Finalizando resultados...")

        # PROMPT #133 - Update notification_title for success
        job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if job:
            suggested_title = result.get("suggested_title", folder_name)
            job.notification_title = f"✅ Análise concluida: '{suggested_title}'"
            db.commit()

        job_manager.complete_job(job_id, result)
        logger.info(f"✅ Memory scan job {job_id} completed")

    except Exception as e:
        logger.error(f"❌ Memory scan job {job_id} failed: {str(e)}", exc_info=True)

        # PROMPT #133 - Update notification_title for failure
        try:
            job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
            if job:
                error_msg = str(e)[:80]
                job.notification_title = f"❌ Erro na análise: {error_msg}"
                db.commit()
        except Exception:
            pass

        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()

async def _process_quick_create_scan(
    job_id: UUID,
    project_id: UUID,
    code_path: str,
    scan_depth: str = "normal"  # PROMPT #163
):
    """
    Background task for quick-create memory scan.

    PROMPT #137 - Updates project name with AI-suggested title.
    PROMPT #163 - Supports configurable scan_depth (quick/normal/deep).
    """
    from app.database import SessionLocal

    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        logger.info(f"🚀 Quick-create scan started for project {project_id}")

        folder_name = Path(code_path).name

        job_manager.update_progress(job_id, 10.0, "Escaneando estrutura de código...")

        memory_service = CodebaseMemoryService(db)

        job_manager.update_progress(job_id, 30.0, "Analisando código e extraindo padrões...")

        # PROMPT #163 - Pass scan_depth for configurable analysis depth
        # PROMPT #298 - Pass job_id for sub-job hierarchy
        result = await memory_service.scan_and_memorize(
            code_path=code_path,
            project_id=project_id,
            scan_depth=scan_depth,
            job_id=job_id
        )

        job_manager.update_progress(job_id, 80.0, "Atualizando projeto com achados...")

        # PROMPT #247 - Title is always manual, never auto-generated
        project = db.query(Project).filter(Project.id == project_id).first()
        if project:

            # Store memory context for Context Interview
            project.initial_memory_context = result
            # PROMPT #222 - Signal that initial scan is done so Continuous RAG can start
            project.initial_scan_complete = True
            # PROMPT #232 - IC-5/IA-5: promote to active on scan success
            from app.models.project import ProjectStatus
            if project.status == ProjectStatus.draft:
                project.status = ProjectStatus.active
                logger.info(f"📦 Project '{project.name}' promoted to active (scan complete)")
            project.updated_at = datetime.utcnow()
            db.commit()

        # PROMPT #202 - Discover specs and sync to RAG after memory scan
        effective_max = _effective_max_patterns(db, project_id)
        if effective_max > 0:
            job_manager.update_progress(job_id, 85.0, "Descobrindo padrões de código e gerando specs...")
            try:
                discovery_service = PatternDiscoveryService(db)
                discovered_patterns = await discovery_service.discover_patterns(
                    project_path=Path(code_path),
                    project_id=project_id,
                    max_patterns=effective_max,
                    min_occurrences=2
                )
                logger.info(f"📋 Discovered {len(discovered_patterns)} patterns for project {project_id}")

                # Sync all project specs to RAG
                from app.services.spec_rag_sync import SpecRAGSync
                spec_sync = SpecRAGSync(db)
                sync_result = spec_sync.sync_all_framework_specs()
                logger.info(f"📡 Specs synced to RAG: {sync_result.get('synced', 0)} new, {sync_result.get('skipped', 0)} skipped")
            except Exception as e:
                logger.warning(f"⚠️ Spec discovery/sync failed (non-blocking): {e}")
        else:
            logger.info(f"📋 Project {project_id} already has {MAX_SPECS_PER_PROJECT} specs, skipping discovery")

        job_manager.update_progress(job_id, 95.0, "Finalizando...")

        # Update notification title for success
        job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if job:
            final_title = project.name if project else folder_name
            job.notification_title = f"✅ Projeto criado: '{final_title}'"
            db.commit()

        job_manager.complete_job(job_id, result)
        logger.info(f"✅ Quick-create scan completed for project {project_id}")

        # PROMPT #233 - Pipeline is read-only: card generation is triggered
        # manually by the user via UI buttons, not automatically after scan.

    except Exception as e:
        logger.error(f"❌ Quick-create scan failed for project {project_id}: {str(e)}", exc_info=True)

        # Update notification title for failure
        try:
            job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
            if job:
                error_msg = str(e)[:80]
                job.notification_title = f"❌ Erro na análise: {error_msg}"
                db.commit()
        except Exception:
            pass

        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()

async def _process_initial_scan(
    job_id: UUID,
    project_id: UUID,
    code_path: str,
    scan_depth: str = "normal"
):
    """
    PROMPT #301 - Non-blocking initial scan.

    Runs memory scan, updates project progressively, then submits
    independent follow-up jobs (wiki, cards, batch processing).
    Project is already active - this just enriches it.
    """
    from app.database import SessionLocal

    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        logger.info(f"Initial scan started for project {project_id}")

        folder_name = Path(code_path).name

        # === Step A: Memory Scan ===
        job_manager.update_progress(job_id, 5.0, "Iniciando scan do codebase...")

        memory_service = CodebaseMemoryService(db)

        job_manager.update_progress(job_id, 15.0, "Analisando estrutura de codigo...")

        result = await memory_service.scan_and_memorize(
            code_path=code_path,
            project_id=project_id,
            scan_depth=scan_depth,
            job_id=job_id
        )

        job_manager.update_progress(job_id, 80.0, "Scan concluido. Salvando resultados...")

        # === Step B: Update project with scan results ===
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        # PROMPT #247 - Title and description are always manual, never auto-generated
        project.initial_memory_context = result
        project.initial_scan_complete = True
        # PROMPT #232 - IC-5/IA-5: promote to active on scan success
        from app.models.project import ProjectStatus
        if project.status == ProjectStatus.draft:
            project.status = ProjectStatus.active
            logger.info(f"📦 Project '{project.name}' promoted to active (scan complete)")

        project.updated_at = datetime.utcnow()
        db.commit()

        # Complete scan job
        job_manager.complete_job(job_id, {
            "success": True,
            "project_id": str(project_id),
            "project_name": project.name,
            "scan_depth": scan_depth
        })

        # Update notification
        job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if job:
            job.notification_title = f"Scan concluido: '{project.name}'"
            db.commit()

        logger.info(f"Initial scan completed for project {project_id}")

        # === Step C: Submit independent follow-up jobs ===
        # PROMPT #233 - Pipeline is read-only: C1 (wiki enrichment) and C2 (card generation)
        # removed. These are now triggered manually by the user via UI buttons.
        from app.services.job_executor import PriorityJobExecutor
        executor = PriorityJobExecutor.get_instance()

        # C3: Register remaining files and start batch processing / watchdog
        try:
            if scan_depth != "deep":
                from app.services.continuous_rag_service import ContinuousRAGService
                rag_service = ContinuousRAGService(db)
                await rag_service.scan_for_changes(project_id)
                logger.info(f"Registered remaining files for batch processing")

                from app.services.watchdog import submit_batch_processing_cycle
                batch_size = {"quick": 8, "normal": 10}.get(scan_depth, 10)
                submit_batch_processing_cycle(db, project_id, batch_size=batch_size)
                logger.info(f"Batch processing started (batch_size={batch_size})")
            else:
                from app.services.watchdog import submit_watchdog_cycle
                submit_watchdog_cycle(db, project_id)
                logger.info(f"Watchdog started for project {project_id} (deep scan)")
        except Exception as e:
            logger.warning(f"Post-scan job start failed (non-blocking): {e}")

    except Exception as e:
        logger.error(f"Initial scan failed for project {project_id}: {str(e)}", exc_info=True)

        # Update notification title for failure
        try:
            job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
            if job:
                error_msg = str(e)[:80]
                job.notification_title = f"Erro no scan: {error_msg}"
                db.commit()
        except Exception:
            pass

        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()

async def _enrich_wiki_job(job_id: UUID, project_id: UUID):
    """
    PROMPT #301 - Wiki enrichment as independent job.
    Wraps _enrich_context_from_rag in a job for granular tracking.
    """
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        job_manager.update_progress(job_id, 10.0, "Expandindo wiki do projeto...")

        enriched = await _enrich_context_from_rag(db, project_id)

        if enriched:
            job_manager.complete_job(job_id, {"enriched": True})
            # Update notification
            project = db.query(Project).filter(Project.id == project_id).first()
            job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
            if job and project:
                job.notification_title = f"Wiki expandida: '{project.name}'"
                db.commit()
            logger.info(f"Wiki enrichment job completed for project {project_id}")
        else:
            job_manager.complete_job(job_id, {"enriched": False, "reason": "Sem dados suficientes"})
            logger.info(f"Wiki enrichment skipped for {project_id} - no data")

    except Exception as e:
        logger.error(f"Wiki enrichment job failed for {project_id}: {e}", exc_info=True)
        try:
            job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
            if job:
                job.notification_title = f"Erro na wiki: {str(e)[:80]}"
                db.commit()
        except Exception:
            pass
        job_manager.fail_job(job_id, str(e))
    finally:
        db.close()

async def _enrich_context_from_rag(db, project_id: UUID) -> bool:
    """
    PROMPT #239 - Living Wiki: enrich project description from RAG findings.
    PROMPT #252 - Removed context_locked guard. Description evolves continuously.
    PROMPT #258 - Enriched with interview answers, scan summary, features.
    context_semantic and context_human remain immutable (managed by epic flow).
    Returns True if enrichment actually happened, False otherwise.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        return False

    # --- 1. Get business rules from RAG ---
    # PROMPT #227 - Reduced from 500 to 80 rules to avoid Ollama timeout on local GPU
    # 80 rules × ~200 chars = ~16K chars input, well within qwen3:8b context
    from sqlalchemy import text as sql_text
    result = db.execute(sql_text("""
        SELECT content FROM rag_documents
        WHERE project_id = :pid
        AND (metadata->>'content_type' = 'business_rule' OR metadata->>'type' = 'business_rule')
        ORDER BY created_at DESC
        LIMIT 80
    """), {"pid": str(project_id)})
    rules = [row[0][:300] for row in result.fetchall()]  # Truncate long rules

    # --- 2. Get interview answers from RAG ---
    interview_result = db.execute(sql_text("""
        SELECT content FROM rag_documents
        WHERE project_id = :pid
        AND (metadata->>'content_type' = 'interview_answer' OR metadata->>'type' = 'interview_answer')
        ORDER BY created_at DESC
        LIMIT 30
    """), {"pid": str(project_id)})
    interview_answers = [row[0] for row in interview_result.fetchall()]

    # --- 3. Extract scan_summary and features from initial_memory_context ---
    scan_summary = ""
    existing_features = ""
    stack_info = ""
    if project.initial_memory_context and isinstance(project.initial_memory_context, dict):
        mem = project.initial_memory_context

        # Stack info
        si = mem.get("stack_info", {})
        if si and isinstance(si, dict):
            parts = []
            if si.get("languages"):
                parts.append(f"Linguagens: {', '.join(si['languages']) if isinstance(si['languages'], list) else si['languages']}")
            if si.get("frameworks"):
                parts.append(f"Frameworks: {', '.join(si['frameworks']) if isinstance(si['frameworks'], list) else si['frameworks']}")
            if si.get("databases"):
                parts.append(f"Bancos: {', '.join(si['databases']) if isinstance(si['databases'], list) else si['databases']}")
            stack_info = "\n".join(parts) if parts else str(si)
        elif si:
            stack_info = str(si)

        # Scan summary
        ss = mem.get("scan_summary", {})
        if ss and isinstance(ss, dict):
            parts = []
            if ss.get("total_files"):
                parts.append(f"Total de arquivos: {ss['total_files']}")
            if ss.get("code_files"):
                parts.append(f"Arquivos de código: {ss['code_files']}")
            langs = ss.get("languages", {})
            if langs and isinstance(langs, dict):
                lang_str = ", ".join(f"{k} ({v})" for k, v in sorted(langs.items(), key=lambda x: -x[1])[:8])
                parts.append(f"Linguagens detectadas: {lang_str}")
            scan_summary = "\n".join(parts) if parts else str(ss)
        elif ss:
            scan_summary = str(ss)

        # Features
        feats = mem.get("key_features", [])
        if feats and isinstance(feats, list):
            existing_features = "\n".join(f"- {f}" for f in feats[:30])

    # --- 4. Check if we have ANY data to enrich ---
    has_rules = bool(rules)
    has_interviews = bool(interview_answers)
    has_scan = bool(scan_summary)
    has_features = bool(existing_features)

    if not has_rules and not has_interviews and not has_scan and not has_features:
        logger.info(f"No RAG data for {project_id}, skipping wiki enrichment")
        return False

    logger.info(
        f"Wiki enrichment data for {project_id}: "
        f"{len(rules)} rules, {len(interview_answers)} interview answers, "
        f"scan={'yes' if has_scan else 'no'}, features={'yes' if has_features else 'no'}"
    )

    # --- 5. Render prompt with all available data ---
    from app.services.ai_orchestrator import AIOrchestrator
    from app.prompts.loader import PromptLoader

    loader = PromptLoader()
    try:
        template_vars = {
            "project_name": project.name or "",
            "current_description": project.description or "",
            "current_context": project.context_human or "",
            "new_rules": "\n".join(f"- {r}" for r in rules) if rules else "",
            "stack_info": stack_info,
            "interview_context": "\n".join(f"- {a}" for a in interview_answers) if interview_answers else "",
            "scan_summary": scan_summary,
            "existing_features": existing_features,
        }
        sys_prompt, usr_prompt = loader.render("context/wiki_enrichment", template_vars)
    except Exception as e:
        logger.warning(f"Wiki enrichment prompt not found: {e}")
        return False

    # --- 6. Call AI to enrich ---
    orchestrator = AIOrchestrator(db)
    # PROMPT #227 - Reduced from 12000 to 4000 tokens to avoid Ollama timeout
    # 4000 tokens is enough for structured wiki (sections, rules, features)
    response = await orchestrator.execute(
        usage_type="general",
        messages=[{"role": "user", "content": usr_prompt}],
        system_prompt=sys_prompt,
        max_tokens=4000,
        project_id=str(project_id),
        metadata={"type": "wiki_enrichment", "skip_context_build": True},
    )

    enriched = response.get("content", "")
    if enriched and len(enriched) > 100:
        # PROMPT #277 - Validate AI response before saving as description
        # Reject hallucinated content (e.g., maze-generator.py code) that doesn't match expected structure
        expected_sections = ["visao geral", "stack", "arquitetura", "regras", "features", "integracoes"]
        enriched_lower = enriched.lower()
        has_valid_section = any(s in enriched_lower for s in expected_sections)
        if not has_valid_section:
            logger.warning(
                f"Wiki enrichment rejected for {project_id}: no valid sections found "
                f"({len(enriched)} chars, first 200: {enriched[:200]})"
            )
            return False

        # PROMPT #247 - Title and description are always manual, never auto-generated
        # Wiki enrichment content goes to wiki pages only, not to project name/description

        project.updated_at = datetime.utcnow()
        db.commit()
        logger.info(f"Wiki enriched for project {project_id} ({len(enriched)} chars)")

        # PROMPT #265/#237 - Parse AI-enriched markdown into wiki pages on disk
        try:
            from app.services.wiki_service import (
                _upsert_wiki_page, _parse_wiki_sections,
                _build_architecture_patterns_page,
                _build_code_conventions_page,
                _build_ui_components_page,
                _build_code_structure_page,
                _build_git_history_page,
                _build_business_rules_wiki_pages,
                _apply_semantic_links_to_project_fs,
                _trigger_rule_enrichment_job,
            )

            code_path = project.code_path
            if not code_path:
                raise ValueError("Project has no code_path")

            sections = _parse_wiki_sections(enriched)

            order = 0
            for slug, (title, content) in sections.items():
                _upsert_wiki_page(code_path, project_id, slug, title, content, order, "enrichment")
                order += 1

            if not sections:
                _upsert_wiki_page(code_path, project_id, "visao-geral", "Visao Geral", enriched, 0, "enrichment")

            if rules:
                rules_md_parts = [
                    "## Catálogo de Referência - Regras Brutas\n",
                    f"Total de regras extraidas do codebase: **{len(rules)}**\n",
                    "Estas são as regras brutas extraidas automaticamente do código-fonte.",
                    "A página principal de Regras de Negocio contém a versão expandida e organizada.\n",
                ]
                for i, rule in enumerate(rules, 1):
                    rule_text = rule[:500] if len(rule) > 500 else rule
                    rules_md_parts.append(f"{i}. {rule_text}")
                rules_md = "\n".join(rules_md_parts)
                _upsert_wiki_page(
                    code_path, project_id, "regras-catálogo-bruto",
                    "Catálogo de Referência - Regras Brutas", rules_md,
                    12, "ai_generated",
                    parent_slug="regras-de-negocio",
                )
                logger.info(f"Wiki: raw rules catalog with {len(rules)} rules for project {project_id}")

            page_builders = [
                ("padrões-arquitetura", "Padrões de Arquitetura", _build_architecture_patterns_page, 6),
                ("convencoes-código", "Convencoes de Código", _build_code_conventions_page, 7),
                ("componentes-interface", "Componentes e Interface", _build_ui_components_page, 8),
                ("estrutura-código", "Estrutura de Código", _build_code_structure_page, 9),
                ("histórico-desenvolvimento", "Histórico de Desenvolvimento", _build_git_history_page, 10),
            ]
            rag_pages_count = 0
            for slug, title, builder, order_idx in page_builders:
                content = builder(db, project_id)
                if content:
                    _upsert_wiki_page(code_path, project_id, slug, title, content, order_idx, "ai_generated")
                    rag_pages_count += 1
            if rag_pages_count:
                logger.info(f"Wiki: {rag_pages_count} RAG data pages for project {project_id}")

            rule_pages = _build_business_rules_wiki_pages(db, code_path, project_id)
            if rule_pages:
                logger.info(f"Wiki: {len(rule_pages)} business rule pages for project {project_id}")

            # Apply semantic hypertext linking
            try:
                _apply_semantic_links_to_project_fs(code_path, project_id)
            except Exception as e:
                logger.warning(f"Failed to apply semantic links: {e}")

            # Auto-trigger AI enrichment for individual rule pages
            rule_page_count = len([p for p in rule_pages if p and p.get("slug", "").startswith("regra-")])
            if rule_page_count > 0:
                try:
                    await _trigger_rule_enrichment_job(db, project_id, rule_page_count)
                except Exception as e:
                    logger.warning(f"Failed to trigger rule enrichment: {e}")
            logger.info(f"Wiki: {len(sections) or 1} pages from enriched content for project {project_id}")
        except Exception as e:
            logger.warning(f"Failed to parse wiki sections: {e}")

        return True

    logger.info(f"Wiki enrichment response too short for {project_id}, skipping")
    return False

async def _process_cards_from_memory_async(
    job_id: UUID,
    project_id: UUID
):
    """
    Background task to generate cards from memory scan.

    PROMPT #153 - Background Card Generation

    This task runs after the memory scan completes and generates:
    1. Business rule cards (closed) - rules verified in existing code
    2. Suggested epics (drafts) - new functionality to develop

    These cards are generated regardless of whether the user completes
    the Context Interview, allowing work to begin immediately.
    """
    from app.database import SessionLocal
    from app.services.context_generator import ContextGeneratorService

    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        logger.info(f"🚀 Card generation started for project {project_id}")

        job_manager.update_progress(job_id, 5.0, "Preparando geração de cards...")

        context_service = ContextGeneratorService(db)

        job_manager.update_progress(job_id, 10.0, "Gerando cards de regras de negocio...")

        # Extract epic_count from job input_data (default: 10)
        job_obj = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        epic_count = 10
        if job_obj and job_obj.input_data and isinstance(job_obj.input_data, dict):
            epic_count = job_obj.input_data.get("epic_count", 10)

        # PROMPT #155 - Pass job_manager and job_id for incremental epic generation
        result = await context_service.generate_cards_from_memory(
            project_id=project_id,
            job_manager=job_manager,
            job_id=job_id,
            epic_count=epic_count
        )

        job_manager.update_progress(job_id, 95.0, "Finalizando...")

        # Update notification title with results
        job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if job:
            business_count = len(result.get("business_rule_cards", []))
            epic_count = len(result.get("suggested_epics", []))

            if result.get("skipped"):
                job.notification_title = f"ℹ️ Cards ja existem para este projeto"
            elif business_count > 0 or epic_count > 0:
                job.notification_title = f"✅ {business_count} regras + {epic_count} epicos gerados"
            else:
                job.notification_title = f"ℹ️ Nenhum card gerado (nenhuma regra/epico detectado)"

            db.commit()

        job_manager.complete_job(job_id, result)
        logger.info(f"✅ Card generation completed for project {project_id}")

    except Exception as e:
        logger.error(f"❌ Card generation failed for project {project_id}: {str(e)}", exc_info=True)

        # Update notification title for failure
        try:
            job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
            if job:
                error_msg = str(e)[:80]
                job.notification_title = f"❌ Erro na geração de cards: {error_msg}"
                db.commit()
        except Exception:
            pass

        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()

async def _process_full_hierarchy_async(job_id: UUID, project_id: UUID):
    """
    PROMPT #237 - Background task: generate full hierarchy.
    PROMPT #240 - Rigid 4-level hierarchy: Epic > Story > Task > Subtask.
    PROMPT #245 - Removed suggested epics generation. This flow creates ONLY
                  business rule cards. No AI suggestions.

    The hierarchy is built by _classify_rules_hierarchy which uses AI to organize
    existing business rules into Epic > Story (with rules[]) structure.
    Code then decomposes Stories into Tasks (groups of 3 rules) and Subtasks (1 per rule).
    All cards are created with workflow_state="open" and status=BACKLOG.
    """
    from app.database import SessionLocal
    from app.services.context_generator import ContextGeneratorService
    from app.models.task import ItemType

    db = SessionLocal()
    try:
        jm = JobManager(db)
        jm.start_job(job_id)

        context_service = ContextGeneratorService(db)
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            jm.fail_job(job_id, "Projeto não encontrado")
            return

        # PROMPT #242 - Safety net: ensure RAG indexing completed before generating cards
        if not project.initial_scan_complete:
            jm.fail_job(job_id, "RAG indexing not complete. Cannot generate cards.")
            return

        project_name = project.name or str(project_id)[:8]

        # === Phase 1: Generate rich context if missing ===
        jm.update_progress(job_id, 5.0, "Fase 1/2: Gerando contexto do projeto...")
        job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if job:
            job.notification_title = f"Fase 1/2: Contexto - '{project_name}'"
            db.commit()

        if not project.context_semantic:
            try:
                await context_service.generate_rich_context_from_memory(
                    project_id=project_id,
                    progress_callback=None,
                    ai_timeout=120
                )
                logger.info(f"Rich context generated for project {project.name}")
            except Exception as e:
                logger.warning(f"Rich context failed, continuing: {e}")

        # === Phase 2: Generate business rule cards (hierarchical, closed) ===
        jm.update_progress(job_id, 20.0, "Fase 2/2: Organizando regras de negocio em hierarquia...")
        job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if job:
            job.notification_title = f"Fase 2/2: Regras de negocio - '{project_name}'"
            db.commit()

        try:
            business_rule_cards = await context_service.generate_business_rule_cards(project_id)
            logger.info(f"Generated {len(business_rule_cards)} business rule cards")
        except Exception as e:
            # PROMPT #233 - LI-2 fix: log error but don't silently swallow it - report partial failure
            logger.error(f"Failed to generate business rule cards: {e}", exc_info=True)
            business_rule_cards = []
            # Record the failure in job result so user knows it partially failed
            jm.update_progress(job_id, 90.0, f"Regras de negocio falharam: {str(e)[:100]}")

        # Count hierarchy levels
        total_epics = sum(1 for c in business_rule_cards if c.get("item_type") == "epic")
        total_stories = sum(1 for c in business_rule_cards if c.get("item_type") == "story")
        total_tasks = sum(1 for c in business_rule_cards if c.get("item_type") == "task")
        total_subtasks = sum(1 for c in business_rule_cards if c.get("item_type") == "subtask")

        # PROMPT #245 - Phase 3 (suggested epics) REMOVED from "Gerar Cards".
        # This flow generates ONLY business rule cards from existing code.
        # Suggested epics are generated separately via "Gerar Epics" button.

        # === Complete ===
        job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if job:
            job.notification_title = (
                f"Hierarquia completa - '{project_name}': "
                f"{total_epics}E {total_stories}S {total_tasks}T {total_subtasks}ST"
            )
            db.commit()

        jm.complete_job(job_id, {
            "project_id": str(project_id),
            "total_business_rule_cards": len(business_rule_cards),
            "total_epics": total_epics,
            "total_stories": total_stories,
            "total_tasks": total_tasks,
            "total_subtasks": total_subtasks,
        })
        logger.info(
            f"Hierarchy generated for '{project_name}': "
            f"{total_epics} epics, {total_stories} stories, "
            f"{total_tasks} tasks, {total_subtasks} subtasks = "
            f"{len(business_rule_cards)} total cards"
        )

    except Exception as e:
        logger.error(f"Full hierarchy generation failed: {e}", exc_info=True)
        try:
            jm.fail_job(job_id, str(e))
        except Exception:
            pass
    finally:
        db.close()
