"""
Seed Optimized AI Flow - Hardware-Aware Configuration
=====================================================
PROMPT #227 + PROMPT #228

Configures ORBIT's AI Flow chains optimized for:
  - i9 CPU + 32GB RAM + 12GB VRAM (NVIDIA)
  - Ollama running natively on Windows (direct GPU access)
  - ORBIT running on WSL2

Models selected based on real benchmarks:
  - qwen3:8b    → 46.5 tok/s (100% GPU, 5.2GB) → Fast tasks + extraction
  - qwen3:14b   → 27.6 tok/s (100% GPU, 9.3GB) → Quality tasks + enrichment
  - qwen2.5-coder:14b → ~25 tok/s (100% GPU, 9GB) → Code tasks
  - nomic-embed-text → instant (0.3GB) → RAG embeddings

Strategy per operation (PROMPT #228 - dual-model for quality+speed):
  - interview:           qwen3:8b (fast, conversational)
  - prompt_generation:   qwen3:14b (quality reasoning)
  - task_execution:      qwen2.5-coder:14b → qwen3:14b (code specialist + fallback)
  - commit_generation:   qwen3:8b (fast, simple output)
  - pattern_discovery:   qwen3:14b → qwen3:8b (analysis + fast fallback)
  - memory:              qwen3:8b → qwen3:14b (fast extraction + quality fallback)
  - queue_orchestration: qwen3:8b (fast routing)
  - general:             qwen3:14b → qwen3:8b (quality + fast fallback)

Usage:
    cd /home/igorhaf/orbit/backend
    poetry run python scripts/seed_optimized_flow.py
"""

import sys
import random
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models.ai_model import AIModel, AIModelUsageType
from app.models.ai_flow_chain import AIFlowChain

import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============================================================================
# Model definitions - optimized for 12GB VRAM
# ============================================================================
MODELS = {
    "qwen3:8b": {
        "name": "Qwen3 8B (Fast)",
        "usage_type": AIModelUsageType.INTERVIEW,
        "max_concurrent": 2,  # PROMPT #228 - 5.2GB fits 2 parallel in 12GB VRAM
        "config": {
            "model_id": "qwen3:8b",
            "max_tokens": 8192,
            "temperature": 0.6,
            "top_p": 0.9,
            "top_k": 40,
            "context_length": 32768,
            "keep_alive": "15m",
        },
    },
    "qwen3:14b": {
        "name": "Qwen3 14B (Quality)",
        "usage_type": AIModelUsageType.GENERAL,
        "config": {
            "model_id": "qwen3:14b",
            "max_tokens": 16384,
            "temperature": 0.5,
            "top_p": 0.9,
            "top_k": 40,
            "context_length": 32768,
            "keep_alive": "30m",
        },
    },
    "qwen2.5-coder:14b": {
        "name": "Qwen2.5 Coder 14B (Code)",
        "usage_type": AIModelUsageType.TASK_EXECUTION,
        "config": {
            "model_id": "qwen2.5-coder:14b",
            "max_tokens": 8192,
            "temperature": 0.3,
            "top_p": 0.9,
            "top_k": 40,
            "context_length": 32768,
            "keep_alive": "30m",
        },
    },
    "nomic-embed-text": {
        "name": "Nomic Embed Text (RAG)",
        "usage_type": AIModelUsageType.GENERAL,
        "config": {
            "model_id": "nomic-embed-text",
            "max_tokens": 512,
            "temperature": 0.0,
            "context_length": 8192,
        },
    },
}

# ============================================================================
# Flow chains - optimized per operation
# ============================================================================
# Pipeline layout constants (MUST match frontend page.tsx buildFlowFromChain)
START_X = 50
MAIN_Y = 150
MODEL_SPACING_X = 300
UTILITY_SPACING_X = 230
ERROR_Y_OFFSET = 200


def _uid():
    return f"{random.randint(1000000, 9999999)}"


def build_utility_nodes():
    """Standard utility nodes for all chains."""
    uid_rag = _uid()
    uid_timeout = _uid()
    uid_validator = _uid()
    uid_retry = _uid()
    return [
        {
            "id": f"rag_context-opt-{uid_rag}",
            "type": "rag_context",
            "label": "RAG Context",
            "enabled": True,
            "config": {
                "max_results": 5,
                "similarity_threshold": 0.7,
                "include_metadata": True,
            },
        },
        {
            "id": f"timeout-opt-{uid_timeout}",
            "type": "timeout",
            "label": "Timeout",
            "enabled": True,
            "config": {"timeout_seconds": 300},
        },
        {
            "id": f"validator-opt-{uid_validator}",
            "type": "validator",
            "label": "Validator",
            "enabled": True,
            "config": {"validation_type": "not_empty", "retry_on_fail": True},
        },
        {
            "id": f"retry-opt-{uid_retry}",
            "type": "retry",
            "label": "Retry",
            "enabled": True,
            "config": {
                "max_retries": 2,
                "backoff_base_ms": 2000,
                "backoff_multiplier": 2.0,
                "retry_on": ["timeout", "server_error"],
            },
        },
    ]


