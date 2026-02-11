"""
Console Logger Service - PROMPT #168
Central logging service for real-time console output

Captures and streams:
- AI prompts and responses
- Specs loaded
- Job progress
- RAG operations
- System events
"""

import logging
import asyncio
import json
from datetime import datetime
from typing import Dict, List, Optional, Any, Callable
from collections import deque
from enum import Enum
from dataclasses import dataclass, asdict
import uuid

logger = logging.getLogger(__name__)


class LogLevel(str, Enum):
    DEBUG = "debug"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    SUCCESS = "success"


class LogCategory(str, Enum):
    AI_PROMPT = "ai_prompt"
    AI_RESPONSE = "ai_response"
    AI_STREAMING = "ai_streaming"  # PROMPT #217 - Real-time streaming chunks
    SPEC_LOADED = "spec_loaded"
    RAG_OPERATION = "rag_operation"
    JOB_EVENT = "job_event"
    MEMORY_SCAN = "memory_scan"
    CACHE_EVENT = "cache_event"
    SYSTEM = "system"
    ERROR = "error"


@dataclass
class ConsoleLogEntry:
    """Single log entry for console output"""
    id: str
    timestamp: str
    level: LogLevel
    category: LogCategory
    title: str
    message: str
    details: Optional[Dict[str, Any]] = None
    project_id: Optional[str] = None  # UUID as string
    job_id: Optional[str] = None  # UUID as string
    duration_ms: Optional[int] = None
    tokens_used: Optional[int] = None

    def to_dict(self) -> Dict:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)


