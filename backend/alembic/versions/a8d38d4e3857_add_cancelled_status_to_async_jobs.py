"""add_cancelled_status_to_async_jobs

Revision ID: a8d38d4e3857
Revises: 65async01
Create Date: 2026-01-05 22:51:59.116336

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a8d38d4e3857'
down_revision: Union[str, None] = '65async01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add 'cancelled' value to jobstatus ENUM
    op.execute("ALTER TYPE jobstatus ADD VALUE IF NOT EXISTS 'cancelled'")


def downgrade() -> None:
    # Note: PostgreSQL does not support removing ENUM values directly
    # If you need to downgrade, you would need to:
    # 1. Create a new ENUM without 'cancelled'
    # 2. Alter column to use new ENUM
    # 3. Drop old ENUM
    # For simplicity, we'll leave this as a no-op since:
    # - No existing data will have 'cancelled' status yet
    # - Having an extra ENUM value doesn't break anything
    pass
