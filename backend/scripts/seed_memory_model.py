"""
Seed script to add Memory AI model to the database
PROMPT #118 - Codebase Memory Scan

This model is used for analyzing codebases and extracting business rules
during project creation.
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


def seed_memory_model():
    """
    Add Memory AI model to the database for codebase analysis.

    Uses Claude Haiku for fast and efficient code analysis.
    """
    logger.info("🧠 Starting Memory model seed...")

    # Create engine and session
    engine = create_engine(settings.database_url)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()

    try:
        # Check if Memory model already exists
        memory_model = db.query(AIModel).filter(
            AIModel.usage_type == AIModelUsageType.MEMORY
        ).first()

        if not memory_model:
            memory_model = AIModel(
                name="Claude Haiku (Memory Scan)",
                provider="anthropic",
                api_key="configure-via-web-interface",  # CLAUDE.md rule: keys are set in /ai-models
                config={
                    "model_id": "claude-3-5-haiku-20241022",
                    "max_tokens": 2000,
                    "temperature": 0.3  # Lower temperature for more consistent analysis
                },
                usage_type=AIModelUsageType.MEMORY,
                is_active=True
            )
            db.add(memory_model)
            db.commit()
            logger.info("✅ Created Claude Haiku (Memory Scan) for memory usage_type")
            logger.info("⚠️  Remember to configure the API key in /ai-models")
        else:
            logger.info(f"⏭️  Memory model already exists: {memory_model.name}")

        # Show summary
        total_models = db.query(AIModel).count()
        active_models = db.query(AIModel).filter(AIModel.is_active == True).count()
        memory_models = db.query(AIModel).filter(
            AIModel.usage_type == AIModelUsageType.MEMORY
        ).count()

        logger.info(f"📊 Summary: {total_models} total models, {active_models} active, {memory_models} memory")
        logger.info("🎉 Memory model seed completed successfully!")

    except Exception as e:
        logger.error(f"❌ Error during seed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_memory_model()
