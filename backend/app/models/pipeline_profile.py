"""
Pipeline Profile Model
Defines configurable execution profiles for the deep pipeline.
Each profile specifies model, tokens, concurrency and contract per phase.
"""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, String, Integer, Boolean, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.database import Base


class PipelineProfile(Base):
    """
    Configurable execution profile for the 7-phase deep pipeline.

    Profiles control which AI model, max_tokens, concurrency and contract
    are used for each phase — enabling economy, balanced and quality tiers.
    """

    __tablename__ = "pipeline_profiles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)
    name = Column(String(50), unique=True, nullable=False, index=True)
    description = Column(Text, nullable=True)

    # Per-phase configuration (model, max_tokens, concurrency, contract, enabled, thinking_budget)
    phase_configs = Column(JSONB, nullable=False)

    # Quality threshold for Phase 7 gap filling (default 60)
    quality_threshold = Column(Integer, nullable=False, default=60)

    is_default = Column(Boolean, nullable=False, default=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    def get_phase_config(self, phase_key: str) -> dict:
        """Get config for a specific phase (e.g. 'phase_1', 'phase_4a')."""
        return (self.phase_configs or {}).get(phase_key, {})

    def __repr__(self) -> str:
        return f"<PipelineProfile(name={self.name}, default={self.is_default})>"
