"""PROMPT #236 - Add protected column to projects

Revision ID: p236_protected
Revises: p233_fix_cascade_and_constraints
Create Date: 2026-02-21
"""
from alembic import op
import sqlalchemy as sa

revision: str = 'p236_protected'
down_revision: str = 'p233_cascade_fix'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'projects',
        sa.Column('protected', sa.Boolean(), nullable=False, server_default='false')
    )


def downgrade() -> None:
    op.drop_column('projects', 'protected')
