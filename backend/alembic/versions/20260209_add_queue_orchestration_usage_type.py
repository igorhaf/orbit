"""Add queue_orchestration to ai_model_usage_type enum

PROMPT #215 - Prompt Orchestration Priority Queue

Revision ID: 20260209_queue_usage
Revises: 20260209_prompt_queue
Create Date: 2026-02-09
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = '20260209_queue_usage'
down_revision = '20260209_prompt_queue'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add new enum value to ai_model_usage_type
    op.execute("ALTER TYPE ai_model_usage_type ADD VALUE IF NOT EXISTS 'queue_orchestration'")


def downgrade() -> None:
    # Cannot remove enum values in PostgreSQL without recreating the type
    pass
