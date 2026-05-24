"""
Quota Watcher — background task that polls Claudius for quota status
and notifies users when the Claude subscription quota becomes available
again after exhaustion.

Behaviour:
- Polls every 10 minutes IF any pipeline_run is interrupted with
  interruption_reason='quota_exhausted'. Otherwise idle.
- On transition exhausted -> available:
    * Broadcasts quota_changed event via WebSocket
    * Creates AsyncJob notification (so the bell shows it)
    * If async_job.input_data.auto_resume==True for any related interrupted
      run, triggers resume serially with a small sleep between dispatches.

PROMPT: quota-awareness v2.3.0
"""
import asyncio
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import text as sql_text

from app.api.websocket import broadcast_quota_event
from app.database import get_db
from app.models.async_job import AsyncJob, JobStatus, JobType
from app.models.pipeline_run import PipelineRun
from app.services.claudius_pipeline import ClaudiusPipelineService

logger = logging.getLogger(__name__)

POLL_INTERVAL_SEC = 600        # 10 minutes when interrupted runs exist
IDLE_INTERVAL_SEC = 1800       # 30 minutes when no interrupted runs (cheap heartbeat)


async def quota_watcher_loop(shutdown_event: Optional[asyncio.Event] = None):
    """Long-running loop. Cancel by setting shutdown_event or task.cancel()."""
    logger.info("quota_watcher: starting (poll=10min when interrupted, 30min idle)")

    last_available: Optional[bool] = None  # tri-state: None/True/False

    while True:
        try:
            if shutdown_event and shutdown_event.is_set():
                logger.info("quota_watcher: shutdown signal received")
                return

            interrupted_count = _count_interrupted_quota_runs()
            client = ClaudiusPipelineService()
            try:
                snapshot = await client.quota_status()
            finally:
                await client.close()

            available_now = bool(snapshot.get("available", True))

            # On transition exhausted -> available, notify + maybe auto-resume
            if last_available is False and available_now:
                logger.info("quota_watcher: quota AVAILABLE again — notifying clients")
                await broadcast_quota_event(snapshot, change_kind="available")
                await _notify_quota_back(snapshot)
                await _maybe_auto_resume_runs()
            elif last_available is True and not available_now:
                logger.warning("quota_watcher: quota EXHAUSTED — broadcasting")
                await broadcast_quota_event(snapshot, change_kind="exhausted")
            elif last_available != available_now and last_available is None:
                # First tick — push initial state silently
                await broadcast_quota_event(snapshot, change_kind="updated")

            last_available = available_now

            # Adaptive cadence: poll faster when something is waiting
            sleep_for = POLL_INTERVAL_SEC if interrupted_count > 0 else IDLE_INTERVAL_SEC
            try:
                if shutdown_event:
                    await asyncio.wait_for(shutdown_event.wait(), timeout=sleep_for)
                else:
                    await asyncio.sleep(sleep_for)
            except asyncio.TimeoutError:
                pass
        except asyncio.CancelledError:
            logger.info("quota_watcher: cancelled")
            return
        except Exception:
            logger.exception("quota_watcher: unexpected error, sleeping 60s before retry")
            await asyncio.sleep(60)


def _count_interrupted_quota_runs() -> int:
    """Count pipeline_runs interrupted by quota that haven't been resumed yet."""
    try:
        db = next(get_db())
        try:
            row = db.execute(sql_text("""
                SELECT COUNT(*) FROM pipeline_runs
                WHERE status = 'interrupted'
                  AND checkpoint_state ->> 'interruption_reason' = 'quota_exhausted'
            """)).scalar()
            return int(row or 0)
        finally:
            db.close()
    except Exception as e:
        logger.warning(f"quota_watcher: count interrupted failed: {e}")
        return 0


