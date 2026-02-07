"""Create ai_flow_chains table

PROMPT #122 - AI Flow: Visual fallback chain configuration

Revision ID: 20260207_aiflow
Revises: 20260206_processing
Create Date: 2026-02-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, ENUM


revision = '20260207_aiflow'
down_revision = '20260206_processing'
branch_labels = None
depends_on = None

# Reference the existing enum type - do NOT create it again
ai_model_usage_type = ENUM(
    'interview', 'prompt_generation', 'commit_generation',
    'task_execution', 'pattern_discovery', 'memory', 'general',
    name='ai_model_usage_type',
    create_type=False,
)


def upgrade() -> None:
    op.create_table(
        'ai_flow_chains',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('usage_type', ai_model_usage_type, nullable=False, unique=True),
        sa.Column('chain', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_ai_flow_chains_usage_type', 'ai_flow_chains', ['usage_type'])


def downgrade() -> None:
    op.drop_index('ix_ai_flow_chains_usage_type')
    op.drop_table('ai_flow_chains')
