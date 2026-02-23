"""
Module-level functions, constants, and caches for the AI Orchestrator package.
Contains satellite logging, semaphore management, broadcast helpers, and UsageType.
"""

from typing import Any, Dict, List, Optional, Literal
from sqlalchemy.orm import Session
import logging
import time
import json  # PROMPT #74 - For cache key generation
import os  # PROMPT #74 - For Redis env vars
import asyncio  # PROMPT #152 - For rate limit waiting
from datetime import datetime
from uuid import UUID
from app.api.websocket import broadcast_chain_event  # PROMPT #124 - Chain animation

from app.models.ai_model import AIModel, AIModelUsageType
from app.models.ai_flow_chain import AIFlowChain  # PROMPT #122 - AI Flow Fallback Chains

# PROMPT #288 - In-memory cache for model configs and chains (avoids 5-7 DB queries per execute())
_model_config_cache: Dict = {}
_model_config_cache_ts: float = 0
_chain_config_cache: Dict = {}
_chain_config_cache_ts: float = 0
_MODEL_CACHE_TTL = 60  # seconds - models rarely change
from app.models.ai_execution import AIExecution  # PROMPT #54 - AI Execution Logging
from app.models.prompt import Prompt  # PROMPT #58 - Prompt Audit Logging
from app.models.task import Task, ItemType, PriorityLevel  # JIRA Transformation - Multi-dimensional model selection
from app.models.system_settings import SystemSettings  # PROMPT #207 - System default timeout
from app.services.console_logger import get_console_logger  # PROMPT #168 - Real-time Console Logs
from app.services.utility_node_executor import UtilityNodeExecutor  # PROMPT #205 - Utility Node Execution

logger = logging.getLogger(__name__)

# PROMPT #228 - Module-level semaphore pool for concurrency control per model.
# Shared across all AIOrchestrator instances within the same process.
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
        # No running event loop
        logger.debug(f"No event loop for broadcast '{event_type}', skipping")


# PROMPT #235 - usage_types whose executions are saved to satellite/memory/
# (interview excluded - too verbose; general excluded - too broad)
_SAVE_USAGE_TYPES = {
    "prompt_generation", "task_execution",
    "commit_generation", "memory", "pattern_discovery",
}


def _save_prompt_to_satellite(db: Session, prompt_log) -> None:
    """
    PROMPT #235 - Save a successful AI execution as markdown in satellite/memory/.

    Only writes for usage_types in _SAVE_USAGE_TYPES.
    Only writes if project has code_path and satellite/memory/ already exists.
    REGRA #0: never overwrites an existing file.
    """
    try:
        if not prompt_log.project_id:
            return
        if prompt_log.type not in _SAVE_USAGE_TYPES:
            return

        from pathlib import Path as _Path
        from app.models.project import Project

        project = db.query(Project).filter(
            Project.id == prompt_log.project_id
        ).first()
        if not project or not project.code_path:
            return

        from app.services.orbit_folder import SATELLITE_DIR
        memory_dir = _Path(project.code_path) / SATELLITE_DIR / "memory"
        if not memory_dir.exists():
            return  # KB not initialized yet - skip silently

        date_str = (prompt_log.created_at or datetime.utcnow()).strftime("%Y-%m-%d")
        prompt_id_short = str(prompt_log.id).replace("-", "")[:8]
        filename = f"{date_str}_{prompt_log.type}_{prompt_id_short}.md"
        file_path = memory_dir / filename

        # REGRA #0 - never overwrite
        if file_path.exists():
            return

        cost = prompt_log.total_cost_usd or 0.0
        content = (
            f"# {prompt_log.type} — {date_str}\n\n"
            f"**Model:** {prompt_log.ai_model_used or 'unknown'}\n"
            f"**Status:** {prompt_log.status or 'unknown'}\n"
            f"**Tokens:** {prompt_log.input_tokens or 0} in / "
            f"{prompt_log.output_tokens or 0} out | "
            f"Cost: ${cost:.4f}\n\n"
            f"## System Prompt\n\n{prompt_log.system_prompt or ''}\n\n"
            f"## User Prompt\n\n{prompt_log.user_prompt or ''}\n\n"
            f"## Response\n\n{prompt_log.response or ''}\n"
        )

        file_path.write_text(content, encoding="utf-8")
        logger.debug(f"Saved prompt log to satellite: {filename}")

    except Exception as e:
        logger.warning(f"Failed to save prompt to satellite (non-critical): {e}")


UsageType = Literal[
    "prompt_generation",
    "task_execution",
    "commit_generation",
    "interview",
    "pattern_discovery",  # PROMPT #62 - AI-powered pattern discovery
    "memory",  # PROMPT #118 - Codebase memory scan and business rules extraction
    "rag_extraction",  # PROMPT #258 - RAG business rules extraction phase
    "content_generation",  # PROMPT #258 - Wiki/cards content generation
    "general"
]