def build_positions(model_ids, utility_nodes):
    """
    Build aligned node positions matching frontend buildFlowFromChain() exactly.

    The frontend algorithm (page.tsx lines 1331-1469):
    1. Start at (START_X, MAIN_Y), cursorX += UTILITY_SPACING_X if pre-nodes else MODEL_SPACING_X
    2. Pre-process nodes at (cursorX, MAIN_Y - 10), cursorX += UTILITY_SPACING_X each
    3. Gap +40 between pre-process and models
    4. Model nodes at (cursorX, MAIN_Y - 20), cursorX += MODEL_SPACING_X each
    5. Gap +40 between models and post-process
    6. Post-process nodes at (cursorX, MAIN_Y - 10), cursorX += UTILITY_SPACING_X each
    7. Response at (cursorX, MAIN_Y)
    8. Error at (lastModelX, MAIN_Y + ERROR_Y_OFFSET)

    We set node_positions to None so the frontend uses its own defaults.
    This ensures perfect alignment regardless of any future frontend changes.
    """
    # Return None - let the frontend calculate positions dynamically
    # This is the most robust approach since the frontend has the exact algorithm
    return None


# Chain definitions per usage_type
# Format: { usage_type: [model_id_keys] }
CHAIN_DEFINITIONS = {
    AIModelUsageType.INTERVIEW: ["qwen3:8b"],
    AIModelUsageType.PROMPT_GENERATION: ["qwen3:14b"],
    AIModelUsageType.TASK_EXECUTION: ["qwen2.5-coder:14b", "qwen3:14b"],
    AIModelUsageType.COMMIT_GENERATION: ["qwen3:8b"],
    AIModelUsageType.PATTERN_DISCOVERY: ["qwen3:14b", "qwen3:8b"],
    AIModelUsageType.MEMORY: ["qwen3:8b", "qwen3:14b"],  # PROMPT #228 - fast extraction + quality fallback
    AIModelUsageType.QUEUE_ORCHESTRATION: ["qwen3:8b"],
    AIModelUsageType.GENERAL: ["qwen3:14b", "qwen3:8b"],
}


