"""
Seed AI Flow Chains - Preset: Nave (Maximum Quality)
Configure Ollama models for maximum output quality and create quality-first
AI Flow chains for all 8 usage types.

Preset: NAVE - Maximum quality, local-only Ollama models, unlimited time.
Uses 14B models as primary (sweet spot for 12GB VRAM), lower temperature
for precision, 16K context window, 1024 batch size, 30m keep_alive.

Hardware target: 32GB RAM + 12GB VRAM (NVIDIA GPU)

Strategy per operation (quality-optimized):
- interview:           Qwen3 14B → Gemma3 12B
- prompt_generation:   Qwen3 14B → Gemma3 12B
- task_execution:      Qwen2.5-Coder 14B → Qwen3 14B → Gemma3 12B
- commit_generation:   Gemma3 12B → Qwen3 14B
- pattern_discovery:   DeepSeek-R1 14B → Qwen3 14B
- memory:              Qwen3 14B → Gemma3 12B → DeepSeek-R1 14B
- queue_orchestration: Qwen3 14B → Gemma3 12B
- general:             Qwen3 14B → Gemma3 12B → DeepSeek-R1 14B

Recommended Ollama environment for Nave profile:
  OLLAMA_NUM_PARALLEL=1
  OLLAMA_FLASH_ATTENTION=1
  OLLAMA_KV_CACHE_TYPE=q8_0

Usage:
    python scripts/seed_nave_profile.py
"""

import sys
from datetime import datetime
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
# Nave model configs - quality-optimized for 12GB VRAM
# Lower temperature for precision, 16K context, 1024 batch, 30m keep_alive
# ============================================================================
NAVE_MODEL_CONFIGS = {
    "qwen3:14b": {
        "max_tokens": 16384,
        "temperature": 0.5,
        "top_p": 0.9,
        "top_k": 40,
        "context_length": 16384,
        "num_batch": 1024,
        "keep_alive": "30m",
    },
    "gemma3:12b": {
        "max_tokens": 8192,
        "temperature": 0.5,
        "top_p": 0.9,
        "top_k": 40,
        "context_length": 16384,
        "num_batch": 1024,
        "keep_alive": "30m",
    },
    "deepseek-r1:14b": {
        "max_tokens": 8192,
        "temperature": 0.6,
        "top_p": 0.9,
        "top_k": 50,
        "context_length": 16384,
        "num_batch": 1024,
        "keep_alive": "30m",
    },
    "qwen2.5-coder:14b": {
        "max_tokens": 8192,
        "temperature": 0.3,
        "top_p": 0.9,
        "top_k": 40,
        "context_length": 16384,
        "num_batch": 1024,
        "keep_alive": "30m",
    },
}

# Models to register if not in DB
NAVE_NEW_MODELS = {
    "qwen3:14b": {
        "name": "Qwen3 14B (Ollama - Nave)",
        "usage_type": AIModelUsageType.GENERAL,
    },
    "qwen2.5-coder:14b": {
        "name": "Qwen2.5 Coder 14B (Ollama - Nave)",
        "usage_type": AIModelUsageType.TASK_EXECUTION,
    },
}


# ============================================================================
# Chain strategy per usage_type (quality-first)
# ============================================================================
NAVE_CHAIN_STRATEGY = {
    # Interview: best reasoning model first
    "interview": [
        ("qwen3:14b", None),
        ("gemma3:12b", None),
    ],
    # Prompt generation: verbose + detailed output
    "prompt_generation": [
        ("qwen3:14b", None),
        ("gemma3:12b", None),
    ],
    # Task execution: code-specialized primary
    "task_execution": [
        ("qwen2.5-coder:14b", None),
        ("qwen3:14b", None),
        ("gemma3:12b", None),
    ],
    # Commit generation: concise + quality
    "commit_generation": [
        ("gemma3:12b", None),
        ("qwen3:14b", None),
    ],
    # Pattern discovery: chain-of-thought reasoning
    "pattern_discovery": [
        ("deepseek-r1:14b", None),
        ("qwen3:14b", None),
    ],
    # Memory / Continuous RAG: best extraction quality
    "memory": [
        ("qwen3:14b", None),
        ("gemma3:12b", None),
        ("deepseek-r1:14b", None),
    ],
    # Queue orchestration: quality batch processing
    "queue_orchestration": [
        ("qwen3:14b", None),
        ("gemma3:12b", None),
    ],
    # General: quality-first fallback
    "general": [
        ("qwen3:14b", None),
        ("gemma3:12b", None),
        ("deepseek-r1:14b", None),
    ],
}


