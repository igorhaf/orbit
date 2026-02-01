"""Change initial_memory_context from TEXT to JSONB

PROMPT #118 - Codebase Memory Scan (fix)
- Change initial_memory_context column type from TEXT to JSONB
- JSONB allows storing dict/JSON data directly

Revision ID: 20260129000001
Revises: 20260128000002
Create Date: 2026-01-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = '20260129000001'
down_revision: Union[str, None] = '20260128000002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Alter column type from TEXT to JSONB
    # First drop any existing data (it was TEXT so no valid JSON anyway)
    op.execute("UPDATE projects SET initial_memory_context = NULL")

    # Change column type to JSONB using USING clause
    op.execute("""
        ALTER TABLE projects
        ALTER COLUMN initial_memory_context TYPE JSONB
        USING initial_memory_context::jsonb
    """)


def downgrade() -> None:
    # Change back to TEXT
    op.execute("""
        ALTER TABLE projects
        ALTER COLUMN initial_memory_context TYPE TEXT
        USING initial_memory_context::text
    """)
