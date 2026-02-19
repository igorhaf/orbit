"""
RAG File State Model
Tracks the processing state of individual files for continuous RAG evolution.

PROMPT #218 - Continuous RAG Evolution

Each row represents a file in a project's codebase with its current processing state,
content hash (for change detection), and references to RAG documents created from it.
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, Text, Integer, DateTime, JSON, Enum as SQLEnum, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy import ForeignKey
import enum

from app.database import Base


class FileProcessingStatus(str, enum.Enum):
    """Status of file processing for RAG."""
    PENDING = "pending"          # File detected as new/modified, waiting to be processed
    PROCESSING = "processing"    # Currently being analyzed by AI
    COMPLETED = "completed"      # Successfully processed and rules stored in RAG
    FAILED = "failed"            # Processing failed (see error_message)
    DELETED = "deleted"          # File no longer exists on disk, pending RAG cleanup


class FileSemanticLayer(str, enum.Enum):
    """
    PROMPT #230 - Stack-agnostic semantic layer classification.
    Files are classified by their role in the architecture, not by framework.
    Processing order: schema → routes → logic → presentation → config.
    """
    SCHEMA = "schema"                # DB migrations, models, entities, schemas
    ROUTES = "routes"                # Controllers, endpoints, API routes, handlers
    LOGIC = "logic"                  # Services, use cases, business logic, jobs
    PRESENTATION = "presentation"    # Views, components, templates, pages
    CONFIG = "config"                # Configuration, env, settings, bootstrapping
    UNKNOWN = "unknown"              # Could not classify


class RAGFileState(Base):
    """
    Tracks processing state of individual files for continuous RAG evolution.

    Workflow:
    1. Scanner detects new/modified file → status=PENDING
    2. Processor picks up file → status=PROCESSING
    3. AI extracts rules, stores in RAG → status=COMPLETED
    4. File deleted from disk → status=DELETED → RAG docs cleaned up → row removed
    """

    __tablename__ = "rag_file_state"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)

    # Project reference
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # File identification
    file_path = Column(Text, nullable=False)          # Relative to project's code_path
    file_hash = Column(String(64), nullable=False)     # SHA-256 of file content
    file_size = Column(Integer, nullable=True)          # File size in bytes

    # Filesystem metadata
    last_modified = Column(DateTime, nullable=True)     # File's mtime from filesystem

    # Processing state
    status = Column(
        SQLEnum(
            FileProcessingStatus,
            name="file_processing_status",
            values_callable=lambda x: [e.value for e in x]
        ),
        nullable=False,
        default=FileProcessingStatus.PENDING,
        index=True
    )
    last_processed_at = Column(DateTime, nullable=True)

    # PROMPT #230 - Semantic layer classification (stack-agnostic)
    file_layer = Column(
        SQLEnum(
            FileSemanticLayer,
            name="file_semantic_layer",
            values_callable=lambda x: [e.value for e in x]
        ),
        nullable=True,
        default=FileSemanticLayer.UNKNOWN,
        index=True
    )

    # RAG document tracking
    rag_document_ids = Column(JSON, nullable=True, default=list)  # Array of RAG doc UUIDs
    rules_extracted = Column(Integer, nullable=False, default=0)

    # Error tracking
    error_message = Column(Text, nullable=True)
    retry_count = Column(Integer, nullable=False, default=0, server_default="0")

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )

    # Constraints
    __table_args__ = (
        UniqueConstraint("project_id", "file_path", name="uq_rag_file_state_project_file"),
        Index("ix_rag_file_state_project_status", "project_id", "status"),
    )

    def __repr__(self):
        layer = self.file_layer.value if self.file_layer else "?"
        return f"<RAGFileState {self.file_path} [{self.status.value}] layer={layer}>"

    def to_dict(self):
        return {
            "id": str(self.id),
            "project_id": str(self.project_id),
            "file_path": self.file_path,
            "file_hash": self.file_hash,
            "file_size": self.file_size,
            "last_modified": self.last_modified.isoformat() if self.last_modified else None,
            "status": self.status.value,
            "last_processed_at": self.last_processed_at.isoformat() if self.last_processed_at else None,
            "rag_document_ids": self.rag_document_ids or [],
            "rules_extracted": self.rules_extracted,
            "file_layer": self.file_layer.value if self.file_layer else None,
            "error_message": self.error_message,
            "retry_count": self.retry_count or 0,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
