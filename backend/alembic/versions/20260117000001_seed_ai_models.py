"""seed_ai_models

Revision ID: 20260117000001
Revises: 20260109000004
Create Date: 2026-01-17 11:50:00.000000

SEED - AI Models Default Configuration
Seeds the ai_models table with default AI model configurations.
API keys are read from environment variables (.env):
- ANTHROPIC_API_KEY
- OPENAI_API_KEY  
- GOOGLE_AI_API_KEY

If keys are not present, uses placeholder values that must be configured via web interface.
"""
from typing import Sequence, Union
import os
from datetime import datetime
from uuid import uuid4

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260117000001'
down_revision: Union[str, None] = '20260109000004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Default AI models configuration
DEFAULT_MODELS = [
    # Anthropic (Claude)
    {
        "name": "Claude Sonnet 4.5",
        "provider": "anthropic",
        "model_id": "claude-sonnet-4-5-20250929",
        "usage_type": "task_execution",
        "max_tokens": 8192,
        "temperature": 0.7,
        "description": "Most capable Claude model - best for complex task execution",
        "env_var": "ANTHROPIC_API_KEY"
    },
    {
        "name": "Claude Opus 4.5",
        "provider": "anthropic",
        "model_id": "claude-opus-4-5-20251101",
        "usage_type": "prompt_generation",
        "max_tokens": 4096,
        "temperature": 0.8,
        "description": "Most intelligent Claude model - best for prompt generation",
        "env_var": "ANTHROPIC_API_KEY"
    },
    {
        "name": "Claude Haiku 4",
        "provider": "anthropic",
        "model_id": "claude-haiku-4-20250110",
        "usage_type": "interview",
        "max_tokens": 4096,
        "temperature": 0.7,
        "description": "Fastest Claude model - best for interviews (cost-effective)",
        "env_var": "ANTHROPIC_API_KEY"
    },
    {
        "name": "Claude Sonnet 4.5 (General)",
        "provider": "anthropic",
        "model_id": "claude-sonnet-4-5-20250929",
        "usage_type": "general",
        "max_tokens": 8192,
        "temperature": 0.7,
        "description": "Most capable Claude model - best for general purpose tasks (default)",
        "env_var": "ANTHROPIC_API_KEY",
        "is_default": True  # Mark as default for general usage
    },

    # OpenAI (GPT)
    {
        "name": "GPT-4o",
        "provider": "openai",
        "model_id": "gpt-4o",
        "usage_type": "general",
        "max_tokens": 4096,
        "temperature": 0.7,
        "description": "Latest GPT-4 model with vision capabilities",
        "env_var": "OPENAI_API_KEY"
    },
    {
        "name": "GPT-4 Turbo",
        "provider": "openai",
        "model_id": "gpt-4-turbo-preview",
        "usage_type": "general",
        "max_tokens": 4096,
        "temperature": 0.7,
        "description": "Fast GPT-4 variant - good balance of speed and quality",
        "env_var": "OPENAI_API_KEY"
    },
    {
        "name": "GPT-3.5 Turbo",
        "provider": "openai",
        "model_id": "gpt-3.5-turbo",
        "usage_type": "commit_generation",
        "max_tokens": 2048,
        "temperature": 0.5,
        "description": "Fastest OpenAI model - best for commit messages (cost-effective)",
        "env_var": "OPENAI_API_KEY"
    },
    
    # Google (Gemini)
    {
        "name": "Gemini 1.5 Pro",
        "provider": "google",
        "model_id": "gemini-1.5-pro",
        "usage_type": "general",
        "max_tokens": 8192,
        "temperature": 0.7,
        "description": "Most capable Gemini model - long context window",
        "env_var": "GOOGLE_AI_API_KEY"
    },
    {
        "name": "Gemini 2.0 Flash",
        "provider": "google",
        "model_id": "gemini-2.0-flash",
        "usage_type": "general",  # Changed from pattern_discovery to avoid enum timing issue
        "max_tokens": 8192,
        "temperature": 0.7,
        "description": "Latest Gemini model - fast and efficient (for pattern discovery)",
        "env_var": "GOOGLE_AI_API_KEY"
    },
    {
        "name": "Gemini 1.5 Flash",
        "provider": "google",
        "model_id": "gemini-1.5-flash",
        "usage_type": "general",
        "max_tokens": 8192,
        "temperature": 0.7,
        "description": "Fastest Gemini model - cost-effective for high-volume tasks",
        "env_var": "GOOGLE_AI_API_KEY"
    },
]


