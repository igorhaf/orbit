"""Add generated_prompt to tasks

Meta Prompt Feature - Atomic Prompt Generation for Tasks/Subtasks

Revision ID: 20260107000001
Revises: 20260106020100
Create Date: 2026-01-07 00:00:01

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260107000001'
down_revision = '20260106020100'  # Previous migration (subtask_suggestions)
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Add generated_prompt field to tasks table.

    New field:
    - generated_prompt: Text field storing the final assembled atomic prompt
      for task/subtask execution

    Purpose:
    - Store AI-generated atomic prompts derived from meta prompt interview
    - Each task/subtask gets a specific prompt built from all fields:
      title, description, acceptance_criteria, generation_context, specs, etc.
    - Displayed in a dedicated "Prompt" tab in the UI
    - Used for task execution by AI orchestrator

    Breaking Changes: NONE - field is nullable
    - Existing tasks get generated_prompt=NULL (no prompt yet)
    - Prompts will be generated during meta prompt interview or manually
    """
    op.add_column('tasks',
        sa.Column('generated_prompt', sa.Text(), nullable=True)
    )


def downgrade() -> None:
    """
    Remove generated_prompt field.

    Rollback strategy: Drop column.
    """
    op.drop_column('tasks', 'generated_prompt')