def seed():
    engine = create_engine(str(settings.database_url))
    Session = sessionmaker(bind=engine)
    db = Session()

    try:
        logger.info("=" * 70)
        logger.info("SEED OPTIMIZED AI FLOW - PROMPT #227 + #228")
        logger.info("Hardware: i9 + 32GB RAM + 12GB VRAM")
        logger.info("=" * 70)

        # =================================================================
        # Phase 1: Clean up old Ollama models from DB
        # =================================================================
        logger.info("\n[1/4] Cleaning old Ollama models...")
        old_ollama = db.query(AIModel).filter(AIModel.provider == "ollama").all()
        removed = 0
        for m in old_ollama:
            model_id = (m.config or {}).get("model_id", "")
            if model_id not in MODELS:
                logger.info(f"  Removing: {m.name} ({model_id})")
                db.delete(m)
                removed += 1
        db.flush()
        logger.info(f"  {removed} old models removed.")

        # =================================================================
        # Phase 2: Register new models
        # =================================================================
        logger.info("\n[2/4] Registering optimized models...")
        model_id_map = {}  # model_id_key -> UUID

        for model_key, model_def in MODELS.items():
            existing = (
                db.query(AIModel)
                .filter(AIModel.provider == "ollama")
                .all()
            )
            found = None
            for m in existing:
                if (m.config or {}).get("model_id") == model_key:
                    found = m
                    break

            max_concurrent = model_def.get("max_concurrent", 1)

            if found:
                # Update config
                found.name = model_def["name"]
                found.config = model_def["config"]
                found.is_active = True
                found.usage_type = model_def["usage_type"]
                found.max_concurrent_requests = max_concurrent
                model_id_map[model_key] = str(found.id)
                logger.info(f"  Updated: {model_def['name']} ({model_key}) [max_concurrent={max_concurrent}]")
            else:
                new_model = AIModel(
                    id=uuid4(),
                    name=model_def["name"],
                    provider="ollama",
                    api_key="not-needed-local",
                    usage_type=model_def["usage_type"],
                    is_active=True,
                    config=model_def["config"],
                    timeout_seconds=300,
                    rate_limit_requests=100,
                    rate_limit_window_seconds=60,
                    max_concurrent_requests=max_concurrent,
                )
                db.add(new_model)
                db.flush()
                model_id_map[model_key] = str(new_model.id)
                logger.info(f"  Created: {model_def['name']} ({model_key})")

        logger.info(f"  Model ID map: {model_id_map}")

        # =================================================================
        # Phase 3: Create optimized AI Flow chains
        # =================================================================
        logger.info("\n[3/4] Creating optimized AI Flow chains...")
        chains_created = 0
        chains_updated = 0

        for usage_type, model_keys in CHAIN_DEFINITIONS.items():
            chain_uuids = []
            skip = False
            for mk in model_keys:
                if mk not in model_id_map:
                    logger.warning(f"  Model {mk} not found, skipping {usage_type}")
                    skip = True
                    break
                chain_uuids.append(model_id_map[mk])

            if skip:
                continue

            utility_nodes = build_utility_nodes()

            # Override validator type for pattern_discovery and memory (expect JSON)
            if usage_type in (AIModelUsageType.PATTERN_DISCOVERY, AIModelUsageType.MEMORY):
                for node in utility_nodes:
                    if node["type"] == "validator":
                        node["config"]["validation_type"] = "json"

            # Let frontend calculate positions dynamically (most robust)
            node_positions = build_positions(chain_uuids, utility_nodes)

            existing_chain = (
                db.query(AIFlowChain)
                .filter(AIFlowChain.usage_type == usage_type)
                .first()
            )

            if existing_chain:
                existing_chain.chain = chain_uuids
                existing_chain.utility_nodes = utility_nodes
                existing_chain.node_positions = node_positions
                existing_chain.is_active = True
                existing_chain.updated_at = datetime.now(timezone.utc)
                chains_updated += 1
                logger.info(f"  Updated: {usage_type.value} = {' → '.join(model_keys)}")
            else:
                new_chain = AIFlowChain(
                    id=uuid4(),
                    usage_type=usage_type,
                    chain=chain_uuids,
                    utility_nodes=utility_nodes,
                    node_positions=node_positions,
                    is_active=True,
                    created_at=datetime.now(timezone.utc),
                    updated_at=datetime.now(timezone.utc),
                )
                db.add(new_chain)
                chains_created += 1
                logger.info(f"  Created: {usage_type.value} = {' → '.join(model_keys)}")

        # =================================================================
        # Phase 4: Deactivate cloud models not in use (keep for future)
        # =================================================================
        logger.info("\n[4/4] Deactivating unused cloud models...")
        cloud_models = (
            db.query(AIModel)
            .filter(AIModel.provider != "ollama")
            .all()
        )
        deactivated = 0
        for m in cloud_models:
            if m.is_active:
                m.is_active = False
                deactivated += 1
                logger.info(f"  Deactivated: {m.name}")
        logger.info(f"  {deactivated} cloud models deactivated (kept for future use).")

        db.commit()

        # =================================================================
        # Summary
        # =================================================================
        total_models = db.query(AIModel).filter(AIModel.is_active == True).count()
        total_chains = db.query(AIFlowChain).filter(AIFlowChain.is_active == True).count()

        logger.info("\n" + "=" * 70)
        logger.info("SEED COMPLETE")
        logger.info("=" * 70)
        logger.info(f"  Models removed: {removed}")
        logger.info(f"  Models registered: {len(model_id_map)}")
        logger.info(f"  Active models: {total_models}")
        logger.info(f"  Chains created: {chains_created}")
        logger.info(f"  Chains updated: {chains_updated}")
        logger.info(f"  Total active chains: {total_chains}")
        logger.info(f"  Cloud models deactivated: {deactivated}")
        logger.info("")
        logger.info("  PERFORMANCE BENCHMARKS (real, measured):")
        logger.info("    qwen3:8b          → 46.5 tok/s (100% GPU, 5.2GB)")
        logger.info("    qwen3:14b         → 27.6 tok/s (100% GPU, 9.3GB)")
        logger.info("    qwen2.5-coder:14b → ~25  tok/s (100% GPU, 9.0GB)")
        logger.info("    nomic-embed-text  → instant     (100% GPU, 0.3GB)")
        logger.info("")
        logger.info("  RECOMMENDED OLLAMA ENV (Windows):")
        logger.info("    OLLAMA_NUM_PARALLEL=2")
        logger.info("    OLLAMA_FLASH_ATTENTION=1")
        logger.info("    OLLAMA_KV_CACHE_TYPE=q8_0")
        logger.info("=" * 70)

    except Exception as e:
        db.rollback()
        logger.error(f"Error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
