"""
Seed AI Flow Chains - PROMPT #220
Configure all Ollama models with top_p/top_k and create optimal AI Flow chains
for all 8 usage types with performance utility nodes.

Strategy per operation:
- interview:           Gemma3 12B (quality) → Qwen3 14B (speed) → Claude Haiku
- prompt_generation:   Qwen3 14B (verbose, creative) → Gemma3 12B → GPT-4 Turbo
- task_execution:      Qwen3 14B (fast tok/s) → Gemma3 12B → Claude Haiku
- commit_generation:   Gemma3 12B (concise output) → Qwen3 14B → Gemini Flash
- pattern_discovery:   DeepSeek-R1 14B (reasoning) → Gemma3 12B → Gemini 2.0 Flash
- memory:              Gemma3 12B (best rules, fast) → Qwen3 14B → DeepSeek-R1
- queue_orchestration: Qwen3 14B (fastest tok/s) → Gemma3 12B → Phi-4
- general:             Gemma3 12B (best overall) → Qwen3 14B → DeepSeek-R1

Utility nodes per chain:
- Cache: exact match, 24h TTL (instant response on cache hit)
- Timeout: 300s GPU (prevents hanging)
- Validator: JSON validation (ensures valid output)

Usage:
    docker exec -w /app orbit-backend python scripts/seed_ai_flow_chains.py
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
# Optimal configs per model (based on PROMPT #219 benchmark + official docs)
# ============================================================================
OLLAMA_MODEL_CONFIGS = {
    "gemma3:12b": {
        "max_tokens": 8192,
        "temperature": 0.7,
        "top_p": 0.9,
        "top_k": 40,
        "context_length": 128000,
    },
    "qwen3:14b": {
        "max_tokens": 32768,
        "temperature": 0.7,
        "top_p": 0.8,
        "top_k": 20,
        "context_length": 131072,
    },
    "deepseek-r1:14b": {
        "max_tokens": 8192,
        "temperature": 0.6,
        "top_p": 0.9,
        "top_k": 50,
        "context_length": 65536,
    },
    "phi4:14b": {
        "max_tokens": 16384,
        "temperature": 0.7,
        "top_p": 0.9,
        "top_k": 40,
        "context_length": 16384,
    },
    "codestral:22b": {
        "max_tokens": 8192,
        "temperature": 0.2,
        "top_p": 0.9,
        "top_k": 40,
        "context_length": 32768,
    },
    "deepseek-coder-v2:16b": {
        "max_tokens": 8192,
        "temperature": 0.3,
        "top_p": 0.9,
        "top_k": 40,
        "context_length": 131072,
    },
    "qwen2.5:32b": {
        "max_tokens": 8192,
        "temperature": 0.7,
        "top_p": 0.8,
        "top_k": 20,
        "context_length": 131072,
    },
}


# ============================================================================
# Chain strategy per usage_type
# Each entry: list of (ollama_model_tag, cloud_model_name_substring)
# Ollama models first (free, local), cloud models as fallback
# ============================================================================
CHAIN_STRATEGY = {
    # Interview: needs quality rule understanding + good Portuguese
    # Gemma3 (best quality, 9 rules, 5 entities) → Qwen3 (fast) → Claude Haiku (cloud fallback)
    "interview": [
        ("gemma3:12b", None),
        ("qwen3:14b", None),
        (None, "Claude Haiku"),
    ],
    # Prompt generation: needs creativity + verbose output
    # Qwen3 (most verbose, 1279 tokens output) → Gemma3 → GPT-4 Turbo (cloud)
    "prompt_generation": [
        ("qwen3:14b", None),
        ("gemma3:12b", None),
        (None, "GPT-4 Turbo"),
    ],
    # Task execution: needs speed + code understanding
    # Qwen3 (31.9 tok/s fastest) → Gemma3 (25 tok/s) → Claude Haiku (cloud)
    "task_execution": [
        ("qwen3:14b", None),
        ("gemma3:12b", None),
        (None, "Claude Haiku"),
    ],
    # Commit generation: needs concise output
    # Gemma3 (concise 737 tokens) → Qwen3 → Gemini Flash (cloud, cheap)
    "commit_generation": [
        ("gemma3:12b", None),
        ("qwen3:14b", None),
        (None, "Gemini 1.5 Flash"),
    ],
    # Pattern discovery: needs reasoning + deep analysis
    # DeepSeek-R1 (chain of thought reasoning) → Gemma3 → Gemini 2.0 Flash (cloud)
    "pattern_discovery": [
        ("deepseek-r1:14b", None),
        ("gemma3:12b", None),
        (None, "Gemini 2.0 Flash"),
    ],
    # Memory / Continuous RAG: needs quality extraction (benchmark winner)
    # Gemma3 (9 rules, 25 tok/s, best quality) → Qwen3 → DeepSeek-R1
    "memory": [
        ("gemma3:12b", None),
        ("qwen3:14b", None),
        ("deepseek-r1:14b", None),
    ],
    # Queue orchestration: needs speed for batch processing
    # Qwen3 (fastest tok/s) → Gemma3 → Phi-4 (good quality backup)
    "queue_orchestration": [
        ("qwen3:14b", None),
        ("gemma3:12b", None),
        ("phi4:14b", None),
    ],
    # General fallback: best overall balance
    # Gemma3 (best overall in benchmark) → Qwen3 → DeepSeek-R1
    "general": [
        ("gemma3:12b", None),
        ("qwen3:14b", None),
        ("deepseek-r1:14b", None),
    ],
}


# ============================================================================
# Utility nodes per usage_type for maximum performance
# Cache: avoids repeated API calls (instant on hit)
# Timeout: prevents hanging requests
# Validator: ensures valid JSON output
# ============================================================================
def _build_utility_nodes(usage_key: str) -> list:
    """Build utility nodes optimized for each operation type."""

    # Base nodes that every chain gets
    cache_node = {
        "id": "cache-1",
        "type": "cache",
        "label": "Cache",
        "enabled": True,
        "config": {
            "ttl_seconds": 86400,  # 24h
            "cache_level": "exact",
            "enabled": True,
        },
        "position": {"x": 100, "y": 50},
    }

    timeout_node = {
        "id": "timeout-1",
        "type": "timeout",
        "label": "Timeout",
        "enabled": True,
        "config": {
            "timeout_seconds": 300,  # 5 min (GPU RTX 4080 is fast)
        },
        "position": {"x": 100, "y": 350},
    }

    validator_json_node = {
        "id": "validator-1",
        "type": "validator",
        "label": "JSON Validator",
        "enabled": True,
        "config": {
            "validation_type": "json",
            "retry_on_fail": False,  # Don't retry - fallback to next model instead
        },
        "position": {"x": 100, "y": 500},
    }

    validator_notempty_node = {
        "id": "validator-1",
        "type": "validator",
        "label": "Not Empty",
        "enabled": True,
        "config": {
            "validation_type": "not_empty",
            "retry_on_fail": False,
        },
        "position": {"x": 100, "y": 500},
    }

    # Per-operation customization
    configs = {
        # Interview: cache questions (same project = same questions),
        # no JSON validation (output is natural language)
        "interview": [cache_node, timeout_node, validator_notempty_node],

        # Prompt generation: cache generated prompts, validate not empty
        "prompt_generation": [cache_node, timeout_node, validator_notempty_node],

        # Task execution: cache code output, validate not empty
        "task_execution": [cache_node, timeout_node, validator_notempty_node],

        # Commit generation: short output, fast timeout
        "commit_generation": [
            cache_node,
            {**timeout_node, "config": {"timeout_seconds": 120}},  # 2 min (commits are short)
            validator_notempty_node,
        ],

        # Pattern discovery: long analysis, extended timeout
        "pattern_discovery": [
            cache_node,
            {**timeout_node, "config": {"timeout_seconds": 600}},  # 10 min (deep reasoning)
            validator_json_node,
        ],

        # Memory / RAG: JSON output required, standard timeout
        "memory": [cache_node, timeout_node, validator_json_node],

        # Queue orchestration: batch speed, shorter cache
        "queue_orchestration": [
            {**cache_node, "config": {**cache_node["config"], "ttl_seconds": 3600}},  # 1h cache
            timeout_node,
            validator_notempty_node,
        ],

        # General: balanced defaults
        "general": [cache_node, timeout_node, validator_notempty_node],
    }

    return configs.get(usage_key, [cache_node, timeout_node, validator_notempty_node])


def seed_ai_flow_chains():
    logger.info("Starting AI Flow Chains seed (PROMPT #220)...")

    engine = create_engine(settings.database_url)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()

    try:
        # ==================================================================
        # Step 1: Update all Ollama models with top_p / top_k parameters
        # ==================================================================
        logger.info("\n[1/3] Updating Ollama models with top_p/top_k configs...")

        ollama_models = db.query(AIModel).filter(AIModel.provider == "ollama").all()
        updated_count = 0

        for model in ollama_models:
            model_id = (model.config or {}).get("model_id", "")
            if model_id in OLLAMA_MODEL_CONFIGS:
                new_config = dict(model.config or {})
                new_config["model_id"] = model_id
                new_config.update(OLLAMA_MODEL_CONFIGS[model_id])
                model.config = new_config
                model.is_active = True
                updated_count += 1
                logger.info(f"  Updated: {model.name} (top_p={new_config['top_p']}, top_k={new_config['top_k']})")
            else:
                logger.warning(f"  Skipped: {model.name} (model_id={model_id} not in config map)")

        db.commit()
        logger.info(f"  {updated_count} Ollama models updated.")

        # ==================================================================
        # Step 2: Build model UUID lookup
        # ==================================================================
        logger.info("\n[2/3] Building model lookup...")

        # Refresh all models
        all_models = db.query(AIModel).filter(AIModel.is_active == True).all()

        # Build lookup: ollama model_id -> UUID
        ollama_lookup = {}
        for m in all_models:
            if m.provider == "ollama":
                mid = (m.config or {}).get("model_id", "")
                ollama_lookup[mid] = str(m.id)

        # Build lookup: cloud model name substring -> UUID
        cloud_lookup = {}
        for m in all_models:
            if m.provider != "ollama":
                cloud_lookup[m.name] = str(m.id)

        logger.info(f"  Ollama models: {list(ollama_lookup.keys())}")
        logger.info(f"  Cloud models: {list(cloud_lookup.keys())}")

        # ==================================================================
        # Step 3: Create/update AI Flow chains for all usage types
        # ==================================================================
        logger.info("\n[3/3] Creating AI Flow chains...")

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

        for usage_key, strategy in CHAIN_STRATEGY.items():
            usage_type = usage_type_map[usage_key]

            # Resolve model IDs for this chain
            chain_ids = []
            chain_names = []
            for ollama_tag, cloud_name_substr in strategy:
                if ollama_tag:
                    model_uuid = ollama_lookup.get(ollama_tag)
                    if model_uuid:
                        chain_ids.append(model_uuid)
                        chain_names.append(f"Ollama:{ollama_tag}")
                    else:
                        logger.warning(f"    Ollama model {ollama_tag} not found (inactive?)")
                elif cloud_name_substr:
                    # Find cloud model by name substring
                    found = False
                    for name, uid in cloud_lookup.items():
                        if cloud_name_substr in name:
                            chain_ids.append(uid)
                            chain_names.append(name)
                            found = True
                            break
                    if not found:
                        logger.warning(f"    Cloud model matching '{cloud_name_substr}' not found (inactive?)")

            if not chain_ids:
                logger.warning(f"  Skipping {usage_key}: no models resolved")
                continue

            # Calculate node positions for visual diagram
            # Start → Model1 → Model2 → Model3 → Error
            positions = {"start": {"x": 50, "y": 200}}
            for i, mid in enumerate(chain_ids):
                positions[mid] = {"x": 250 + (i * 250), "y": 200}
            positions["error"] = {"x": 250 + (len(chain_ids) * 250), "y": 200}

            # Build utility nodes for this operation
            utility_nodes = _build_utility_nodes(usage_key)
            node_types = [n["type"] for n in utility_nodes]

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

            logger.info(f"  {action} chain: {usage_key} = {' → '.join(chain_names)} + nodes: {node_types}")

        db.commit()

        # ==================================================================
        # Summary
        # ==================================================================
        logger.info("\n" + "=" * 70)
        logger.info("SEED COMPLETE")
        logger.info("=" * 70)
        logger.info(f"  Ollama models updated: {updated_count}")
        logger.info(f"  Chains created: {chains_created}")
        logger.info(f"  Chains updated: {chains_updated}")
        logger.info(f"  Total chains: {chains_created + chains_updated}")
        logger.info("=" * 70)

    except Exception as e:
        logger.error(f"Error during seed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_ai_flow_chains()
