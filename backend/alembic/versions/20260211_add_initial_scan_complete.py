"""Add initial_scan_complete to projects

PROMPT #222 - Continuous RAG must wait for initial scan to complete.
Adds boolean flag that is set to True when the initial memory scan finishes.
The Continuous RAG scheduler only processes projects where this flag is True.

For existing projects that already have initial_memory_context populated,
the migration sets initial_scan_complete = True (they already completed their scan).

Revision ID: 20260211_scan_complete
Revises: 218a_rag_file_state
Create Date: 2026-02-11
"""

from alembic import op
import sqlalchemy as sa

revision = "20260211_scan_complete"
down_revision = "218a_rag_file_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add the column with default False
    op.add_column(
        "projects",
        sa.Column(
            "initial_scan_complete",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )

    # Set True for existing projects that already completed their initial scan
    # (they have initial_memory_context populated)
    op.execute(
        "UPDATE projects SET initial_scan_complete = true "
        "WHERE initial_memory_context IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_column("projects", "initial_scan_complete")
