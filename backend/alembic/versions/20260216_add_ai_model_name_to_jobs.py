"""Add ai_model_name to async_jobs

PROMPT #299 - Show AI model name in Jobs page

Revision ID: 20260216_ai_model_name
Revises: 20260216_parent_job
Create Date: 2026-02-16
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = '20260216_ai_model_name'
down_revision = '20260216_parent_job'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('async_jobs', sa.Column('ai_model_name', sa.String(200), nullable=True))


def downgrade():
    op.drop_column('async_jobs', 'ai_model_name')
