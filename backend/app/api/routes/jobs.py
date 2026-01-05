"""
Async Jobs API Router
CRUD operations for tracking background job status.

PROMPT #65 - Async Job System
Allows clients to poll job status instead of blocking on long operations.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional
from uuid import UUID
import logging

from app.database import get_db
from app.models.async_job import AsyncJob, JobStatus
from app.services.job_manager import JobManager
from app.services.job_cleanup import JobCleanupService

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/{job_id}")
async def get_job_status(
    job_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get the status of an async job.

    Clients should poll this endpoint periodically (every 1-2 seconds)
    to check if a background job has completed.

    Args:
        job_id: UUID of the async job

    Returns:
        {
            "id": "...",
            "job_type": "interview_message",
            "status": "pending" | "running" | "completed" | "failed",
            "progress_percent": 50,  # Optional
            "progress_message": "Processing story 3/7...",  # Optional
            "result": {...},  # Only when status=completed
            "error": "...",  # Only when status=failed
            "created_at": "...",
            "started_at": "...",
            "completed_at": "..."
        }

    Example:
        # Client creates job
        POST /interviews/{id}/send-message
        → {job_id: "abc-123", status: "pending"}

        # Client polls for status
        GET /jobs/abc-123
        → {status: "running", progress_percent: 30}

        GET /jobs/abc-123
        → {status: "running", progress_percent: 60}

        GET /jobs/abc-123
        → {status: "completed", result: {...}}

        # Client uses result
        Display AI response from job.result
    """
    job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()

    if not job:
        logger.error(f"Job {job_id} not found")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found"
        )

    return job.to_dict()


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_job(
    job_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Delete a completed or failed job.

    Useful for cleanup after client has consumed the result.

    Args:
        job_id: UUID of the async job

    Returns:
        204 No Content
    """
    job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found"
        )

    # Only allow deletion of completed/failed/cancelled jobs
    if job.status in (JobStatus.PENDING, JobStatus.RUNNING):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete a job that is still pending or running. Cancel it first if needed."
        )

    db.delete(job)
    db.commit()

    logger.info(f"Deleted job {job_id}")
    return None


@router.patch("/{job_id}/cancel")
async def cancel_job(
    job_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Cancel a pending or running job.

    Args:
        job_id: UUID of the async job

    Returns:
        {
            "id": "...",
            "status": "cancelled",
            "message": "Job was cancelled successfully"
        }

    Raises:
        404: Job not found
        400: Job cannot be cancelled (already completed/failed/cancelled)

    Example:
        # User starts backlog generation (takes 5 minutes)
        POST /interviews/{id}/generate-prompts-async
        → {job_id: "abc-123"}

        # User realizes they want to cancel (30 seconds later)
        PATCH /jobs/abc-123/cancel
        → {status: "cancelled"}

        # Background task detects cancellation and stops gracefully
    """
    job_manager = JobManager(db)

    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found"
        )

    # Attempt to cancel
    success = job_manager.cancel_job(job_id)

    if not success:
        # Job couldn't be cancelled (already completed/failed/cancelled)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot cancel job with status '{job.status.value}'. Only pending or running jobs can be cancelled."
        )

    logger.info(f"Job {job_id} cancelled successfully")

    return {
        "id": str(job_id),
        "status": "cancelled",
        "message": "Job was cancelled successfully"
    }


@router.get("/cleanup/stats")
async def get_cleanup_stats(
    db: Session = Depends(get_db)
):
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

    Example:
        GET /api/v1/jobs/cleanup/stats
        → Show how many old jobs can be cleaned up
    """
    cleanup_service = JobCleanupService(db)
    stats = cleanup_service.get_cleanup_stats()

    logger.info(f"Cleanup stats: {stats}")
    return stats


@router.post("/cleanup")
async def cleanup_old_jobs(
    days: int = 7,
    db: Session = Depends(get_db)
):
    """
    Clean up old completed/failed/cancelled jobs.

    Args:
        days: Delete jobs older than this many days (default: 7)

    Returns:
        {
            "deleted_count": 25,
            "cutoff_days": 7,
            "message": "Successfully deleted 25 old jobs"
        }

    Example:
        # Delete jobs older than 7 days
        POST /api/v1/jobs/cleanup
        → {deleted_count: 25}

        # Delete jobs older than 30 days
        POST /api/v1/jobs/cleanup?days=30
        → {deleted_count: 45}
    """
    cleanup_service = JobCleanupService(db)

    deleted_count = cleanup_service.cleanup_old_jobs(days=days)

    logger.info(f"Cleaned up {deleted_count} jobs older than {days} days")

    return {
        "deleted_count": deleted_count,
        "cutoff_days": days,
        "message": f"Successfully deleted {deleted_count} old jobs (older than {days} days)"
    }