# ============================================================================
# Utility nodes - Nave profile: quality-focused
# RAG Context + Timeout 600s + Validator (retry) + Retry 3x
# No cost_guard (local = free), no rate_limiter (NUM_PARALLEL=1 handles it)
# ============================================================================
PRE_Y = -20
POST_Y = 320
X_START = 170
X_STEP = 250


def _build_nave_utility_nodes(usage_key: str) -> list:
    """Build Nave utility nodes optimized for maximum quality."""

    # Base template: RAG + Timeout + Validator + Retry
    base_id = hash(usage_key) % 10000000

    # Validator type: JSON for extraction tasks, not_empty for others
    json_ops = {"pattern_discovery", "memory"}
    validator_type = "json" if usage_key in json_ops else "not_empty"

    return [
        # PRE-PROCESS (above chain)
        {
            "id": f"rag_context-nave-{base_id + 1}",
            "type": "rag_context",
            "label": "RAG Context",
            "enabled": True,
            "config": {
                "max_results": 5,
                "similarity_threshold": 0.7,
                "include_metadata": True,
            },
            "position": {"x": X_START, "y": PRE_Y},
        },
        {
            "id": f"timeout-nave-{base_id + 2}",
            "type": "timeout",
            "label": "Timeout",
            "enabled": True,
            "config": {"timeout_seconds": 600},
            "position": {"x": X_START + X_STEP, "y": PRE_Y},
        },
        # POST-PROCESS (below chain)
        {
            "id": f"validator-nave-{base_id + 3}",
            "type": "validator",
            "label": "Validator",
            "enabled": True,
            "config": {
                "validation_type": validator_type,
                "retry_on_fail": True,
            },
            "position": {"x": X_START, "y": POST_Y},
        },
        {
            "id": f"retry-nave-{base_id + 4}",
            "type": "retry",
            "label": "Retry",
            "enabled": True,
            "config": {
                "max_retries": 3,
                "backoff_base_ms": 3000,
                "backoff_multiplier": 2.0,
                "retry_on": ["timeout", "server_error"],
            },
            "position": {"x": X_START + X_STEP, "y": POST_Y},
        },
    ]


# ============================================================================
# Node positions for Nave layout
# ============================================================================
NAVE_POSITIONS = {
    "interview": {
        "fixed": {
            "start": {"x": 0, "y": -120},
            "error": {"x": 1420, "y": -40},
            "response": {"x": 1800, "y": 220},
        },
        "models": [
            {"x": 640, "y": -40},
            {"x": 1000, "y": -40},
        ],
    },
    "prompt_generation": {
        "fixed": {
            "start": {"x": 40, "y": -120},
            "error": {"x": 1580, "y": 20},
            "response": {"x": 1640, "y": 360},
        },
        "models": [
            {"x": 700, "y": 20},
            {"x": 1080, "y": 20},
        ],
    },
    "task_execution": {
        "fixed": {
            "start": {"x": -20, "y": -180},
            "error": {"x": 1980, "y": -40},
            "response": {"x": 2140, "y": 340},
        },
        "models": [
            {"x": 700, "y": 20},
            {"x": 1080, "y": 20},
            {"x": 1460, "y": 20},
        ],
    },
    "commit_generation": {
        "fixed": {
            "start": {"x": 0, "y": -120},
            "error": {"x": 1520, "y": -20},
            "response": {"x": 1680, "y": 280},
        },
        "models": [
            {"x": 680, "y": -60},
            {"x": 1040, "y": 80},
        ],
    },
    "pattern_discovery": {
        "fixed": {
            "start": {"x": 50, "y": 150},
            "error": {"x": 1500, "y": -60},
            "response": {"x": 1880, "y": 360},
        },
        "models": [
            {"x": 700, "y": -40},
            {"x": 1040, "y": 0},
        ],
    },
    "memory": {
        "fixed": {
            "start": {"x": 50, "y": 150},
            "error": {"x": 2240, "y": 20},
            "response": {"x": 2560, "y": 340},
        },
        "models": [
            {"x": 960, "y": 0},
            {"x": 1310, "y": 130},
            {"x": 1610, "y": 130},
        ],
    },
    "queue_orchestration": {
        "fixed": {
            "start": {"x": 50, "y": 150},
            "error": {"x": 1500, "y": -60},
            "response": {"x": 1880, "y": 360},
        },
        "models": [
            {"x": 640, "y": -40},
            {"x": 1000, "y": -40},
        ],
    },
    "general": {
        "fixed": {
            "start": {"x": 50, "y": 150},
            "error": {"x": 2020, "y": 60},
            "response": {"x": 2720, "y": 480},
        },
        "models": [
            {"x": 780, "y": 130},
            {"x": 1080, "y": 130},
            {"x": 1460, "y": 120},
        ],
    },
}


