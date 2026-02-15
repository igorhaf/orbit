"""Add chain tracking fields to ai_executions

PROMPT #124 - AI Flow: Metrics, Animation, Analytics & Smart Reorder

Revision ID: 20260207_chain_track
Revises: 20260207_aiflow
Create Date: 2026-02-07
"""
from alembic import op
import sqlalchemy as sa


revision = '20260207_chain_track'
down_revision = '20260207_aiflow'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('ai_executions', sa.Column('chain_usage_type', sa.String(50), nullable=True))
    op.add_column('ai_executions', sa.Column('chain_position', sa.Integer(), nullable=True))
    op.add_column('ai_executions', sa.Column('chain_total', sa.Integer(), nullable=True))
    op.add_column('ai_executions', sa.Column('chain_fallback', sa.Boolean(), nullable=True, server_default='false'))
    op.add_column('ai_executions', sa.Column('chain_source', sa.String(20), nullable=True))
    op.create_index('ix_ai_executions_chain_usage_type', 'ai_executions', ['chain_usage_type'])


def downgrade() -> None:
    op.drop_index('ix_ai_executions_chain_usage_type')
    op.drop_column('ai_executions', 'chain_source')
    op.drop_column('ai_executions', 'chain_fallback')
    op.drop_column('ai_executions', 'chain_total')
    op.drop_column('ai_executions', 'chain_position')
    op.drop_column('ai_executions', 'chain_usage_type')
