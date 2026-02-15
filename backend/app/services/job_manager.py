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
        priority: Optional[int] = None  # PROMPT #120: Job priority
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
            created_at=datetime.utcnow()
        )

        self.db.add(job)
        self.db.commit()
        self.db.refresh(job)

        logger.info(f"Created job {job.id} ({job_type.value}) priority={priority}")
        return job

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

        job.status = JobStatus.RUNNING
        job.started_at = datetime.utcnow()

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
            "task_id": str(job.task_id) if job.task_id else None,
            "project_id": str(job.project_id) if job.project_id else None,
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
        # Check if we crossed a milestone boundary
        is_milestone = False
        for m in self._PROGRESS_MILESTONES:
            if old_percent < m <= progress_percent:
                is_milestone = True
                break

        if is_milestone or progress_message != job.progress_message:
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
            "interview_id": str(job.interview_id) if job.interview_id else None
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
            "interview_id": str(job.interview_id) if job.interview_id else None
        })

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

        # Can only cancel pending or running jobs
        if job.status not in [JobStatus.PENDING, JobStatus.RUNNING]:
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
            "status": "cancelled"
        })

        return True

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
