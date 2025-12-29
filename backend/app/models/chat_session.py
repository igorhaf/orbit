"""
ChatSession Model
Represents a chat session with AI for task execution
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, DateTime, JSON, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import enum

from app.database import Base


class ChatSessionStatus(str, enum.Enum):
    """Chat session status enum"""
    ACTIVE = "active"
    COMPLETED = "completed"
    FAILED = "failed"


class ChatSession(Base):
    """
    ChatSession model - Represents a chat session with AI for executing a task

    Attributes:
        id: Unique identifier
        task_id: Reference to the associated task
        messages: JSON array of chat messages
        ai_model_used: Name of the AI model used
        status: Current status of the chat session
        created_at: Timestamp of creation
        updated_at: Timestamp of last update
    """

    __tablename__ = "chat_sessions"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)

    # Foreign keys
    task_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # Basic fields
    messages = Column(JSON, nullable=False, default=list)
    ai_model_used = Column(String(100), nullable=False)
    status = Column(
        SQLEnum(ChatSessionStatus, name="chat_session_status", values_callable=lambda x: [e.value for e in x]),
        default=ChatSessionStatus.ACTIVE,
        nullable=False,
        index=True
    )

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )

    # Relationships
    task = relationship("Task", back_populates="chat_sessions")

    def __repr__(self) -> str:
        return f"<ChatSession(id={self.id}, task_id={self.task_id}, status={self.status})>"
