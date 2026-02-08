"""Add timeout_seconds to ai_models

PROMPT #207 - Per-model API timeout field

Revision ID: 20260208_timeout
Revises: 20260208_add_utility_nodes_to_ai_flow_chains
Create Date: 2026-02-08
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260208_timeout'
down_revision = '20260208_utility'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('ai_models', sa.Column('timeout_seconds', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('ai_models', 'timeout_seconds')
