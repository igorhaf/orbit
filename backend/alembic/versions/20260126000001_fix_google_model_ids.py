"""Fix Google Gemini model IDs to use correct API names

Revision ID: 20260126000001
Revises: ff42c2846a70
Create Date: 2026-01-26

This migration fixes the model_id values for Google Gemini models
that were seeded with incorrect API model names.

The original seed used names like "gemini-1.5-flash" which don't exist
in the Google AI API. This migration updates them to valid model names.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = '20260126000001'
down_revision = 'e9f2a3b4c5d6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Update Google model IDs to correct API names.

    Valid models (as of Jan 2026):
    - gemini-2.5-pro (most capable)
    - gemini-2.5-flash (fast, cost-effective)
    - gemini-2.0-flash (stable)
    - gemini-2.0-flash-lite (cheapest)
    """

    # Fix Gemini 1.5 Pro -> gemini-2.5-pro (gemini-1.5-pro was retired)
    op.execute("""
        UPDATE ai_models
        SET config = jsonb_set(config::jsonb, '{model_id}', '"gemini-2.5-pro"')::json
        WHERE name = 'Gemini 1.5 Pro'
        AND provider = 'google'
        AND config->>'model_id' != 'gemini-2.5-pro'
    """)

    # Fix Gemini 2.0 Flash (already correct, but ensure consistency)
    op.execute("""
        UPDATE ai_models
        SET config = jsonb_set(config::jsonb, '{model_id}', '"gemini-2.0-flash"')::json
        WHERE name = 'Gemini 2.0 Flash'
        AND provider = 'google'
        AND config->>'model_id' != 'gemini-2.0-flash'
    """)

    # Fix any model with invalid "gemini-1.5-flash" -> gemini-2.5-flash
    op.execute("""
        UPDATE ai_models
        SET config = jsonb_set(config::jsonb, '{model_id}', '"gemini-2.5-flash"')::json
        WHERE provider = 'google'
        AND config->>'model_id' = 'gemini-1.5-flash'
    """)


def downgrade() -> None:
    """Revert to original (incorrect) model IDs - not recommended."""
    pass
