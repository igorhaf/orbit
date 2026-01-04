"""
TaskRelationship Model
Represents relationships between tasks (blocks, depends_on, relates_to, duplicates)
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, DateTime, ForeignKey, Enum as SQLEnum, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import enum

from app.database import Base


class RelationshipType(str, enum.Enum):
    """Relationship types between tasks"""
    BLOCKS = "blocks"              # Source blocks Target
    BLOCKED_BY = "blocked_by"      # Source blocked by Target (inverse of blocks)
    DEPENDS_ON = "depends_on"      # Source depends on Target
    RELATES_TO = "relates_to"      # General relationship
    DUPLICATES = "duplicates"      # Source duplicates Target
    CLONES = "clones"              # Source is clone of Target


class TaskRelationship(Base):
    """
    TaskRelationship model - Represents directed relationships between tasks

    Attributes:
        id: Unique identifier
        source_task_id: Task initiating the relationship
        target_task_id: Task being related to
        relationship_type: Type of relationship
        created_at: When relationship was created
    """

    __tablename__ = "task_relationships"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)

    # Foreign keys
    source_task_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    target_task_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # Relationship metadata
    relationship_type = Column(
        SQLEnum(RelationshipType, name="relationship_type", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        index=True
    )

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    source_task = relationship(
        "Task",
        foreign_keys=[source_task_id],
        back_populates="relationships_as_source"
    )
    target_task = relationship(
        "Task",
        foreign_keys=[target_task_id],
        back_populates="relationships_as_target"
    )

    # Composite indexes for performance
    __table_args__ = (
        Index('ix_task_rel_source_target', 'source_task_id', 'target_task_id'),
        Index('ix_task_rel_type_source', 'relationship_type', 'source_task_id'),
    )

    def __repr__(self) -> str:
        return f"<TaskRelationship({self.source_task_id} {self.relationship_type.value} {self.target_task_id})>"
