"""add description_edited_by and prompt_edited_by to tasks

Revision ID: 967131d5b898
Revises: p230f5_batch_source
Create Date: 2026-02-20 01:03:05.839015

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '967131d5b898'
down_revision: Union[str, None] = 'p230f5_batch_source'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PROMPT #232 - Human Data Supremacy (REGRA #0)
    # Track whether description/generated_prompt were edited by human or AI
    op.add_column('tasks', sa.Column('description_edited_by', sa.String(length=10), nullable=True))
    op.add_column('tasks', sa.Column('prompt_edited_by', sa.String(length=10), nullable=True))


def downgrade() -> None:
    op.drop_column('tasks', 'prompt_edited_by')
    op.drop_column('tasks', 'description_edited_by')
