"""
ProjectAnalysis Model
Stores analysis results from uploaded project archives
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, Text, DateTime, JSON, Integer, Boolean, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


class ProjectAnalysis(Base):
    """
    ProjectAnalysis model - Stores results from analyzing uploaded codebases

    Workflow:
    1. User uploads .zip/.tar.gz project archive
    2. System extracts and analyzes structure
    3. Detects stack (Laravel, Next.js, Django, etc.)
    4. Extracts conventions (naming, code style, architecture)
    5. Generates custom orchestrator dynamically
    6. Registers orchestrator for use with tasks

    Attributes:
        id: Unique identifier
        project_id: Optional link to existing project
        original_filename: Name of uploaded file
        file_size_bytes: Size of uploaded file
        upload_path: Path where file is stored
        extraction_path: Path where archive was extracted
        status: Current processing status
        detected_stack: Detected framework/stack
        confidence_score: Detection confidence (0-100)
        file_structure: JSON tree of extracted files
        conventions: Extracted naming conventions
        patterns: Recognized code patterns
        dependencies: Detected dependencies
        orchestrator_generated: Whether orchestrator was created
        orchestrator_key: Unique key for orchestrator
        orchestrator_code: Generated Python orchestrator code
        error_message: Error details if failed
        created_at: Upload timestamp
        updated_at: Last update timestamp
        completed_at: Analysis completion timestamp
    """

    __tablename__ = "project_analyses"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)

    # Optional project link
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )

    # File information
    original_filename = Column(String(255), nullable=False)
    file_size_bytes = Column(Integer, nullable=False)
    upload_path = Column(String(500), nullable=True)
    extraction_path = Column(String(500), nullable=True)

    # Processing status
    status = Column(
        String(50),
        nullable=False,
        default="uploaded",
        index=True
    )  # uploaded, analyzing, completed, failed

    # Detection results
    detected_stack = Column(String(100), nullable=True)
    confidence_score = Column(Integer, nullable=True)  # 0-100

    # Analysis results (JSON)
    file_structure = Column(JSON, nullable=True)
    conventions = Column(JSON, nullable=True)
    patterns = Column(JSON, nullable=True)
    dependencies = Column(JSON, nullable=True)

    # Orchestrator generation
    orchestrator_generated = Column(Boolean, default=False, nullable=False)
    orchestrator_key = Column(String(100), nullable=True, unique=True, index=True)
    orchestrator_code = Column(Text, nullable=True)

    # Error handling
    error_message = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )
    completed_at = Column(DateTime, nullable=True)

    # Relationships
    project = relationship(
        "Project",
        back_populates="analyses",
        lazy="selectin"
    )

    def __repr__(self) -> str:
        return (
            f"<ProjectAnalysis(id={self.id}, "
            f"filename='{self.original_filename}', "
            f"status='{self.status}', "
            f"stack='{self.detected_stack}')>"
        )

    @property
    def is_completed(self) -> bool:
        """Check if analysis is completed successfully"""
        return self.status == "completed"

    @property
    def is_failed(self) -> bool:
        """Check if analysis failed"""
        return self.status == "failed"

    @property
    def is_processing(self) -> bool:
        """Check if analysis is in progress"""
        return self.status == "analyzing"
