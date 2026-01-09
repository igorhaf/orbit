"""add_stack_fields_to_projects

Revision ID: d8e3f5b62c4a
Revises: c7d9e2f14a3b
Create Date: 2025-12-29 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd8e3f5b62c4a'
down_revision: Union[str, None] = 'c7d9e2f14a3b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add stack configuration fields to projects table
    op.add_column('projects', sa.Column('stack_backend', sa.String(50), nullable=True))
    op.add_column('projects', sa.Column('stack_database', sa.String(50), nullable=True))
    op.add_column('projects', sa.Column('stack_frontend', sa.String(50), nullable=True))
    op.add_column('projects', sa.Column('stack_css', sa.String(50), nullable=True))


def downgrade() -> None:
    # Remove stack configuration fields
    op.drop_column('projects', 'stack_css')
    op.drop_column('projects', 'stack_frontend')
    op.drop_column('projects', 'stack_database')
    op.drop_column('projects', 'stack_backend')
