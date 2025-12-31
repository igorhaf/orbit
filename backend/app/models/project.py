"""
Project Model
Represents a project in the AI Orchestrator system
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, Text, DateTime, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


class Project(Base):
    """
    Project model - Main entity representing an AI orchestration project

    Attributes:
        id: Unique identifier
        name: Project name
        description: Detailed project description
        git_repository_info: JSON containing git repository information
        created_at: Timestamp of creation
        updated_at: Timestamp of last update
    """

    __tablename__ = "projects"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)

    # Basic fields
    name = Column(String(255), nullable=False, index=True)
    description = Column(Text, nullable=True)
    git_repository_info = Column(JSON, nullable=True)

    # Stack configuration (PROMPT #46 - Phase 1)
    stack_backend = Column(String(50), nullable=True)      # 'laravel', 'django', 'fastapi', etc
    stack_database = Column(String(50), nullable=True)     # 'postgresql', 'mysql', 'mongodb', etc
    stack_frontend = Column(String(50), nullable=True)     # 'nextjs', 'react', 'vue', etc
    stack_css = Column(String(50), nullable=True)          # 'tailwind', 'bootstrap', 'materialui', etc

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )

    # Relationships
    interviews = relationship(
        "Interview",
        back_populates="project",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    prompts = relationship(
        "Prompt",
        back_populates="project",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    tasks = relationship(
        "Task",
        back_populates="project",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    commits = relationship(
        "Commit",
        back_populates="project",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    consistency_issues = relationship(
        "ConsistencyIssue",
        back_populates="project",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    analyses = relationship(
        "ProjectAnalysis",
        back_populates="project",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    prompt_templates = relationship(
        "PromptTemplate",
        back_populates="project",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<Project(id={self.id}, name='{self.name}')>"
