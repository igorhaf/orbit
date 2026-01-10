"""add blocking system fields

PROMPT #94 FASE 4 - Sistema de Bloqueio por Modificação

Add fields to support blocking tasks when AI suggests modifications:
- Add 'blocked' value to task_status enum
- Add blocked_reason column (String, nullable)
- Add pending_modification column (JSON, nullable)

Revision ID: 20260109000002
Revises: 20260107000002
Create Date: 2026-01-09 15:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '20260109000002'
down_revision: Union[str, None] = '20260107000002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add blocking system fields to tasks table.

    PROMPT #94 FASE 4 - Blocking System:
    When AI suggests modifying an existing task (>90% semantic similarity):
    1. Block the existing task (status = BLOCKED)
    2. Save proposed modification in pending_modification field
    3. Require user approval/rejection via UI
    """
    # Add 'blocked' value to task_status enum
    op.execute("""
        ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'blocked'
    """)

    # Add blocked_reason column
    op.add_column('tasks', sa.Column(
        'blocked_reason',
        sa.String(length=500),
        nullable=True,
        comment='Reason why task is blocked (e.g., "Modification suggested by AI")'
    ))

    # Add pending_modification column (JSON)
    op.add_column('tasks', sa.Column(
        'pending_modification',
        postgresql.JSON(astext_type=sa.Text()),
        nullable=True,
        comment='Proposed modification awaiting user approval (title, description, similarity_score, etc.)'
    ))


def downgrade() -> None:
    """
    Remove blocking system fields.

    Note: PostgreSQL doesn't support removing enum values directly.
    Removing 'blocked' would require recreating the entire enum,
    which is complex and risky in production. We'll leave it.
    """
    # Remove columns
    op.drop_column('tasks', 'pending_modification')
    op.drop_column('tasks', 'blocked_reason')

    # Note: Cannot remove 'blocked' from enum without recreating it
    # This is acceptable - unused enum values don't cause issues
