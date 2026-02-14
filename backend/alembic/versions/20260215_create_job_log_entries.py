"""PROMPT #286 - Create job_log_entries table for job execution history

Revision ID: prompt286_job_log_entries
Revises: prompt282_chat_jobtype
Create Date: 2026-02-15
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'prompt286_job_log_entries'
down_revision = 'prompt282_chat_jobtype'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'job_log_entries',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('job_id', UUID(as_uuid=True), sa.ForeignKey('async_jobs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('timestamp', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('level', sa.String(20), nullable=False, server_default='info'),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('progress_percent', sa.Float(), nullable=True),
    )
    op.create_index('idx_job_log_entries_job_id', 'job_log_entries', ['job_id'])
    op.create_index('idx_job_log_entries_job_ts', 'job_log_entries', ['job_id', 'timestamp'])


def downgrade() -> None:
    op.drop_index('idx_job_log_entries_job_ts')
    op.drop_index('idx_job_log_entries_job_id')
    op.drop_table('job_log_entries')
