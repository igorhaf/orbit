"""add_context_fields_to_project

PROMPT #89 - Context Interview: Add context fields to Project model
- context_semantic: Structured text for AI consumption
- context_human: Human-readable description
- context_locked: Boolean flag to lock context after first epic
- context_locked_at: Timestamp when context was locked

Revision ID: e9f2a3b4c5d6
Revises: d8e4f5c27e4f
Create Date: 2026-01-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e9f2a3b4c5d6'
down_revision: Union[str, None] = 'd8e4f5c27e4f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PROMPT #89 - Add context fields to projects table

    # context_semantic: Structured semantic text for AI consumption
    op.add_column(
        'projects',
        sa.Column('context_semantic', sa.Text(), nullable=True)
    )

    # context_human: Human-readable project description
    op.add_column(
        'projects',
        sa.Column('context_human', sa.Text(), nullable=True)
    )

    # context_locked: Flag to prevent context modification after first epic
    op.add_column(
        'projects',
        sa.Column('context_locked', sa.Boolean(), nullable=False, server_default='false')
    )

    # context_locked_at: Timestamp when context was locked
    op.add_column(
        'projects',
        sa.Column('context_locked_at', sa.DateTime(), nullable=True)
    )


def downgrade() -> None:
    # Remove context fields
    op.drop_column('projects', 'context_locked_at')
    op.drop_column('projects', 'context_locked')
    op.drop_column('projects', 'context_human')
    op.drop_column('projects', 'context_semantic')
