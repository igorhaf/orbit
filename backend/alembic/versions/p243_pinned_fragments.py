"""add pinned_fragments column to projects

Revision ID: p243a1b2c3e4
Revises: a241b1c2d3e4
Create Date: 2026-03-02 00:00:00.000000

PROMPT #243 - Pinned fragments: text selections persisted by user
to be preserved during AI expand/summarize operations.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'p243a1b2c3e4'
down_revision: Union[str, None] = 'a241b1c2d3e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('projects', sa.Column('pinned_fragments', postgresql.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('projects', 'pinned_fragments')