class ConsoleLogger:
    """
    Singleton console logger that maintains log buffer and notifies subscribers
    """
    _instance = None
    _lock = asyncio.Lock()

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        # Buffer to store recent logs (max 1000 entries)
        self.buffer: deque = deque(maxlen=1000)

        # Subscribers waiting for new logs (SSE connections)
        self.subscribers: List[asyncio.Queue] = []

        # Lock for thread-safe operations
        self._buffer_lock = asyncio.Lock()

        self._initialized = True
        logger.info("📋 ConsoleLogger initialized")

    async def log(
        self,
        level: LogLevel,
        category: LogCategory,
        title: str,
        message: str,
        details: Optional[Dict[str, Any]] = None,
        project_id: Optional[str] = None,
        job_id: Optional[str] = None,
        duration_ms: Optional[int] = None,
        tokens_used: Optional[int] = None
    ) -> ConsoleLogEntry:
        """
        Add a log entry and notify all subscribers
        """
        entry = ConsoleLogEntry(
            id=str(uuid.uuid4()),
            timestamp=datetime.utcnow().isoformat() + "Z",
            level=level,
            category=category,
            title=title,
            message=message,
            details=details,
            project_id=project_id,
            job_id=job_id,
            duration_ms=duration_ms,
            tokens_used=tokens_used
        )

        # PROMPT #217 - Streaming chunks are ephemeral: only sent to SSE subscribers,
        # not stored in the buffer (prevents flooding the 1000-entry log buffer)
        is_streaming_chunk = (
            category == LogCategory.AI_STREAMING
            and details
            and not details.get("is_complete", False)
        )

        if not is_streaming_chunk:
            async with self._buffer_lock:
                self.buffer.append(entry)

        # Notify all subscribers (including streaming chunks)
        await self._notify_subscribers(entry)

        # Also log to standard logger for container logs (skip streaming chunks to avoid noise)
        if not is_streaming_chunk:
            log_msg = f"[{category.value}] {title}: {message}"
            if level == LogLevel.ERROR:
                logger.error(log_msg)
            elif level == LogLevel.WARNING:
                logger.warning(log_msg)
            elif level == LogLevel.DEBUG:
                logger.debug(log_msg)
            else:
                logger.info(log_msg)

        return entry

    async def _notify_subscribers(self, entry: ConsoleLogEntry):
        """Notify all SSE subscribers of new log entry"""
        dead_subscribers = []

        for queue in self.subscribers:
            try:
                await asyncio.wait_for(
                    queue.put(entry),
                    timeout=1.0
                )
            except asyncio.TimeoutError:
                dead_subscribers.append(queue)
            except Exception as e:
                logger.warning(f"Failed to notify subscriber: {e}")
                dead_subscribers.append(queue)

        # Remove dead subscribers
        for queue in dead_subscribers:
            try:
                self.subscribers.remove(queue)
            except ValueError:
                pass

    async def subscribe(self) -> asyncio.Queue:
        """Subscribe to log updates (for SSE)"""
        queue = asyncio.Queue(maxsize=100)
        self.subscribers.append(queue)
        logger.info(f"📡 New console subscriber (total: {len(self.subscribers)})")
        return queue

    async def unsubscribe(self, queue: asyncio.Queue):
        """Unsubscribe from log updates"""
        try:
            self.subscribers.remove(queue)
            logger.info(f"📡 Console subscriber removed (total: {len(self.subscribers)})")
        except ValueError:
            pass

    async def get_recent_logs(
        self,
        limit: int = 100,
        category: Optional[LogCategory] = None,
        level: Optional[LogLevel] = None,
        project_id: Optional[str] = None
    ) -> List[ConsoleLogEntry]:
        """Get recent logs with optional filtering"""
        async with self._buffer_lock:
            logs = list(self.buffer)

        # Apply filters
        if category:
            logs = [l for l in logs if l.category == category]
        if level:
            logs = [l for l in logs if l.level == level]
        if project_id:
            logs = [l for l in logs if l.project_id == project_id]

        # Return most recent first, limited
        return list(reversed(logs[-limit:]))

    async def clear_logs(self):
        """Clear all logs from buffer"""
        async with self._buffer_lock:
            self.buffer.clear()
        logger.info("📋 Console logs cleared")

    # Convenience methods for common log types

    async def log_ai_prompt(
        self,
        model: str,
        usage_type: str,
        prompt_preview: str,
        full_prompt: Optional[str] = None,
        project_id: Optional[str] = None,
        job_id: Optional[str] = None
    ):
        """Log an AI prompt being sent"""
        await self.log(
            level=LogLevel.INFO,
            category=LogCategory.AI_PROMPT,
            title=f"AI Prompt → {model}",
            message=prompt_preview[:200] + ("..." if len(prompt_preview) > 200 else ""),
            details={
                "model": model,
                "usage_type": usage_type,
                "prompt_length": len(full_prompt or prompt_preview),
                "full_prompt": (full_prompt or prompt_preview)[:5000]  # Limit to 5K chars
            },
            project_id=project_id,
            job_id=job_id
        )

    async def log_ai_response(
        self,
        model: str,
        response_preview: str,
        full_response: Optional[str] = None,
        tokens_used: Optional[int] = None,
        duration_ms: Optional[int] = None,
        project_id: Optional[str] = None,
        job_id: Optional[str] = None,
        cache_hit: bool = False
    ):
        """Log an AI response received"""
        title = f"AI Response ← {model}"
        if cache_hit:
            title = f"🎯 Cache Hit ← {model}"

        await self.log(
            level=LogLevel.SUCCESS,
            category=LogCategory.AI_RESPONSE,
            title=title,
            message=response_preview[:300] + ("..." if len(response_preview) > 300 else ""),
            details={
                "model": model,
                "response_length": len(full_response or response_preview),
                "cache_hit": cache_hit,
                "full_response": (full_response or response_preview)[:10000]  # Limit to 10K chars
            },
            project_id=project_id,
            job_id=job_id,
            duration_ms=duration_ms,
            tokens_used=tokens_used
        )

    async def log_ai_streaming_chunk(
        self,
        stream_id: str,
        model: str,
        chunk_text: str,
        chunk_index: int,
        is_complete: bool = False,
        accumulated_text: Optional[str] = None,
        project_id: Optional[str] = None,
        job_id: Optional[str] = None
    ):
        """
        Log a streaming AI response chunk - PROMPT #217
        Ephemeral entries (is_complete=False) are only sent to SSE subscribers,
        not stored in the buffer.
        """
        if is_complete:
            title = f"AI Stream Complete <- {model}"
        else:
            title = f"AI Streaming <- {model}"

        await self.log(
            level=LogLevel.INFO,
            category=LogCategory.AI_STREAMING,
            title=title,
            message=chunk_text,
            details={
                "stream_id": stream_id,
                "model": model,
                "chunk_text": chunk_text,
                "chunk_index": chunk_index,
                "is_complete": is_complete,
                "accumulated_length": len(accumulated_text) if accumulated_text else 0,
            },
            project_id=project_id,
            job_id=job_id
        )

    async def log_spec_loaded(
        self,
        spec_name: str,
        spec_type: str,
        tokens_saved: Optional[int] = None,
        project_id: Optional[str] = None
    ):
        """Log a spec being loaded"""
        await self.log(
            level=LogLevel.INFO,
            category=LogCategory.SPEC_LOADED,
            title=f"Spec Loaded: {spec_name}",
            message=f"Type: {spec_type}" + (f", Tokens saved: ~{tokens_saved}" if tokens_saved else ""),
            details={
                "spec_name": spec_name,
                "spec_type": spec_type,
                "tokens_saved": tokens_saved
            },
            project_id=project_id
        )

    async def log_rag_operation(
        self,
        operation: str,
        query: Optional[str] = None,
        results_count: Optional[int] = None,
        project_id: Optional[str] = None
    ):
        """Log a RAG operation"""
        message = operation
        if query:
            message += f" - Query: {query[:100]}"
        if results_count is not None:
            message += f" - Results: {results_count}"

        await self.log(
            level=LogLevel.INFO,
            category=LogCategory.RAG_OPERATION,
            title=f"RAG: {operation}",
            message=message,
            details={
                "operation": operation,
                "query": query,
                "results_count": results_count
            },
            project_id=project_id
        )

    async def log_job_event(
        self,
        job_id: str,
        job_type: str,
        status: str,
        message: str,
        progress: Optional[int] = None,
        project_id: Optional[str] = None
    ):
        """Log a job event"""
        level = LogLevel.SUCCESS if status == "completed" else (
            LogLevel.ERROR if status == "failed" else LogLevel.INFO
        )

        await self.log(
            level=level,
            category=LogCategory.JOB_EVENT,
            title=f"Job #{job_id} [{job_type}]",
            message=f"{status.upper()}: {message}" + (f" ({progress}%)" if progress else ""),
            details={
                "job_type": job_type,
                "status": status,
                "progress": progress
            },
            project_id=project_id,
            job_id=job_id
        )

    async def log_memory_scan(
        self,
        phase: str,
        message: str,
        files_processed: Optional[int] = None,
        project_id: Optional[str] = None,
        job_id: Optional[str] = None
    ):
        """Log memory scan progress"""
        await self.log(
            level=LogLevel.INFO,
            category=LogCategory.MEMORY_SCAN,
            title=f"Memory Scan: {phase}",
            message=message,
            details={
                "phase": phase,
                "files_processed": files_processed
            },
            project_id=project_id,
            job_id=job_id
        )

    async def log_error(
        self,
        error_type: str,
        message: str,
        stack_trace: Optional[str] = None,
        project_id: Optional[str] = None,
        job_id: Optional[str] = None
    ):
        """Log an error"""
        await self.log(
            level=LogLevel.ERROR,
            category=LogCategory.ERROR,
            title=f"Error: {error_type}",
            message=message,
            details={
                "error_type": error_type,
                "stack_trace": stack_trace
            },
            project_id=project_id,
            job_id=job_id
        )

    async def log_cache_event(
        self,
        event_type: str,
        cache_key: Optional[str] = None,
        hit: bool = False,
        project_id: Optional[str] = None
    ):
        """Log cache operations"""
        level = LogLevel.SUCCESS if hit else LogLevel.DEBUG
        await self.log(
            level=level,
            category=LogCategory.CACHE_EVENT,
            title=f"Cache: {event_type}",
            message="HIT" if hit else "MISS" + (f" - Key: {cache_key[:50]}" if cache_key else ""),
            details={
                "event_type": event_type,
                "cache_key": cache_key,
                "hit": hit
            },
            project_id=project_id
        )


# Global instance
console_logger = ConsoleLogger()


def get_console_logger() -> ConsoleLogger:
    """Get the singleton console logger instance"""
    return console_logger
