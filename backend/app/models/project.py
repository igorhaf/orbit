"""
Project Model
Represents a project in the AI Orchestrator system
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, Text, DateTime, JSON, Boolean, Enum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import enum

from app.database import Base


class ProjectStatus(str, enum.Enum):
    """
    Project status enum.

    PROMPT #126 - Project Lifecycle Status
    PROMPT #121 - Added processing status

    - draft: Project created but pipeline failed or not started
    - processing: Background pipeline running (scan + context + title)
    - active: Pipeline complete, project ready to use
    """
    draft = "draft"
    processing = "processing"
    active = "active"


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

    # PROMPT #111 - code_path é OBRIGATÓRIO e IMUTÁVEL
    # ORBIT foca em análise de código existente, não em provisionamento
    code_path = Column(String(500), nullable=False, index=True)  # Path to project code folder
    # Example: "/home/user/my-project"
    # REQUIRED: Project must be tied to an existing code folder

    # Context fields (PROMPT #89 - Context Interview)
    context_semantic = Column(Text, nullable=True)       # Structured semantic text for AI consumption
    context_human = Column(Text, nullable=True)          # Human-readable project description
    context_locked = Column(Boolean, default=False, nullable=False)  # Lock after first epic
    context_locked_at = Column(DateTime, nullable=True)  # When context was locked

    # PROMPT #126 - Project lifecycle status
    # draft: Context created, suggested epics exist, but none approved yet
    # active: At least one epic has been approved/created
    status = Column(
        Enum(ProjectStatus),
        default=ProjectStatus.draft,
        nullable=False,
        server_default="draft"
    )

    # PROMPT #118 - Initial memory context from codebase scan (JSON dict)
    # This is set when project is created after a memory scan
    # Contains: suggested_title, stack_info, business_rules, key_features, interview_context
    # If present, context interview uses this rich context for better questions
    initial_memory_context = Column(JSON, nullable=True)

    # PROMPT #222 - Continuous RAG must wait for initial scan to complete
    # Set to True when the initial memory scan (MEMORY_SCAN job) finishes successfully.
    # The Continuous RAG scheduler only processes projects where this flag is True.
    initial_scan_complete = Column(Boolean, default=False, nullable=False, server_default="false")

    # PROMPT #245 - Store scan depth for batch processing across restarts
    scan_depth = Column(String(10), nullable=True)

    # PROMPT #223 - AI-detected ignore patterns for this project
    # Populated by AI pre-scan analysis before initial memory scan
    # JSON: {"directories": [...], "rationale": {...}, "detected_by_ai": true}
    custom_ignore_patterns = Column(JSON, nullable=True)

    # PROMPT #241 - User-editable ignore paths per project
    # JSON array of relative paths to exclude from scanning
    # Example: ["projects/", "vendor/", "node_modules/custom/"]
    ignore_paths = Column(JSON, nullable=True)

    # PROMPT #236 - Protection against accidental deletion
    # When True, project cannot be deleted unless system setting
    # "allow_protected_project_deletion" is set to "true"
    protected = Column(Boolean, default=False, nullable=False, server_default="false")

    # Deep Pipeline fields (7-phase Claudio pipeline)
    # Phase 3 output: architectural map with domains, cross-domain flows, patterns
    project_architecture = Column(JSON, nullable=True)
    # Phase 6 output: overall quality score (0-100)
    pipeline_quality_score = Column(String(10), nullable=True)
    # Pipeline version used: "v1" (legacy 4-phase) or "v2" (deep 7-phase)
    pipeline_version = Column(String(10), nullable=True)

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

    chats = relationship(
        "ProjectChat",
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
