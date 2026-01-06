"""Add interview_mode, parent_task_id, and task_type_selection to interviews

PROMPT #68 - Dual-Mode Interview System
Phase 1: Database Schema - Interview Model Extensions

Revision ID: 20260106020000
Revises: 20260106014006
Create Date: 2026-01-06 02:00:00

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision = '20260106020000'
down_revision = '20260106014006'  # Previous migration (PROMPT #67 - mobile support)
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Add dual-mode interview fields to interviews table.

    New fields:
    - interview_mode: Distinguishes between "requirements" (new project) and "task_focused" (existing project)
    - parent_task_id: Links task-focused interviews to parent task (for sub-interviews)
    - task_type_selection: Stores selected task type (bug/feature/refactor/enhancement)

    Breaking Changes: NONE - all fields have safe defaults
    - Existing interviews get interview_mode="requirements" (current behavior)
    - parent_task_id and task_type_selection default to NULL (not used in old flow)
    """
    # Add interview_mode column with default
    op.add_column('interviews',
        sa.Column('interview_mode', sa.String(50),
                  nullable=False,
                  server_default='requirements')
    )

    # Add parent_task_id (optional FK to tasks)
    op.add_column('interviews',
        sa.Column('parent_task_id', UUID(as_uuid=True), nullable=True)
    )

    # Add task_type_selection
    op.add_column('interviews',
        sa.Column('task_type_selection', sa.String(50), nullable=True)
    )

    # Create indexes for performance
    op.create_index('ix_interviews_interview_mode', 'interviews', ['interview_mode'])
    op.create_index('ix_interviews_parent_task_id', 'interviews', ['parent_task_id'])

    # Create foreign key constraint (after column exists)
    op.create_foreign_key(
        'fk_interviews_parent_task_id',
        'interviews', 'tasks',
        ['parent_task_id'], ['id'],
        ondelete='CASCADE'
    )


def downgrade() -> None:
    """
    Remove dual-mode interview fields.

    Rollback strategy: Drop FK constraint, indexes, and columns.
    """
    # Drop FK constraint first
    op.drop_constraint('fk_interviews_parent_task_id', 'interviews', type_='foreignkey')

    # Drop indexes
    op.drop_index('ix_interviews_parent_task_id', 'interviews')
    op.drop_index('ix_interviews_interview_mode', 'interviews')

    # Drop columns
    op.drop_column('interviews', 'task_type_selection')
    op.drop_column('interviews', 'parent_task_id')
    op.drop_column('interviews', 'interview_mode')
