"""Add created_by_ai_model to tasks

PROMPT #127 - Track which AI model generated task content

Revision ID: 20260131110000
Revises: 20260131100000
Create Date: 2026-01-31

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260131110000'
down_revision = '20260131100000'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add created_by_ai_model column to tasks table
    op.add_column('tasks', sa.Column(
        'created_by_ai_model',
        sa.String(100),
        nullable=True
    ))


def downgrade() -> None:
    op.drop_column('tasks', 'created_by_ai_model')
