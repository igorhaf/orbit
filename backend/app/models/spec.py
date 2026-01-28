"""
Spec Model (PROMPT #47 - Phase 2)
Represents framework/technology specifications for token reduction

PROMPT #62 - Week 1: Added pattern discovery support
- project_id: Link to project for project-specific patterns
- scope: Distinguish framework vs project-specific specs
- discovery_metadata: AI decision reasoning and metadata

PROMPT #117: Added spec versioning
- version: Track spec version (increments on each update)
- SpecHistory: Store previous versions for audit trail
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


class SpecHistory(Base):
    """
    SpecHistory model - Stores previous versions of specs

    PROMPT #117: Spec versioning history

    When a spec is updated, the previous version is saved here
    before applying changes. This allows:
    - Audit trail of all changes
    - Rollback to previous versions if needed
    - Understanding how specs evolved over time
    """

    __tablename__ = "spec_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)

    # Reference to the spec
    spec_id = Column(UUID(as_uuid=True), ForeignKey("specs.id", ondelete="CASCADE"), nullable=False, index=True)

    # Version that was saved
    version = Column(Integer, nullable=False)

    # Snapshot of the spec at this version
    category = Column(String(50), nullable=False)
    name = Column(String(100), nullable=False)
    spec_type = Column(String(50), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    content = Column(Text, nullable=False)
    language = Column(String(50), nullable=True)
    framework_version = Column(String(20), nullable=True)

    # Who/what made the change
    change_reason = Column(String(255), nullable=True)  # e.g., "manual edit", "pattern discovery sync", "AI inference"
    changed_by = Column(String(100), nullable=True)  # e.g., "user", "system", "ai_model_name"

    # Git commit reference (PROMPT #117)
    git_commit_hash = Column(String(40), nullable=True)  # SHA-1 hash of the git commit

    # When
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationship
    spec = relationship("Spec", back_populates="history")

    def __repr__(self) -> str:
        return f"<SpecHistory(spec_id={self.spec_id}, version={self.version})>"


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

    # Versioning (PROMPT #117)
    version = Column(Integer, nullable=False, default=1)  # Starts at 1, increments on each update
    git_commit_hash = Column(String(40), nullable=True)  # SHA-1 hash of the git commit when created/updated

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
    history = relationship("SpecHistory", back_populates="spec", cascade="all, delete-orphan", order_by="SpecHistory.version.desc()")

    def __repr__(self) -> str:
        scope_str = f", scope='{self.scope.value}'" if self.scope else ""
        return f"<Spec(id={self.id}, category='{self.category}', name='{self.name}', type='{self.spec_type}'{scope_str})>"
