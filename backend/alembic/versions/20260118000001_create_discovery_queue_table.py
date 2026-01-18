"""create_discovery_queue_table

Revision ID: 20260118000001
Revises: 20260117000001
Create Date: 2026-01-18 10:00:00.000000

Creates the discovery_queue table for managing projects that need
pattern discovery. When a task is executed without specs, the project
is added to this queue for manual validation.
"""
from typing import Sequence, Union
from datetime import datetime
from uuid import uuid4

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = '20260118000001'
down_revision: Union[str, None] = '20260117000001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create discovery_queue table"""
    op.create_table(
        'discovery_queue',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid4),
        sa.Column('project_id', UUID(as_uuid=True), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('reason', sa.String(255), nullable=True),
        sa.Column('task_id', UUID(as_uuid=True), sa.ForeignKey('tasks.id', ondelete='SET NULL'), nullable=True),
        sa.Column('status', sa.String(50), default='pending', nullable=False),
        sa.Column('created_at', sa.DateTime, default=datetime.utcnow, nullable=False),
        sa.Column('processed_at', sa.DateTime, nullable=True),
    )

    # Create indexes for common queries
    op.create_index('ix_discovery_queue_project_id', 'discovery_queue', ['project_id'])
    op.create_index('ix_discovery_queue_status', 'discovery_queue', ['status'])
    op.create_index('ix_discovery_queue_created_at', 'discovery_queue', ['created_at'])


def downgrade() -> None:
    """Drop discovery_queue table"""
    op.drop_index('ix_discovery_queue_created_at', table_name='discovery_queue')
    op.drop_index('ix_discovery_queue_status', table_name='discovery_queue')
    op.drop_index('ix_discovery_queue_project_id', table_name='discovery_queue')
    op.drop_table('discovery_queue')
