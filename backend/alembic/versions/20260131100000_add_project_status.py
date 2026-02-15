"""Add project status field

PROMPT #126 - Project Lifecycle Status

Revision ID: 20260131100000
Revises: 20260129000001
Create Date: 2026-01-31

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '20260131100000'
down_revision = '20260129000001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Check if enum type already exists
    conn = op.get_bind()
    result = conn.execute(sa.text(
        "SELECT 1 FROM pg_type WHERE typname = 'projectstatus'"
    )).fetchone()

    if not result:
        # Create enum type only if it doesn't exist
        op.execute("CREATE TYPE projectstatus AS ENUM ('draft', 'active')")

    # Check if column already exists
    result = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = 'projects' AND column_name = 'status'"
    )).fetchone()

    if not result:
        # Add status column with default 'draft'
        op.add_column('projects', sa.Column(
            'status',
            sa.Enum('draft', 'active', name='projectstatus'),
            nullable=False,
            server_default='draft'
        ))

        # Update existing projects:
        # - Projects with context_locked=true and at least one non-suggested epic -> 'active'
        # - All others -> 'draft' (already default)
        op.execute("""
            UPDATE projects
            SET status = 'active'
            WHERE context_locked = true
            AND id IN (
                SELECT DISTINCT project_id
                FROM tasks
                WHERE item_type = 'epic'
                AND (labels IS NULL OR NOT labels::jsonb @> '["suggested"]'::jsonb)
            )
        """)


def downgrade() -> None:
    op.drop_column('projects', 'status')
    op.execute("DROP TYPE IF EXISTS projectstatus")
