"""
TaskComment Model
Structured comments for tasks (replaces JSON comments)
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Enum as SQLEnum, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import enum

from app.database import Base


class CommentType(str, enum.Enum):
    """Types of comments"""
    COMMENT = "comment"            # User comment
    SYSTEM = "system"              # System-generated (status changed, etc.)
    AI_INSIGHT = "ai_insight"      # AI-generated observation
    VALIDATION = "validation"      # Validation result
    CODE_SNIPPET = "code_snippet"  # Code example or snippet


class TaskComment(Base):
    """
    TaskComment model - Structured comments for tasks

    Attributes:
        id: Unique identifier
        task_id: Task this comment belongs to
        author: Username/system that created comment
        content: Comment text (markdown supported)
        comment_type: Type of comment
        metadata: Additional structured data (for system comments)
        created_at: When comment was created
        updated_at: When comment was last edited
    """

    __tablename__ = "task_comments"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)

    # Foreign keys
    task_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # Comment data
    author = Column(String(100), nullable=False)  # Future: author_id FK to users
    content = Column(Text, nullable=False)
    comment_type = Column(
        SQLEnum(CommentType, name="comment_type", values_callable=lambda x: [e.value for e in x]),
        default=CommentType.COMMENT,
        nullable=False
    )
    metadata = Column(JSON, nullable=True, default=dict)  # {ai_model, execution_id, etc.}

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    task = relationship("Task", back_populates="comments")

    def __repr__(self) -> str:
        return f"<TaskComment(task_id={self.task_id}, author='{self.author}', type={self.comment_type})>"
