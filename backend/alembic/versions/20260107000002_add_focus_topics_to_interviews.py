"""Add focus_topics to interviews

PROMPT #77 - Meta Prompt Topic Selection

Revision ID: 20260107000002
Revises: 20260107000001
Create Date: 2026-01-07 00:00:02

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSON


# revision identifiers, used by Alembic.
revision = '20260107000002'
down_revision = '20260107000001'  # Previous migration (generated_prompt)
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Add focus_topics field to interviews table.

    New field:
    - focus_topics: JSON array of selected topics for meta prompt interviews
      Format: ["business_rules", "design", "architecture", "security", ...]

    Purpose:
    - Allow client to choose which aspects of the project to focus on
    - Guide AI contextual questions towards selected topics
    - Only used in meta_prompt interview mode

    Breaking Changes: NONE - field is nullable and defaults to empty array
    - Existing interviews get focus_topics=[] (no topics selected)
    """
    op.add_column('interviews',
        sa.Column('focus_topics', JSON, nullable=True, server_default='[]')
    )


def downgrade() -> None:
    """
    Remove focus_topics field.

    Rollback strategy: Drop column.
    """
    op.drop_column('interviews', 'focus_topics')
