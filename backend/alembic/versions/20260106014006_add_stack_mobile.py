"""Add stack_mobile column to projects

PROMPT #67 - Phase 1: Mobile Support

Revision ID: 20260106014006
Revises: (auto)
Create Date: 2026-01-06 01:40:06

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260106014006'
down_revision = 'a8d38d4e3857'  # Previous migration (PROMPT #65 - async jobs)
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Add stack_mobile column to projects table.

    Mobile framework is OPTIONAL - projects without mobile remain valid.
    Supports: react-native, flutter, expo, etc.
    """
    op.add_column('projects',
        sa.Column('stack_mobile', sa.String(50), nullable=True)
    )


def downgrade() -> None:
    """Remove stack_mobile column"""
    op.drop_column('projects', 'stack_mobile')
