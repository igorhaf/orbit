"""Add semantic_prompt to jobtype enum

Revision ID: i266a1b2c3e7
Revises: h265a1b2c3e6
Create Date: 2026-03-05 00:00:00.000000
"""

from alembic import op

# revision identifiers
revision = 'i266a1b2c3e7'
down_revision = 'h265a1b2c3e6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'semantic_prompt'")


def downgrade() -> None:
    # PostgreSQL doesn't support removing enum values
    pass
