"""Fix labels column from JSON to JSONB for @> operator support

PROMPT #125 - Fix labels column type

Revision ID: 20260207_labels_jsonb
Revises: 20260207_chain_track
Create Date: 2026-02-07

The labels column was JSON type which doesn't support the @> (contains)
operator in PostgreSQL. JSONB supports it natively, fixing the error:
"operator does not exist: json ~~ text"
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = '20260207_labels_jsonb'
down_revision = '20260207_chain_track'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE tasks ALTER COLUMN labels TYPE JSONB USING labels::jsonb")


def downgrade() -> None:
    op.execute("ALTER TABLE tasks ALTER COLUMN labels TYPE JSON USING labels::json")
