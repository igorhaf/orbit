"""Add custom_ignore_patterns to projects

PROMPT #223 - AI Pre-Scan Ignore Detection.
Stores AI-detected directories to exclude from memory scan and Continuous RAG.

Revision ID: 20260211_custom_ignore
Revises: 20260211_scan_complete
Create Date: 2026-02-11
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSON

revision = "20260211_custom_ignore"
down_revision = "20260211_scan_complete"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("custom_ignore_patterns", JSON, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("projects", "custom_ignore_patterns")
