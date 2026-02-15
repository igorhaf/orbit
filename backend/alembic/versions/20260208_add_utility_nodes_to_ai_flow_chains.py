"""Add utility_nodes column to ai_flow_chains

PROMPT #204 - Utility Nodes for AI Flow

Revision ID: 20260208_utility
Revises: 20260207_children
Create Date: 2026-02-08
"""
from alembic import op
import sqlalchemy as sa


revision = '20260208_utility'
down_revision = '20260207_children_gen'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'ai_flow_chains',
        sa.Column('utility_nodes', sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('ai_flow_chains', 'utility_nodes')
