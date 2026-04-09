"""
ProjectChat Model
PROMPT #282 - RAG Chat: Project Knowledge Chat Sessions

Represents a chat session where users ask questions about their project
and get AI-powered answers based on the project's RAG knowledge base.
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, Text, String, DateTime, JSON, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


class ProjectChat(Base):
    __tablename__ = "project_chats"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)

    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    title = Column(Text, nullable=False, default="New Chat")

    # JSON array of messages: [{"role": "user"|"assistant", "content": "...", "timestamp": "ISO-8601", "model": "..."}]
    messages = Column(JSON, nullable=False, default=list)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )

    # Relationships
    project = relationship("Project", back_populates="chats")

    __table_args__ = (
        Index("idx_project_chats_project_created", "project_id", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<ProjectChat(id={self.id}, project_id={self.project_id}, title={self.title})>"
