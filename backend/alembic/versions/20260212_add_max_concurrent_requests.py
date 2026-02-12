"""Add max_concurrent_requests to ai_models

PROMPT #228 - Parallelism field for AI models.
Controls how many API calls can run in parallel for each model.
NULL = unlimited (no concurrency limit).

Revision ID: 20260212_max_concurrent
Revises: 20260212_missing_jobtypes
Create Date: 2026-02-12
"""
import sqlalchemy as sa
from alembic import op


revision = "20260212_max_concurrent"
down_revision = "20260212_missing_jobtypes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ai_models",
        sa.Column("max_concurrent_requests", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ai_models", "max_concurrent_requests")
