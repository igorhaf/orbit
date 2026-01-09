"""Merge heads: resolve conflict between multiple migration branches

Revision ID: 20260109000003
Revises: 20260109000001, 20260109000002
Create Date: 2026-01-09 12:00:00.000000

This merge resolves the conflict between:
- 20260109000001 (rename simple to orchestrator) - depends on 20260108000002
- 20260109000002 (add blocking system fields) - depends on 20260107000002
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260109000003'
down_revision: Union[str, None] = ('20260109000001', '20260109000002')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Merge migrations - no schema changes needed"""
    pass


def downgrade() -> None:
    """Merge migrations - no schema changes needed"""
    pass
