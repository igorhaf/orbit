"""Add scan_depth column to projects table

PROMPT #245 - Batch Processing Pipeline

Revision ID: 245a_scan_depth
Revises: 20260212_max_concurrent
"""

from alembic import op
import sqlalchemy as sa

revision = "245a_scan_depth"
down_revision = "20260212_max_concurrent"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("scan_depth", sa.String(10), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("projects", "scan_depth")
