"""PROMPT #252 - Add INDEXED status to file_processing_status enum.

New status between PROCESSING and COMPLETED:
- INDEXED = embedding stored in RAG, awaiting business rule extraction

Revision ID: p252_indexed_status
Revises: p250_nomic_768
"""
from alembic import op

revision = "p252_indexed_status"
down_revision = "p250_nomic_768"
branch_labels = None
depends_on = None


def upgrade():
    # PostgreSQL allows adding enum values without recreating the type
    op.execute("ALTER TYPE file_processing_status ADD VALUE IF NOT EXISTS 'indexed' AFTER 'processing'")


def downgrade():
    # PostgreSQL does not support removing enum values directly.
    # The 'indexed' value will remain but be unused.
    pass
