"""
Prompt Model
Represents a composable prompt following the Prompter architecture
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, Text, Boolean, Integer, Float, DateTime, JSON, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


class Prompt(Base):
    """
    Prompt model - Represents a composable prompt following Prompter architecture

    PROMPT #58 - Enhanced with AI execution audit fields for comprehensive logging

    Attributes:
        id: Unique identifier
        content: The actual prompt content (legacy - use response for new prompts)
        type: Type of prompt (interview, commit, task, etc.)
        is_reusable: Whether this prompt can be reused in other contexts
        components: JSON list of reusable components
        project_id: Reference to the project
        created_from_interview_id: Reference to the interview that generated this prompt
        version: Version number for prompt versioning
        parent_id: Reference to parent prompt (for versioning)

        # AI Execution Audit Fields (PROMPT #58)
        ai_model_used: AI model used for execution (e.g., claude-sonnet-4-5)
        system_prompt: System prompt sent to AI
        user_prompt: User prompt/input sent to AI
        response: AI response/output
        input_tokens: Number of input tokens consumed
        output_tokens: Number of output tokens generated
        total_cost_usd: Total cost in USD for this execution
        execution_time_ms: Execution time in milliseconds
        metadata: Additional metadata (task_id, commit_id, etc.)
        status: Execution status (success, error, timeout)
        error_message: Error message if status is error

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

    # PROMPT #58 - AI Execution Audit Fields
    ai_model_used = Column(String(100), nullable=True, index=True)
    system_prompt = Column(Text, nullable=True)
    user_prompt = Column(Text, nullable=True)
    response = Column(Text, nullable=True)
    input_tokens = Column(Integer, nullable=True, default=0)
    output_tokens = Column(Integer, nullable=True, default=0)
    total_cost_usd = Column(Float, nullable=True, default=0.0)
    execution_time_ms = Column(Integer, nullable=True, default=0)
    execution_metadata = Column(JSON, nullable=True)  # Renamed from 'metadata' (SQLAlchemy reserved)
    status = Column(String(20), nullable=True, default='success', index=True)
    error_message = Column(Text, nullable=True)

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
