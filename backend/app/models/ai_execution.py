"""
AIExecution Model
Represents a logged execution of an AI model (audit trail)
PROMPT #54 - AI Execution Logging System
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, Text, Integer, DateTime, JSON, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


class AIExecution(Base):
    """
    AIExecution model - Tracks every AI model execution for audit/monitoring

    Attributes:
        id: Unique identifier
        ai_model_id: Reference to the AI model that was used
        usage_type: Type of usage (interview, prompt_generation, etc.)
        input_messages: JSON array of input messages sent to the model
        system_prompt: System prompt used (if any)
        response_content: The AI model's response
        input_tokens: Number of input tokens consumed
        output_tokens: Number of output tokens generated
        total_tokens: Total tokens (input + output)
        provider: Provider used (anthropic, openai, google)
        model_name: Specific model name (claude-3-5-sonnet, gpt-4, etc.)
        temperature: Temperature parameter used
        max_tokens: Max tokens parameter used
        execution_metadata: Additional metadata as JSON (renamed from metadata to avoid SQLAlchemy conflict)
        error_message: Error message if execution failed
        execution_time_ms: Execution time in milliseconds
        created_at: Timestamp of execution
    """

    __tablename__ = "ai_executions"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)

    # Foreign keys
    ai_model_id = Column(
        UUID(as_uuid=True),
        ForeignKey("ai_models.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )

    # Execution details
    usage_type = Column(String(50), nullable=False, index=True)
    input_messages = Column(JSON, nullable=False)
    system_prompt = Column(Text, nullable=True)
    response_content = Column(Text, nullable=True)

    # Token usage
    input_tokens = Column(Integer, nullable=True)
    output_tokens = Column(Integer, nullable=True)
    total_tokens = Column(Integer, nullable=True)

    # Model information
    provider = Column(String(50), nullable=False, index=True)
    model_name = Column(String(100), nullable=False)
    temperature = Column(String(10), nullable=True)  # Stored as string to handle floats
    max_tokens = Column(Integer, nullable=True)

    # Additional data
    execution_metadata = Column(JSON, nullable=True, default=dict)  # Renamed from 'metadata' to avoid SQLAlchemy conflict
    error_message = Column(Text, nullable=True)
    execution_time_ms = Column(Integer, nullable=True)

    # Timestamp
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    # Relationships
    ai_model = relationship("AIModel", backref="executions")

    def __repr__(self) -> str:
        return f"<AIExecution(id={self.id}, usage_type='{self.usage_type}', provider='{self.provider}', model='{self.model_name}')>"
