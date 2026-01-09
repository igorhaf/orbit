"""Rename interview_mode 'simple' to 'orchestrator'

Revision ID: 20260109000001
Revises: 20260108000002
Create Date: 2026-01-09 00:00:01.000000

PROMPT #94 - Rename "simple" mode to "orchestrator" to better reflect its role
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260109000001'
down_revision = '20260108000002'
branch_labels = None
depends_on = None


def upgrade():
    """
    Update existing interviews with mode='simple' to mode='orchestrator'
    """
    # Update all interviews that have interview_mode = 'simple'
    op.execute("""
        UPDATE interviews
        SET interview_mode = 'orchestrator'
        WHERE interview_mode = 'simple'
    """)


def downgrade():
    """
    Revert orchestrator back to simple (for rollback)
    """
    op.execute("""
        UPDATE interviews
        SET interview_mode = 'simple'
        WHERE interview_mode = 'orchestrator'
    """)
