"""Add parent_job_id and phase_label to async_jobs for sub-job hierarchy

PROMPT #298 - Sub-Jobs: Granularizacao de Operacoes

Revision ID: 20260216_parent_job
Revises: prompt288_job_indexes
Create Date: 2026-02-16
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers
revision = '20260216_parent_job'
down_revision = 'prompt288_job_indexes'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('async_jobs', sa.Column('parent_job_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('async_jobs', sa.Column('phase_label', sa.String(200), nullable=True))
    op.create_foreign_key('fk_async_jobs_parent', 'async_jobs', 'async_jobs', ['parent_job_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_async_jobs_parent_job_id', 'async_jobs', ['parent_job_id'])


def downgrade():
    op.drop_index('ix_async_jobs_parent_job_id', table_name='async_jobs')
    op.drop_constraint('fk_async_jobs_parent', 'async_jobs', type_='foreignkey')
    op.drop_column('async_jobs', 'phase_label')
    op.drop_column('async_jobs', 'parent_job_id')
