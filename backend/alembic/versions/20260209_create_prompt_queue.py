"""Create prompt_queue table

PROMPT #215 - Prompt Orchestration Priority Queue

Revision ID: 20260209_prompt_queue
Revises: 20260208_timeout
Create Date: 2026-02-09
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision = '20260209_prompt_queue'
down_revision = '20260208_timeout'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create queue_item_status enum
    queue_status_enum = sa.Enum(
        'pending', 'ready', 'executing', 'completed', 'failed', 'skipped', 'blocked',
        name='queue_item_status'
    )
    queue_status_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        'prompt_queue',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('project_id', UUID(as_uuid=True), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('task_id', UUID(as_uuid=True), sa.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('position', sa.Integer(), nullable=False, default=0, index=True),
        sa.Column('status', queue_status_enum, nullable=False, default='pending'),
        sa.Column('priority_score', sa.Integer(), nullable=False, default=0),
        sa.Column('hierarchy_score', sa.Integer(), nullable=False, default=0),
        sa.Column('age_score', sa.Integer(), nullable=False, default=0),
        sa.Column('dependency_score', sa.Integer(), nullable=False, default=0),
        sa.Column('manual_override', sa.Boolean(), nullable=False, default=False),
        sa.Column('execution_job_id', UUID(as_uuid=True), nullable=True),
        sa.Column('execution_notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('executed_at', sa.DateTime(), nullable=True),
    )

    # Unique constraint: one entry per task per project
    op.create_unique_constraint('uq_prompt_queue_project_task', 'prompt_queue', ['project_id', 'task_id'])


def downgrade() -> None:
    op.drop_table('prompt_queue')
    sa.Enum(name='queue_item_status').drop(op.get_bind(), checkfirst=True)
