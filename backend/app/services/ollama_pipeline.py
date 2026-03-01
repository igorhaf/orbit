"""
Ollama Pipeline Service
Direct HTTP client for Ollama local inference.

Same interface as ClaudioPipelineService for plug-and-play compatibility:
- call(), call_batch(), call_followup(), health_check(), close()
- Same response format: {"text": ..., "thinking": ..., "usage": ..., "model": ...}
- Accepts Claudio params (session_key, thinking) as no-op for compatibility
- Adds Ollama params: temperature, num_ctx, keep_alive
"""

import asyncio
import json
import logging
import os
import re
from typing import Any, Optional

import httpx

from app.services.claudio_pipeline import ClaudioPipelineError

logger = logging.getLogger(__name__)

# Re-use ClaudioPipelineError for compatibility with deep_pipeline.py error handlers
OllamaPipelineError = ClaudioPipelineError

# Ollama defaults
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_DEFAULT_TIMEOUT = 600  # 10 min — local models are slower
OLLAMA_MAX_RETRIES = 3


class OllamaPipelineService:
    """
    Direct HTTP client for Ollama local LLM inference.

    Drop-in replacement for ClaudioPipelineService. Same interface,
    different backend. Profile's "provider" field selects which service.

    Usage:
        service = OllamaPipelineService()

        result = await service.call(
            model="qwen3:14b",
            system_prompt="You are an expert...",
            user_prompt="Analyze this code...",
            max_tokens=8000,
            temperature=0.2,
            num_ctx=32768,
        )

        results = await service.call_batch(
            requests=[{"model": "qwen3:14b", "system_prompt": "...", "user_prompt": "..."}],
            max_concurrency=1,
        )
    """

    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or OLLAMA_BASE_URL).rstrip("/")
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(OLLAMA_DEFAULT_TIMEOUT, connect=10.0),
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
        # Claudio-compatible params (accepted but no-op for Ollama)
        session_key: str | None = None,
        thinking: dict | None = None,
        # Common params
        max_tokens: int | None = None,
        max_retries: int | None = None,
        # Ollama-specific params
        temperature: float = 0.1,
        num_ctx: int = 16384,
        keep_alive: str = "5m",
        **kwargs,  # Accept and ignore any extra params for forward-compat
    ) -> dict[str, Any]:
        """
        Make a single call to Ollama.

        Args:
            model: Ollama model name (e.g. "qwen3:14b", "gemma2:9b")
            system_prompt: System prompt
            user_prompt: User message
            session_key: Ignored (Ollama has no session state)
            thinking: Ignored (Ollama doesn't support extended thinking)
            max_tokens: Max output tokens
            max_retries: Override default retry count
            temperature: Sampling temperature (0.0-1.0)
            num_ctx: Context window size in tokens
            keep_alive: How long to keep model in memory ("5m", "0", etc.)

        Returns:
            dict with keys: text, thinking, usage, model, stop_reason
            (same format as ClaudioPipelineService)
        """
        retries = max_retries if max_retries is not None else OLLAMA_MAX_RETRIES

        # Build Ollama messages format
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": user_prompt})

        options = {
            "temperature": temperature,
            "num_predict": max_tokens or 4096,
            "num_ctx": num_ctx,
            "num_gpu": 99,       # Offload all layers to GPU
            "num_batch": 512,    # Optimized batch size
        }

        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
            "options": options,
            "keep_alive": keep_alive,
        }

        url = f"{self.base_url}/api/chat"
        last_error = None

        for attempt in range(retries + 1):
            try:
                client = await self._get_client()
                logger.info(
                    f"🦙 Ollama call: model={model}, attempt={attempt + 1}/{retries + 1}, "
                    f"num_ctx={num_ctx}, max_tokens={max_tokens or 4096}"
                )

                response = await client.post(
                    url,
                    json=payload,
                    timeout=httpx.Timeout(OLLAMA_DEFAULT_TIMEOUT, connect=10.0),
                )

                if response.status_code != 200:
                    error_text = response.text[:500]
                    logger.warning(
                        f"Ollama returned {response.status_code} on attempt {attempt + 1}: {error_text}"
                    )
                    last_error = OllamaPipelineError(
                        f"HTTP {response.status_code}: {error_text}"
                    )
                    if attempt < retries:
                        await asyncio.sleep(2 ** attempt)
                    continue

                data = response.json()

                # Ollama returns 200 with {"error": "..."} for OOM etc.
                if "error" in data:
                    error_msg = data["error"]
                    logger.error(f"❌ Ollama error: {error_msg}")
                    last_error = OllamaPipelineError(f"Ollama error: {error_msg}")
                    if attempt < retries:
                        await asyncio.sleep(2 ** attempt)
                    continue

                return self._parse_response(data, model)

            except httpx.TimeoutException as e:
                logger.warning(
                    f"Ollama timeout on attempt {attempt + 1}/{retries + 1} "
                    f"(model={model}): {e}"
                )
                last_error = OllamaPipelineError(f"Timeout: {e}")
                if attempt < retries:
                    await asyncio.sleep(2 ** attempt)

            except httpx.ConnectError as e:
                logger.error(f"Cannot connect to Ollama at {self.base_url}: {e}")
                raise OllamaPipelineError(
                    f"Cannot connect to Ollama at {self.base_url}. "
                    f"Is Ollama running? Try: ollama serve"
                ) from e

            except Exception as e:
                logger.error(f"Unexpected error calling Ollama: {e}")
                last_error = OllamaPipelineError(f"Unexpected error: {e}")
                if attempt < retries:
                    await asyncio.sleep(2 ** attempt)

        raise last_error or OllamaPipelineError("All retries exhausted")

    # ── Multi-turn Call (simulate via full context) ───────────────────

    async def call_followup(
        self,
        model: str,
        session_key: str,
        user_prompt: str,
        thinking: dict | None = None,
        max_tokens: int | None = None,
        **kwargs,
    ) -> dict[str, Any]:
        """
        Follow-up call. Ollama has no session state, so this just sends
        the user_prompt as a fresh call (system_prompt empty).
        For true multi-turn, the caller should accumulate context.
        """
        return await self.call(
            model=model,
            system_prompt="",
            user_prompt=user_prompt,
            max_tokens=max_tokens,
            **kwargs,
        )

    # ── Batch Parallel Calls ─────────────────────────────────────────

    async def call_batch(
        self,
        requests: list[dict[str, Any]],
        max_concurrency: int = 1,
    ) -> list[dict[str, Any] | ClaudioPipelineError]:
        """
        Execute multiple calls with concurrency limit.
        Default concurrency 1 for Ollama (VRAM constraint with 14B models).
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
            f"Ollama batch complete: {succeeded}/{len(requests)} succeeded, {failed} failed"
        )

        return results

    # ── Session Management (no-op for Ollama) ────────────────────────

    async def delete_session(self, session_key: str) -> bool:
        """No-op: Ollama has no session state."""
        return True

    async def list_sessions(self) -> dict:
        """No-op: Ollama has no session state."""
        return {"sessions": {}, "count": 0}

    # ── Health Check ─────────────────────────────────────────────────

    async def health_check(self) -> bool:
        """Check if Ollama is reachable by listing models."""
        try:
            client = await self._get_client()
            response = await client.get(
                f"{self.base_url}/api/tags",
                timeout=5.0,
            )
            return response.status_code == 200
        except Exception:
            return False

    # ── Response Parsing ─────────────────────────────────────────────

    @staticmethod
    def _parse_response(data: dict, model: str = "") -> dict[str, Any]:
        """
        Parse Ollama API response into ClaudioPipelineService-compatible format.

        Ollama response: {"message": {"content": "..."}, "prompt_eval_count": N, ...}
        Output format:   {"text": "...", "thinking": "", "usage": {...}, "model": "..."}
        """
        content = data.get("message", {}).get("content", "")
        total_duration = data.get("total_duration", 0) / 1e9  # ns → s

        if total_duration > 0:
            eval_count = data.get("eval_count", 0)
            tokens_per_sec = eval_count / total_duration if total_duration > 0 else 0
            logger.info(f"🦙 Ollama completed in {total_duration:.1f}s ({tokens_per_sec:.1f} tok/s)")

        return {
            "text": content,
            "thinking": "",  # Ollama doesn't support extended thinking
            "usage": {
                "input_tokens": data.get("prompt_eval_count", 0),
                "output_tokens": data.get("eval_count", 0),
            },
            "model": data.get("model", model),
            "stop_reason": "end_turn" if data.get("done", True) else "length",
            "raw": data,
        }

    # ── JSON Extraction (reuse from ClaudioPipelineService) ──────────

    @staticmethod
    def extract_json(text: str) -> dict | list | None:
        """
        Extract JSON from AI response text.
        Enhanced for local models that often wrap JSON in markdown.
        """
        text = text.strip()

        # Try direct parse
        try:
            return json.loads(text)
        except (json.JSONDecodeError, ValueError):
            pass

        # Try extracting from ```json ... ``` or ``` ... ``` blocks
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
