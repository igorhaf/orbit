#!/usr/bin/env python3
"""
Initialize AI Models with Placeholders

This script creates default AI model entries in the database with placeholder API keys.
All API keys MUST be configured via the web interface at http://localhost:3000/ai-models

This approach allows:
- Granular control per model via CRUD operations
- Business logic and validations in the backend
- Audit trail and versioning
- Dynamic configuration without redeployment

Usage:
    # Inside Docker container:
    docker-compose -p orbit exec backend python scripts/init_ai_models.py

    # Or locally:
    cd backend && python scripts/init_ai_models.py

After running:
    Configure API keys at: http://localhost:3000/ai-models
"""

import sys
from pathlib import Path

# Add backend to path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models.ai_model import AIModel, AIModelUsageType


# Default AI models configuration (without API keys)
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


def init_ai_models(db: Session):
    """
    Create default AI models in database with placeholder API keys.
    
    Args:
        db: Database session
    """
    print("🚀 Initializing AI Models...")
    print("=" * 70)
    
    # Check if models already exist
    existing_count = db.query(AIModel).count()
    if existing_count > 0:
        print(f"⚠️  Found {existing_count} existing AI models in database.")
        response = input("Do you want to DELETE all and recreate? (yes/no): ")
        if response.lower() != "yes":
            print("❌ Initialization cancelled.")
            print(f"\nManage models at: http://localhost:3000/ai-models")
            return
        
        # Delete existing models
        db.query(AIModel).delete()
        db.commit()
        print("✅ Deleted existing models\n")
    
    # Create models with placeholders
    created_count = 0
    
    print("Creating models with placeholder API keys:\n")
    
    for model_config in DEFAULT_MODELS:
        # Create model with placeholder
        model = AIModel(
            name=model_config["name"],
            provider=model_config["provider"],
            api_key="CONFIGURE_VIA_WEB_INTERFACE",  # Placeholder
            usage_type=model_config["usage_type"],
            is_active=False,  # Inactive until API key configured
            config={
                "model_id": model_config["model_id"],
                "max_tokens": model_config["max_tokens"],
                "temperature": model_config["temperature"],
                "description": model_config["description"],
            }
        )
        
        db.add(model)
        created_count += 1
        
        print(f"📝 {model_config['name']:25} ({model_config['provider']:10}) - {model_config['usage_type'].value}")
    
    db.commit()
    
    print("\n" + "=" * 70)
    print(f"✅ Created {created_count} AI models with placeholders")
    print("\n" + "⚠️  IMPORTANT: All models are INACTIVE")
    print("=" * 70)
    print("\n📌 Next Steps:\n")
    print("1. Go to: http://localhost:3000/ai-models")
    print("2. Edit each model to add your API key")
    print("3. Toggle 'Active' to enable the model")
    print("\nAlternatively, use the Backend API:")
    print("  PATCH /api/v1/ai-models/{id}")
    print("  Body: { \"api_key\": \"sk-...\", \"is_active\": true }")
    print("\n" + "=" * 70)


def main():
    """Main entry point"""
    print("\n" + "=" * 70)
    print("ORBIT - AI Models Initialization")
    print("=" * 70)
    print("\n⚠️  This script creates models with PLACEHOLDER API keys")
    print("   You MUST configure real keys via web interface\n")
    
    # Create database session
    db = SessionLocal()
    
    try:
        init_ai_models(db)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
