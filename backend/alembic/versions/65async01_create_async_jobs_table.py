"""create async_jobs table

Revision ID: 65async01
Revises: aabbccdd1111
Create Date: 2026-01-05 00:00:00.000000

PROMPT #65 - Async Job System
Creates async_jobs table for tracking long-running background tasks.
Prevents UI blocking during AI calls, provisioning, and backlog generation.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '65async01'
down_revision: Union[str, None] = '0a91d3726255'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create job_status enum using raw SQL
    op.execute("CREATE TYPE jobstatus AS ENUM ('pending', 'running', 'completed', 'failed')")

    # Create job_type enum using raw SQL
    op.execute("CREATE TYPE jobtype AS ENUM ('interview_message', 'backlog_generation', 'project_provisioning')")

    # Create async_jobs table
    op.create_table(
        'async_jobs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('job_type', postgresql.ENUM('interview_message', 'backlog_generation', 'project_provisioning', name='jobtype', create_type=False), nullable=False),
        sa.Column('status', postgresql.ENUM('pending', 'running', 'completed', 'failed', name='jobstatus', create_type=False), nullable=False),
        sa.Column('input_data', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='{}'),
        sa.Column('result', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('progress_percent', sa.Float(), nullable=True),
        sa.Column('progress_message', sa.String(500), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('interview_id', postgresql.UUID(as_uuid=True), nullable=True),
    )

    # Create indexes for performance
    op.create_index('ix_async_jobs_job_type', 'async_jobs', ['job_type'])
    op.create_index('ix_async_jobs_status', 'async_jobs', ['status'])
    op.create_index('ix_async_jobs_project_id', 'async_jobs', ['project_id'])
    op.create_index('ix_async_jobs_interview_id', 'async_jobs', ['interview_id'])


def downgrade() -> None:
    # Drop indexes
    op.drop_index('ix_async_jobs_interview_id', table_name='async_jobs')
    op.drop_index('ix_async_jobs_project_id', table_name='async_jobs')
    op.drop_index('ix_async_jobs_status', table_name='async_jobs')
    op.drop_index('ix_async_jobs_job_type', table_name='async_jobs')

    # Drop table
    op.drop_table('async_jobs')

    # Drop enums
    sa.Enum(name='jobtype').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='jobstatus').drop(op.get_bind(), checkfirst=True)
