"""
Seed script for Continuous RAG Evolution
PROMPT #218 - Creates Ollama qwen2.5:32b model + AI Flow chain for memory usage type

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
    Seed Ollama qwen2.5:32b model for continuous RAG evolution
    and create AI Flow chain for memory usage type.
    """
    logger.info("🧠 Starting Continuous RAG Evolution seed...")

    engine = create_engine(settings.database_url)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()

    try:
        # =====================================================================
        # 1. Create/update Qwen2.5 32B model for memory usage type
        # =====================================================================
        ollama_memory = db.query(AIModel).filter(
            AIModel.provider == "ollama",
            AIModel.usage_type == AIModelUsageType.MEMORY
        ).first()

        if not ollama_memory:
            ollama_memory = AIModel(
                name="Qwen2.5 32B (Ollama - RAG Evolution)",
                provider="ollama",
                api_key="",  # No API key needed for local Ollama
                config={
                    "model_id": "qwen2.5:32b",
                    "max_tokens": 8192,
                    "temperature": 0.1  # Deterministic for rule extraction
                },
                usage_type=AIModelUsageType.MEMORY,
                is_active=True,
                timeout_seconds=600  # 10 min timeout for 32B model
            )
            db.add(ollama_memory)
            db.commit()
            db.refresh(ollama_memory)
            logger.info(f"✅ Created Qwen2.5 32B (Ollama) for memory usage - ID: {ollama_memory.id}")
        else:
            # Update to qwen2.5:32b if it was a different model
            ollama_memory.name = "Qwen2.5 32B (Ollama - RAG Evolution)"
            ollama_memory.config = {
                "model_id": "qwen2.5:32b",
                "max_tokens": 8192,
                "temperature": 0.1
            }
            ollama_memory.is_active = True
            ollama_memory.timeout_seconds = 600
            db.commit()
            db.refresh(ollama_memory)
            logger.info(f"🔄 Updated existing Ollama memory model to qwen2.5:32b - ID: {ollama_memory.id}")

        # =====================================================================
        # 2. Find Claude Haiku for fallback
        # =====================================================================
        haiku_model = db.query(AIModel).filter(
            AIModel.provider == "anthropic",
            AIModel.is_active == True
        ).order_by(AIModel.created_at.desc()).first()

        if not haiku_model:
            logger.warning("⚠️ No Anthropic model found for fallback chain")

        # =====================================================================
        # 3. Create AI Flow chain for memory usage type
        # =====================================================================
        chain = db.query(AIFlowChain).filter(
            AIFlowChain.usage_type == AIModelUsageType.MEMORY
        ).first()

        chain_models = [str(ollama_memory.id)]
        if haiku_model:
            chain_models.append(str(haiku_model.id))

        if not chain:
            chain = AIFlowChain(
                usage_type=AIModelUsageType.MEMORY,
                chain=chain_models,
                is_active=True,
                node_positions={
                    "start": {"x": 50, "y": 200},
                    str(ollama_memory.id): {"x": 300, "y": 200},
                },
            )
            if haiku_model:
                chain.node_positions[str(haiku_model.id)] = {"x": 550, "y": 200}
                chain.node_positions["error"] = {"x": 800, "y": 200}
            else:
                chain.node_positions["error"] = {"x": 550, "y": 200}

            db.add(chain)
            db.commit()
            logger.info(f"✅ Created AI Flow chain for 'memory': {' → '.join(chain_models)}")
        else:
            chain.chain = chain_models
            chain.is_active = True
            db.commit()
            logger.info(f"🔄 Updated AI Flow chain for 'memory': {' → '.join(chain_models)}")

        # =====================================================================
        # Summary
        # =====================================================================
        total_models = db.query(AIModel).count()
        ollama_models = db.query(AIModel).filter(AIModel.provider == "ollama").count()
        chains = db.query(AIFlowChain).count()

        logger.info(f"📊 Summary:")
        logger.info(f"   Models: {total_models} total, {ollama_models} Ollama")
        logger.info(f"   Chains: {chains} total")
        logger.info(f"   Memory chain: Qwen2.5 32B (Ollama)" + (f" → Claude Haiku (fallback)" if haiku_model else ""))
        logger.info("🎉 Continuous RAG Evolution seed completed!")

    except Exception as e:
        logger.error(f"❌ Error during seed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_continuous_rag()
