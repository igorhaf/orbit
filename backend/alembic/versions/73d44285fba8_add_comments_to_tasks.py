"""add_comments_to_tasks

Revision ID: 73d44285fba8
Revises: 001
Create Date: 2025-12-26 18:45:53.139778

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '73d44285fba8'
down_revision: Union[str, None] = '001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add comments column to tasks table
    op.add_column('tasks', sa.Column('comments', sa.JSON(), nullable=True))


def downgrade() -> None:
    # Remove comments column from tasks table
    op.drop_column('tasks', 'comments')
