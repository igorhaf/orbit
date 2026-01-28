"""seed_pattern_discovery_model

Revision ID: 20260127100000
Revises: 20260126120000
Create Date: 2026-01-27 10:00:00.000000

PROMPT #115 - Pattern Discovery Model Configuration
Seeds a dedicated AI model for pattern_discovery usage type.
This allows pattern discovery to be configured separately from other AI operations.
"""
from typing import Sequence, Union
import os
from datetime import datetime

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260127100000'
down_revision: Union[str, None] = '20260126120000'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Seed a dedicated AI model for pattern_discovery usage type.
    Uses Google Gemini 2.0 Flash by default (good for code analysis).
    """
    connection = op.get_bind()

    # Check if pattern_discovery model already exists
    result = connection.execute(sa.text(
        "SELECT COUNT(*) FROM ai_models WHERE usage_type = 'pattern_discovery'"
    ))
    count = result.scalar()

    if count > 0:
        print(f"⚠️  Pattern discovery model already exists ({count} models). Skipping.")
        return

    print("🌱 Seeding Pattern Discovery AI model...")

    # Get Google AI API key from environment (or use placeholder)
    api_key = os.getenv("GOOGLE_AI_API_KEY", "").strip()
    is_active = bool(api_key)
    if not api_key:
        api_key = "CONFIGURE_VIA_WEB_INTERFACE"

    now = datetime.utcnow()

    # Insert pattern_discovery model
    connection.execute(
        sa.text("""
            INSERT INTO ai_models (id, name, provider, api_key, usage_type, is_active, config, created_at, updated_at)
            VALUES (
                gen_random_uuid(),
                :name,
                :provider,
                :api_key,
                'pattern_discovery',
                :is_active,
                jsonb_build_object(
                    'model_id', :model_id,
                    'max_tokens', :max_tokens,
                    'temperature', :temperature,
                    'description', :description
                ),
                :created_at,
                :updated_at
            )
        """),
        {
            "name": "Gemini 2.0 Flash (Pattern Discovery)",
            "provider": "google",
            "api_key": api_key,
            "model_id": "gemini-2.0-flash",
            "max_tokens": 8192,
            "temperature": 0.7,
            "description": "Fast Gemini model optimized for code pattern discovery and analysis",
            "is_active": is_active,
            "created_at": now,
            "updated_at": now,
        }
    )

    status = "🔑 Active" if is_active else "⚠️  Inactive (needs API key)"
    print(f"   {status} - Gemini 2.0 Flash (Pattern Discovery)")
    print("✅ Pattern discovery model seeded successfully")


def downgrade() -> None:
    """
    Remove pattern_discovery model.
    """
    print("⚠️  Removing pattern discovery model...")
    op.execute("DELETE FROM ai_models WHERE usage_type = 'pattern_discovery'")
    print("✅ Pattern discovery model removed")