async def _notify_quota_back(snapshot: dict):
    """Create a job-style notification entry so the bell rings."""
    try:
        from app.api.websocket import broadcast_job_event
        await broadcast_job_event("notification", {
            "kind": "quota_back",
            "notification_title": "Cota Claude voltou — pipelines pendentes podem ser retomados",
            "deep_link": "/settings?section=quota",
            "snapshot": snapshot,
        })
    except Exception as e:
        logger.warning(f"notify_quota_back failed: {e}")


async def _maybe_auto_resume_runs():
    """If any quota-interrupted run has auto_resume=true in its async_job,
    fire the resume endpoint serially (small sleep between dispatches)."""
    try:
        db = next(get_db())
        try:
            # Find interrupted runs + their originating job (latest deep_pipeline job per project)
            runs = db.query(PipelineRun).filter(
                PipelineRun.status == "interrupted",
            ).all()
            quota_runs = [
                r for r in runs
                if (r.checkpoint_state or {}).get("interruption_reason") == "quota_exhausted"
            ]
            if not quota_runs:
                return

            for r in quota_runs:
                # Find latest deep_pipeline job for this project
                job = db.query(AsyncJob).filter(
                    AsyncJob.project_id == r.project_id,
                    AsyncJob.job_type == JobType.DEEP_PIPELINE,
                ).order_by(AsyncJob.created_at.desc()).first()

                if not job:
                    continue
                input_data = job.input_data or {}
                if not input_data.get("auto_resume"):
                    continue

                logger.info(f"quota_watcher: auto-resuming pipeline for project {r.project_id}")
                try:
                    # Dispatch via the existing route handler logic (HTTP self-call avoided)
                    from app.api.routes.continuous_rag.deep_pipeline import (
                        trigger_deep_pipeline,
                    )
                    # We can't easily call the FastAPI handler in-process without a Request,
                    # so just enqueue a new background pipeline run via JobManager + run task
                    from app.services.job_manager import JobManager
                    from app.models.project import Project
                    project = db.query(Project).filter(Project.id == r.project_id).first()
                    if not project:
                        continue
                    jm = JobManager(db)
                    new_job = jm.create_job(
                        job_type=JobType.DEEP_PIPELINE,
                        input_data={"project_id": str(r.project_id), "auto_resume": True},
                        project_id=r.project_id,
                        notification_title=f"Deep Pipeline (auto-resume) — {project.name}",
                        deep_link=f"/projects/{r.project_id}",
                    )
                    # Mirror what trigger_deep_pipeline does for the background task
                    asyncio.create_task(_run_resume_task(new_job.id, r.project_id))
                    # Sleep briefly between dispatches so they don't all hammer at once
                    await asyncio.sleep(5)
                except Exception:
                    logger.exception(f"auto-resume dispatch failed for run {r.id}")
        finally:
            db.close()
    except Exception:
        logger.exception("_maybe_auto_resume_runs failed")


async def _run_resume_task(job_id, project_id):
    """Runner mirror of deep_pipeline.trigger_deep_pipeline._run_deep_pipeline.

    Kept in-line to avoid coupling watcher to route module internals.
    """
    db = next(get_db())
    try:
        from app.services.deep_pipeline import DeepPipelineService
        from app.services.job_manager import JobManager
        from app.services.claudius_pipeline import ClaudiusQuotaExhaustedError

        jm = JobManager(db)
        jm.start_job(job_id)
        pipeline = DeepPipelineService(db)

        async def _progress(phase, pct, msg):
            try:
                jm.update_progress(job_id, max(0, min(99, int(pct))), f"[Fase {phase}] {msg}")
            except Exception:
                pass

        result = await pipeline.run(project_id, progress_callback=_progress)
        jm.complete_job(job_id, result)
    except Exception as e:
        is_quota = e.__class__.__name__ == "ClaudiusQuotaExhaustedError"
        prefix = "[QUOTA] " if is_quota else ""
        try:
            db.rollback()
            from app.services.job_manager import JobManager
            JobManager(db).fail_job(job_id, prefix + str(e))
        except Exception:
            logger.exception("auto-resume fail_job failed")
    finally:
        db.close()
