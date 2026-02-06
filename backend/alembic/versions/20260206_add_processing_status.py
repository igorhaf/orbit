"""Add processing status to projectstatus enum and project_pipeline to jobtype enum

PROMPT #121 - Project Creation Redesign

Revision ID: 20260206_processing
Revises: 20260206_priority
Create Date: 2026-02-06
"""

from alembic import op


# revision identifiers
revision = '20260206_processing'
down_revision = '20260206_priority'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add 'processing' to projectstatus enum
    op.execute("ALTER TYPE projectstatus ADD VALUE IF NOT EXISTS 'processing'")
    # Add 'project_pipeline' to jobtype enum
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'project_pipeline'")


def downgrade() -> None:
    # PostgreSQL doesn't support removing enum values easily
    # This is a no-op for downgrade
    pass
