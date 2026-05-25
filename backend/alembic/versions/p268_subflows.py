"""v3.0: add subflows column to ai_flow_profiles for canvas grouping.

Subflows are collapsible node groups in the unified AI Studio canvas.
Each entry: {subflow_id: {label, node_ids[], position: {x,y}, collapsed: bool}}

Revision ID: p268_subflows
Revises: p267_claudius_only
Create Date: 2026-05-25
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "p268_subflows"
down_revision = "p267_claudius_only"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ai_flow_profiles",
        sa.Column(
            "subflows",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("ai_flow_profiles", "subflows")
