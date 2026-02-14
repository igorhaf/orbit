"""PROMPT #288 - Add performance indexes on async_jobs

Revision ID: prompt288_job_indexes
Revises: prompt286_job_log_entries
Create Date: 2026-02-15
"""
from alembic import op

revision = 'prompt288_job_indexes'
down_revision = 'prompt286_job_log_entries'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Index for status-based filtering (used by /jobs/active, /jobs?status=, stats)
    op.create_index(
        'idx_async_jobs_status_created',
        'async_jobs',
        ['status', 'created_at'],
        if_not_exists=True,
    )
    # Index for project-based filtering
    op.create_index(
        'idx_async_jobs_project_status',
        'async_jobs',
        ['project_id', 'status'],
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index('idx_async_jobs_project_status', table_name='async_jobs')
    op.drop_index('idx_async_jobs_status_created', table_name='async_jobs')
