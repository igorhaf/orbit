"""PROMPT #133: Add missing JobType enum values to PostgreSQL

Revision ID: 20260201000002
Revises: 20260201000001
Create Date: 2026-02-01

This migration adds the new JobType enum values that were added in:
- PROMPT #68: task_generation
- PROMPT #108: task_execution, batch_execution, commit_generation
- PROMPT #133: interview_question, memory_scan, project_title, context_generation, suggested_epics
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = '20260201000002'
down_revision = '20260201000001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add new enum values to jobtype
    # PostgreSQL requires ALTER TYPE to add new enum values

    # PROMPT #68
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'task_generation'")

    # PROMPT #108
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'task_execution'")
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'batch_execution'")
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'commit_generation'")

    # PROMPT #133
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'interview_question'")
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'memory_scan'")
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'project_title'")
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'context_generation'")
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'suggested_epics'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values easily
    # The safest approach is to not remove them in downgrade
    # They won't cause issues if the code doesn't use them
    pass
