"""
Seed AI Flow Chains - Preset: Custo Mínimo (Ollama-first) + Claudio Opus pipelines

Configure all Ollama models with top_p/top_k and create optimal AI Flow chains
for all 10 usage types with performance utility nodes.

Preset: CUSTO MÍNIMO - Prioriza modelos locais (Ollama) para zero custo de API.
Modelos cloud ficam como fallback final apenas se necessário.

PROMPT #252 additions (PROMPT #255 - switched to Sonnet for richer semantic text):
- content_generation:  Claudio Sonnet 4.6 (Wiki, Cards, Description, Title)
- rag_extraction:      Claudio Sonnet 4.6 (Business rules extraction)
- memory:              Claudio Opus 4.6 (upgraded from Sonnet)

Strategy per operation (cost-optimized):
- interview:           Gemma3 12B → Qwen3 8B
- prompt_generation:   Qwen3 8B → Gemma3 12B
- task_execution:      Qwen3 8B → Gemma3 12B
- commit_generation:   Gemma3 12B → Qwen3 8B
- pattern_discovery:   DeepSeek-R1 14B → Gemma3 12B
- memory:              Claudio Opus 4.6
- queue_orchestration: Qwen3 8B → Gemma3 12B → Phi-4 14B
- general:             Qwen3 8B → Gemma3 12B → DeepSeek-R1 14B
- content_generation:  Claudio Sonnet 4.6
- rag_extraction:      Claudio Sonnet 4.6

Usage:
    python scripts/seed_ai_flow_chains.py
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
    "qwen3:8b": {
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
    # Interview: quality rule understanding + good Portuguese
    # Gemma3 (best quality) → Qwen3 (fast fallback)
    "interview": [
        ("gemma3:12b", None),
        ("qwen3:8b", None),
    ],
    # Prompt generation: creativity + verbose output
    # Qwen3 (most verbose, 1279 tokens) → Gemma3 (quality fallback)
    "prompt_generation": [
        ("qwen3:8b", None),
        ("gemma3:12b", None),
    ],
    # Task execution: speed + code understanding
    # Qwen3 (31.9 tok/s fastest) → Gemma3 (25 tok/s)
    "task_execution": [
        ("qwen3:8b", None),
        ("gemma3:12b", None),
    ],
    # Commit generation: concise output
    # Gemma3 (concise 737 tokens) → Qwen3
    "commit_generation": [
        ("gemma3:12b", None),
        ("qwen3:8b", None),
    ],
    # Pattern discovery: reasoning + deep analysis
    # DeepSeek-R1 (chain of thought) → Gemma3
    "pattern_discovery": [
        ("deepseek-r1:14b", None),
        ("gemma3:12b", None),
    ],
    # Memory / Continuous RAG: verbose extraction in Portuguese
    # Qwen3 (most verbose 1279 tokens, best Portuguese) → Gemma3 → DeepSeek-R1
    "memory": [
        ("qwen3:8b", None),
        ("gemma3:12b", None),
        ("deepseek-r1:14b", None),
    ],
    # Queue orchestration: speed for batch processing
    # Qwen3 (fastest) → Gemma3 → Phi-4 (quality backup)
    "queue_orchestration": [
        ("qwen3:8b", None),
        ("gemma3:12b", None),
        ("phi4:14b", None),
    ],
    # General: verbose output with good Portuguese
    # Qwen3 (best Portuguese, most verbose) → Gemma3 → DeepSeek-R1
    "general": [
        ("qwen3:8b", None),
        ("gemma3:12b", None),
        ("deepseek-r1:14b", None),
    ],
    # PROMPT #255 - Content generation: Wiki, Cards, Description, Title
    # Sonnet 4.6 for richer semantic text (Opus is too conservative/literal)
    "content_generation": [
        (None, "Claudio Sonnet 4.6 (Content)"),
    ],
    # PROMPT #255 - RAG extraction: business rules from codebase
    # Sonnet 4.6 for comprehensive rule extraction with richer output
    "rag_extraction": [
        (None, "Claudio Sonnet 4.6 (RAG Extraction)"),
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
        # ----------------------------------------------------------------
        # Content generation (PROMPT #252): quality content, long timeout
        # Timeout (pre) + Validator (post) + Retry (post)
        # ----------------------------------------------------------------
        "content_generation": [
            {
                "id": "timeout-1707800001",
                "type": "timeout",
                "label": "Timeout",
                "enabled": True,
                "config": {"timeout_seconds": 600},
                "position": {"x": X_START, "y": PRE_Y},
            },
            {
                "id": "validator-1707800002",
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
                "id": "retry-1707800003",
                "type": "retry",
                "label": "Retry",
                "enabled": True,
                "config": {
                    "max_retries": 2,
                    "backoff_base_ms": 3000,
                    "backoff_multiplier": 2.0,
                    "retry_on": ["timeout", "server_error"],
                },
                "position": {"x": X_START + X_STEP, "y": POST_Y},
            },
        ],
        # ----------------------------------------------------------------
        # RAG extraction (PROMPT #252): precise extraction, JSON required
        # Timeout (pre) + JSON Validator (post) + Retry (post)
        # ----------------------------------------------------------------
        "rag_extraction": [
            {
                "id": "timeout-1707900001",
                "type": "timeout",
                "label": "Timeout",
                "enabled": True,
                "config": {"timeout_seconds": 600},
                "position": {"x": X_START, "y": PRE_Y},
            },
            {
                "id": "validator-1707900002",
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
                "id": "retry-1707900003",
                "type": "retry",
                "label": "Retry",
                "enabled": True,
                "config": {
                    "max_retries": 2,
                    "backoff_base_ms": 3000,
                    "backoff_multiplier": 2.0,
                    "retry_on": ["timeout", "server_error"],
                },
                "position": {"x": X_START + X_STEP, "y": POST_Y},
            },
        ],
    }

    return configs.get(usage_key, configs["general"])


# ============================================================================
# Exact node positions from user-arranged layout (Custo Mínimo preset)
# "fixed" = non-model nodes (start, error, response, utility nodes)
# "models" = ordered list of positions for chain models [0]=first, [1]=second, etc.
# ============================================================================
CHAIN_POSITIONS = {
    "interview": {
        "fixed": {
            "start": {"x": 0, "y": -120},
            "error": {"x": 1420, "y": -40},
            "response": {"x": 1800, "y": 220},
            "cache-1707000001": {"x": 100, "y": 20},
            "timeout-1707000002": {"x": 360, "y": 0},
            "validator-1707000003": {"x": 1320, "y": 100},
            "retry-1707000004": {"x": 1600, "y": 100},
        },
        "models": [
            {"x": 640, "y": -40},   # Gemma3
            {"x": 1000, "y": -40},  # Qwen3
        ],
    },
    "prompt_generation": {
        "fixed": {
            "start": {"x": 40, "y": -120},
            "error": {"x": 1580, "y": 20},
            "response": {"x": 1640, "y": 360},
            "cache-1707100001": {"x": 170, "y": -20},
            "timeout-1707100002": {"x": 420, "y": -20},
            "validator-1707100003": {"x": 1440, "y": 260},
        },
        "models": [
            {"x": 700, "y": 20},    # Qwen3
            {"x": 1080, "y": 20},   # Gemma3
        ],
    },
    "task_execution": {
        "fixed": {
            "start": {"x": -20, "y": -180},
            "error": {"x": 1680, "y": -40},
            "response": {"x": 1840, "y": 340},
            "cache-1707200001": {"x": 170, "y": -20},
            "rate_limiter-1707200002": {"x": 420, "y": -20},
            "timeout-1707200003": {"x": 670, "y": -20},
            "validator-1707200004": {"x": 1580, "y": 240},
        },
        "models": [
            {"x": 920, "y": 120},   # Qwen3
            {"x": 1220, "y": -40},  # Gemma3
        ],
    },
    "commit_generation": {
        "fixed": {
            "start": {"x": 0, "y": -120},
            "error": {"x": 1520, "y": -20},
            "response": {"x": 1680, "y": 280},
            "cache-1707300001": {"x": 170, "y": -20},
            "timeout-1707300002": {"x": 420, "y": -20},
            "cost_guard-1707300003": {"x": 1380, "y": 240},
        },
        "models": [
            {"x": 680, "y": -60},   # Gemma3
            {"x": 1040, "y": 80},   # Qwen3
        ],
    },
    "pattern_discovery": {
        "fixed": {
            "start": {"x": 50, "y": 150},
            "error": {"x": 1500, "y": -60},
            "response": {"x": 1880, "y": 360},
            "cache-1707400001": {"x": 170, "y": -20},
            "timeout-1707400002": {"x": 420, "y": -20},
            "validator-1707400003": {"x": 1400, "y": 100},
            "retry-1707400004": {"x": 1680, "y": 240},
        },
        "models": [
            {"x": 700, "y": -40},   # DeepSeek-R1
            {"x": 1040, "y": 0},    # Gemma3
        ],
    },
    "memory": {
        "fixed": {
            "start": {"x": 50, "y": 150},
            "error": {"x": 2240, "y": 20},
            "response": {"x": 2560, "y": 340},
            "cache-1707500001": {"x": 170, "y": -20},
            "rag_context-1707500002": {"x": 420, "y": -20},
            "timeout-1707500003": {"x": 670, "y": -20},
            "validator-1707500004": {"x": 1940, "y": 240},
            "retry-1707500005": {"x": 2200, "y": 340},
        },
        "models": [
            {"x": 960, "y": 0},     # Qwen3
            {"x": 1310, "y": 130},   # Gemma3
            {"x": 1610, "y": 130},   # DeepSeek-R1
        ],
    },
    "queue_orchestration": {
        "fixed": {
            "start": {"x": 50, "y": 150},
            "error": {"x": 1250, "y": 150},
            "cache-1707600001": {"x": 170, "y": -20},
            "rate_limiter-1707600002": {"x": 420, "y": -20},
            "timeout-1707600003": {"x": 670, "y": -20},
            "validator-1707600004": {"x": 170, "y": 320},
        },
        "models": [
            {"x": 350, "y": 150},   # Qwen3
            {"x": 650, "y": 150},   # Gemma3
            {"x": 950, "y": 150},   # Phi-4
        ],
    },
    "general": {
        "fixed": {
            "start": {"x": 50, "y": 150},
            "error": {"x": 2020, "y": 60},
            "response": {"x": 2720, "y": 480},
            "cache-1707700001": {"x": 170, "y": -20},
            "timeout-1707700002": {"x": 420, "y": -20},
            "validator-1707700003": {"x": 1900, "y": 260},
            "retry-1707700004": {"x": 2180, "y": 320},
            "cost_guard-1707700005": {"x": 2480, "y": 360},
        },
        "models": [
            {"x": 780, "y": 130},   # Qwen3
            {"x": 1080, "y": 130},  # Gemma3
            {"x": 1460, "y": 120},  # DeepSeek-R1
        ],
    },
    # PROMPT #252 - Content generation: single Opus model
    "content_generation": {
        "fixed": {
            "start": {"x": 50, "y": 150},
            "error": {"x": 760, "y": 340},
            "response": {"x": 850, "y": 150},
        },
        "models": [
            {"x": 400, "y": 130},   # Claudio Opus 4.6 (Content)
        ],
    },
    # PROMPT #252 - RAG extraction: single Opus model
    "rag_extraction": {
        "fixed": {
            "start": {"x": 50, "y": 150},
            "error": {"x": 760, "y": 340},
            "response": {"x": 850, "y": 150},
        },
        "models": [
            {"x": 400, "y": 130},   # Claudio Opus 4.6 (RAG Extraction)
        ],
    },
}


def seed_ai_flow_chains():
    logger.info("Starting AI Flow Chains seed (Custo Mínimo preset)...")

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
        # Step 1.5: Ensure Claudio Sonnet 4.6 models exist (PROMPT #255)
        # Switched from Opus to Sonnet for richer semantic text generation.
        # Opus is too conservative/literal for Mapa Semantico content.
        # ==================================================================
        logger.info("\n[1.5/3] Ensuring Claudio Sonnet 4.6 models exist...")

        claudio_models = {
            "Claudio Sonnet 4.6 (Content)": {
                "usage_type": AIModelUsageType.CONTENT_GENERATION,
                "config": {"model_id": "claude-sonnet-4-6", "max_tokens": 16384, "temperature": 0.7},
            },
            "Claudio Sonnet 4.6 (RAG Extraction)": {
                "usage_type": AIModelUsageType.RAG_EXTRACTION,
                "config": {"model_id": "claude-sonnet-4-6", "max_tokens": 16384, "temperature": 0.3},
            },
        }

        # PROMPT #255 - Deactivate old Opus models for content_generation/rag_extraction
        old_opus_names = ["Claudio Opus 4.6 (Content)", "Claudio Opus 4.6 (RAG Extraction)"]
        for old_name in old_opus_names:
            old_model = db.query(AIModel).filter(AIModel.name == old_name, AIModel.is_active == True).first()
            if old_model:
                old_model.is_active = False
                logger.info(f"  Deactivated old model: {old_name}")

        for model_name, model_cfg in claudio_models.items():
            existing = db.query(AIModel).filter(AIModel.name == model_name).first()
            if not existing:
                new_model = AIModel(
                    id=uuid4(),
                    name=model_name,
                    provider="claudio",
                    api_key="not-needed",
                    usage_type=model_cfg["usage_type"],
                    is_active=True,
                    config=model_cfg["config"],
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                )
                db.add(new_model)
                logger.info(f"  Created: {model_name}")
            else:
                # Update existing to ensure correct config
                existing.config = model_cfg["config"]
                existing.is_active = True
                logger.info(f"  Updated: {model_name} (max_tokens={model_cfg['config']['max_tokens']})")

        # Upgrade memory model to Opus 4.6
        memory_model = db.query(AIModel).filter(
            AIModel.usage_type == AIModelUsageType.MEMORY,
            AIModel.provider == "claudio",
            AIModel.is_active == True,
        ).first()
        if memory_model:
            memory_model.config = {"model_id": "claude-opus-4-6", "max_tokens": 16384, "temperature": 0.5}
            memory_model.name = "Claudio Opus 4.6 (Memory)"
            logger.info(f"  Updated memory model: Opus 4.6 (max_tokens=16384)")

        db.commit()

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
            "content_generation": AIModelUsageType.CONTENT_GENERATION,
            "rag_extraction": AIModelUsageType.RAG_EXTRACTION,
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

            # Use manually-arranged node positions (Custo Mínimo preset)
            layout = CHAIN_POSITIONS.get(usage_key, {})
            positions = dict(layout.get("fixed", {}))
            # Map model positions by chain index → model-{uuid}
            model_positions = layout.get("models", [])
            for i, mid in enumerate(chain_ids):
                if i < len(model_positions):
                    positions[f"model-{mid}"] = model_positions[i]
                else:
                    positions[f"model-{mid}"] = {"x": 700 + 300 * i, "y": 0}

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
