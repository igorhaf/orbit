"""add_motivation_type_to_interviews

Revision ID: 20260109000001
Revises: 20260107000002
Create Date: 2025-01-09 00:00:00.000000

PROMPT #98 - Card-Focused Interview System
Add motivation_type field to interviews table to track card motivation/type
(bug, feature, bugfix, design, documentation, enhancement, refactor, testing, optimization, security)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260109000004'
down_revision: Union[str, None] = '20260109000003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add motivation_type field to interviews table
    op.add_column('interviews', sa.Column('motivation_type', sa.String(50), nullable=True))


def downgrade() -> None:
    # Remove motivation_type field
    op.drop_column('interviews', 'motivation_type')
