"""
PromptTemplate Model

Stores reusable prompt templates with composition, versioning, and metrics.
Part of the Prompter Architecture for token reduction and standardization.
"""

from sqlalchemy import Column, String, Text, Integer, Boolean, Float, ForeignKey, JSON, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import UUID
from datetime import datetime
import uuid

from app.database import Base


class PromptTemplate(Base):
    """
    Reusable prompt template with composition and versioning support.

    Features:
    - Template composition with Jinja2
    - Component-based architecture
    - Version control and rollback
    - Usage metrics and quality tracking
    - Hybrid storage (DB + filesystem)
    """
    __tablename__ = "prompt_templates"

    # Primary fields
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False, index=True)
    category = Column(String(50))  # system, user, component

    # Template content
    template_content = Column(Text, nullable=False)
    template_format = Column(String(20), default="jinja2")

    # Composition
    base_template_id = Column(UUID(as_uuid=True), ForeignKey("prompt_templates.id"), nullable=True)
    components = Column(JSON, default=list)  # List of component template IDs/names

    # Variable schema (JSON Schema format)
    variables_schema = Column(JSON, default=dict)

    # Versioning
    version = Column(Integer, default=1, nullable=False)
    parent_version_id = Column(UUID(as_uuid=True), ForeignKey("prompt_templates.id"), nullable=True)
    is_active = Column(Boolean, default=True, index=True)

    # Metrics
    usage_count = Column(Integer, default=0)
    avg_cost = Column(Float, default=0.0)
    avg_quality_score = Column(Float, nullable=True)

    # Metadata
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=True)
    description = Column(Text, nullable=True)
    tags = Column(JSON, default=list)  # e.g., ["task-generation", "interview"]

    # Post-processing configuration
    post_process = Column(JSON, default=list)  # List of processing steps

    # Recommended model and token estimates
    recommended_model = Column(String(50), nullable=True)
    estimated_tokens = Column(Integer, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    base_template = relationship(
        "PromptTemplate",
        remote_side=[id],
        foreign_keys=[base_template_id],
        backref="derived_templates"
    )

    parent_version = relationship(
        "PromptTemplate",
        remote_side=[id],
        foreign_keys=[parent_version_id],
        backref="child_versions"
    )

    project = relationship("Project", back_populates="prompt_templates")

    # Back-reference from Task model
    tasks = relationship("Task", back_populates="prompt_template")

    def __repr__(self):
        return f"<PromptTemplate(name='{self.name}', version={self.version}, category='{self.category}')>"

    def to_dict(self):
        """Convert to dictionary for API responses"""
        return {
            "id": str(self.id),
            "name": self.name,
            "category": self.category,
            "template_content": self.template_content,
            "template_format": self.template_format,
            "version": self.version,
            "is_active": self.is_active,
            "usage_count": self.usage_count,
            "avg_cost": self.avg_cost,
            "avg_quality_score": self.avg_quality_score,
            "tags": self.tags,
            "recommended_model": self.recommended_model,
            "estimated_tokens": self.estimated_tokens,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
