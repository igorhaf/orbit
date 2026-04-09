"""
AIModel Model
Represents an AI model configuration
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, Text, String, Boolean, DateTime, JSON, Enum as SQLEnum, Integer
from sqlalchemy.dialects.postgresql import UUID
import enum

from app.database import Base


class AIModelUsageType(str, enum.Enum):
    """AI Model usage type enum"""
    INTERVIEW = "interview"
    PROMPT_GENERATION = "prompt_generation"
    COMMIT_GENERATION = "commit_generation"
    TASK_EXECUTION = "task_execution"
    PATTERN_DISCOVERY = "pattern_discovery"  # PROMPT #62 - AI-powered pattern discovery
    MEMORY = "memory"  # PROMPT #118 - Codebase memory scan and business rules extraction
    QUEUE_ORCHESTRATION = "queue_orchestration"  # PROMPT #215 - Prompt queue execution
    CONTENT_GENERATION = "content_generation"  # PROMPT #252 - Wiki, Cards, Description, Title (Opus)
    RAG_EXTRACTION = "rag_extraction"  # PROMPT #252 - Business rules extraction to RAG (Opus)
    GENERAL = "general"


class AIModel(Base):
    """
    AIModel model - Represents an AI model configuration

    Attributes:
        id: Unique identifier
        name: Model name (unique)
        provider: AI provider (anthropic, openai, local, etc.)
        api_key: Encrypted API key
        usage_type: Type of usage for this model
        is_active: Whether this model is currently active
        config: JSON containing additional configuration
        created_at: Timestamp of creation
        updated_at: Timestamp of last update
    """

    __tablename__ = "ai_models"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)

    # Basic fields
    name = Column(Text, nullable=False, unique=True, index=True)
    provider = Column(String(50), nullable=False, index=True)
    api_key = Column(Text, nullable=False)  # Should be encrypted in production
    usage_type = Column(
        SQLEnum(AIModelUsageType, name="ai_model_usage_type", values_callable=lambda x: [e.value for e in x]),
        default=AIModelUsageType.GENERAL,
        nullable=False,
        index=True
    )
    is_active = Column(Boolean, default=True, nullable=False, index=True)
    config = Column(JSON, nullable=True, default=dict)

    # Rate Limiting (PROMPT #152)
    # Controls how many requests can be made to this model within a time window
    # NULL = no rate limiting (unlimited)
    rate_limit_requests = Column(Integer, nullable=True)  # Max requests per window (e.g., 3)
    rate_limit_window_seconds = Column(Integer, nullable=True)  # Window size in seconds (e.g., 60)

    # Timeout (PROMPT #207)
    # Per-model API timeout in seconds. NULL = use system default from settings.
    timeout_seconds = Column(Integer, nullable=True)

    # Concurrency (PROMPT #228)
    # Max parallel API calls to this model. NULL = unlimited.
    max_concurrent_requests = Column(Integer, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )

    def __repr__(self) -> str:
        return f"<AIModel(id={self.id}, name='{self.name}', provider='{self.provider}')>"