def get_api_key(env_var: str) -> tuple[str, bool]:
    """
    Get API key from environment variable.
    
    Args:
        env_var: Environment variable name
    
    Returns:
        Tuple of (api_key, is_active)
        - If key exists: (actual_key, True)
        - If key missing: (placeholder, False)
    """
    api_key = os.getenv(env_var, "").strip()
    
    if api_key:
        return (api_key, True)
    else:
        return ("CONFIGURE_VIA_WEB_INTERFACE", False)


def upgrade() -> None:
    """
    Seed ai_models table with default configurations.
    
    Reads API keys from environment variables:
    - ANTHROPIC_API_KEY
    - OPENAI_API_KEY
    - GOOGLE_AI_API_KEY
    
    If keys are present, creates active models.
    If keys are missing, creates inactive models with placeholders.
    """
    # Check if models already exist (idempotent)
    connection = op.get_bind()
    result = connection.execute(sa.text("SELECT COUNT(*) FROM ai_models"))
    count = result.scalar()
    
    if count > 0:
        print(f"⚠️  AI models already seeded ({count} models exist). Skipping seed.")
        return
    
    print("🌱 Seeding AI models from environment variables...")

    # Prepare and insert seed data
    active_count = 0
    placeholder_count = 0
    now = datetime.utcnow()
    default_general_model_id = None

    for model_config in DEFAULT_MODELS:
        api_key, is_active = get_api_key(model_config["env_var"])

        # Force default general model to be active (even without API key)
        if model_config.get("is_default"):
            is_active = True

        if is_active:
            active_count += 1
        else:
            placeholder_count += 1

        # Insert individual record - build config as JSONB string
        # Use RETURNING to get the generated ID
        result = connection.execute(
            sa.text("""
                INSERT INTO ai_models (id, name, provider, api_key, usage_type, is_active, config, created_at, updated_at)
                VALUES (
                    gen_random_uuid(),
                    :name,
                    :provider,
                    :api_key,
                    :usage_type,
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
                RETURNING id
            """),
            {
                "name": model_config["name"],
                "provider": model_config["provider"],
                "api_key": api_key,
                "usage_type": model_config["usage_type"],
                "is_active": is_active,
                "model_id": model_config["model_id"],
                "max_tokens": model_config["max_tokens"],
                "temperature": model_config["temperature"],
                "description": model_config["description"],
                "created_at": now,
                "updated_at": now,
            }
        )

        # Capture ID of default general model
        if model_config.get("is_default") and model_config["usage_type"] == "general":
            model_id = result.scalar()
            default_general_model_id = str(model_id)

        status = "🔑" if is_active else "⚠️ "
        marker = " (DEFAULT)" if model_config.get("is_default") else ""
        print(f"{status} {model_config['name']:30} ({model_config['provider']:10}) - {model_config['usage_type']}{marker}")
    
    print(f"\n✅ Seeded {len(DEFAULT_MODELS)} AI models:")
    print(f"   - {active_count} active (with API keys from .env)")
    print(f"   - {placeholder_count} inactive (placeholders - configure via web)")

    # Configure default general model in system_settings
    if default_general_model_id:
        print(f"\n⚙️  Configuring default model for general usage...")
        connection.execute(
            sa.text("""
                INSERT INTO system_settings (id, key, value, description, updated_at)
                VALUES (
                    gen_random_uuid(),
                    'default_model_general',
                    :value,
                    'Default AI model for general purpose tasks',
                    :updated_at
                )
                ON CONFLICT (key) DO UPDATE SET
                    value = EXCLUDED.value,
                    updated_at = EXCLUDED.updated_at
            """),
            {
                "value": f'"{default_general_model_id}"',  # JSON string format
                "updated_at": now
            }
        )
        print(f"   ✅ Set Claude Sonnet 4.5 (General) as default for General dropdown")

    if placeholder_count > 0:
        print(f"\n⚠️  To activate inactive models:")
        print(f"   1. Add API keys to .env file:")
        print(f"      - ANTHROPIC_API_KEY=sk-ant-...")
        print(f"      - OPENAI_API_KEY=sk-...")
        print(f"      - GOOGLE_AI_API_KEY=...")
        print(f"   2. Restart containers to re-run migrations")
        print(f"   OR update via web: http://localhost:3000/ai-models")


def downgrade() -> None:
    """
    Remove seeded AI models and settings.

    WARNING: This will delete ALL ai_models records!
    Only use if you're rolling back the initial seed.
    """
    print("⚠️  Rolling back AI models seed (deleting all models and settings)...")
    op.execute("DELETE FROM ai_models")
    op.execute("DELETE FROM system_settings WHERE key = 'default_model_general'")
    print("✅ AI models seed rolled back")
