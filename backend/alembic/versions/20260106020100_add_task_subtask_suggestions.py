"""Add subtask_suggestions to tasks

PROMPT #68 - Dual-Mode Interview System
Phase 1: Database Schema - Task Model Extensions

Revision ID: 20260106020100
Revises: 20260106020000
Create Date: 2026-01-06 02:01:00

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSON


# revision identifiers, used by Alembic.
revision = '20260106020100'
down_revision = '20260106020000'  # Previous migration (PROMPT #68 - interview mode fields)
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Add subtask_suggestions field to tasks table.

    New field:
    - subtask_suggestions: JSON array of AI-suggested subtasks (not created yet)
      Format: [{"title": "...", "description": "...", "story_points": 2}]

    Purpose:
    - AI can suggest breaking down complex tasks into subtasks
    - User decides: accept all, accept some, or explore with sub-interview
    - Suggestions are NOT actual Task records until user accepts them

    Breaking Changes: NONE - field defaults to empty list
    - Existing tasks get subtask_suggestions=[] (no suggestions)
    """
    op.add_column('tasks',
        sa.Column('subtask_suggestions', JSON, nullable=True, server_default='[]')
    )


def downgrade() -> None:
    """
    Remove subtask_suggestions field.

    Rollback strategy: Drop column.
    """
    op.drop_column('tasks', 'subtask_suggestions')
