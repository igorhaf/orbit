"""Add children_generation to jobtype enum

PROMPT #173 - Add CHILDREN_GENERATION job type to PostgreSQL enum

Revision ID: 20260207_children_gen
Revises: 20260207_labels_jsonb
Create Date: 2026-02-07
"""
from alembic import op


revision = '20260207_children_gen'
down_revision = '20260207_labels_jsonb'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'children_generation'")


def downgrade() -> None:
    # PostgreSQL doesn't support removing enum values directly
    pass
