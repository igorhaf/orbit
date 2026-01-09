"""add_interview_id_to_tasks

Revision ID: c7d9e2f14a3b
Revises: b3f8e4a21d9c
Create Date: 2025-12-29 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c7d9e2f14a3b'
down_revision: Union[str, None] = 'b3f8e4a21d9c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add created_from_interview_id column to tasks table
    op.add_column(
        'tasks',
        sa.Column('created_from_interview_id', postgresql.UUID(as_uuid=True), nullable=True)
    )

    # Add foreign key constraint
    op.create_foreign_key(
        'fk_tasks_created_from_interview_id',
        'tasks',
        'interviews',
        ['created_from_interview_id'],
        ['id'],
        ondelete='SET NULL'
    )

    # Add index for better query performance
    op.create_index(
        'ix_tasks_created_from_interview_id',
        'tasks',
        ['created_from_interview_id']
    )


def downgrade() -> None:
    # Remove index
    op.drop_index('ix_tasks_created_from_interview_id', 'tasks')

    # Remove foreign key
    op.drop_constraint('fk_tasks_created_from_interview_id', 'tasks', type_='foreignkey')

    # Remove column
    op.drop_column('tasks', 'created_from_interview_id')
