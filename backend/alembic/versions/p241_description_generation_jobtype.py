"""add description_generation to jobtype enum

Revision ID: a241b1c2d3e4
Revises: a264b1c2d3e5
Create Date: 2026-03-02 00:00:00.000000

PROMPT #241 - Add DESCRIPTION_GENERATION job type for generate/expand/summarize
description operations via PriorityJobExecutor.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a241b1c2d3e4'
down_revision: Union[str, None] = 'g264a1b2c3e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'description_generation'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values
    pass
