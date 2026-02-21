"""PROMPT #241 - Add ignore_paths column to projects

User-editable list of paths to exclude from scanning.
Separate from custom_ignore_patterns (AI-detected, read-only).

Revision ID: p241_ignore_paths
Revises: p236_protected
Create Date: 2026-02-21
"""
from alembic import op
import sqlalchemy as sa

revision: str = 'p241_ignore_paths'
down_revision: str = 'p236_protected'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'projects',
        sa.Column('ignore_paths', sa.JSON(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('projects', 'ignore_paths')
