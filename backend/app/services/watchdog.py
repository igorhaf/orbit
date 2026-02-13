"""
Living Wiki Watchdog Service

PROMPT #241 - Continuous background job that never stops.
Scans code, commits, specs, enriches project wiki, and auto-discovers cards.

Architecture:
- Each cycle runs as a LOW priority job via PriorityJobExecutor
- After completing a cycle, it sleeps then re-queues itself
- Yields to higher-priority jobs between cycles
- Self-heals: re-queues even on failure (with longer cooldown)
- On startup, bootstrap ensures every active project has a cycle queued
"""

import asyncio
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict
from uuid import UUID

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Cooldown between cycles (seconds)
CYCLE_COOLDOWN = 60
ERROR_COOLDOWN = 120
# Max auto-discovered cards per cycle
MAX_CARDS_PER_CYCLE = 5


async def watchdog_cycle(job_id: UUID, project_id: UUID):
    """
    One cycle of the living wiki watchdog for a single project.

    Steps:
    1. RAG file scan (detect new/changed/deleted files, extract rules)
    2. Git commit sync (index new commits in RAG)
    3. Pattern discovery + spec sync
    4. Wiki enrichment (merge RAG findings into project description)
    5. Auto-discover cards (create suggestions for new findings)
    6. Sleep then re-queue self

    Runs at LOW priority, yielding to higher-priority jobs between cycles.
    """
    from app.database import SessionLocal
    from app.models.project import Project
    from app.services.job_manager import JobManager

    db = SessionLocal()
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
        jm.update_progress(job_id, 10.0, "Scanning files for changes...")
        rag_result = {}
        try:
            from app.services.continuous_rag_service import ContinuousRAGService
            rag_service = ContinuousRAGService(db)
            rag_result = await rag_service.run_full_cycle(project_id)
            logger.info(f"RAG scan done for '{project_name}'")
        except Exception as e:
            logger.warning(f"RAG scan failed (non-blocking): {e}")

        # --- Step 2: Git commit sync ---
        jm.update_progress(job_id, 30.0, "Syncing git commits...")
        git_result = {}
        try:
            from app.services.prompt_doc_rag_sync import GitCommitRAGSync
            git_sync = GitCommitRAGSync(db, project_id, code_path)
            git_result = git_sync.sync(max_commits=50)
            logger.info(f"Git sync done for '{project_name}'")
        except Exception as e:
            logger.warning(f"Git sync failed (non-blocking): {e}")

        # --- Step 3: Pattern discovery + spec sync ---
        jm.update_progress(job_id, 50.0, "Discovering code patterns...")
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
        already_enriched = False
        if isinstance(rag_result, dict):
            already_enriched = rag_result.get("wiki_enriched", False)

        if already_enriched:
            jm.update_progress(job_id, 70.0, "Wiki already enriched from new discoveries")
            logger.info(f"Wiki enrichment skipped for '{project_name}' (already done in RAG scan)")
        else:
            jm.update_progress(job_id, 70.0, "Enriching project wiki...")
            try:
                from app.api.routes.projects import _enrich_context_from_rag
                await _enrich_context_from_rag(db, project_id)
                logger.info(f"Wiki enrichment done for '{project_name}'")
            except Exception as e:
                logger.warning(f"Wiki enrichment failed (non-blocking): {e}")

        # --- Step 5: Auto-discover cards ---
        jm.update_progress(job_id, 85.0, "Checking for new discoveries...")
        card_result = {}
        try:
            card_result = await _auto_discover_cards(db, project_id)
            if card_result.get("created", 0) > 0:
                logger.info(f"Auto-discovered {card_result['created']} cards for '{project_name}'")
        except Exception as e:
            logger.warning(f"Auto card discovery failed (non-blocking): {e}")

        jm.complete_job(job_id, {
            "project_id": str(project_id),
            "rag_scan": rag_result.get("processed", {}).get("processed_count", 0) if isinstance(rag_result, dict) else 0,
            "git_commits": git_result.get("new_commits", 0) if isinstance(git_result, dict) else 0,
            "cards_created": card_result.get("created", 0),
        })

        logger.info(f"Watchdog cycle completed for '{project_name}'")

        # Cooldown then re-queue
        await asyncio.sleep(CYCLE_COOLDOWN)
        submit_watchdog_cycle(db, project_id)

    except Exception as e:
        logger.error(f"Watchdog cycle failed for project {project_id}: {e}", exc_info=True)
        try:
            jm.fail_job(job_id, str(e))
        except Exception:
            pass
        # Re-queue even on failure (with longer cooldown)
        await asyncio.sleep(ERROR_COOLDOWN)
        try:
            submit_watchdog_cycle(db, project_id)
        except Exception:
            pass
    finally:
        db.close()


