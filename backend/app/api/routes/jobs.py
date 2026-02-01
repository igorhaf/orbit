"""
Async Jobs API Router
CRUD operations for tracking background job status.

PROMPT #65 - Async Job System
Allows clients to poll job status instead of blocking on long operations.

PROMPT #128 - Background Job Notifications
Added /active endpoint to list all active (pending/running) jobs.

PROMPT #135 - Job Queue Manager
Added comprehensive endpoints for job queue visualization and management.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, and_
from typing import Optional, List
from uuid import UUID
from datetime import datetime, timedelta
import logging

from app.database import get_db
from app.models.async_job import AsyncJob, JobStatus, JobType
from app.services.job_manager import JobManager
from app.services.job_cleanup import JobCleanupService

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/")
async def list_all_jobs(
    db: Session = Depends(get_db),
    status: Optional[str] = Query(None, description="Filter by status (pending, running, completed, failed, cancelled)"),
    job_type: Optional[str] = Query(None, description="Filter by job type"),
    project_id: Optional[str] = Query(None, description="Filter by project ID"),
    limit: int = Query(50, ge=1, le=500, description="Number of jobs to return"),
    offset: int = Query(0, ge=0, description="Number of jobs to skip"),
    sort_by: str = Query("created_at", description="Field to sort by"),
    sort_order: str = Query("desc", description="Sort order (asc or desc)")
):
    """
    PROMPT #135 - List all jobs with filtering and pagination.

    Used by the Job Queue Manager page to display all jobs.

    Args:
        status: Filter by job status
        job_type: Filter by job type
        project_id: Filter by project ID
        limit: Max number of jobs to return
        offset: Number of jobs to skip
        sort_by: Field to sort by (created_at, started_at, completed_at)
        sort_order: Sort order (asc or desc)

    Returns:
        {
            "jobs": [...],
            "total": 100,
            "limit": 50,
            "offset": 0
        }
    """
    query = db.query(AsyncJob)

    # Apply filters
    if status:
        try:
            status_enum = JobStatus(status)
            query = query.filter(AsyncJob.status == status_enum)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}")

    if job_type:
        try:
            job_type_enum = JobType(job_type)
            query = query.filter(AsyncJob.job_type == job_type_enum)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid job_type: {job_type}")

    if project_id:
        query = query.filter(AsyncJob.project_id == project_id)

    # Get total count before pagination
    total = query.count()

    # Apply sorting
    sort_column = getattr(AsyncJob, sort_by, AsyncJob.created_at)
    if sort_order.lower() == "desc":
        query = query.order_by(desc(sort_column))
    else:
        query = query.order_by(sort_column)

    # Apply pagination
    jobs = query.offset(offset).limit(limit).all()

    return {
        "jobs": [job.to_dict() for job in jobs],
        "total": total,
        "limit": limit,
        "offset": offset
    }


@router.get("/stats")
async def get_job_stats(
    db: Session = Depends(get_db),
    project_id: Optional[str] = Query(None, description="Filter by project ID"),
    hours: int = Query(24, ge=1, le=720, description="Stats for the last N hours")
):
    """
    PROMPT #135 - Get comprehensive job statistics.

    Returns aggregated statistics about jobs for the Job Queue Manager dashboard.

    Args:
        project_id: Optional filter by project
        hours: Time range for statistics (default: 24 hours)

    Returns:
        {
            "total_jobs": 100,
            "by_status": {"pending": 5, "running": 3, ...},
            "by_type": {"memory_scan": 10, "interview_question": 20, ...},
            "avg_duration_seconds": 15.5,
            "jobs_per_hour": [...],
            "error_rate": 0.05,
            "recent_errors": [...]
        }
    """
    cutoff_time = datetime.utcnow() - timedelta(hours=hours)

    # Base query
    base_query = db.query(AsyncJob)
    if project_id:
        base_query = base_query.filter(AsyncJob.project_id == project_id)

    # Total jobs in time range
    total_jobs = base_query.filter(AsyncJob.created_at >= cutoff_time).count()

    # Jobs by status
    status_counts = {}
    for status_val in JobStatus:
        count = base_query.filter(
            AsyncJob.status == status_val,
            AsyncJob.created_at >= cutoff_time
        ).count()
        status_counts[status_val.value] = count

    # Jobs by type
    type_counts = {}
    for type_val in JobType:
        count = base_query.filter(
            AsyncJob.job_type == type_val,
            AsyncJob.created_at >= cutoff_time
        ).count()
        if count > 0:  # Only include types with jobs
            type_counts[type_val.value] = count

    # Average duration for completed jobs
    completed_jobs = base_query.filter(
        AsyncJob.status == JobStatus.COMPLETED,
        AsyncJob.started_at.isnot(None),
        AsyncJob.completed_at.isnot(None),
        AsyncJob.created_at >= cutoff_time
    ).all()

    durations = []
    for job in completed_jobs:
        if job.started_at and job.completed_at:
            duration = (job.completed_at - job.started_at).total_seconds()
            durations.append(duration)

    avg_duration = sum(durations) / len(durations) if durations else 0

    # Error rate
    failed_count = status_counts.get("failed", 0)
    completed_count = status_counts.get("completed", 0)
    total_finished = failed_count + completed_count
    error_rate = failed_count / total_finished if total_finished > 0 else 0

    # Recent errors
    recent_errors = base_query.filter(
        AsyncJob.status == JobStatus.FAILED,
        AsyncJob.created_at >= cutoff_time
    ).order_by(desc(AsyncJob.completed_at)).limit(10).all()

    # Jobs per hour (last 24 hours)
    jobs_per_hour = []
    for i in range(min(hours, 24)):
        hour_start = datetime.utcnow() - timedelta(hours=i+1)
        hour_end = datetime.utcnow() - timedelta(hours=i)
        count = base_query.filter(
            AsyncJob.created_at >= hour_start,
            AsyncJob.created_at < hour_end
        ).count()
        jobs_per_hour.append({
            "hour": hour_start.strftime("%H:%M"),
            "count": count
        })

    jobs_per_hour.reverse()  # Oldest first

    return {
        "total_jobs": total_jobs,
        "by_status": status_counts,
        "by_type": type_counts,
        "avg_duration_seconds": round(avg_duration, 2),
        "jobs_per_hour": jobs_per_hour,
        "error_rate": round(error_rate, 4),
        "recent_errors": [
            {
                "id": str(job.id),
                "job_type": job.job_type.value,
                "error": job.error,
                "notification_title": job.notification_title,
                "completed_at": job.completed_at.isoformat() if job.completed_at else None
            }
            for job in recent_errors
        ],
        "time_range_hours": hours
    }


@router.get("/types")
async def list_job_types():
    """
    PROMPT #135 - List all available job types.

    Returns:
        List of job type values for filter dropdowns.
    """
    return [{"value": jt.value, "label": jt.value.replace("_", " ").title()} for jt in JobType]


@router.get("/statuses")
async def list_job_statuses():
    """
    PROMPT #135 - List all available job statuses.

    Returns:
        List of job status values for filter dropdowns.
    """
    return [{"value": js.value, "label": js.value.title()} for js in JobStatus]


@router.get("/active")
async def list_active_jobs(
    db: Session = Depends(get_db)
):
    """
    PROMPT #128 - List all active (pending or running) jobs.

    Used by the frontend notification bell to show in-progress jobs.

    Returns:
        List of job objects with status pending or running.
    """
    active_jobs = db.query(AsyncJob).filter(
        AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING])
    ).order_by(AsyncJob.created_at.desc()).all()

    return [job.to_dict() for job in active_jobs]


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


@router.delete("/bulk")
async def bulk_delete_jobs(
    status: Optional[str] = Query(None, description="Delete jobs with this status"),
    job_type: Optional[str] = Query(None, description="Delete jobs with this type"),
    older_than_hours: Optional[int] = Query(None, description="Delete jobs older than N hours"),
    db: Session = Depends(get_db)
):
    """
    PROMPT #135 - Bulk delete jobs with filters.

    At least one filter must be provided for safety.

    Args:
        status: Filter by status
        job_type: Filter by job type
        older_than_hours: Filter by age

    Returns:
        {
            "deleted_count": 25,
            "message": "Successfully deleted 25 jobs"
        }
    """
    if not status and not job_type and not older_than_hours:
        raise HTTPException(
            status_code=400,
            detail="At least one filter (status, job_type, or older_than_hours) must be provided"
        )

    query = db.query(AsyncJob)

    # Don't allow deleting active jobs
    query = query.filter(AsyncJob.status.notin_([JobStatus.PENDING, JobStatus.RUNNING]))

    if status:
        try:
            status_enum = JobStatus(status)
            if status_enum in [JobStatus.PENDING, JobStatus.RUNNING]:
                raise HTTPException(status_code=400, detail="Cannot bulk delete pending or running jobs")
            query = query.filter(AsyncJob.status == status_enum)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}")

    if job_type:
        try:
            job_type_enum = JobType(job_type)
            query = query.filter(AsyncJob.job_type == job_type_enum)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid job_type: {job_type}")

    if older_than_hours:
        cutoff = datetime.utcnow() - timedelta(hours=older_than_hours)
        query = query.filter(AsyncJob.created_at < cutoff)

    count = query.count()
    query.delete(synchronize_session=False)
    db.commit()

    logger.info(f"Bulk deleted {count} jobs")

    return {
        "deleted_count": count,
        "message": f"Successfully deleted {count} jobs"
    }
