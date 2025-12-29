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

    # Basic fields
    conversation_data = Column(JSON, nullable=False, default=list)
    ai_model_used = Column(String(100), nullable=False)
    status = Column(
        SQLEnum(InterviewStatus, name="interview_status", values_callable=lambda x: [e.value for e in x]),
        default=InterviewStatus.ACTIVE,
        nullable=False,
        index=True
    )

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="interviews")

    prompts = relationship(
        "Prompt",
        back_populates="interview",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<Interview(id={self.id}, project_id={self.project_id}, status={self.status})>"
