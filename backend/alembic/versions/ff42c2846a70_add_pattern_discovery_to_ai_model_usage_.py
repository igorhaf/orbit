"""add_pattern_discovery_to_ai_model_usage_type_enum

Revision ID: ff42c2846a70
Revises: a1b2c3d4e5f6
Create Date: 2026-01-04 02:06:39.650150

PROMPT #62 - Week 1 Day 10: Fix missing enum value
- Add 'pattern_discovery' to ai_model_usage_type ENUM
- Required for PatternDiscoveryService to query AI models
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ff42c2846a70'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add 'pattern_discovery' value to ai_model_usage_type ENUM
    # PostgreSQL requires explicit ALTER TYPE for adding enum values
    op.execute("ALTER TYPE ai_model_usage_type ADD VALUE IF NOT EXISTS 'pattern_discovery'")


def downgrade() -> None:
    # Note: PostgreSQL doesn't support removing enum values
    # This is a one-way migration for safety
    # To truly downgrade, you would need to recreate the enum type
    pass
