"""
Spec Model (PROMPT #47 - Phase 2)
Represents framework/technology specifications for token reduction

PROMPT #62 - Week 1: Added pattern discovery support
- project_id: Link to project for project-specific patterns
- scope: Distinguish framework vs project-specific specs
- discovery_metadata: AI decision reasoning and metadata
"""

import enum
from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, Text, Integer, Boolean, DateTime, ARRAY, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID, JSON
from sqlalchemy.orm import relationship

from app.database import Base


class SpecScope(str, enum.Enum):
    """Spec scope enumeration"""
    FRAMEWORK = "framework"  # Global framework spec (reusable across projects)
    PROJECT = "project"      # Project-specific discovered pattern


class Spec(Base):
    """
    Spec model - Stores framework specifications to reduce token usage

    Dynamic system - interview questions are generated from available specs.
    Adding new specs automatically makes them available in interviews.

    Attributes:
        id: Unique identifier
        category: Spec category (backend, frontend, database, css)
        name: Framework/technology name (laravel, nextjs, postgresql, tailwind)
        spec_type: Type of spec (controller, model, page, migration, etc)
        title: Human-readable title
        description: Detailed description
        content: The actual specification content/template
        language: Programming language
        framework_version: Framework version this spec applies to
        ignore_patterns: File/folder patterns to ignore
        file_extensions: Relevant file extensions
        is_active: Whether this spec is currently active
        usage_count: How many times this spec has been used
        created_at: Timestamp of creation
        updated_at: Timestamp of last update
    """

    __tablename__ = "specs"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)

    # Core fields
    category = Column(String(50), nullable=False, index=True)       # 'backend', 'frontend', 'database', 'css'
    name = Column(String(100), nullable=False, index=True)          # 'laravel', 'nextjs', 'postgresql', 'tailwind'
    spec_type = Column(String(50), nullable=False)                  # 'controller', 'model', 'page', etc

    # Content
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    content = Column(Text, nullable=False)

    # Metadata
    language = Column(String(50), nullable=True)
    framework_version = Column(String(20), nullable=True)

    # Patterns
    ignore_patterns = Column(ARRAY(Text), nullable=True)
    file_extensions = Column(ARRAY(Text), nullable=True)

    # Status
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    usage_count = Column(Integer, nullable=False, default=0)

    # Pattern Discovery (PROMPT #62 - Week 1)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True)
    scope = Column(
        SQLEnum(SpecScope, name="spec_scope", values_callable=lambda x: [e.value for e in x]),
        default=SpecScope.FRAMEWORK,
        nullable=False,
        index=True
    )
    discovery_metadata = Column(JSON, nullable=True)
    # discovery_metadata structure:
    # {
    #   "discovered_at": "2026-01-03T...",
    #   "discovery_method": "ai_pattern_recognition",
    #   "confidence_score": 0.85,
    #   "sample_files": ["path/to/file1.php", "path/to/file2.php"],
    #   "occurrences": 12,
    #   "ai_model_used": "anthropic/claude-sonnet-4",
    #   "ai_decision_reasoning": "Pattern appears generic and reusable...",
    #   "is_framework_worthy": true
    # }

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )

    # Relationships
    project = relationship("Project", back_populates="discovered_specs")

    def __repr__(self) -> str:
        scope_str = f", scope='{self.scope.value}'" if self.scope else ""
        return f"<Spec(id={self.id}, category='{self.category}', name='{self.name}', type='{self.spec_type}'{scope_str})>"
