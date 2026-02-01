"""
Seed script to add Cohere AI models to the database
PROMPT #122 - Cohere AI Integration
"""

import sys
from pathlib import Path

# Add parent directory to path to import app
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models.ai_model import AIModel, AIModelUsageType
from app.config import settings
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def seed_cohere_models():
    """
    Add Cohere AI models to the database

    Models added:
    - Command R+ (most powerful, for complex tasks)
    - Command R (balanced, for general use)
    - Command Light (fast and cheap)
    """
    logger.info("🟠 Starting Cohere models seed...")

    # Create engine and session
    engine = create_engine(settings.database_url)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()

    try:
        # Define Cohere models to seed
        # NOTE: Model IDs updated January 2026 - old 'command-r' was deprecated Sept 2025
        # See: https://docs.cohere.com/docs/models#command
        cohere_models = [
            {
                "name": "Cohere Command R+ (Most Powerful)",
                "provider": "cohere",
                "api_key": "configure-via-web-interface",
                "config": {
                    "model_id": "command-r-plus-08-2024",  # Updated from deprecated command-r-plus
                    "max_tokens": 4096,
                    "temperature": 0.7
                },
                "usage_type": AIModelUsageType.PROMPT_GENERATION,
                "is_active": False  # Inactive by default, user needs to add API key
            },
            {
                "name": "Cohere Command R (Balanced)",
                "provider": "cohere",
                "api_key": "configure-via-web-interface",
                "config": {
                    "model_id": "command-r-08-2024",  # Updated from deprecated command-r
                    "max_tokens": 4096,
                    "temperature": 0.7
                },
                "usage_type": AIModelUsageType.GENERAL,
                "is_active": False
            },
            {
                "name": "Cohere Command R (Interview)",
                "provider": "cohere",
                "api_key": "configure-via-web-interface",
                "config": {
                    "model_id": "command-r-08-2024",  # Updated from deprecated command-r
                    "max_tokens": 2048,
                    "temperature": 0.5
                },
                "usage_type": AIModelUsageType.INTERVIEW,
                "is_active": False
            },
            {
                "name": "Cohere Command Light (Fast)",
                "provider": "cohere",
                "api_key": "configure-via-web-interface",
                "config": {
                    "model_id": "command-light-nightly",  # Updated from deprecated command-light
                    "max_tokens": 2048,
                    "temperature": 0.7
                },
                "usage_type": AIModelUsageType.COMMIT_GENERATION,
                "is_active": False
            },
        ]

        created_count = 0
        skipped_count = 0

        for model_data in cohere_models:
            # Check if model already exists
            existing = db.query(AIModel).filter(
                AIModel.name == model_data["name"]
            ).first()

            if not existing:
                model = AIModel(
                    name=model_data["name"],
                    provider=model_data["provider"],
                    api_key=model_data["api_key"],
                    config=model_data["config"],
                    usage_type=model_data["usage_type"],
                    is_active=model_data["is_active"]
                )
                db.add(model)
                created_count += 1
                logger.info(f"✅ Created: {model_data['name']} ({model_data['usage_type'].value})")
            else:
                skipped_count += 1
                logger.info(f"⏭️  Skipped (exists): {model_data['name']}")

        db.commit()

        # Show summary
        total_models = db.query(AIModel).count()
        active_models = db.query(AIModel).filter(AIModel.is_active == True).count()
        cohere_count = db.query(AIModel).filter(AIModel.provider == "cohere").count()

        logger.info("")
        logger.info("=" * 50)
        logger.info(f"📊 Summary:")
        logger.info(f"   Created: {created_count} models")
        logger.info(f"   Skipped: {skipped_count} models")
        logger.info(f"   Total in DB: {total_models} models")
        logger.info(f"   Active: {active_models} models")
        logger.info(f"   Cohere: {cohere_count} models")
        logger.info("=" * 50)
        logger.info("")
        logger.info("🎉 Cohere models seed completed successfully!")
        logger.info("")
        logger.info("⚠️  IMPORTANT: Cohere models are INACTIVE by default.")
        logger.info("   To use them:")
        logger.info("   1. Go to /ai-models in the web interface")
        logger.info("   2. Edit each Cohere model")
        logger.info("   3. Add your Cohere API key")
        logger.info("   4. Enable the model (toggle is_active)")
        logger.info("")

    except Exception as e:
        logger.error(f"❌ Error during seed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_cohere_models()
