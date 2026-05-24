"""
Streaming provider execution mixin for AIOrchestrator.

v2.5: claudius-only lockdown. Contains _create_stream_callback() (token
streaming sink for the live console) and _execute_claudius_streaming()
(httpx SSE call against the local Claudius proxy).
"""

from typing import Any, Dict, List, Optional
import logging
import os
import time
import json
import asyncio

from .constants import logger
from app.services.console_logger import get_console_logger  # PROMPT #168 - Real-time Console Logs


class ProvidersStreamMixin:
    """Streaming provider execution methods and stream callback creation."""

    # ===================================================================
    # PROMPT #217 - Streaming provider methods for real-time console output
    # ===================================================================

    def _create_stream_callback(
        self,
        stream_id: str,
        model_label: str,
        project_id: Optional[str] = None,
        job_id: Optional[str] = None,
    ):
        """
        Create a callback for streaming chunks to console logger.
        Uses time-based batching: accumulates chunks for 200ms or 50 chars,
        then flushes as one SSE event (~5 events/sec instead of 50+).
        """
        console = get_console_logger()
        chunk_counter = [0]
        buffer = []
        last_flush = [time.time()]

        async def callback(chunk_text: str):
            chunk_counter[0] += 1
            buffer.append(chunk_text)
            now = time.time()
            buffered_text = "".join(buffer)

            # Flush every 200ms or when buffer >= 50 chars
            # PROMPT #221 - Fire-and-forget to prevent streaming stalls
            if now - last_flush[0] >= 0.2 or len(buffered_text) >= 50:
                asyncio.create_task(console.log_ai_streaming_chunk(
                    stream_id=stream_id,
                    model=model_label,
                    chunk_text=buffered_text,
                    chunk_index=chunk_counter[0],
                    is_complete=False,
                    project_id=project_id,
                    job_id=job_id,
                ))
                buffer.clear()
                last_flush[0] = now

        async def flush_remaining():
            """Flush any remaining buffered text"""
            if buffer:
                buffered_text = "".join(buffer)
                asyncio.create_task(console.log_ai_streaming_chunk(
                    stream_id=stream_id,
                    model=model_label,
                    chunk_text=buffered_text,
                    chunk_index=chunk_counter[0],
                    is_complete=False,
                    project_id=project_id,
                    job_id=job_id,
                ))
                buffer.clear()

        return callback, chunk_counter, flush_remaining

    async def _execute_claudius_streaming(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str],
        max_tokens: int,
        temperature: float,
        stream_callback,
        flush_callback,
        timeout_seconds: Optional[float] = None,
        cwd: Optional[str] = None,
        thinking: Optional[Dict] = None,
        disable_tools: bool = False,
    ) -> Dict:
        """
        PROMPT #253 - Claudius streaming via httpx SSE.
        Supports cwd and thinking parameters.
        """
        import httpx

        claudius_base = os.getenv("CLAUDIUS_BASE_URL", "http://localhost:8001")
        claudius_key = os.getenv("CLAUDIUS_API_KEY", "123456789")
        url = f"{claudius_base}/v1/messages"

        body: Dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "stream": True,
            "messages": messages,
        }

        if system_prompt:
            body["system"] = system_prompt

        if cwd:
            body["cwd"] = cwd

        # PROMPT #253 - disable_tools sends tools=[] to proxy, which adds --tools "" to CLI
        if disable_tools:
            body["tools"] = []

        if thinking:
            body["thinking"] = thinking
        else:
            body["temperature"] = temperature

        _timeout = timeout_seconds or 600.0
        accumulated = ""
        thinking_text = ""
        input_tokens = 0
        output_tokens = 0
        _stream_start = time.time()

        async with httpx.AsyncClient(timeout=httpx.Timeout(_timeout)) as client:
            async with client.stream(
                "POST", url, json=body,
                headers={
                    "Content-Type": "application/json",
                    "anthropic-version": "2023-06-01",
                    "x-api-key": claudius_key,
                },
            ) as resp:
                resp.raise_for_status()
                buf = ""
                async for chunk in resp.aiter_text():
                    buf += chunk
                    while "\n\n" in buf:
                        event_block, buf = buf.split("\n\n", 1)
                        event_type = ""
                        event_data = ""
                        for line in event_block.split("\n"):
                            if line.startswith("event: "):
                                event_type = line[7:]
                            elif line.startswith("data: "):
                                event_data = line[6:]
                        if not event_data:
                            continue
                        try:
                            parsed = json.loads(event_data)
                        except (json.JSONDecodeError, Exception):
                            continue

                        # SSE error events → raise so non-streaming fallback triggers
                        if event_type == "error":
                            err_msg = parsed.get("error", {}).get("message", str(parsed))
                            raise RuntimeError(f"Claudius streaming error: {err_msg}")

                        if event_type == "content_block_delta":
                            delta = parsed.get("delta", {})
                            if delta.get("type") == "text_delta":
                                text = delta.get("text", "")
                                accumulated += text
                                await stream_callback(text)
                            elif delta.get("type") == "thinking_delta":
                                thinking_text += delta.get("thinking", "")
                        elif event_type == "message_delta":
                            usage_delta = parsed.get("usage", {})
                            output_tokens = usage_delta.get("output_tokens", output_tokens)
                        elif event_type == "message_start":
                            msg = parsed.get("message", {})
                            usage_start = msg.get("usage", {})
                            input_tokens = usage_start.get("input_tokens", 0)

        await flush_callback()

        _streaming_time_ms = int((time.time() - _stream_start) * 1000)
        result = {
            "provider": "claudius",
            "model": model,
            "content": accumulated,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
                "execution_time_ms": _streaming_time_ms,
            },
        }
        if thinking_text:
            result["thinking"] = thinking_text

        return result

