"""
AIFlowProfile Model
Named, versioned AI flow profiles with free-form names and usage_type tags.
Replaces per-usage_type chains with reusable, versionable configurations.
"""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, Text, Boolean, DateTime, Integer, JSON, String
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base
from app.models.ai_model import AIModelUsageType


class AIFlowProfile(Base):
    """
    Named AI Flow profile with versioning.

    Users create profiles with free-form names (e.g. "Cost Optimized", "Quality First")
    and tag each with a usage_type. Multiple profiles can share the same usage_type,
    but only one can be active per usage_type at a time.
    """

    __tablename__ = "ai_flow_profiles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)
    name = Column(Text, nullable=False)
    usage_type = Column(
        SQLEnum(
            AIModelUsageType,
            name="ai_model_usage_type",
            values_callable=lambda x: [e.value for e in x],
            create_type=False,
        ),
        nullable=False,
        index=True,
    )
    version = Column(Integer, nullable=False, default=1)
    chain = Column(JSON, nullable=False, default=list)
    utility_nodes = Column(JSON, nullable=True, default=None)
    node_positions = Column(JSON, nullable=True, default=None)
    is_active = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<AIFlowProfile(name='{self.name}', usage_type='{self.usage_type}', v{self.version}, active={self.is_active})>"
