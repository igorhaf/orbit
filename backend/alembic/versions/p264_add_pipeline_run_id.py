"""add pipeline_run_id to tasks and wiki_pages

Revision ID: g264a1b2c3e5
Revises: f263a1b2c3e4
Create Date: 2026-03-01 12:00:00.000000

Add pipeline_run_id FK to tasks and wiki_pages tables for data isolation
between pipeline runs. Allows tracking which run generated which data.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = 'g264a1b2c3e5'
down_revision: Union[str, None] = 'f263a1b2c3e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tasks', sa.Column(
        'pipeline_run_id', UUID(as_uuid=True), nullable=True,
    ))
    op.create_foreign_key(
        'fk_tasks_pipeline_run', 'tasks', 'pipeline_runs',
        ['pipeline_run_id'], ['id'], ondelete='SET NULL',
    )
    op.create_index('ix_tasks_pipeline_run_id', 'tasks', ['pipeline_run_id'])

    op.add_column('wiki_pages', sa.Column(
        'pipeline_run_id', UUID(as_uuid=True), nullable=True,
    ))
    op.create_foreign_key(
        'fk_wiki_pages_pipeline_run', 'wiki_pages', 'pipeline_runs',
        ['pipeline_run_id'], ['id'], ondelete='SET NULL',
    )
    op.create_index('ix_wiki_pages_pipeline_run_id', 'wiki_pages', ['pipeline_run_id'])


def downgrade() -> None:
    op.drop_index('ix_wiki_pages_pipeline_run_id', table_name='wiki_pages')
    op.drop_constraint('fk_wiki_pages_pipeline_run', 'wiki_pages', type_='foreignkey')
    op.drop_column('wiki_pages', 'pipeline_run_id')

    op.drop_index('ix_tasks_pipeline_run_id', table_name='tasks')
    op.drop_constraint('fk_tasks_pipeline_run', 'tasks', type_='foreignkey')
    op.drop_column('tasks', 'pipeline_run_id')
