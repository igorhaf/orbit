"""
Pipeline Artifact Model
Stores intermediate artifacts from the deep pipeline phases for feedback loops and resumability.
"""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, String, Integer, DateTime, Enum, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy import ForeignKey
import enum

from app.database import Base


class ArtifactType(str, enum.Enum):
    """Types of pipeline artifacts produced by each phase."""
    file_analysis = "file_analysis"              # Phase 1: per-file Haiku analysis
    synthesized_rules = "synthesized_rules"      # Phase 2: cross-file Sonnet synthesis
    architectural_map = "architectural_map"      # Phase 3: Sonnet + thinking architecture
    epic_generation = "epic_generation"          # Phase 4a: Opus epic generation
    story_generation = "story_generation"        # Phase 4b: Opus story decomposition
    wiki_structure = "wiki_structure"            # Phase 5a: wiki planning
    quality_report = "quality_report"            # Phase 6: QA validation report


class PipelineArtifact(Base):
    """
    Intermediate artifacts from the 7-phase deep pipeline.

    Each phase stores its output as a PipelineArtifact, enabling:
    - Resumability: if Phase 3 fails, Phase 2 artifacts are still available
    - Feedback loops: Phase 6 QA references all previous artifacts
    - Debugging: inspect what each phase produced
    - Gap filling: Phase 7 re-runs specific phases using QA feedback
    """

    __tablename__ = "pipeline_artifacts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)

    artifact_type = Column(Enum(ArtifactType), nullable=False, index=True)
    phase = Column(Integer, nullable=False)

    # Domain or file path this artifact relates to (for Phase 1/2 grouping)
    domain = Column(String(255), nullable=True, index=True)
    source_path = Column(String(500), nullable=True)

    # The actual artifact content (structured JSON)
    content = Column(JSONB, nullable=False)

    # Quality score assigned by Phase 6 QA (0-100, NULL if not yet reviewed)
    quality_score = Column(Integer, nullable=True)

    # Pipeline run identifier (groups artifacts from the same run)
    run_id = Column(UUID(as_uuid=True), nullable=False, index=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("ix_pipeline_artifacts_project_phase", "project_id", "phase"),
        Index("ix_pipeline_artifacts_run_type", "run_id", "artifact_type"),
    )

    def __repr__(self) -> str:
        return f"<PipelineArtifact(id={self.id}, type={self.artifact_type}, phase={self.phase})>"
