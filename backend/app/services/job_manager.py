"""
Job Manager Service
Utility functions for managing async jobs.

PROMPT #65 - Async Job System
Provides helpers for creating, updating, and completing jobs.
"""

from sqlalchemy.orm import Session
from uuid import UUID, uuid4
from datetime import datetime
from typing import Dict, Any, Optional
import logging

from app.models.async_job import AsyncJob, JobStatus, JobType

logger = logging.getLogger(__name__)


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
        interview_id: Optional[UUID] = None
    ) -> AsyncJob:
        """
        Create a new pending job.

        Args:
            job_type: Type of job (INTERVIEW_MESSAGE, BACKLOG_GENERATION, etc.)
            input_data: Parameters for the job
            project_id: Optional project ID
            interview_id: Optional interview ID

        Returns:
            AsyncJob instance with status=PENDING
        """
        job = AsyncJob(
            id=uuid4(),
            job_type=job_type,
            status=JobStatus.PENDING,
            input_data=input_data,
            project_id=project_id,
            interview_id=interview_id,
            created_at=datetime.utcnow()
        )

        self.db.add(job)
        self.db.commit()
        self.db.refresh(job)

        logger.info(f"Created job {job.id} ({job_type.value})")
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

        self.db.commit()
        logger.info(f"Started job {job_id}")

    def update_progress(
        self,
        job_id: UUID,
        progress_percent: float,
        progress_message: Optional[str] = None
    ) -> None:
        """
        Update job progress.

        Args:
            job_id: UUID of the job
            progress_percent: Progress percentage (0-100)
            progress_message: Optional human-readable message
        """
        job = self.db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if not job:
            logger.error(f"Job {job_id} not found")
            return

        job.progress_percent = progress_percent
        if progress_message:
            job.progress_message = progress_message

        self.db.commit()
        logger.debug(f"Job {job_id} progress: {progress_percent}% - {progress_message}")

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

        self.db.commit()
        logger.info(f"Completed job {job_id}")

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

        self.db.commit()
        logger.error(f"Failed job {job_id}: {error}")

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

        self.db.commit()
        logger.info(f"Cancelled job {job_id}")
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
