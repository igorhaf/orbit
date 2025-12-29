"""
Prompt Model
Represents a composable prompt following the Prompter architecture
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, Text, Boolean, Integer, DateTime, JSON, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


class Prompt(Base):
    """
    Prompt model - Represents a composable prompt following Prompter architecture

    Attributes:
        id: Unique identifier
        content: The actual prompt content
        type: Type of prompt (system, user, template, etc.)
        is_reusable: Whether this prompt can be reused in other contexts
        components: JSON list of reusable components
        project_id: Reference to the project
        created_from_interview_id: Reference to the interview that generated this prompt
        version: Version number for prompt versioning
        parent_id: Reference to parent prompt (for versioning)
        created_at: Timestamp of creation
        updated_at: Timestamp of last update
    """

    __tablename__ = "prompts"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)

    # Foreign keys
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    created_from_interview_id = Column(
        UUID(as_uuid=True),
        ForeignKey("interviews.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )

    parent_id = Column(
        UUID(as_uuid=True),
        ForeignKey("prompts.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )

    # Basic fields
    content = Column(Text, nullable=False)
    type = Column(String(50), nullable=False, default="user", index=True)
    is_reusable = Column(Boolean, default=False, nullable=False)
    components = Column(JSON, nullable=True, default=list)
    version = Column(Integer, default=1, nullable=False)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )

    # Relationships
    project = relationship("Project", back_populates="prompts")
    interview = relationship("Interview", back_populates="prompts")

    # Self-referential relationship for versioning
    parent = relationship(
        "Prompt",
        remote_side=[id],
        back_populates="children",
        foreign_keys=[parent_id]
    )

    children = relationship(
        "Prompt",
        back_populates="parent",
        cascade="all, delete-orphan",
        foreign_keys=[parent_id]
    )

    tasks = relationship(
        "Task",
        back_populates="prompt",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<Prompt(id={self.id}, type='{self.type}', version={self.version})>"
