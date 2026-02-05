"""
Console API Routes - PROMPT #168
Real-time console log streaming via SSE (Server-Sent Events)

Provides:
- GET /console/stream - SSE stream for real-time logs
- GET /console/logs - Get recent logs with filtering
- DELETE /console/logs - Clear log buffer
"""

import asyncio
import logging
from typing import Optional
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.services.console_logger import (
    get_console_logger,
    LogCategory,
    LogLevel
)

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/stream")
async def stream_console_logs():
    """
    SSE endpoint for real-time console log streaming

    Returns Server-Sent Events with log entries as they occur.
    Each event is a JSON-encoded ConsoleLogEntry.

    Usage in frontend:
    ```javascript
    const eventSource = new EventSource('/api/v1/console/stream');
    eventSource.onmessage = (event) => {
        const log = JSON.parse(event.data);
        console.log(log);
    };
    ```
    """
    console = get_console_logger()
    queue = await console.subscribe()

    async def event_generator():
        try:
            # Send initial connection message
            yield f"data: {{'type': 'connected', 'message': 'Console stream connected'}}\n\n"

            # Send recent logs first (last 50)
            recent_logs = await console.get_recent_logs(limit=50)
            for log in recent_logs:
                yield f"data: {log.to_json()}\n\n"

            # Stream new logs as they arrive
            while True:
                try:
                    # Wait for new log with timeout (for keepalive)
                    log_entry = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {log_entry.to_json()}\n\n"
                except asyncio.TimeoutError:
                    # Send keepalive ping
                    yield f": keepalive\n\n"
                except asyncio.CancelledError:
                    break
        except Exception as e:
            logger.error(f"SSE stream error: {e}")
        finally:
            await console.unsubscribe(queue)
            logger.info("Console SSE stream closed")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"  # Disable nginx buffering
        }
    )


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
        "message": "Console logs cleared"
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
