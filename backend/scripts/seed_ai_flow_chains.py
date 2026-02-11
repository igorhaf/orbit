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
# Frontend layout: pre-process nodes above chain (y=-20), post-process below (y=320)
# Pre-process: cache, rag_context, prompt_transformer, router, rate_limiter, timeout
# Post-process: retry, validator, cost_guard
# Node positions: x = 170 + index * 250
# ============================================================================

# Pre-process node positions (above chain, y=-20)
PRE_Y = -20
# Post-process node positions (below chain, y=320)
POST_Y = 320
# X start offset
X_START = 170
X_STEP = 250


def _build_utility_nodes(usage_key: str) -> list:
    """Build utility nodes optimized for each operation type.

    Each operation gets a curated set of nodes based on its needs:
    - Speed-critical ops: cache + timeout + rate_limiter
    - Quality-critical ops: cache + timeout + validator + retry
    - Batch ops: cache + timeout + rate_limiter + validator
    - RAG ops: cache + rag_context + timeout + validator
    """

    configs = {
        # ----------------------------------------------------------------
        # Interview: quality matters, cache repeated project questions
        # Cache (pre) + Timeout (pre) + Validator (post) + Retry (post)
        # ----------------------------------------------------------------
        "interview": [
            # PRE-PROCESS (above chain)
            {
                "id": "cache-1707000001",
                "type": "cache",
                "label": "Cache",
                "enabled": True,
                "config": {
                    "ttl_seconds": 86400,
                    "cache_level": "exact",
                    "enabled": True,
                },
                "position": {"x": X_START, "y": PRE_Y},
            },
            {
                "id": "timeout-1707000002",
                "type": "timeout",
                "label": "Timeout",
                "enabled": True,
                "config": {"timeout_seconds": 300},
                "position": {"x": X_START + X_STEP, "y": PRE_Y},
            },
            # POST-PROCESS (below chain)
            {
                "id": "validator-1707000003",
                "type": "validator",
                "label": "Validator",
                "enabled": True,
                "config": {
                    "validation_type": "not_empty",
                    "retry_on_fail": True,
                },
                "position": {"x": X_START, "y": POST_Y},
            },
            {
                "id": "retry-1707000004",
                "type": "retry",
                "label": "Retry",
                "enabled": True,
                "config": {
                    "max_retries": 2,
                    "backoff_base_ms": 2000,
                    "backoff_multiplier": 2.0,
                    "retry_on": ["timeout", "server_error"],
                },
                "position": {"x": X_START + X_STEP, "y": POST_Y},
            },
        ],
        # ----------------------------------------------------------------
        # Prompt generation: creative + verbose, cache heavily
        # Cache (pre) + Timeout (pre) + Validator (post)
        # ----------------------------------------------------------------
        "prompt_generation": [
            {
                "id": "cache-1707100001",
                "type": "cache",
                "label": "Cache",
                "enabled": True,
                "config": {
                    "ttl_seconds": 86400,
                    "cache_level": "exact",
                    "enabled": True,
                },
                "position": {"x": X_START, "y": PRE_Y},
            },
            {
                "id": "timeout-1707100002",
                "type": "timeout",
                "label": "Timeout",
                "enabled": True,
                "config": {"timeout_seconds": 300},
                "position": {"x": X_START + X_STEP, "y": PRE_Y},
            },
            {
                "id": "validator-1707100003",
                "type": "validator",
                "label": "Validator",
                "enabled": True,
                "config": {
                    "validation_type": "not_empty",
                    "retry_on_fail": False,
                },
                "position": {"x": X_START, "y": POST_Y},
            },
        ],
        # ----------------------------------------------------------------
        # Task execution: speed + code quality, rate limit to avoid GPU overload
        # Cache (pre) + Rate Limiter (pre) + Timeout (pre) + Validator (post)
        # ----------------------------------------------------------------
        "task_execution": [
            {
                "id": "cache-1707200001",
                "type": "cache",
                "label": "Cache",
                "enabled": True,
                "config": {
                    "ttl_seconds": 86400,
                    "cache_level": "exact",
                    "enabled": True,
                },
                "position": {"x": X_START, "y": PRE_Y},
            },
            {
                "id": "rate_limiter-1707200002",
                "type": "rate_limiter",
                "label": "Rate Limiter",
                "enabled": True,
                "config": {
                    "max_requests": 10,
                    "window_seconds": 60,
                    "action_on_exceed": "queue",
                },
                "position": {"x": X_START + X_STEP, "y": PRE_Y},
            },
            {
                "id": "timeout-1707200003",
                "type": "timeout",
                "label": "Timeout",
                "enabled": True,
                "config": {"timeout_seconds": 300},
                "position": {"x": X_START + X_STEP * 2, "y": PRE_Y},
            },
            {
                "id": "validator-1707200004",
                "type": "validator",
                "label": "Validator",
                "enabled": True,
                "config": {
                    "validation_type": "not_empty",
                    "retry_on_fail": False,
                },
                "position": {"x": X_START, "y": POST_Y},
            },
        ],
        # ----------------------------------------------------------------
        # Commit generation: short output, fast timeout, cost guard
        # Cache (pre) + Timeout (pre) + Cost Guard (post)
        # ----------------------------------------------------------------
        "commit_generation": [
            {
                "id": "cache-1707300001",
                "type": "cache",
                "label": "Cache",
                "enabled": True,
                "config": {
                    "ttl_seconds": 86400,
                    "cache_level": "exact",
                    "enabled": True,
                },
                "position": {"x": X_START, "y": PRE_Y},
            },
            {
                "id": "timeout-1707300002",
                "type": "timeout",
                "label": "Timeout",
                "enabled": True,
                "config": {"timeout_seconds": 120},
                "position": {"x": X_START + X_STEP, "y": PRE_Y},
            },
            {
                "id": "cost_guard-1707300003",
                "type": "cost_guard",
                "label": "Cost Guard",
                "enabled": True,
                "config": {
                    "max_cost_per_call": 0.10,
                    "daily_budget": 10.0,
                    "monthly_budget": 100.0,
                    "action_on_exceed": "block",
                },
                "position": {"x": X_START, "y": POST_Y},
            },
        ],
        # ----------------------------------------------------------------
        # Pattern discovery: deep reasoning, long timeout, JSON validation + retry
        # Cache (pre) + Timeout (pre) + Validator JSON (post) + Retry (post)
        # ----------------------------------------------------------------
        "pattern_discovery": [
            {
                "id": "cache-1707400001",
                "type": "cache",
                "label": "Cache",
                "enabled": True,
                "config": {
                    "ttl_seconds": 86400,
                    "cache_level": "exact",
                    "enabled": True,
                },
                "position": {"x": X_START, "y": PRE_Y},
            },
            {
                "id": "timeout-1707400002",
                "type": "timeout",
                "label": "Timeout",
                "enabled": True,
                "config": {"timeout_seconds": 600},
                "position": {"x": X_START + X_STEP, "y": PRE_Y},
            },
            {
                "id": "validator-1707400003",
                "type": "validator",
                "label": "JSON Validator",
                "enabled": True,
                "config": {
                    "validation_type": "json",
                    "retry_on_fail": True,
                },
                "position": {"x": X_START, "y": POST_Y},
            },
            {
                "id": "retry-1707400004",
                "type": "retry",
                "label": "Retry",
                "enabled": True,
                "config": {
                    "max_retries": 2,
                    "backoff_base_ms": 3000,
                    "backoff_multiplier": 2.0,
                    "retry_on": ["timeout", "rate_limit", "server_error"],
                },
                "position": {"x": X_START + X_STEP, "y": POST_Y},
            },
        ],
        # ----------------------------------------------------------------
        # Memory / Continuous RAG: quality extraction, RAG context, JSON required
        # Cache (pre) + RAG Context (pre) + Timeout (pre) + Validator JSON (post) + Retry (post)
        # ----------------------------------------------------------------
        "memory": [
            {
                "id": "cache-1707500001",
                "type": "cache",
                "label": "Cache",
                "enabled": True,
                "config": {
                    "ttl_seconds": 86400,
                    "cache_level": "exact",
                    "enabled": True,
                },
                "position": {"x": X_START, "y": PRE_Y},
            },
            {
                "id": "rag_context-1707500002",
                "type": "rag_context",
                "label": "RAG Context",
                "enabled": True,
                "config": {
                    "max_results": 3,
                    "similarity_threshold": 0.8,
                    "include_metadata": True,
                },
                "position": {"x": X_START + X_STEP, "y": PRE_Y},
            },
            {
                "id": "timeout-1707500003",
                "type": "timeout",
                "label": "Timeout",
                "enabled": True,
                "config": {"timeout_seconds": 300},
                "position": {"x": X_START + X_STEP * 2, "y": PRE_Y},
            },
            {
                "id": "validator-1707500004",
                "type": "validator",
                "label": "JSON Validator",
                "enabled": True,
                "config": {
                    "validation_type": "json",
                    "retry_on_fail": True,
                },
                "position": {"x": X_START, "y": POST_Y},
            },
            {
                "id": "retry-1707500005",
                "type": "retry",
                "label": "Retry",
                "enabled": True,
                "config": {
                    "max_retries": 2,
                    "backoff_base_ms": 2000,
                    "backoff_multiplier": 2.0,
                    "retry_on": ["timeout", "server_error"],
                },
                "position": {"x": X_START + X_STEP, "y": POST_Y},
            },
        ],
        # ----------------------------------------------------------------
        # Queue orchestration: batch processing, rate limit, short cache
        # Cache (pre) + Rate Limiter (pre) + Timeout (pre) + Validator (post)
        # ----------------------------------------------------------------
        "queue_orchestration": [
            {
                "id": "cache-1707600001",
                "type": "cache",
                "label": "Cache",
                "enabled": True,
                "config": {
                    "ttl_seconds": 3600,
                    "cache_level": "exact",
                    "enabled": True,
                },
                "position": {"x": X_START, "y": PRE_Y},
            },
            {
                "id": "rate_limiter-1707600002",
                "type": "rate_limiter",
                "label": "Rate Limiter",
                "enabled": True,
                "config": {
                    "max_requests": 10,
                    "window_seconds": 60,
                    "action_on_exceed": "queue",
                },
                "position": {"x": X_START + X_STEP, "y": PRE_Y},
            },
            {
                "id": "timeout-1707600003",
                "type": "timeout",
                "label": "Timeout",
                "enabled": True,
                "config": {"timeout_seconds": 300},
                "position": {"x": X_START + X_STEP * 2, "y": PRE_Y},
            },
            {
                "id": "validator-1707600004",
                "type": "validator",
                "label": "Validator",
                "enabled": True,
                "config": {
                    "validation_type": "not_empty",
                    "retry_on_fail": False,
                },
                "position": {"x": X_START, "y": POST_Y},
            },
        ],
        # ----------------------------------------------------------------
        # General fallback: balanced - cache + timeout + validator + retry
        # Cache (pre) + Timeout (pre) + Validator (post) + Retry (post) + Cost Guard (post)
        # ----------------------------------------------------------------
        "general": [
            {
                "id": "cache-1707700001",
                "type": "cache",
                "label": "Cache",
                "enabled": True,
                "config": {
                    "ttl_seconds": 86400,
                    "cache_level": "exact",
                    "enabled": True,
                },
                "position": {"x": X_START, "y": PRE_Y},
            },
            {
                "id": "timeout-1707700002",
                "type": "timeout",
                "label": "Timeout",
                "enabled": True,
                "config": {"timeout_seconds": 300},
                "position": {"x": X_START + X_STEP, "y": PRE_Y},
            },
            {
                "id": "validator-1707700003",
                "type": "validator",
                "label": "Validator",
                "enabled": True,
                "config": {
                    "validation_type": "not_empty",
                    "retry_on_fail": True,
                },
                "position": {"x": X_START, "y": POST_Y},
            },
            {
                "id": "retry-1707700004",
                "type": "retry",
                "label": "Retry",
                "enabled": True,
                "config": {
                    "max_retries": 2,
                    "backoff_base_ms": 2000,
                    "backoff_multiplier": 2.0,
                    "retry_on": ["timeout", "rate_limit", "server_error"],
                },
                "position": {"x": X_START + X_STEP, "y": POST_Y},
            },
            {
                "id": "cost_guard-1707700005",
                "type": "cost_guard",
                "label": "Cost Guard",
                "enabled": True,
                "config": {
                    "max_cost_per_call": 0.10,
                    "daily_budget": 10.0,
                    "monthly_budget": 100.0,
                    "action_on_exceed": "block",
                },
                "position": {"x": X_START + X_STEP * 2, "y": POST_Y},
            },
        ],
    }

    return configs.get(usage_key, configs["general"])


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
            # Frontend constants: START_X=50, SPACING_X=300, Y=150
            positions = {"start": {"x": 50, "y": 150}}
            for i, mid in enumerate(chain_ids):
                positions[mid] = {"x": 50 + 300 * (i + 1), "y": 150}
            positions["error"] = {"x": 50 + 300 * (len(chain_ids) + 1), "y": 150}

            # Build utility nodes for this operation
            utility_nodes = _build_utility_nodes(usage_key)
            node_types = [n["type"] for n in utility_nodes]

            # Add utility node positions to the positions dict
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
