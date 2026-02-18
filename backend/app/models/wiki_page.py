"""
Wiki Page Model
PROMPT #261 - Multi-page Wiki System

Represents a wiki page within a project. Pages are organized hierarchically
with parent-child relationships and can be linked via markdown references.
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, Text, Integer, DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship

from app.database import Base


class WikiPage(Base):
    """
    Wiki page model - Individual page in a project's wiki.

    Attributes:
        id: Unique identifier
        project_id: FK to project
        slug: URL-friendly identifier (unique per project)
        title: Page title
        content: Markdown content
        parent_id: FK to parent wiki page (for hierarchy)
        order_index: Sort order within siblings
        source: Origin of the page ('ai_generated', 'manual', 'enrichment')
        created_at: Timestamp of creation
        updated_at: Timestamp of last update
    """

    __tablename__ = "wiki_pages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)

    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    slug = Column(String(255), nullable=False)
    title = Column(String(255), nullable=False)
    content = Column(Text, nullable=False, default="")

    parent_id = Column(
        UUID(as_uuid=True),
        ForeignKey("wiki_pages.id", ondelete="SET NULL"),
        nullable=True
    )

    order_index = Column(Integer, nullable=False, default=0)
    source = Column(String(50), nullable=False, default="manual")

    # PROMPT #230 Phase 5 - Batch source tracking
    # Tracks which pipeline batch created/modified this page
    # Example: {"batch_number": 2, "rules_added": 5, "domain": "Pagamentos"}
    batch_source = Column(JSONB, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )

    # Relationships
    children = relationship(
        "WikiPage",
        backref="parent",
        remote_side=[id],
        foreign_keys=[parent_id],
        lazy="selectin"
    )

    __table_args__ = (
        UniqueConstraint("project_id", "slug", name="uq_wiki_page_project_slug"),
        Index("ix_wiki_page_project_parent", "project_id", "parent_id"),
    )

    def __repr__(self):
        return f"<WikiPage {self.slug} ({self.title})>"

    def to_dict(self):
        return {
            "id": str(self.id),
            "project_id": str(self.project_id),
            "slug": self.slug,
            "title": self.title,
            "content": self.content,
            "parent_id": str(self.parent_id) if self.parent_id else None,
            "order_index": self.order_index,
            "source": self.source,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