def seed_nave_profile():
    logger.info("=" * 70)
    logger.info("Starting AI Flow Chains seed - NAVE (Maximum Quality) profile")
    logger.info("=" * 70)

    engine = create_engine(settings.database_url)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()

    try:
        # ==================================================================
        # Step 1: Register new models if not in DB
        # ==================================================================
        logger.info("\n[1/4] Registering Nave models...")

        registered_count = 0
        for model_id, model_info in NAVE_NEW_MODELS.items():
            # Check if model already exists by model_id in config
            existing = db.query(AIModel).filter(
                AIModel.provider == "ollama",
            ).all()

            found = False
            for m in existing:
                if (m.config or {}).get("model_id") == model_id:
                    found = True
                    logger.info(f"  Already exists: {m.name} ({model_id})")
                    break

            if not found:
                new_model = AIModel(
                    id=uuid4(),
                    name=model_info["name"],
                    provider="ollama",
                    api_key="",
                    config={
                        "model_id": model_id,
                        **NAVE_MODEL_CONFIGS[model_id],
                    },
                    usage_type=model_info["usage_type"],
                    is_active=True,
                )
                db.add(new_model)
                registered_count += 1
                logger.info(f"  Registered: {model_info['name']} ({model_id})")

        db.commit()
        logger.info(f"  {registered_count} new models registered.")

        # ==================================================================
        # Step 2: Update all Ollama models with Nave configs
        # ==================================================================
        logger.info("\n[2/4] Updating Ollama models with Nave quality configs...")

        ollama_models = db.query(AIModel).filter(AIModel.provider == "ollama").all()
        updated_count = 0

        for model in ollama_models:
            model_id = (model.config or {}).get("model_id", "")
            if model_id in NAVE_MODEL_CONFIGS:
                new_config = dict(model.config or {})
                new_config["model_id"] = model_id
                new_config.update(NAVE_MODEL_CONFIGS[model_id])
                model.config = new_config
                model.is_active = True
                updated_count += 1
                logger.info(
                    f"  Updated: {model.name} "
                    f"(temp={new_config['temperature']}, "
                    f"ctx={new_config['context_length']}, "
                    f"batch={new_config['num_batch']}, "
                    f"keep_alive={new_config['keep_alive']})"
                )

        db.commit()
        logger.info(f"  {updated_count} Ollama models updated with Nave configs.")

        # ==================================================================
        # Step 3: Build model UUID lookup
        # ==================================================================
        logger.info("\n[3/4] Building model lookup...")

        all_models = db.query(AIModel).filter(AIModel.is_active == True).all()

        ollama_lookup = {}
        for m in all_models:
            if m.provider == "ollama":
                mid = (m.config or {}).get("model_id", "")
                ollama_lookup[mid] = str(m.id)

        logger.info(f"  Ollama models available: {list(ollama_lookup.keys())}")

        # ==================================================================
        # Step 4: Create/update AI Flow chains
        # ==================================================================
        logger.info("\n[4/4] Creating Nave AI Flow chains...")

        usage_type_map = {
            "interview": AIModelUsageType.INTERVIEW,
            "prompt_generation": AIModelUsageType.PROMPT_GENERATION,
            "task_execution": AIModelUsageType.TASK_EXECUTION,
            "commit_generation": AIModelUsageType.COMMIT_GENERATION,
            "pattern_discovery": AIModelUsageType.PATTERN_DISCOVERY,
            "memory": AIModelUsageType.MEMORY,
            "queue_orchestration": AIModelUsageType.QUEUE_ORCHESTRATION,
            "general": AIModelUsageType.GENERAL,
        }

        chains_created = 0
        chains_updated = 0

        for usage_key, strategy in NAVE_CHAIN_STRATEGY.items():
            usage_type = usage_type_map[usage_key]

            # Resolve model IDs
            chain_ids = []
            chain_names = []
            for ollama_tag, _ in strategy:
                model_uuid = ollama_lookup.get(ollama_tag)
                if model_uuid:
                    chain_ids.append(model_uuid)
                    chain_names.append(ollama_tag)
                else:
                    logger.warning(f"    Model {ollama_tag} not found (not downloaded or inactive?)")

            if not chain_ids:
                logger.warning(f"  Skipping {usage_key}: no models resolved")
                continue

            # Build positions
            layout = NAVE_POSITIONS.get(usage_key, {})
            positions = dict(layout.get("fixed", {}))
            model_positions = layout.get("models", [])
            for i, mid in enumerate(chain_ids):
                if i < len(model_positions):
                    positions[f"model-{mid}"] = model_positions[i]
                else:
                    positions[f"model-{mid}"] = {"x": 700 + 300 * i, "y": 0}

            # Build utility nodes
            utility_nodes = _build_nave_utility_nodes(usage_key)
            node_types = [n["type"] for n in utility_nodes]

            # Add utility node positions
            for unode in utility_nodes:
                if unode.get("position"):
                    positions[unode["id"]] = unode["position"]

            # Upsert chain
            existing = db.query(AIFlowChain).filter(
                AIFlowChain.usage_type == usage_type
            ).first()

            if existing:
                existing.chain = chain_ids
                existing.node_positions = positions
                existing.utility_nodes = utility_nodes
                existing.is_active = True
                existing.updated_at = datetime.utcnow()
                chains_updated += 1
                action = "Updated"
            else:
                new_chain = AIFlowChain(
                    id=uuid4(),
                    usage_type=usage_type,
                    chain=chain_ids,
                    node_positions=positions,
                    utility_nodes=utility_nodes,
                    is_active=True,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                )
                db.add(new_chain)
                chains_created += 1
                action = "Created"

            logger.info(f"  {action} chain: {usage_key} = {' -> '.join(chain_names)} + nodes: {node_types}")

        db.commit()

        # ==================================================================
        # Summary
        # ==================================================================
        logger.info("\n" + "=" * 70)
        logger.info("NAVE PROFILE SEED COMPLETE")
        logger.info("=" * 70)
        logger.info(f"  New models registered: {registered_count}")
        logger.info(f"  Ollama models updated: {updated_count}")
        logger.info(f"  Chains created: {chains_created}")
        logger.info(f"  Chains updated: {chains_updated}")
        logger.info(f"  Total chains: {chains_created + chains_updated}")
        logger.info("")
        logger.info("  HARDWARE OPTIMIZATION TIPS:")
        logger.info("  Set these in your .env:")
        logger.info("    OLLAMA_NUM_PARALLEL=1        # All GPU for one request")
        logger.info("    OLLAMA_FLASH_ATTENTION=1     # Faster attention computation")
        logger.info("    OLLAMA_KV_CACHE_TYPE=q8_0    # 50% less VRAM for KV cache")
        logger.info("=" * 70)

    except Exception as e:
        logger.error(f"Error during Nave seed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_nave_profile()
