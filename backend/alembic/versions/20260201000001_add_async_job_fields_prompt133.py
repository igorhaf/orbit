"""PROMPT #133: Add task_id, deep_link, notification_title to async_jobs

Revision ID: 20260201000001
Revises:
Create Date: 2026-02-01

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '20260201000001'
down_revision = '20260131110000'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add new columns to async_jobs table for PROMPT #133
    op.add_column('async_jobs', sa.Column('task_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('async_jobs', sa.Column('deep_link', sa.String(500), nullable=True))
    op.add_column('async_jobs', sa.Column('notification_title', sa.String(200), nullable=True))

    # Create index on task_id for faster lookups
    op.create_index('ix_async_jobs_task_id', 'async_jobs', ['task_id'])


def downgrade() -> None:
    # Remove index
    op.drop_index('ix_async_jobs_task_id', table_name='async_jobs')

    # Remove columns
    op.drop_column('async_jobs', 'notification_title')
    op.drop_column('async_jobs', 'deep_link')
    op.drop_column('async_jobs', 'task_id')
