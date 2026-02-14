"""
Job Log Entry Model
Stores historical log entries for async job execution.

PROMPT #286 - Job Detail Log Viewer
Each call to JobManager.update_progress() creates one entry.
Lifecycle events (start, complete, fail, cancel) also create entries.
"""

from sqlalchemy import Column, String, Text, DateTime, Float, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID
from datetime import datetime
from uuid import uuid4

from app.database import Base


class JobLogEntry(Base):
    __tablename__ = "job_log_entries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    job_id = Column(
        UUID(as_uuid=True),
        ForeignKey("async_jobs.id", ondelete="CASCADE"),
        nullable=False,
    )
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
    level = Column(String(20), nullable=False, default="info")
    message = Column(Text, nullable=False)
    progress_percent = Column(Float, nullable=True)

    __table_args__ = (
        Index("idx_job_log_entries_job_id", "job_id"),
        Index("idx_job_log_entries_job_ts", "job_id", "timestamp"),
    )

    def to_dict(self):
        return {
            "id": str(self.id),
            "job_id": str(self.job_id),
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "level": self.level,
            "message": self.message,
            "progress_percent": self.progress_percent,
        }
