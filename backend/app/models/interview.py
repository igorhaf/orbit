"""
Interview Model
Represents a conversational interview session with AI
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, DateTime, JSON, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import enum

from app.database import Base


class InterviewStatus(str, enum.Enum):
    """Interview status enum"""
    ACTIVE = "active"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class Interview(Base):
    """
    Interview model - Represents a conversational session to gather project requirements

    Attributes:
        id: Unique identifier
        project_id: Reference to the project
        conversation_data: JSON array of conversation messages
        ai_model_used: Name of the AI model used for the interview
        status: Current status of the interview
        created_at: Timestamp of creation
        interview_mode: Mode of interview ("requirements" or "task_focused")
        parent_task_id: If task-focused, reference to the task being explored
        task_type_selection: Selected task type (bug/feature/refactor/enhancement)
    """

    __tablename__ = "interviews"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)

    # Foreign keys
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # PROMPT #68 - Dual-Mode Interview System
    parent_task_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=True,
        index=True
    )

    # Basic fields
    conversation_data = Column(JSON, nullable=False, default=list)
    ai_model_used = Column(String(100), nullable=False)
    status = Column(
        SQLEnum(InterviewStatus, name="interview_status", values_callable=lambda x: [e.value for e in x]),
        default=InterviewStatus.ACTIVE,
        nullable=False,
        index=True
    )

    # PROMPT #68 - Dual-Mode Interview System
    interview_mode = Column(
        String(50),
        default="requirements",  # "requirements" | "task_focused"
        nullable=False,
        index=True
    )

    task_type_selection = Column(
        String(50),  # "bug" | "feature" | "refactor" | "enhancement"
        nullable=True
    )

    # PROMPT #77 - Meta Prompt Topic Selection
    focus_topics = Column(
        JSON,  # ["business_rules", "design", "architecture", "security", etc.]
        nullable=True,
        default=list
    )

    # PROMPT #98 - Card-Focused Interview System
    motivation_type = Column(
        String(50),  # "bug" | "feature" | "bugfix" | "design" | "documentation" | etc.
        nullable=True
    )

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="interviews")

    # PROMPT #68 - Dual-Mode Interview System
    parent_task = relationship(
        "Task",
        foreign_keys=[parent_task_id],
        back_populates="exploration_interviews"
    )

    prompts = relationship(
        "Prompt",
        back_populates="interview",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<Interview(id={self.id}, project_id={self.project_id}, status={self.status})>"
