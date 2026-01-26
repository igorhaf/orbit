"""
Project Model
Represents a project in the AI Orchestrator system
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, Text, DateTime, JSON, Boolean
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
        context_semantic: Structured semantic text for AI (PROMPT #89)
        context_human: Human-readable project context (PROMPT #89)
        context_locked: Whether context is locked (PROMPT #89)
        context_locked_at: When context was locked (PROMPT #89)
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

    # Stack configuration (PROMPT #46 - Phase 1, PROMPT #67 - Mobile)
    stack_backend = Column(String(50), nullable=True)      # 'laravel', 'django', 'fastapi', etc
    stack_database = Column(String(50), nullable=True)     # 'postgresql', 'mysql', 'mongodb', etc
    stack_frontend = Column(String(50), nullable=True)     # 'nextjs', 'react', 'vue', etc
    stack_css = Column(String(50), nullable=True)          # 'tailwind', 'bootstrap', 'materialui', etc
    stack_mobile = Column(String(50), nullable=True)       # 'react-native', 'flutter', 'expo', etc (PROMPT #67)

    # Project folder path (stores the sanitized folder name)
    project_folder = Column(String(255), nullable=True)    # 'my-project-name' (sanitized)

    # Pattern Discovery (PROMPT #62 - Week 1)
    code_path = Column(String(500), nullable=True, index=True)  # Path to project code in Docker container
    # Example: "/app/projects/legacy-app"
    # Required for AI-powered pattern discovery

    # Context fields (PROMPT #89 - Context Interview)
    context_semantic = Column(Text, nullable=True)       # Structured semantic text for AI consumption
    context_human = Column(Text, nullable=True)          # Human-readable project description
    context_locked = Column(Boolean, default=False, nullable=False)  # Lock after first epic
    context_locked_at = Column(DateTime, nullable=True)  # When context was locked

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

    discovered_specs = relationship(
        "Spec",
        back_populates="project",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    @property
    def stack(self) -> dict:
        """
        Returns stack configuration as a dictionary.
        Built dynamically from stack_* fields.
        Returns None if no stack is configured.

        PROMPT #60 - Automatic Provisioning Integration
        PROMPT #67 - Mobile Support (stack_mobile optional)
        """
        if not self.stack_backend and not self.stack_database and not self.stack_frontend and not self.stack_css:
            return None

        return {
            "backend": self.stack_backend,
            "database": self.stack_database,
            "frontend": self.stack_frontend,
            "css": self.stack_css,
            "mobile": self.stack_mobile  # PROMPT #67 - Optional mobile framework
        }

    def __repr__(self) -> str:
        return f"<Project(id={self.id}, name='{self.name}')>"
