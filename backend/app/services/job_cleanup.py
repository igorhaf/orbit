"""
Job Cleanup Service
Automatically removes old completed/failed/cancelled jobs.

PROMPT #65 - Async Job System
Prevents database from growing indefinitely with old job records.
"""

from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import logging

from app.models.async_job import AsyncJob, JobStatus

logger = logging.getLogger(__name__)


class JobCleanupService:
    """
    Service for cleaning up old async jobs.

    Example:
        cleanup_service = JobCleanupService(db)

        # Delete jobs older than 7 days
        deleted_count = cleanup_service.cleanup_old_jobs(days=7)

        # Delete only completed jobs (keep failed for debugging)
        deleted_count = cleanup_service.cleanup_old_jobs(
            days=7,
            statuses=[JobStatus.COMPLETED]
        )
    """

    def __init__(self, db: Session):
        self.db = db

    def cleanup_old_jobs(
        self,
        days: int = 7,
        statuses: list[JobStatus] | None = None
    ) -> int:
        """
        Delete jobs older than specified days.

        Args:
            days: Delete jobs older than this many days (default: 7)
            statuses: Only delete jobs with these statuses.
                     If None, deletes COMPLETED, FAILED, and CANCELLED jobs.
                     PENDING and RUNNING jobs are never deleted.

        Returns:
            Number of jobs deleted

        Example:
            # Delete all finished jobs older than 30 days
            cleanup_service.cleanup_old_jobs(days=30)

            # Delete only completed jobs older than 7 days (keep failed for analysis)
            cleanup_service.cleanup_old_jobs(days=7, statuses=[JobStatus.COMPLETED])
        """
        # Default: clean up COMPLETED, FAILED, and CANCELLED jobs
        if statuses is None:
            statuses = [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]

        # Never delete PENDING or RUNNING jobs
        statuses = [s for s in statuses if s not in [JobStatus.PENDING, JobStatus.RUNNING]]

        if not statuses:
            logger.warning("No valid statuses to clean up")
            return 0

        # Calculate cutoff date
        cutoff_date = datetime.utcnow() - timedelta(days=days)

        # Build query
        query = self.db.query(AsyncJob).filter(
            AsyncJob.status.in_(statuses),
            AsyncJob.completed_at < cutoff_date
        )

        # Count before deleting
        count = query.count()

        if count == 0:
            logger.info(f"No jobs to cleanup (older than {days} days)")
            return 0

        # Delete
        query.delete(synchronize_session=False)
        self.db.commit()

        logger.info(
            f"Cleaned up {count} jobs older than {days} days "
            f"(statuses: {[s.value for s in statuses]})"
        )

        return count

    def get_cleanup_stats(self) -> dict:
        """
        Get statistics about jobs that can be cleaned up.

        Returns:
            {
                "total_jobs": 100,
                "completed": 50,
                "failed": 10,
                "cancelled": 5,
                "pending": 20,
                "running": 15,
                "oldest_completed_age_days": 30,
                "oldest_failed_age_days": 15,
                "cleanable_jobs_7_days": 25,
                "cleanable_jobs_30_days": 45
            }
        """
        now = datetime.utcnow()

        # Count by status
        total_jobs = self.db.query(AsyncJob).count()
        completed = self.db.query(AsyncJob).filter(AsyncJob.status == JobStatus.COMPLETED).count()
        failed = self.db.query(AsyncJob).filter(AsyncJob.status == JobStatus.FAILED).count()
        cancelled = self.db.query(AsyncJob).filter(AsyncJob.status == JobStatus.CANCELLED).count()
        pending = self.db.query(AsyncJob).filter(AsyncJob.status == JobStatus.PENDING).count()
        running = self.db.query(AsyncJob).filter(AsyncJob.status == JobStatus.RUNNING).count()

        # Find oldest completed/failed job
        oldest_completed = (
            self.db.query(AsyncJob)
            .filter(AsyncJob.status == JobStatus.COMPLETED)
            .order_by(AsyncJob.completed_at.asc())
            .first()
        )
        oldest_completed_age_days = None
        if oldest_completed and oldest_completed.completed_at:
            oldest_completed_age_days = (now - oldest_completed.completed_at).days

        oldest_failed = (
            self.db.query(AsyncJob)
            .filter(AsyncJob.status == JobStatus.FAILED)
            .order_by(AsyncJob.completed_at.asc())
            .first()
        )
        oldest_failed_age_days = None
        if oldest_failed and oldest_failed.completed_at:
            oldest_failed_age_days = (now - oldest_failed.completed_at).days

        # Count cleanable jobs (older than 7 and 30 days)
        cutoff_7_days = now - timedelta(days=7)
        cutoff_30_days = now - timedelta(days=30)

        cleanable_7_days = (
            self.db.query(AsyncJob)
            .filter(
                AsyncJob.status.in_([JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]),
                AsyncJob.completed_at < cutoff_7_days
            )
            .count()
        )

        cleanable_30_days = (
            self.db.query(AsyncJob)
            .filter(
                AsyncJob.status.in_([JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]),
                AsyncJob.completed_at < cutoff_30_days
            )
            .count()
        )

        return {
            "total_jobs": total_jobs,
            "completed": completed,
            "failed": failed,
            "cancelled": cancelled,
            "pending": pending,
            "running": running,
            "oldest_completed_age_days": oldest_completed_age_days,
            "oldest_failed_age_days": oldest_failed_age_days,
            "cleanable_jobs_7_days": cleanable_7_days,
            "cleanable_jobs_30_days": cleanable_30_days,
        }
