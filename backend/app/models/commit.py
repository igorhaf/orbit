"""
Commit Model
Represents an AI-generated commit following Conventional Commits
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, Text, DateTime, JSON, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import enum

from app.database import Base


class CommitType(str, enum.Enum):
    """Commit type enum following Conventional Commits"""
    FEAT = "feat"
    FIX = "fix"
    DOCS = "docs"
    STYLE = "style"
    REFACTOR = "refactor"
    TEST = "test"
    CHORE = "chore"
    PERF = "perf"


class Commit(Base):
    """
    Commit model - Represents an AI-generated commit

    Attributes:
        id: Unique identifier
        type: Type of commit (feat, fix, docs, etc.)
        message: Commit message
        changes: JSON containing details of changes
        created_by_ai_model: Name of the AI model that generated the commit
        task_id: Reference to the associated task
        project_id: Reference to the project
        timestamp: Timestamp of the commit
        author: Author of the commit (default: AI System)
    """

    __tablename__ = "commits"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)

    # Foreign keys
    task_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # Basic fields
    type = Column(
        SQLEnum(CommitType, name="commit_type", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        index=True
    )
    message = Column(Text, nullable=False)
    changes = Column(JSON, nullable=True, default=dict)
    created_by_ai_model = Column(String(100), nullable=False)
    author = Column(String(100), default="AI System", nullable=False)

    # Timestamp
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    # Relationships
    task = relationship("Task", back_populates="commits")
    project = relationship("Project", back_populates="commits")

    def __repr__(self) -> str:
        return f"<Commit(id={self.id}, type={self.type}, task_id={self.task_id})>"
