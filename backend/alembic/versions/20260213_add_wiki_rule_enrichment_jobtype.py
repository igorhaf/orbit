"""Add wiki_rule_enrichment to JobType enum

PROMPT #270 - AI enrichment of individual business rule wiki pages

Revision ID: prompt270_wiki_enrich
Revises: None (standalone enum extension)
Create Date: 2026-02-13
"""

from alembic import op

# revision identifiers
revision = 'prompt270_wiki_enrich'
down_revision = '245a_scan_depth'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'wiki_rule_enrichment'")


def downgrade():
    # PostgreSQL does not support removing enum values
    pass
