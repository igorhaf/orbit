"""
Console API Routes - PROMPT #168 / PROMPT #247
Console log management (REST endpoints).
Real-time streaming moved to WebSocket at /ws/console (PROMPT #247).

Provides:
- GET /console/logs - Get recent logs with filtering
- DELETE /console/logs - Clear log buffer
"""

import logging
from typing import Optional
from fastapi import APIRouter, Query

from app.services.console_logger import (
    get_console_logger,
    LogCategory,
    LogLevel
)

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/logs")
async def get_console_logs(
    limit: int = Query(default=100, ge=1, le=1000),
    category: Optional[str] = Query(default=None),
    level: Optional[str] = Query(default=None),
    project_id: Optional[int] = Query(default=None)
):
    """
    Get recent console logs with optional filtering

    Args:
        limit: Maximum number of logs to return (1-1000)
        category: Filter by category (ai_prompt, ai_response, spec_loaded, etc.)
        level: Filter by level (debug, info, warning, error, success)
        project_id: Filter by project ID

    Returns:
        List of ConsoleLogEntry objects
    """
    console = get_console_logger()

    # Convert string params to enums if provided
    cat_enum = LogCategory(category) if category else None
    level_enum = LogLevel(level) if level else None

    logs = await console.get_recent_logs(
        limit=limit,
        category=cat_enum,
        level=level_enum,
        project_id=project_id
    )

    return {
        "logs": [log.to_dict() for log in logs],
        "count": len(logs),
        "filters": {
            "category": category,
            "level": level,
            "project_id": project_id
        }
    }


@router.delete("/logs")
async def clear_console_logs():
    """Clear all logs from the buffer"""
    console = get_console_logger()
    await console.clear_logs()

    return {
        "success": True,
        "message": "Logs do console limpos com sucesso"
    }


@router.get("/operations")
async def get_operations_summary(
    project_id: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100)
):
    """
    PROMPT #296 - Group recent logs by trace_id into operation summaries.

    Returns a timeline of operations with phases, duration, tokens, cost and diagnostics.
    """
    console = get_console_logger()
    logs = await console.get_recent_logs(limit=1000)

    # Group by trace_id
    operations = {}
    ungrouped = []
    for log in logs:
        if not log.trace_id:
            ungrouped.append(log.to_dict())
            continue
        if project_id and log.project_id != project_id:
            continue
        if log.trace_id not in operations:
            operations[log.trace_id] = {
                "trace_id": log.trace_id,
                "operation_name": log.operation_name or "Operação",
                "events": [],
                "phases": [],
                "total_duration_ms": 0,
                "total_tokens": 0,
                "total_cost": 0.0,
                "models_used": set(),
                "started_at": log.timestamp,
                "ended_at": log.timestamp,
                "bottleneck": None,
                "diagnostics": [],
                "project_id": log.project_id,
            }
        op = operations[log.trace_id]
        op["events"].append(log.to_dict())

        # Update timestamps
        if log.timestamp < op["started_at"]:
            op["started_at"] = log.timestamp
        if log.timestamp > op["ended_at"]:
            op["ended_at"] = log.timestamp

        # Extract phase info from performance events
        details = log.details or {}
        event_type = details.get("event_type", "")

        if event_type == "phase_end":
            phase_info = {
                "name": details.get("phase_name") or log.phase_name or "",
                "duration_ms": log.duration_ms or 0,
                "tokens": log.tokens_used or 0,
                "cost_usd": log.cost_usd or 0.0,
                "model": log.model_name or "",
            }
            op["phases"].append(phase_info)
            op["total_tokens"] += phase_info["tokens"]
            op["total_cost"] += phase_info["cost_usd"]

        if event_type == "operation_summary":
            op["total_duration_ms"] = details.get("total_duration_ms", 0)
            op["bottleneck"] = details.get("bottleneck")
            op["diagnostics"] = details.get("diagnostics", [])
            op["total_tokens"] = details.get("total_tokens") or op["total_tokens"]
            op["total_cost"] = details.get("total_cost") or op["total_cost"]

        if log.model_name:
            op["models_used"].add(log.model_name)

    # Convert sets to lists for JSON serialization
    result = []
    for op in operations.values():
        op["models_used"] = list(op["models_used"])
        # Calculate duration from phases if summary not present
        if not op["total_duration_ms"] and op["phases"]:
            op["total_duration_ms"] = sum(p["duration_ms"] for p in op["phases"])
        result.append(op)

    # Sort by most recent first
    result.sort(key=lambda o: o["ended_at"], reverse=True)

    return {
        "operations": result[:limit],
        "ungrouped_count": len(ungrouped),
        "total_operations": len(result)
    }


@router.get("/categories")
async def get_log_categories():
    """Get available log categories"""
    return {
        "categories": [
            {"value": c.value, "label": c.value.replace("_", " ").title()}
            for c in LogCategory
        ]
    }


@router.get("/levels")
async def get_log_levels():
    """Get available log levels"""
    return {
        "levels": [
            {"value": l.value, "label": l.value.upper()}
            for l in LogLevel
        ]
    }
