"""Add missing JobType enum values to PostgreSQL

PROMPT #224 - Fix /jobs/stats 500 error.
The Python JobType enum has 5 values that were never added to PostgreSQL:
  - epic_activation (PROMPT #108)
  - story_activation (PROMPT #108)
  - task_activation (PROMPT #108)
  - subtask_activation (PROMPT #108)
  - cards_from_memory (PROMPT #153)

Revision ID: 20260212_missing_jobtypes
Revises: 20260211_custom_ignore
Create Date: 2026-02-12
"""
from alembic import op


revision = "20260212_missing_jobtypes"
down_revision = "20260211_custom_ignore"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PROMPT #108: activation job types
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'epic_activation'")
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'story_activation'")
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'task_activation'")
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'subtask_activation'")

    # PROMPT #153: cards from memory scan
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'cards_from_memory'")


def downgrade() -> None:
    # PostgreSQL doesn't support removing enum values directly
    pass
