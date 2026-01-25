"""
Seed script to add Ollama local LLM model to the database
PROMPT #106 - Ollama Integration
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


def seed_ollama_model():
    """
    Add Ollama local LLM model to the database
    """
    logger.info("🦙 Starting Ollama model seed...")

    # Create engine and session
    engine = create_engine(settings.database_url)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()

    try:
        # Check if Ollama model already exists
        ollama_model = db.query(AIModel).filter(
            AIModel.provider == "ollama",
            AIModel.usage_type == AIModelUsageType.GENERAL
        ).first()

        if not ollama_model:
            ollama_model = AIModel(
                name="Qwen2.5 Coder (Ollama Local)",
                provider="ollama",
                api_key="",  # No API key needed for local Ollama
                config={
                    "model_id": "qwen2.5-coder:7b-instruct",
                    "max_tokens": 4096,
                    "temperature": 0.7
                },
                usage_type=AIModelUsageType.GENERAL,
                is_active=True
            )
            db.add(ollama_model)
            db.commit()
            logger.info("✅ Created Qwen2.5 Coder (Ollama Local) for general usage")
        else:
            logger.info("⏭️  Ollama model already exists")

        # Show summary
        total_models = db.query(AIModel).count()
        active_models = db.query(AIModel).filter(AIModel.is_active == True).count()
        ollama_models = db.query(AIModel).filter(AIModel.provider == "ollama").count()
        logger.info(f"📊 Summary: {total_models} total models, {active_models} active, {ollama_models} Ollama")
        logger.info("🎉 Ollama model seed completed successfully!")

    except Exception as e:
        logger.error(f"❌ Error during seed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_ollama_model()
