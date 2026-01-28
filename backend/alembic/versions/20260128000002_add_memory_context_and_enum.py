"""Add initial_memory_context to projects and memory to ai_model_usage_type enum

PROMPT #118 - Codebase Memory Scan
- Add initial_memory_context column to projects table
- Add 'memory' value to ai_model_usage_type enum

Revision ID: 20260128000002
Revises: 20260128000001
Create Date: 2026-01-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260128000002'
down_revision: Union[str, None] = '20260128000001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Step 1: Add 'memory' value to ai_model_usage_type enum
    # PostgreSQL requires ALTER TYPE to add new enum values
    op.execute("ALTER TYPE ai_model_usage_type ADD VALUE IF NOT EXISTS 'memory'")

    # Step 2: Add initial_memory_context column to projects table
    op.add_column(
        'projects',
        sa.Column('initial_memory_context', sa.Text(), nullable=True)
    )


def downgrade() -> None:
    # Remove column from projects
    op.drop_column('projects', 'initial_memory_context')

    # Note: PostgreSQL doesn't support removing enum values easily
    # The 'memory' enum value will remain in the database
    # This is safe as it won't affect functionality
