"""
Claudio Pipeline Service
Direct HTTP client for the Claudio API proxy (Claude CLI wrapper).

Bypasses AIOrchestrator intentionally:
- No provider selection needed (all calls go to Claudio)
- No Redis cache needed (subscription has no per-call cost)
- Explicit model control per phase (Haiku/Sonnet/Opus)
- Multi-turn session management via session_key
- Extended thinking control via budget_tokens
"""

import asyncio
import json
import logging
import os
from typing import Any
from uuid import uuid4

import httpx

logger = logging.getLogger(__name__)

# Claudio proxy base URL (default: local)
CLAUDIO_BASE_URL = os.getenv("CLAUDIO_BASE_URL", "http://localhost:8001")

# Model identifiers
MODEL_HAIKU = "claude-haiku-4-5"
MODEL_SONNET = "claude-sonnet-4-6"
MODEL_OPUS = "claude-opus-4-6"

# Timeouts per model (seconds) - Opus takes longer for deep reasoning
MODEL_TIMEOUTS = {
    MODEL_HAIKU: 120,
    MODEL_SONNET: 300,
    MODEL_OPUS: 600,
}

# Default retry policies per model
MODEL_RETRIES = {
    MODEL_HAIKU: 3,
    MODEL_SONNET: 2,
    MODEL_OPUS: 2,
}


class ClaudioPipelineError(Exception):
    """Raised when a Claudio API call fails after all retries."""
    pass


