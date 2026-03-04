"""Remove subtask layer — delete subtask records and drop subtask_suggestions column

Revision ID: h265a1b2c3e6
Revises: g264a1b2c3e5
Create Date: 2026-03-03 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = 'h265a1b2c3e6'
down_revision = 'g264a1b2c3e5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Delete all subtask records from the database
    op.execute("DELETE FROM tasks WHERE item_type = 'subtask'")

    # 2. Drop subtask_suggestions column from tasks table
    op.drop_column('tasks', 'subtask_suggestions')

    # Note: We do NOT remove 'subtask' from the PostgreSQL enum
    # because ALTER TYPE ... DROP VALUE is not supported.
    # The value remains in the PG enum but is not used by the Python model.


def downgrade() -> None:
    # Re-add subtask_suggestions column
    op.add_column('tasks', sa.Column('subtask_suggestions', sa.JSON(), nullable=True))
