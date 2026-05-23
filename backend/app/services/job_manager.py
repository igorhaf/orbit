"""
Job Manager Service
Utility functions for managing async jobs.

PROMPT #65 - Async Job System
Provides helpers for creating, updating, and completing jobs.

PROMPT #134 - WebSocket Integration
All job status changes now broadcast via WebSocket for real-time updates.
"""

from sqlalchemy.orm import Session
from uuid import UUID, uuid4
from datetime import datetime
from typing import Dict, Any, Optional
import logging
import asyncio

from app.models.async_job import AsyncJob, JobStatus, JobType, JOB_TYPE_DEFAULT_PRIORITY, JobPriority
from app.models.job_log_entry import JobLogEntry
from app.models.ai_model import AIModel, AIModelUsageType

logger = logging.getLogger(__name__)


def _broadcast_job_event(event_type: str, job_data: dict):
    """
    Helper to broadcast job event via WebSocket.
    PROMPT #134 - WebSocket integration for real-time updates.

    Uses asyncio.create_task to avoid blocking the synchronous methods.
    """
    try:
        from app.api.websocket import broadcast_job_event

        # Get or create event loop
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(broadcast_job_event(event_type, job_data))
        except RuntimeError:
            # No running loop - create one (shouldn't happen in FastAPI context)
            asyncio.run(broadcast_job_event(event_type, job_data))
    except Exception as e:
        logger.warning(f"Failed to broadcast job event: {e}")


