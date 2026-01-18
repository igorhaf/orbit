"""
DiscoveryQueue Model
Represents a project queued for pattern discovery.

When a task is executed but the project has no discovered specs,
the project is added to this queue for manual validation.
"""

import enum
from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


class DiscoveryQueueStatus(str, enum.Enum):
    """Discovery queue item status"""
    PENDING = "pending"         # Waiting for user action
    PROCESSING = "processing"   # Discovery is running
    COMPLETED = "completed"     # Discovery finished successfully
    DISMISSED = "dismissed"     # User dismissed (no discovery needed)
    FAILED = "failed"           # Discovery failed


class DiscoveryQueue(Base):
    """
    DiscoveryQueue model - Tracks projects needing pattern discovery

    When a task is executed without specs, the project is added here.
    Users can then manually process the queue to discover patterns.

    Attributes:
        id: Unique identifier
        project_id: The project that needs discovery
        reason: Why this was added to queue (e.g., "task_execution_without_specs")
        task_id: The task that triggered the queue addition (optional)
        status: Current status (pending, processing, completed, dismissed, failed)
        created_at: When added to queue
        processed_at: When discovery was completed/dismissed
    """

    __tablename__ = "discovery_queue"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)

    # Foreign keys
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    task_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="SET NULL"),
        nullable=True
    )

    # Fields
    reason = Column(String(255), nullable=True)
    status = Column(
        SQLEnum(DiscoveryQueueStatus, name="discovery_queue_status", values_callable=lambda x: [e.value for e in x]),
        default=DiscoveryQueueStatus.PENDING,
        nullable=False,
        index=True
    )

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    processed_at = Column(DateTime, nullable=True)

    # Relationships
    project = relationship("Project", backref="discovery_queue_items")
    task = relationship("Task", backref="discovery_queue_items")

    def __repr__(self) -> str:
        return f"<DiscoveryQueue(id={self.id}, project_id={self.project_id}, status='{self.status.value}')>"