class ClaudioPipelineService:
    """
    Direct HTTP client for Claudio proxy.

    Usage:
        service = ClaudioPipelineService()

        # Single call
        result = await service.call(
            model=MODEL_SONNET,
            system_prompt="You are an expert...",
            user_prompt="Analyze this code...",
            session_key="pipeline:proj123:phase2:domain:payments",
        )

        # Parallel batch (Phase 1: per-file analysis)
        results = await service.call_batch(
            requests=[
                {"model": MODEL_HAIKU, "system_prompt": "...", "user_prompt": "..."},
                ...
            ],
            max_concurrency=10,
        )
    """

    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or CLAUDIO_BASE_URL).rstrip("/")
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=httpx.Timeout(600.0, connect=10.0),
            )
        return self._client

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    # ── Single Call ──────────────────────────────────────────────────────

    async def call(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        session_key: str | None = None,
        thinking: dict | None = None,
        max_tokens: int | None = None,
        max_retries: int | None = None,
    ) -> dict[str, Any]:
        """
        Make a single non-streaming call to Claudio.

        Args:
            model: One of MODEL_HAIKU, MODEL_SONNET, MODEL_OPUS
            system_prompt: System prompt for the AI
            user_prompt: User message content
            session_key: Explicit session key for multi-turn (None = no session)
            thinking: Extended thinking config, e.g. {"type": "enabled", "budget_tokens": 10000}
            max_tokens: Max output tokens (None = model default)
            max_retries: Override default retry count

        Returns:
            dict with keys: text, thinking, usage, model, session_id
        """
        retries = max_retries if max_retries is not None else MODEL_RETRIES.get(model, 2)
        timeout = MODEL_TIMEOUTS.get(model, 300)

        payload = {
            "model": model,
            "messages": [{"role": "user", "content": user_prompt}],
            "system": system_prompt,
            "stream": False,
            "tools": [],  # Force pure text generation (--tools "")
        }

        if session_key:
            payload["session_key"] = session_key
        if thinking:
            payload["thinking"] = thinking
        if max_tokens:
            payload["max_tokens"] = max_tokens

        last_error = None
        for attempt in range(retries + 1):
            try:
                client = await self._get_client()
                response = await client.post(
                    "/v1/messages",
                    json=payload,
                    timeout=httpx.Timeout(float(timeout), connect=10.0),
                )

                if response.status_code != 200:
                    error_text = response.text[:500]
                    logger.warning(
                        f"Claudio returned {response.status_code} on attempt {attempt + 1}: {error_text}"
                    )
                    last_error = ClaudioPipelineError(
                        f"HTTP {response.status_code}: {error_text}"
                    )
                    if attempt < retries:
                        await asyncio.sleep(2 ** attempt)
                    continue

                data = response.json()
                return self._parse_response(data)

            except httpx.TimeoutException as e:
                logger.warning(
                    f"Claudio timeout on attempt {attempt + 1}/{retries + 1} "
                    f"(model={model}, timeout={timeout}s): {e}"
                )
                last_error = ClaudioPipelineError(f"Timeout after {timeout}s: {e}")
                if attempt < retries:
                    timeout = int(timeout * 1.5)  # Increase timeout on retry
                    await asyncio.sleep(2 ** attempt)

            except httpx.ConnectError as e:
                logger.error(f"Cannot connect to Claudio at {self.base_url}: {e}")
                raise ClaudioPipelineError(
                    f"Cannot connect to Claudio at {self.base_url}. Is it running?"
                ) from e

            except Exception as e:
                logger.error(f"Unexpected error calling Claudio: {e}")
                last_error = ClaudioPipelineError(f"Unexpected error: {e}")
                if attempt < retries:
                    await asyncio.sleep(2 ** attempt)

        raise last_error or ClaudioPipelineError("All retries exhausted")

    # ── Multi-turn Call (resume session) ─────────────────────────────────

    async def call_followup(
        self,
        model: str,
        session_key: str,
        user_prompt: str,
        thinking: dict | None = None,
        max_tokens: int | None = None,
    ) -> dict[str, Any]:
        """
        Send a follow-up message in an existing session.
        Uses session_key to resume the CLI session context.
        """
        return await self.call(
            model=model,
            system_prompt="",  # System prompt not needed on follow-up
            user_prompt=user_prompt,
            session_key=session_key,
            thinking=thinking,
            max_tokens=max_tokens,
        )

    # ── Batch Parallel Calls ─────────────────────────────────────────────

    async def call_batch(
        self,
        requests: list[dict[str, Any]],
        max_concurrency: int = 10,
    ) -> list[dict[str, Any] | ClaudioPipelineError]:
        """
        Execute multiple calls in parallel with concurrency limit.

        Each request dict should have keys matching call() parameters:
        - model, system_prompt, user_prompt, session_key?, thinking?, max_tokens?

        Returns list of results (dict) or ClaudioPipelineError for failed calls.
        """
        semaphore = asyncio.Semaphore(max_concurrency)
        results: list[dict[str, Any] | ClaudioPipelineError] = [None] * len(requests)

        async def _process(index: int, req: dict):
            async with semaphore:
                try:
                    result = await self.call(**req)
                    results[index] = result
                except ClaudioPipelineError as e:
                    logger.warning(f"Batch item {index} failed: {e}")
                    results[index] = e

        tasks = [_process(i, req) for i, req in enumerate(requests)]
        await asyncio.gather(*tasks)

        succeeded = sum(1 for r in results if not isinstance(r, ClaudioPipelineError))
        failed = len(results) - succeeded
        logger.info(
            f"Batch complete: {succeeded}/{len(requests)} succeeded, {failed} failed"
        )

        return results

    # ── Session Management ───────────────────────────────────────────────

    async def delete_session(self, session_key: str) -> bool:
        """Delete a session by key. Returns True if deleted, False if not found."""
        try:
            client = await self._get_client()
            response = await client.delete(f"/v1/sessions/{session_key}")
            return response.status_code == 200
        except Exception as e:
            logger.warning(f"Failed to delete session {session_key}: {e}")
            return False

    async def list_sessions(self) -> dict:
        """List all active sessions."""
        try:
            client = await self._get_client()
            response = await client.get("/v1/sessions")
            return response.json()
        except Exception as e:
            logger.warning(f"Failed to list sessions: {e}")
            return {"sessions": {}, "count": 0}

    # ── Health Check ─────────────────────────────────────────────────────

    async def health_check(self) -> bool:
        """Check if Claudio is reachable."""
        try:
            client = await self._get_client()
            response = await client.get("/api/health", timeout=5.0)
            return response.status_code == 200
        except Exception:
            return False

    # ── Response Parsing ─────────────────────────────────────────────────

    @staticmethod
    def _parse_response(data: dict) -> dict[str, Any]:
        """
        Parse Claudio API response into a clean result dict.

        Returns:
            {
                "text": "...",           # Main text content
                "thinking": "...",       # Extended thinking (if present)
                "usage": {"input_tokens": N, "output_tokens": N},
                "model": "claude-...",
                "session_id": "...",     # CLI session ID (for debugging)
                "raw": {...},            # Full raw response
            }
        """
        text = ""
        thinking = ""
        content = data.get("content", [])

        for block in content:
            if block.get("type") == "text":
                text += block.get("text", "")
            elif block.get("type") == "thinking":
                thinking += block.get("thinking", "")

        return {
            "text": text,
            "thinking": thinking,
            "usage": data.get("usage", {}),
            "model": data.get("model", ""),
            "stop_reason": data.get("stop_reason", "end_turn"),
            "raw": data,
        }

    # ── JSON Extraction Helper ───────────────────────────────────────────

    @staticmethod
    def extract_json(text: str) -> dict | list | None:
        """
        Extract JSON from AI response text.
        Handles responses that contain JSON inside markdown code blocks.

        Returns parsed JSON or None if extraction fails.
        """
        # Try direct parse first
        text = text.strip()
        try:
            return json.loads(text)
        except (json.JSONDecodeError, ValueError):
            pass

        # Try extracting from ```json ... ``` blocks
        import re
        json_blocks = re.findall(r'```(?:json)?\s*\n?(.*?)\n?```', text, re.DOTALL)
        for block in json_blocks:
            try:
                return json.loads(block.strip())
            except (json.JSONDecodeError, ValueError):
                continue

        # Try finding first { or [ to last } or ]
        for start_char, end_char in [('{', '}'), ('[', ']')]:
            start = text.find(start_char)
            end = text.rfind(end_char)
            if start != -1 and end != -1 and end > start:
                try:
                    return json.loads(text[start:end + 1])
                except (json.JSONDecodeError, ValueError):
                    continue

        return None
