"""
StatusTransition Model
Audit log for all status changes
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, Text, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


class StatusTransition(Base):
    """
    StatusTransition model - Audit log for task status changes

    Attributes:
        id: Unique identifier
        task_id: Task that changed status
        from_status: Previous status
        to_status: New status
        transitioned_by: Who made the change
        transition_reason: Optional reason/comment
        created_at: When transition occurred
    """

    __tablename__ = "status_transitions"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)

    # Foreign keys
    task_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # Transition data
    from_status = Column(String(50), nullable=False)  # TaskStatus enum value
    to_status = Column(String(50), nullable=False)    # TaskStatus enum value
    transitioned_by = Column(String(100), nullable=True)  # Future: user FK
    transition_reason = Column(Text, nullable=True)

    # Timestamp
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    # Relationships
    task = relationship("Task", back_populates="transitions")

    def __repr__(self) -> str:
        return f"<StatusTransition({self.from_status} → {self.to_status} at {self.created_at})>"
