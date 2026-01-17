#!/usr/bin/env python3
"""
Setup AI Models API Keys

This script populates the ai_models table with default AI model configurations.
API keys can be provided via:
1. Environment variables from .env file (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY)
2. Manual configuration via web interface at http://localhost:3000/ai-models

Usage:
    # Inside Docker container:
    docker-compose -p orbit exec backend python scripts/setup_api_keys.py

    # Or locally:
    cd backend && python scripts/setup_api_keys.py

Security:
    - API keys are stored in the DATABASE (ai_models table)
    - .env is in .gitignore and NEVER committed
    - If no keys in .env, placeholders are used (configure via web later)
"""

import os
import sys
from pathlib import Path

# Add backend to path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from sqlalchemy.orm import Session
from app.database import SessionLocal, engine
from app.models.ai_model import AIModel, AIModelUsageType


# Default AI models configuration
DEFAULT_MODELS = [
    # Anthropic (Claude)
    {
        "name": "Claude Sonnet 4.5",
        "provider": "anthropic",
        "model_id": "claude-sonnet-4-5-20250929",
        "usage_type": AIModelUsageType.TASK_EXECUTION,
        "max_tokens": 8192,
        "temperature": 0.7,
        "description": "Most capable Claude model - best for complex task execution"
    },
    {
        "name": "Claude Opus 4.5",
        "provider": "anthropic",
        "model_id": "claude-opus-4-5-20251101",
        "usage_type": AIModelUsageType.PROMPT_GENERATION,
        "max_tokens": 4096,
        "temperature": 0.8,
        "description": "Most intelligent Claude model - best for prompt generation"
    },
    {
        "name": "Claude Haiku 4",
        "provider": "anthropic",
        "model_id": "claude-haiku-4-20250110",
        "usage_type": AIModelUsageType.INTERVIEW,
        "max_tokens": 4096,
        "temperature": 0.7,
        "description": "Fastest Claude model - best for interviews (cost-effective)"
    },
    
    # OpenAI (GPT)
    {
        "name": "GPT-4o",
        "provider": "openai",
        "model_id": "gpt-4o",
        "usage_type": AIModelUsageType.GENERAL,
        "max_tokens": 4096,
        "temperature": 0.7,
        "description": "Latest GPT-4 model with vision capabilities"
    },
    {
        "name": "GPT-4 Turbo",
        "provider": "openai",
        "model_id": "gpt-4-turbo-preview",
        "usage_type": AIModelUsageType.GENERAL,
        "max_tokens": 4096,
        "temperature": 0.7,
        "description": "Fast GPT-4 variant - good balance of speed and quality"
    },
    {
        "name": "GPT-3.5 Turbo",
        "provider": "openai",
        "model_id": "gpt-3.5-turbo",
        "usage_type": AIModelUsageType.COMMIT_GENERATION,
        "max_tokens": 2048,
        "temperature": 0.5,
        "description": "Fastest OpenAI model - best for commit messages (cost-effective)"
    },
    
    # Google (Gemini)
    {
        "name": "Gemini 1.5 Pro",
        "provider": "google",
        "model_id": "gemini-1.5-pro",
        "usage_type": AIModelUsageType.GENERAL,
        "max_tokens": 8192,
        "temperature": 0.7,
        "description": "Most capable Gemini model - long context window"
    },
    {
        "name": "Gemini 2.0 Flash",
        "provider": "google",
        "model_id": "gemini-2.0-flash",
        "usage_type": AIModelUsageType.PATTERN_DISCOVERY,
        "max_tokens": 8192,
        "temperature": 0.7,
        "description": "Latest Gemini model - fast and efficient"
    },
    {
        "name": "Gemini 1.5 Flash",
        "provider": "google",
        "model_id": "gemini-1.5-flash",
        "usage_type": AIModelUsageType.GENERAL,
        "max_tokens": 8192,
        "temperature": 0.7,
        "description": "Fastest Gemini model - cost-effective for high-volume tasks"
    },
]


