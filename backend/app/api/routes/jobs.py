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

    # Only allow deletion of completed/failed jobs
    if job.status in (JobStatus.PENDING, JobStatus.RUNNING):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete a job that is still pending or running"
        )

    db.delete(job)
    db.commit()

    logger.info(f"Deleted job {job_id}")
    return None