def submit_watchdog_cycle(db: Session, project_id: UUID):
    """
    Submit a new watchdog cycle for a project.
    Checks for existing pending/running jobs to avoid duplicates.
    Creates a silent (no notification) LOW priority job.
    """
    from app.models.async_job import AsyncJob, JobStatus, JobType, JobPriority
    from app.services.job_manager import JobManager
    from app.services.job_executor import PriorityJobExecutor

    # Check no pending/running cycle exists
    existing = db.query(AsyncJob).filter(
        AsyncJob.job_type == JobType.RAG_CONTINUOUS_SCAN,
        AsyncJob.project_id == project_id,
        AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING])
    ).first()

    if existing:
        logger.debug(f"Watchdog already queued for project {project_id}")
        return

    jm = JobManager(db)
    job = jm.create_job(
        job_type=JobType.RAG_CONTINUOUS_SCAN,
        input_data={"project_id": str(project_id), "watchdog": True},
        project_id=project_id,
        notification_title=None,  # Silent - no notification for background cycles
    )

    executor = PriorityJobExecutor.get_instance()
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(executor.submit(
            JobPriority.LOW,
            watchdog_cycle,
            job.id,
            project_id,
        ))
    except RuntimeError:
        # No running event loop - schedule via thread
        import threading
        def _submit():
            new_loop = asyncio.new_event_loop()
            new_loop.run_until_complete(executor.submit(
                JobPriority.LOW,
                watchdog_cycle,
                job.id,
                project_id,
            ))
            new_loop.close()
        threading.Thread(target=_submit, daemon=True).start()

    logger.debug(f"Watchdog cycle queued for project {project_id} (job {job.id})")


async def _auto_discover_cards(db: Session, project_id: UUID) -> Dict:
    """
    Check for new business rules in RAG that don't have corresponding cards.
    Creates suggested story cards for genuinely new discoveries.

    Uses SimilarityDetector (384-dim embeddings, threshold 0.90) to avoid duplicates.
    """
    from sqlalchemy import text as sql_text
    from app.models.task import Task, ItemType, TaskStatus, PriorityLevel

    # Get recent business rules from RAG (last 24 hours)
    result = db.execute(sql_text("""
        SELECT content FROM rag_documents
        WHERE project_id = :pid
        AND metadata->>'content_type' = 'business_rule'
        AND created_at > NOW() - INTERVAL '24 hours'
        ORDER BY created_at DESC
        LIMIT 20
    """), {"pid": str(project_id)})
    recent_rules = [row[0] for row in result.fetchall()]

    if not recent_rules:
        return {"checked": 0, "created": 0}

    # Get all existing card titles + descriptions for similarity check
    existing_tasks = db.query(Task).filter(
        Task.project_id == project_id,
    ).all()

    # Build text corpus for existing cards
    existing_texts = []
    for t in existing_tasks:
        text = f"{t.title or ''}\n{t.description or ''}"
        existing_texts.append(text)

    created_cards = []
    created_texts = []

    try:
        from app.services.similarity_detector import calculate_semantic_similarity
    except ImportError:
        logger.warning("SimilarityDetector not available, skipping card discovery")
        return {"checked": len(recent_rules), "created": 0}

    for rule_content in recent_rules:
        if not rule_content or len(rule_content) < 30:
            continue

        if len(created_cards) >= MAX_CARDS_PER_CYCLE:
            break

        # Check against all existing cards
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

        # Also check against cards we just created in this cycle
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

        # Create a title from the rule content (first sentence, max 100 chars)
        title = rule_content.split(".")[0].strip()
        if len(title) > 100:
            title = title[:97] + "..."
        if not title or len(title) < 10:
            title = rule_content[:100]

        new_task = Task(
            project_id=project_id,
            title=title,
            description=rule_content,
            item_type=ItemType.STORY,
            status=TaskStatus.BACKLOG,
            priority=PriorityLevel.LOW,
            labels=["suggested", "auto-discovered"],
            workflow_state="draft",
            reporter="watchdog",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(new_task)
        created_cards.append(title)
        created_texts.append(rule_content)
        # Add to existing corpus for next iteration
        existing_texts.append(rule_content)

    if created_cards:
        db.commit()

    return {
        "checked": len(recent_rules),
        "created": len(created_cards),
        "cards": created_cards,
    }


async def bootstrap_watchdog():
    """
    On startup, ensure every active project has a watchdog cycle queued.
    Called once from main.py lifespan.
    """
    from app.database import get_db as get_db_gen
    from app.models.project import Project

    db = next(get_db_gen())
    try:
        projects = db.query(Project).filter(
            Project.code_path.isnot(None),
            Project.code_path != "",
            Project.initial_scan_complete == True,
        ).all()

        count = 0
        for project in projects:
            try:
                submit_watchdog_cycle(db, project.id)
                count += 1
            except Exception as e:
                logger.warning(f"Failed to bootstrap watchdog for {project.name}: {e}")

        if count > 0:
            logger.info(f"Watchdog bootstrapped for {count} project(s)")
    except Exception as e:
        logger.error(f"Watchdog bootstrap failed: {e}")
    finally:
        db.close()
