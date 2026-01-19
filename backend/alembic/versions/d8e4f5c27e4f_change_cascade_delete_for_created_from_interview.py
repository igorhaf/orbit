"""change_cascade_delete_for_created_from_interview

PROMPT #88 - When a Task is deleted, cascade delete all Interviews that created it.

Revision ID: d8e4f5c27e4f
Revises: c7d9e2f14a3b
Create Date: 2025-01-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd8e4f5c27e4f'
down_revision: Union[str, None] = '20260118000001'  # PROMPT #88 - Reference latest migration
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PROMPT #88: Drop the existing foreign key with SET NULL behavior
    op.drop_constraint('fk_tasks_created_from_interview_id', 'tasks', type_='foreignkey')

    # Create new foreign key with CASCADE delete behavior
    op.create_foreign_key(
        'fk_tasks_created_from_interview_id',
        'tasks',
        'interviews',
        ['created_from_interview_id'],
        ['id'],
        ondelete='CASCADE'  # PROMPT #88: Cascade delete interviews when task is deleted
    )


def downgrade() -> None:
    # Revert to SET NULL behavior
    op.drop_constraint('fk_tasks_created_from_interview_id', 'tasks', type_='foreignkey')

    op.create_foreign_key(
        'fk_tasks_created_from_interview_id',
        'tasks',
        'interviews',
        ['created_from_interview_id'],
        ['id'],
        ondelete='SET NULL'
    )
