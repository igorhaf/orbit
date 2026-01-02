"""add project_folder to projects table

Revision ID: 656b42f1fb6d
Revises: 9088b001976c
Create Date: 2026-01-02 02:24:52.437045

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '656b42f1fb6d'
down_revision: Union[str, None] = '9088b001976c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add project_folder column to projects table
    op.add_column('projects', sa.Column('project_folder', sa.String(length=255), nullable=True))


def downgrade() -> None:
    # Remove project_folder column from projects table
    op.drop_column('projects', 'project_folder')
