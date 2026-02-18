"""Add batch_source column to tasks and wiki_pages

PROMPT #230 Phase 5 - Tracks which batch created/modified each entity.

Revision ID: p230f5_batch_source
Revises: p230a1b2c3d4
Create Date: 2026-02-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers
revision = "p230f5_batch_source"
down_revision = "p230a1b2c3d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add batch_source to tasks
    op.add_column(
        "tasks",
        sa.Column("batch_source", JSONB, nullable=True),
    )

    # Add batch_source to wiki_pages
    op.add_column(
        "wiki_pages",
        sa.Column("batch_source", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("wiki_pages", "batch_source")
    op.drop_column("tasks", "batch_source")