class JobManager:
    """
    Helper class for managing async jobs.

    Example:
        # Create job
        job_manager = JobManager(db)
        job = job_manager.create_job(
            job_type=JobType.INTERVIEW_MESSAGE,
            input_data={"interview_id": str(interview_id), "message": "..."},
            project_id=project.id,
            interview_id=interview.id
        )

        # Return job_id to client immediately
        return {"job_id": str(job.id), "status": "pending"}

        # In background task:
        job_manager.start_job(job.id)
        try:
            result = await do_work()
            job_manager.complete_job(job.id, result)
        except Exception as e:
            job_manager.fail_job(job.id, str(e))
    """

    def __init__(self, db: Session):
        self.db = db

    def create_job(
        self,
        job_type: JobType,
        input_data: Dict[str, Any],
        project_id: Optional[UUID] = None,
        interview_id: Optional[UUID] = None,
        task_id: Optional[UUID] = None,  # PROMPT #133
        deep_link: Optional[str] = None,  # PROMPT #133
        notification_title: Optional[str] = None,  # PROMPT #133
        priority: Optional[int] = None,  # PROMPT #120: Job priority
        parent_job_id: Optional[UUID] = None,  # PROMPT #298: Sub-job hierarchy
        phase_label: Optional[str] = None,  # PROMPT #298: Phase label
    ) -> AsyncJob:
        """
        Create a new pending job.

        Args:
            job_type: Type of job (INTERVIEW_MESSAGE, BACKLOG_GENERATION, etc.)
            input_data: Parameters for the job
            project_id: Optional project ID
            interview_id: Optional interview ID
            task_id: Optional task ID for card operations (PROMPT #133)
            deep_link: URL to navigate when notification clicked (PROMPT #133)
            notification_title: Title for notification display (PROMPT #133)
            priority: Job priority (PROMPT #120). Defaults based on job_type.

        Returns:
            AsyncJob instance with status=PENDING
        """
        # PROMPT #120: Resolve priority from job type defaults
        if priority is None:
            priority = JOB_TYPE_DEFAULT_PRIORITY.get(job_type, JobPriority.NORMAL)

        job = AsyncJob(
            id=uuid4(),
            job_type=job_type,
            status=JobStatus.PENDING,
            input_data=input_data,
            project_id=project_id,
            interview_id=interview_id,
            task_id=task_id,  # PROMPT #133
            deep_link=deep_link,  # PROMPT #133
            notification_title=notification_title,  # PROMPT #133
            priority=priority,  # PROMPT #120
            parent_job_id=parent_job_id,  # PROMPT #298
            phase_label=phase_label,  # PROMPT #298
            created_at=datetime.utcnow()
        )

        self.db.add(job)
        self.db.commit()
        self.db.refresh(job)

        logger.info(f"Created job {job.id} ({job_type.value}) priority={priority}")
        return job

    # PROMPT #299 - Mapping from JobType to AIModelUsageType for model lookup
    _JOB_TYPE_USAGE_MAP = {
        JobType.INTERVIEW_MESSAGE: AIModelUsageType.INTERVIEW,
        JobType.INTERVIEW_QUESTION: AIModelUsageType.INTERVIEW,
        JobType.CHAT_MESSAGE: AIModelUsageType.INTERVIEW,
        JobType.BACKLOG_GENERATION: AIModelUsageType.PROMPT_GENERATION,
        JobType.TASK_GENERATION: AIModelUsageType.PROMPT_GENERATION,
        JobType.EPIC_ACTIVATION: AIModelUsageType.PROMPT_GENERATION,
        JobType.STORY_ACTIVATION: AIModelUsageType.PROMPT_GENERATION,
        JobType.TASK_ACTIVATION: AIModelUsageType.PROMPT_GENERATION,
        JobType.SUGGESTED_EPICS: AIModelUsageType.PROMPT_GENERATION,
        JobType.CARDS_FROM_MEMORY: AIModelUsageType.PROMPT_GENERATION,
        JobType.CHILDREN_GENERATION: AIModelUsageType.PROMPT_GENERATION,
        JobType.TASK_EXECUTION: AIModelUsageType.TASK_EXECUTION,
        JobType.BATCH_EXECUTION: AIModelUsageType.TASK_EXECUTION,
        JobType.COMMIT_GENERATION: AIModelUsageType.COMMIT_GENERATION,
        JobType.MEMORY_SCAN: AIModelUsageType.MEMORY,
        JobType.RAG_CONTINUOUS_SCAN: AIModelUsageType.RAG_EXTRACTION,
        JobType.CONTEXT_GENERATION: AIModelUsageType.GENERAL,
        JobType.PROJECT_TITLE: AIModelUsageType.GENERAL,
        JobType.PROJECT_PIPELINE: AIModelUsageType.GENERAL,
        JobType.WIKI_GENERATION: AIModelUsageType.CONTENT_GENERATION,
        JobType.WIKI_RULE_ENRICHMENT: AIModelUsageType.CONTENT_GENERATION,
        JobType.WIKI_PAGE_AI: AIModelUsageType.GENERAL,
        JobType.DESCRIPTION_GENERATION: AIModelUsageType.GENERAL,
        # DEEP_PIPELINE removed: model is set by the pipeline itself based on profile
    }

    def _resolve_ai_model_name(self, job_type: JobType) -> Optional[str]:
        """PROMPT #299 - Look up active AI model name for a job type."""
        usage_type = self._JOB_TYPE_USAGE_MAP.get(job_type)
        if not usage_type:
            return None
        try:
            model = self.db.query(AIModel).filter(
                AIModel.usage_type == usage_type,
                AIModel.is_active == True
            ).order_by(AIModel.updated_at.desc()).first()
            if model:
                return model.name
            # Fallback to GENERAL
            model = self.db.query(AIModel).filter(
                AIModel.usage_type == AIModelUsageType.GENERAL,
                AIModel.is_active == True
            ).first()
            return model.name if model else None
        except Exception:
            return None

    def start_job(self, job_id: UUID) -> None:
        """
        Mark job as running.

        Args:
            job_id: UUID of the job
        """
        job = self.db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if not job:
            logger.error(f"Job {job_id} not found")
            return

        # Se foi pausado entre o submit e o start_job, respeitar — nao forcar RUNNING
        if job.status == JobStatus.PAUSED:
            logger.info(f"Job {job_id} esta PAUSED — start_job ignorado (sera retomado via resume)")
            return

        job.status = JobStatus.RUNNING
        job.started_at = datetime.utcnow()

        # PROMPT #299 - Auto-set AI model name if not already set
        if not job.ai_model_name:
            job.ai_model_name = self._resolve_ai_model_name(job.job_type)

        # PROMPT #286 - Insert log entry
        self.db.add(JobLogEntry(job_id=job_id, level="info", message="Job started", progress_percent=0))

        self.db.commit()
        logger.info(f"Started job {job_id}")

        # PROMPT #134 - Broadcast via WebSocket
        _broadcast_job_event("job_started", {
            "job_id": str(job_id),
            "job_type": job.job_type.value,
            "status": "running",
            "notification_title": job.notification_title,
            "ai_model_name": job.ai_model_name,
            "priority": job.priority,
            "task_id": str(job.task_id) if job.task_id else None,
            "project_id": str(job.project_id) if job.project_id else None,
            "parent_job_id": str(job.parent_job_id) if job.parent_job_id else None,
        })

    # PROMPT #288 - Milestone thresholds for throttled progress updates
    _PROGRESS_MILESTONES = {0, 10, 25, 50, 75, 90, 100}

    def update_progress(
        self,
        job_id: UUID,
        progress_percent: float,
        progress_message: Optional[str] = None
    ) -> None:
        """
        Update job progress.

        PROMPT #288 - Throttled: only commits to DB + broadcasts WebSocket at
        milestone percentages (0, 10, 25, 50, 75, 90, 100) to reduce DB spam.
        In-memory progress is always updated for polling.

        Args:
            job_id: UUID of the job
            progress_percent: Progress percentage (0-100)
            progress_message: Optional human-readable message
        """
        job = self.db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if not job:
            logger.error(f"Job {job_id} not found")
            return

        old_percent = job.progress_percent or 0
        job.progress_percent = progress_percent
        if progress_message:
            job.progress_message = progress_message

        # PROMPT #288 - Only do expensive operations at milestones
        # PROMPT #237 - Pipeline jobs always broadcast (granular monitoring)
        _PIPELINE_JOB_TYPES = {"deep_pipeline", "rag_pipeline", "memory_scan"}
        is_pipeline = job.job_type.value in _PIPELINE_JOB_TYPES

        # Check if we crossed a milestone boundary
        is_milestone = False
        for m in self._PROGRESS_MILESTONES:
            if old_percent < m <= progress_percent:
                is_milestone = True
                break

        if is_milestone or is_pipeline or progress_message != job.progress_message:
            # PROMPT #286 - Insert log entry only at milestones
            self.db.add(JobLogEntry(
                job_id=job_id, level="info",
                message=progress_message or f"Progresso: {progress_percent}%",
                progress_percent=progress_percent,
            ))

            self.db.commit()
            logger.debug(f"Job {job_id} progress: {progress_percent}% - {progress_message}")

            # PROMPT #134 - Broadcast via WebSocket only at milestones
            _broadcast_job_event("job_progress", {
                "job_id": str(job_id),
                "job_type": job.job_type.value,
                "progress_percent": progress_percent,
                "progress_message": progress_message
            })
        else:
            # Lightweight update: just flush progress to DB without full commit
            self.db.flush()
            logger.debug(f"Job {job_id} progress (throttled): {progress_percent}%")

    def complete_job(self, job_id: UUID, result: Dict[str, Any]) -> None:
        """
        Mark job as completed with result.

        Args:
            job_id: UUID of the job
            result: Result data to return to client
        """
        job = self.db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if not job:
            logger.error(f"Job {job_id} not found")
            return

        job.status = JobStatus.COMPLETED
        job.result = result
        job.completed_at = datetime.utcnow()
        job.progress_percent = 100.0

        # PROMPT #286 - Insert log entry
        self.db.add(JobLogEntry(job_id=job_id, level="success", message="Job completed successfully", progress_percent=100.0))

        self.db.commit()
        logger.info(f"Completed job {job_id}")

        # PROMPT #134 - Broadcast via WebSocket
        _broadcast_job_event("job_completed", {
            "job_id": str(job_id),
            "job_type": job.job_type.value,
            "status": "completed",
            "result": result,
            "notification_title": job.notification_title,
            "deep_link": job.deep_link,
            "project_id": str(job.project_id) if job.project_id else None,
            "task_id": str(job.task_id) if job.task_id else None,
            "interview_id": str(job.interview_id) if job.interview_id else None,
            "parent_job_id": str(job.parent_job_id) if job.parent_job_id else None,
        })

    def fail_job(self, job_id: UUID, error: str) -> None:
        """
        Mark job as failed with error message.

        Args:
            job_id: UUID of the job
            error: Error message
        """
        job = self.db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if not job:
            logger.error(f"Job {job_id} not found")
            return

        job.status = JobStatus.FAILED
        job.error = error
        job.completed_at = datetime.utcnow()

        # PROMPT #286 - Insert log entry
        self.db.add(JobLogEntry(job_id=job_id, level="error", message=error))

        self.db.commit()
        logger.error(f"Failed job {job_id}: {error}")

        # PROMPT #134 - Broadcast via WebSocket
        _broadcast_job_event("job_failed", {
            "job_id": str(job_id),
            "job_type": job.job_type.value,
            "status": "failed",
            "error": error,
            "notification_title": job.notification_title,
            "deep_link": job.deep_link,
            "project_id": str(job.project_id) if job.project_id else None,
            "task_id": str(job.task_id) if job.task_id else None,
            "interview_id": str(job.interview_id) if job.interview_id else None,
            "parent_job_id": str(job.parent_job_id) if job.parent_job_id else None,
        })

    def cleanup_stale_jobs(self, stale_minutes: int = 10) -> int:
        """
        PROMPT #234 SM-3: Mark stale RUNNING/PENDING jobs as FAILED.
        Jobs stuck in RUNNING or PENDING for longer than stale_minutes are considered dead.

        Returns:
            Number of jobs cleaned up
        """
        from datetime import timedelta
        cutoff = datetime.utcnow() - timedelta(minutes=stale_minutes)

        stale_jobs = self.db.query(AsyncJob).filter(
            AsyncJob.status.in_([JobStatus.RUNNING, JobStatus.PENDING]),
            AsyncJob.updated_at < cutoff
        ).all()

        count = 0
        for job in stale_jobs:
            job.status = JobStatus.FAILED
            job.error = f"Job stuck for >{stale_minutes} minutes - marked as failed by cleanup"
            job.completed_at = datetime.utcnow()
            self.db.add(JobLogEntry(job_id=job.id, level="warning", message=f"Stale job cleanup after {stale_minutes}min"))
            count += 1
            logger.warning(f"Cleaned up stale job {job.id} (type={job.job_type.value})")

        if count > 0:
            self.db.commit()
            logger.info(f"Cleaned up {count} stale jobs")

        return count

    def get_job(self, job_id: UUID) -> Optional[AsyncJob]:
        """
        Get job by ID.

        Args:
            job_id: UUID of the job

        Returns:
            AsyncJob instance or None
        """
        return self.db.query(AsyncJob).filter(AsyncJob.id == job_id).first()

    def cancel_job(self, job_id: UUID) -> bool:
        """
        Cancel a running or pending job.

        Args:
            job_id: UUID of the job

        Returns:
            True if job was cancelled, False if job couldn't be cancelled
            (e.g., already completed or failed)
        """
        job = self.db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if not job:
            logger.error(f"Job {job_id} not found")
            return False

        # Pode cancelar pending, running ou paused
        if job.status not in [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.PAUSED]:
            logger.warning(f"Cannot cancel job {job_id} with status {job.status.value}")
            return False

        job.status = JobStatus.CANCELLED
        job.completed_at = datetime.utcnow()
        job.error = "Job was cancelled by user"

        # PROMPT #286 - Insert log entry
        self.db.add(JobLogEntry(job_id=job_id, level="warning", message="Job cancelled by user"))

        self.db.commit()
        logger.info(f"Cancelled job {job_id}")

        # PROMPT #134 - Broadcast via WebSocket
        _broadcast_job_event("job_cancelled", {
            "job_id": str(job_id),
            "job_type": job.job_type.value,
            "status": "cancelled",
            "parent_job_id": str(job.parent_job_id) if job.parent_job_id else None,
        })

        return True

    def pause_job(self, job_id: UUID) -> bool:
        """Pausa um job (pending ou running). Background tasks devem checar `is_paused()` periodicamente."""
        job = self.db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if not job:
            logger.error(f"Job {job_id} not found")
            return False
        if job.status not in [JobStatus.PENDING, JobStatus.RUNNING]:
            logger.warning(f"Cannot pause job {job_id} with status {job.status.value}")
            return False
        prior = job.status
        job.status = JobStatus.PAUSED
        # guarda status anterior em result pra restaurar no resume
        cur = dict(job.result or {})
        cur["_paused_from"] = prior.value
        cur["_paused_at"] = datetime.utcnow().isoformat()
        job.result = cur
        self.db.add(JobLogEntry(job_id=job_id, level="info", message=f"Job pausado pelo usuario (estava {prior.value})"))
        self.db.commit()
        logger.info(f"Paused job {job_id} (was {prior.value})")
        _broadcast_job_event("job_paused", {
            "job_id": str(job_id),
            "job_type": job.job_type.value,
            "status": "paused",
            "previous_status": prior.value,
            "parent_job_id": str(job.parent_job_id) if job.parent_job_id else None,
        })
        return True

    def resume_job(self, job_id: UUID) -> bool:
        """Retoma um job pausado. Vai pra PENDING (executor pega de novo) ou RUNNING se estava rodando."""
        job = self.db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if not job:
            logger.error(f"Job {job_id} not found")
            return False
        if job.status != JobStatus.PAUSED:
            logger.warning(f"Cannot resume job {job_id} (status={job.status.value}, esperado paused)")
            return False
        prior_str = (job.result or {}).get("_paused_from", "pending")
        try:
            new_status = JobStatus(prior_str)
        except ValueError:
            new_status = JobStatus.PENDING
        # Por seguranca, jobs que estavam RUNNING voltam pra PENDING — o executor decide quem roda
        if new_status == JobStatus.RUNNING:
            new_status = JobStatus.PENDING
        job.status = new_status
        cur = dict(job.result or {})
        cur.pop("_paused_from", None)
        cur.pop("_paused_at", None)
        cur["_resumed_at"] = datetime.utcnow().isoformat()
        job.result = cur
        self.db.add(JobLogEntry(job_id=job_id, level="info", message=f"Job retomado (estado: {new_status.value})"))
        self.db.commit()
        logger.info(f"Resumed job {job_id} (-> {new_status.value})")
        _broadcast_job_event("job_resumed", {
            "job_id": str(job_id),
            "job_type": job.job_type.value,
            "status": new_status.value,
            "parent_job_id": str(job.parent_job_id) if job.parent_job_id else None,
        })
        return True

    def is_paused(self, job_id: UUID) -> bool:
        """Background tasks usam pra pausar processamento mid-execucao."""
        job = self.db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        return bool(job and job.status == JobStatus.PAUSED)

    def is_cancelled(self, job_id: UUID) -> bool:
        """
        Check if a job has been cancelled.
        Background tasks should call this periodically to detect cancellation.

        Args:
            job_id: UUID of the job

        Returns:
            True if job was cancelled, False otherwise
        """
        job = self.db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if not job:
            return False

        return job.status == JobStatus.CANCELLED

    # ──────────────────────────────────────────────
    # PROMPT #298 - Sub-Job Hierarchy Methods
    # ──────────────────────────────────────────────

    def create_child_job(
        self,
        parent_job_id: UUID,
        job_type: JobType,
        input_data: Dict[str, Any],
        phase_label: str,
        **kwargs
    ) -> AsyncJob:
        """
        Create a child job linked to a parent. Inherits project_id and priority from parent.

        Args:
            parent_job_id: UUID of the parent job
            job_type: Type of job
            input_data: Parameters for the job
            phase_label: Human-readable label (e.g. "Fase 3/6: Indexacao RAG")
            **kwargs: Additional fields (task_id, deep_link, etc.)

        Returns:
            AsyncJob instance with parent_job_id set
        """
        parent = self.get_job(parent_job_id)
        if not parent:
            raise ValueError(f"Job pai {parent_job_id} nao encontrado")

        return self.create_job(
            job_type=job_type,
            input_data=input_data,
            project_id=parent.project_id,
            priority=parent.priority,
            parent_job_id=parent_job_id,
            phase_label=phase_label,
            notification_title=phase_label,
            **kwargs
        )

    def update_parent_progress(self, parent_job_id: UUID) -> None:
        """Recalculate parent progress based on children completion."""
        children = self.db.query(AsyncJob).filter(
            AsyncJob.parent_job_id == parent_job_id
        ).all()
        if not children:
            return

        finished_statuses = [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]
        completed = sum(1 for c in children if c.status in finished_statuses)
        total = len(children)
        pct = (completed / total) * 100

        failed = sum(1 for c in children if c.status == JobStatus.FAILED)
        msg = f"{completed}/{total} fases concluidas"
        if failed:
            msg += f" ({failed} com erro)"

        self.update_progress(parent_job_id, pct, msg)

    def complete_child_job(self, child_job_id: UUID, result: Dict[str, Any]) -> None:
        """Complete a child job and update parent progress."""
        child = self.get_job(child_job_id)
        self.complete_job(child_job_id, result)
        if child and child.parent_job_id:
            self.update_parent_progress(child.parent_job_id)

    def fail_child_job(self, child_job_id: UUID, error: str) -> None:
        """Fail a child job and update parent progress."""
        child = self.get_job(child_job_id)
        self.fail_job(child_job_id, error)
        if child and child.parent_job_id:
            self.update_parent_progress(child.parent_job_id)

    def _check_parent_completion(self, parent_job_id: UUID) -> None:
        """If all children are finished, complete or fail the parent job."""
        children = self.db.query(AsyncJob).filter(
            AsyncJob.parent_job_id == parent_job_id
        ).all()

        finished_statuses = [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]
        all_done = all(c.status in finished_statuses for c in children)
        if not all_done:
            return

        failed = [c for c in children if c.status == JobStatus.FAILED]
        if failed:
            errors = [f"{c.phase_label or 'fase'}: {c.error}" for c in failed[:3]]
            self.fail_job(parent_job_id, f"{len(failed)} fase(s) falharam: " + "; ".join(errors))
        else:
            results = {str(c.id): c.result for c in children if c.result}
            self.complete_job(parent_job_id, {
                "children_completed": len(children),
                "children_results": results
            })

    def cancel_with_children(self, job_id: UUID) -> bool:
        """Cancel a job and all its pending/running children."""
        children = self.db.query(AsyncJob).filter(
            AsyncJob.parent_job_id == job_id,
            AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING])
        ).all()
        for child in children:
            self.cancel_job(child.id)
        return self.cancel_job(job_id)

    def get_children(self, parent_job_id: UUID) -> list:
        """Return children ordered by created_at."""
        return self.db.query(AsyncJob).filter(
            AsyncJob.parent_job_id == parent_job_id
        ).order_by(AsyncJob.created_at).all()