def get_api_key(provider: str) -> str:
    """
    Get API key from environment or return placeholder.
    
    Args:
        provider: AI provider name (anthropic, openai, google)
    
    Returns:
        API key from .env or placeholder string
    """
    env_key_map = {
        "anthropic": "ANTHROPIC_API_KEY",
        "openai": "OPENAI_API_KEY",
        "google": "GOOGLE_API_KEY",
    }
    
    env_var = env_key_map.get(provider)
    if not env_var:
        return "configure-via-web-interface"
    
    api_key = os.getenv(env_var, "").strip()
    
    if not api_key:
        return "configure-via-web-interface"
    
    return api_key


def setup_ai_models(db: Session):
    """
    Create default AI models in database.
    
    Args:
        db: Database session
    """
    print("🚀 Setting up AI Models...")
    print("=" * 60)
    
    # Check if models already exist
    existing_count = db.query(AIModel).count()
    if existing_count > 0:
        print(f"⚠️  Found {existing_count} existing AI models in database.")
        response = input("Do you want to DELETE all and recreate? (yes/no): ")
        if response.lower() != "yes":
            print("❌ Setup cancelled. Use web interface to manage models.")
            return
        
        # Delete existing models
        db.query(AIModel).delete()
        db.commit()
        print("✅ Deleted existing models")
    
    # Create models
    created_count = 0
    placeholder_count = 0
    
    for model_config in DEFAULT_MODELS:
        provider = model_config["provider"]
        api_key = get_api_key(provider)
        
        # Track if using placeholder
        using_placeholder = api_key == "configure-via-web-interface"
        if using_placeholder:
            placeholder_count += 1
        
        # Create model
        model = AIModel(
            name=model_config["name"],
            provider=provider,
            api_key=api_key,
            usage_type=model_config["usage_type"],
            is_active=not using_placeholder,  # Inactive if placeholder
            config={
                "model_id": model_config["model_id"],
                "max_tokens": model_config["max_tokens"],
                "temperature": model_config["temperature"],
                "description": model_config["description"],
            }
        )
        
        db.add(model)
        created_count += 1
        
        # Status emoji
        status = "🔑" if not using_placeholder else "⚠️ "
        print(f"{status} {model_config['name']:25} ({provider:10}) - {model_config['usage_type'].value}")
    
    db.commit()
    
    print("=" * 60)
    print(f"✅ Created {created_count} AI models")
    
    if placeholder_count > 0:
        print(f"\n⚠️  {placeholder_count} models using placeholders (inactive)")
        print(f"\nTo activate them:")
        print(f"1. Add API keys to .env file:")
        print(f"   - ANTHROPIC_API_KEY=sk-ant-...")
        print(f"   - OPENAI_API_KEY=sk-...")
        print(f"   - GOOGLE_API_KEY=...")
        print(f"\n2. Run this script again: docker-compose -p orbit exec backend python scripts/setup_api_keys.py")
        print(f"\nOR configure manually at: http://localhost:3000/ai-models")
    else:
        print(f"\n🎉 All models configured with API keys from .env!")
        print(f"\nYou can manage models at: http://localhost:3000/ai-models")
    
    print("\n" + "=" * 60)


def main():
    """Main entry point"""
    print("\n" + "=" * 60)
    print("ORBIT - AI Models Setup")
    print("=" * 60)
    
    # Load .env if exists (for local execution)
    env_file = backend_dir.parent / ".env"
    if env_file.exists():
        from dotenv import load_dotenv
        load_dotenv(env_file)
        print(f"✅ Loaded .env from: {env_file}")
    else:
        print(f"⚠️  No .env file found at: {env_file}")
        print(f"   API keys will use placeholders")
    
    # Create database session
    db = SessionLocal()
    
    try:
        setup_ai_models(db)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
