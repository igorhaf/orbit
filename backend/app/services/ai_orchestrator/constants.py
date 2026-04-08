"""
Module-level constants, caches, helpers, and UsageType for the AI Orchestrator package.
Replaces satellite_logger.py after satellite/orbit folder removal.
"""

from typing import Any, Dict, List, Optional, Literal
import logging
import asyncio

from app.api.websocket import broadcast_chain_event

logger = logging.getLogger(__name__)

# PROMPT #288 - In-memory cache for model configs and chains (avoids 5-7 DB queries per execute())
_model_config_cache: Dict = {}
_model_config_cache_ts: float = 0
_chain_config_cache: Dict = {}
_chain_config_cache_ts: float = 0
_MODEL_CACHE_TTL = 60  # seconds - models rarely change

# PROMPT #228 - Module-level semaphore pool for concurrency control per model.
_model_semaphores: Dict[str, asyncio.Semaphore] = {}


def _get_model_semaphore(model_id: str, max_concurrent: int) -> asyncio.Semaphore:
    """Get or create a semaphore for a given model with the specified concurrency limit."""
    existing = _model_semaphores.get(model_id)
    if existing is None or existing._value != max_concurrent:
        _model_semaphores[model_id] = asyncio.Semaphore(max_concurrent)
    return _model_semaphores[model_id]


def _safe_broadcast(event_type: str, data: dict):
    """PROMPT #234 EH-2: Safe wrapper for broadcast_chain_event via asyncio.create_task.
    Logs errors instead of silently dropping them."""
    async def _do_broadcast():
        try:
            await broadcast_chain_event(event_type, data)
        except Exception as e:
            logger.warning(f"Failed to broadcast chain event '{event_type}': {e}")

    try:
        asyncio.create_task(_do_broadcast())
    except RuntimeError:
        logger.debug(f"No event loop for broadcast '{event_type}', skipping")


UsageType = Literal[
    "prompt_generation",
    "task_execution",
    "commit_generation",
    "interview",
    "pattern_discovery",
    "memory",
    "rag_extraction",
    "content_generation",
    "general"
]
