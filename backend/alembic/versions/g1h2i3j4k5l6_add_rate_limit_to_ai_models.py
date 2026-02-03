"""Add rate limit fields to ai_models

Revision ID: g1h2i3j4k5l6
Revises: ff42c2846a70
Create Date: 2026-02-02

PROMPT #152 - Rate Limiting por Modelo de IA
Adds rate_limit_requests and rate_limit_window_seconds columns to ai_models table.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'g1h2i3j4k5l6'
down_revision = '20260201000002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add rate limiting columns to ai_models table
    # NULL values mean no rate limiting (unlimited)
    op.add_column(
        'ai_models',
        sa.Column('rate_limit_requests', sa.Integer(), nullable=True,
                  comment='Maximum requests allowed per time window (NULL = no limit)')
    )
    op.add_column(
        'ai_models',
        sa.Column('rate_limit_window_seconds', sa.Integer(), nullable=True,
                  comment='Time window size in seconds (NULL = no limit)')
    )


def downgrade() -> None:
    op.drop_column('ai_models', 'rate_limit_window_seconds')
    op.drop_column('ai_models', 'rate_limit_requests')
