"""
Pipeline Run Model
Tracks each execution of the deep pipeline with full metrics,
enabling comparison between runs and quality trend analysis.
"""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, String, Integer, DateTime, Numeric, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.database import Base


class PipelineRun(Base):
    """
    Historical record of a deep pipeline execution.

    Stores the profile snapshot, per-phase scores and durations,
    aggregate stats, and cost information for each run.
    """

    __tablename__ = "pipeline_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    profile_id = Column(UUID(as_uuid=True), ForeignKey("pipeline_profiles.id", ondelete="SET NULL"), nullable=True)

    # Snapshot of profile at execution time (immutable record)
    profile_snapshot = Column(JSONB, nullable=True)
    profile_name = Column(String(50), nullable=True)

    version = Column(String(10), nullable=False, default="v2")
    status = Column(String(20), nullable=False, default="running")  # running, completed, failed

    # Quality scores
    overall_score = Column(Integer, nullable=True)
    phase_scores = Column(JSONB, nullable=True)  # {"phase_1": 87, "phase_2": 72, ...}

    # Per-phase duration in milliseconds
    phase_durations = Column(JSONB, nullable=True)  # {"phase_0": 1200, "phase_1": 45000, ...}

    # Aggregate stats
    total_files_scanned = Column(Integer, nullable=True)
    total_rules_extracted = Column(Integer, nullable=True)
    total_domains = Column(Integer, nullable=True)
    total_cards_created = Column(Integer, nullable=True)
    total_wiki_pages = Column(Integer, nullable=True)

    # Cost tracking
    total_input_tokens = Column(Integer, nullable=True, default=0)
    total_output_tokens = Column(Integer, nullable=True, default=0)
    estimated_cost_usd = Column(Numeric(10, 4), nullable=True)

    # Reinforcement applied (adjustments from previous run)
    reinforcement_applied = Column(JSONB, nullable=True)

    # Error info (if failed)
    error = Column(String(1000), nullable=True)

    # Timestamps
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def __repr__(self) -> str:
        return f"<PipelineRun(id={self.id}, status={self.status}, score={self.overall_score})>"
