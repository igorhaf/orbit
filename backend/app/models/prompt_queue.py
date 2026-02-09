"""
PromptQueue Model - PROMPT #215
Orchestration priority queue for prompt/card execution ordering.

Cards/prompts are ordered in a per-project queue that determines
execution priority. The queue considers:
- Hierarchy (epics before stories before tasks before subtasks)
- Dependencies (depends_on resolved first)
- Card priority (critical > high > medium > low > trivial)
- Age (older cards as tiebreaker)
- Manual overrides (user drag-to-reorder)
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Enum as SQLEnum, Boolean, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import enum

from app.database import Base


class QueueItemStatus(str, enum.Enum):
    """Status of an item in the prompt queue."""
    PENDING = "pending"          # Waiting to be executed
    READY = "ready"              # Dependencies met, ready to execute
    EXECUTING = "executing"      # Currently being executed
    COMPLETED = "completed"      # Execution finished successfully
    FAILED = "failed"            # Execution failed
    SKIPPED = "skipped"          # Manually skipped by user
    BLOCKED = "blocked"          # Blocked by unresolved dependency


class PromptQueue(Base):
    """
    PromptQueue model - Per-project ordered queue of cards/prompts.

    Each entry links to a Task (card) and has a position that determines
    execution priority. Position 1 = highest priority (executes first).
    """

    __tablename__ = "prompt_queue"

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
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # Queue ordering
    position = Column(Integer, nullable=False, default=0, index=True)

    # Status tracking
    status = Column(
        SQLEnum(QueueItemStatus, name="queue_item_status", values_callable=lambda x: [e.value for e in x]),
        default=QueueItemStatus.PENDING,
        nullable=False,
        index=True
    )

    # Scoring factors (computed, stored for display)
    priority_score = Column(Integer, default=0, nullable=False)  # Computed from card priority
    hierarchy_score = Column(Integer, default=0, nullable=False)  # Computed from item_type depth
    age_score = Column(Integer, default=0, nullable=False)  # Computed from card age in days
    dependency_score = Column(Integer, default=0, nullable=False)  # Computed from dependency chain length
    manual_override = Column(Boolean, default=False, nullable=False)  # True if user manually reordered

    # Execution tracking
    execution_job_id = Column(UUID(as_uuid=True), nullable=True)  # Link to async_job
    execution_notes = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )
    executed_at = Column(DateTime, nullable=True)

    # Relationships
    task = relationship("Task", foreign_keys=[task_id])

    def __repr__(self) -> str:
        return f"<PromptQueue(id={self.id}, position={self.position}, status='{self.status}')>"
