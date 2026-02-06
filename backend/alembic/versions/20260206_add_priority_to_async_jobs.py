"""Add priority column to async_jobs table

PROMPT #120 - Job Priority System

Revision ID: 20260206_priority
Revises: g1h2i3j4k5l6
Create Date: 2026-02-06
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = '20260206_priority'
down_revision = 'g1h2i3j4k5l6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add priority column with default=5 (NORMAL)
    op.add_column('async_jobs', sa.Column('priority', sa.Integer(), nullable=False, server_default='5'))
    op.create_index('ix_async_jobs_priority', 'async_jobs', ['priority'])


def downgrade() -> None:
    op.drop_index('ix_async_jobs_priority', table_name='async_jobs')
    op.drop_column('async_jobs', 'priority')
