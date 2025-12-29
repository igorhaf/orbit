"""
Spec Model (PROMPT #47 - Phase 2)
Represents framework/technology specifications for token reduction
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, Text, Integer, Boolean, DateTime, ARRAY
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


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

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )

    def __repr__(self) -> str:
        return f"<Spec(id={self.id}, category='{self.category}', name='{self.name}', type='{self.spec_type}')>"
