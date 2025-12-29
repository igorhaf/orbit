"""
Task Model
Represents a task in the Kanban board
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, Text, Integer, DateTime, ForeignKey, Enum as SQLEnum, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import enum

from app.database import Base


class TaskStatus(str, enum.Enum):
    """Task status enum - represents columns in Kanban board"""
    BACKLOG = "backlog"
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    REVIEW = "review"
    DONE = "done"


class Task(Base):
    """
    Task model - Represents a task in the Kanban board

    Attributes:
        id: Unique identifier
        title: Task title
        description: Detailed task description
        prompt_id: Reference to associated prompt
        project_id: Reference to the project
        status: Current task status (Kanban column)
        column: Kanban column name
        order: Order within the column
        created_at: Timestamp of creation
        updated_at: Timestamp of last update
    """

    __tablename__ = "tasks"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)

    # Foreign keys
    prompt_id = Column(
        UUID(as_uuid=True),
        ForeignKey("prompts.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )

    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # Basic fields
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(
        SQLEnum(TaskStatus, name="task_status", values_callable=lambda x: [e.value for e in x]),
        default=TaskStatus.BACKLOG,
        nullable=False,
        index=True
    )
    column = Column(String(50), default="backlog", nullable=False)
    order = Column(Integer, default=0, nullable=False)
    comments = Column(JSON, nullable=True, default=list)

    # Task execution fields
    type = Column(String(100), nullable=True)  # "model", "controller", "repository", etc.
    entity = Column(String(100), nullable=True)  # "Book", "User", etc.
    file_path = Column(String(500), nullable=True)  # "src/Models/Book.php"
    complexity = Column(Integer, default=1, nullable=False)  # 1-5 (affects model selection)
    depends_on = Column(JSON, nullable=True, default=list)  # List of task IDs this depends on

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )

    # Relationships
    prompt = relationship("Prompt", back_populates="tasks")
    project = relationship("Project", back_populates="tasks")

    chat_sessions = relationship(
        "ChatSession",
        back_populates="task",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    commits = relationship(
        "Commit",
        back_populates="task",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    result = relationship(
        "TaskResult",
        back_populates="task",
        uselist=False,
        cascade="all, delete-orphan"
    )

    def to_dict(self) -> dict:
        """Converte task para dict (usado pelo orquestrador)"""
        return {
            "id": str(self.id),
            "type": self.type,
            "title": self.title,
            "description": self.description,
            "complexity": self.complexity,
            "depends_on": self.depends_on or [],
            "file_spec": {
                "path": self.file_path,
                "type": self.type,
                "entity": self.entity
            }
        }

    def __repr__(self) -> str:
        return f"<Task(id={self.id}, title='{self.title}', status={self.status})>"
