"""
Seed script para popular AI Models no banco de dados
Cria configurações para os 3 providers: Anthropic, OpenAI e Google AI
"""

import sys
import os
from pathlib import Path

# Adicionar diretório pai ao path para importar app
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models.ai_model import AIModel, AIModelUsageType
from app.config import settings
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def seed_ai_models():
    """
    Popula o banco com as configurações de AI Models
    """
    logger.info("🌱 Starting AI Models seed...")

    # Criar engine e sessão
    engine = create_engine(settings.database_url)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()

    try:
        # Verificar se API keys estão configuradas
        if not settings.anthropic_api_key:
            logger.warning("⚠️  ANTHROPIC_API_KEY not configured in .env")

        if not settings.openai_api_key:
            logger.warning("⚠️  OPENAI_API_KEY not configured in .env")

        if not settings.google_ai_api_key:
            logger.warning("⚠️  GOOGLE_AI_API_KEY not configured in .env")

        # 1. Claude Sonnet 4 para Task Execution
        claude_model = db.query(AIModel).filter(
            AIModel.provider == "anthropic",
            AIModel.usage_type == AIModelUsageType.TASK_EXECUTION
        ).first()

        if not claude_model and settings.anthropic_api_key:
            claude_model = AIModel(
                name="Claude Sonnet 4",
                provider="anthropic",
                api_key=settings.anthropic_api_key,
                config={
                    "model": "claude-sonnet-4-20250514",
                    "max_tokens": 8000,
                    "temperature": 0.7
                },
                usage_type=AIModelUsageType.TASK_EXECUTION,
                is_active=True
            )
            db.add(claude_model)
            logger.info("✅ Created Claude Sonnet 4 for task_execution")
        else:
            logger.info("⏭️  Claude model already exists or API key not configured")

        # 2. GPT-4 Turbo para Prompt Generation
        gpt4_model = db.query(AIModel).filter(
            AIModel.provider == "openai",
            AIModel.usage_type == AIModelUsageType.PROMPT_GENERATION
        ).first()

        if not gpt4_model and settings.openai_api_key:
            gpt4_model = AIModel(
                name="GPT-4 Turbo",
                provider="openai",
                api_key=settings.openai_api_key,
                config={
                    "model": "gpt-4-turbo-preview",
                    "max_tokens": 4000,
                    "temperature": 0.7
                },
                usage_type=AIModelUsageType.PROMPT_GENERATION,
                is_active=True
            )
            db.add(gpt4_model)
            logger.info("✅ Created GPT-4 Turbo for prompt_generation")
        else:
            logger.info("⏭️  GPT-4 model already exists or API key not configured")

        # 3. Gemini 1.5 Flash para Commit Generation
        gemini_model = db.query(AIModel).filter(
            AIModel.provider == "google",
            AIModel.usage_type == AIModelUsageType.COMMIT_GENERATION
        ).first()

        if not gemini_model and settings.google_ai_api_key:
            gemini_model = AIModel(
                name="Gemini 1.5 Flash",
                provider="google",
                api_key=settings.google_ai_api_key,
                config={
                    "model_id": "gemini-2.5-flash",
                    "max_tokens": 2000,
                    "temperature": 0.5
                },
                usage_type=AIModelUsageType.COMMIT_GENERATION,
                is_active=True
            )
            db.add(gemini_model)
            logger.info("✅ Created Gemini 1.5 Flash for commit_generation")
        else:
            logger.info("⏭️  Gemini model already exists or API key not configured")

        # Commit changes
        db.commit()
        logger.info("🎉 AI Models seed completed successfully!")

        # Show summary
        total_models = db.query(AIModel).count()
        active_models = db.query(AIModel).filter(AIModel.is_active == True).count()
        logger.info(f"📊 Summary: {total_models} total models, {active_models} active")

    except Exception as e:
        logger.error(f"❌ Error during seed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_ai_models()
