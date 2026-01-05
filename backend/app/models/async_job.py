"""
Async Job Model for tracking long-running background tasks.

PROMPT #65 - Async Job System
Tracks status of asynchronous operations like AI calls, provisioning, backlog generation.
"""

from sqlalchemy import Column, String, Text, Enum as SQLEnum, DateTime, JSON, Float
from sqlalchemy.dialects.postgresql import UUID
from datetime import datetime
from uuid import uuid4
import enum

from app.database import Base


class JobStatus(str, enum.Enum):
    """Status of an async job."""
    PENDING = "pending"      # Job created, not started yet
    RUNNING = "running"      # Job is currently executing
    COMPLETED = "completed"  # Job finished successfully
    FAILED = "failed"        # Job failed with error
    CANCELLED = "cancelled"  # Job was cancelled by user


class JobType(str, enum.Enum):
    """Type of async job."""
    INTERVIEW_MESSAGE = "interview_message"        # AI response for interview
    BACKLOG_GENERATION = "backlog_generation"      # Epic → Stories → Tasks generation
    PROJECT_PROVISIONING = "project_provisioning"  # Project scaffolding


class AsyncJob(Base):
    """
    Tracks long-running background tasks.

    Workflow:
    1. Client creates job via API endpoint
    2. Backend returns job_id immediately
    3. BackgroundTask executes the actual work
    4. Client polls /jobs/{job_id} for status
    5. When status=completed, client gets result

    Example:
        # Create job
        job = AsyncJob(
            job_type=JobType.INTERVIEW_MESSAGE,
            status=JobStatus.PENDING,
            input_data={"interview_id": str(interview.id), "message": "..."}
        )
        db.add(job)
        db.commit()

        # Return job_id to client immediately
        return {"job_id": str(job.id), "status": "pending"}

        # Client polls: GET /jobs/{job_id}
        # Returns: {"status": "running", "progress": 50}
        # ...
        # Returns: {"status": "completed", "result": {...}}
    """
    __tablename__ = "async_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)

    # Job metadata
    job_type = Column(SQLEnum(JobType), nullable=False, index=True)
    status = Column(SQLEnum(JobStatus), nullable=False, default=JobStatus.PENDING, index=True)

    # Input/Output
    input_data = Column(JSON, nullable=False, default=dict)  # Parameters for the job
    result = Column(JSON, nullable=True)                     # Result when completed
    error = Column(Text, nullable=True)                      # Error message if failed

    # Progress tracking
    progress_percent = Column(Float, nullable=True)          # 0-100, optional
    progress_message = Column(String(500), nullable=True)    # Human-readable progress

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    # Related entities (optional)
    project_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    interview_id = Column(UUID(as_uuid=True), nullable=True, index=True)

    def __repr__(self):
        return f"<AsyncJob {self.id} {self.job_type} {self.status}>"

    def to_dict(self):
        """Convert to dictionary for API response."""
        return {
            "id": str(self.id),
            "job_type": self.job_type.value,
            "status": self.status.value,
            "input_data": self.input_data,
            "result": self.result,
            "error": self.error,
            "progress_percent": self.progress_percent,
            "progress_message": self.progress_message,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "project_id": str(self.project_id) if self.project_id else None,
            "interview_id": str(self.interview_id) if self.interview_id else None
        }
