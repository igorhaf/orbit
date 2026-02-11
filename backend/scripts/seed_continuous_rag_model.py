"""
Seed script for Continuous RAG Evolution
PROMPT #218 - Creates Ollama qwen2.5:32b model as general fallback + AI Flow chain

The Ollama model is configured as usage_type=general so it serves as the
universal fallback for ALL operations (including memory/continuous_rag).
The AI Flow general chain ensures Ollama is tried first (free, local),
with cloud models as fallback.

Usage:
    cd backend && poetry run python scripts/seed_continuous_rag_model.py
"""

import sys
from pathlib import Path

# Add parent directory to path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models.ai_model import AIModel, AIModelUsageType
from app.models.ai_flow_chain import AIFlowChain
from app.config import settings
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def seed_continuous_rag():
    """
    Seed Ollama qwen2.5:32b model as general usage type.
    The general type acts as universal fallback for any usage_type
    that doesn't have a specific model configured (including memory).
    """
    logger.info("🧠 Starting Continuous RAG Evolution seed...")

    engine = create_engine(settings.database_url)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()

    try:
        # =====================================================================
        # 1. Create/update Qwen2.5 32B model as general (universal fallback)
        # =====================================================================
        ollama_model = db.query(AIModel).filter(
            AIModel.provider == "ollama",
        ).first()

        if not ollama_model:
            ollama_model = AIModel(
                name="Qwen2.5 32B (Ollama - RAG Evolution)",
                provider="ollama",
                api_key="",  # No API key needed for local Ollama
                config={
                    "model_id": "qwen2.5:32b",
                    "max_tokens": 8192,
                    "temperature": 0.1  # Deterministic for rule extraction
                },
                usage_type=AIModelUsageType.GENERAL,
                is_active=True,
                timeout_seconds=600  # 10 min timeout for CPU inference
            )
            db.add(ollama_model)
            db.commit()
            db.refresh(ollama_model)
            logger.info(f"✅ Created Qwen2.5 32B (Ollama) as general - ID: {ollama_model.id}")
        else:
            ollama_model.name = "Qwen2.5 32B (Ollama - RAG Evolution)"
            ollama_model.config = {
                "model_id": "qwen2.5:32b",
                "max_tokens": 8192,
                "temperature": 0.1
            }
            ollama_model.usage_type = AIModelUsageType.GENERAL
            ollama_model.is_active = True
            ollama_model.timeout_seconds = 600
            db.commit()
            db.refresh(ollama_model)
            logger.info(f"🔄 Updated Ollama model to general - ID: {ollama_model.id}")

        # =====================================================================
        # 2. Ensure general AI Flow chain includes Ollama as first model
        # =====================================================================
        chain = db.query(AIFlowChain).filter(
            AIFlowChain.usage_type == AIModelUsageType.GENERAL
        ).first()

        ollama_id = str(ollama_model.id)

        if not chain:
            chain = AIFlowChain(
                usage_type=AIModelUsageType.GENERAL,
                chain=[ollama_id],
                is_active=True,
                node_positions={
                    "start": {"x": 50, "y": 200},
                    ollama_id: {"x": 300, "y": 200},
                    "error": {"x": 550, "y": 200},
                },
            )
            db.add(chain)
            db.commit()
            logger.info(f"✅ Created general AI Flow chain with Ollama")
        elif ollama_id not in chain.chain:
            # Add Ollama as first model in existing general chain
            chain.chain = [ollama_id] + chain.chain
            db.commit()
            logger.info(f"🔄 Added Ollama as first model in general chain")
        else:
            logger.info(f"✅ Ollama already in general chain")

        # =====================================================================
        # Summary
        # =====================================================================
        total_models = db.query(AIModel).count()
        ollama_models = db.query(AIModel).filter(AIModel.provider == "ollama").count()
        chains = db.query(AIFlowChain).count()

        logger.info(f"📊 Summary:")
        logger.info(f"   Models: {total_models} total, {ollama_models} Ollama")
        logger.info(f"   Chains: {chains} total")
        logger.info(f"   General chain: Ollama (free, local) as first model")
        logger.info("🎉 Continuous RAG Evolution seed completed!")

    except Exception as e:
        logger.error(f"❌ Error during seed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_continuous_rag()
