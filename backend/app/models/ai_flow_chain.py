"""
AIFlowChain Model
Stores per-usage_type ordered fallback chains of AI model IDs.
PROMPT #122 - AI Flow: Visual Fallback Chain Configuration
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, Boolean, DateTime, JSON, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base
from app.models.ai_model import AIModelUsageType


class AIFlowChain(Base):
    """
    AIFlowChain model - Stores fallback chain configuration per usage_type.

    Only ONE chain per usage_type (unique constraint).
    The chain field is a JSON array of AI Model UUIDs in fallback order.
    """

    __tablename__ = "ai_flow_chains"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)
    usage_type = Column(
        SQLEnum(
            AIModelUsageType,
            name="ai_model_usage_type",
            values_callable=lambda x: [e.value for e in x],
            create_type=False,
        ),
        nullable=False,
        unique=True,
        index=True,
    )
    chain = Column(JSON, nullable=False, default=list)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<AIFlowChain(id={self.id}, usage_type='{self.usage_type}', chain_length={len(self.chain or [])})>"
