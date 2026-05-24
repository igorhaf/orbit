"""
Claudius Pipeline Service
Direct HTTP client for the Claudius API proxy (Claude CLI wrapper).

Bypasses AIOrchestrator intentionally:
- No provider selection needed (all calls go to Claudius)
- No Redis cache needed (subscription has no per-call cost)
- Explicit model control per phase (Haiku/Sonnet/Opus)
- Multi-turn session management via session_key
- Extended thinking control via budget_tokens
"""

import asyncio
import json
import logging
import os
import re
import time
from datetime import datetime
from typing import Any
from uuid import uuid4

import httpx
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Claudius proxy base URL and API key
CLAUDIUS_BASE_URL = os.getenv("CLAUDIUS_BASE_URL", "http://localhost:8001")
CLAUDIUS_API_KEY = os.getenv("CLAUDIUS_API_KEY", "123456789")

# Model identifiers
MODEL_HAIKU = "claude-haiku-4-5"
MODEL_SONNET = "claude-sonnet-4-6"
MODEL_OPUS = "claude-opus-4-7"

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


class ClaudiusPipelineError(Exception):
    """Raised when a Claudius API call fails after all retries."""
    pass


class ClaudiusQuotaExhaustedError(ClaudiusPipelineError):
    """Raised quando Claude CLI responde HTTP 200 mas o texto indica limite de cota."""
    pass


_QUOTA_PATTERNS = re.compile(
    r"(hit your (usage )?limit|usage limit reached|rate limit|"
    r"resets? (at|in|on)|quota exceeded|you've reached your|"
    r"try again (later|in \d))",
    re.IGNORECASE,
)


class ClaudiusPipelineService:
    """
    Direct HTTP client for Claudius proxy.

    Usage:
        service = ClaudiusPipelineService()

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

    def __init__(
        self,
        base_url: str | None = None,
        db: Session | None = None,
        default_usage_type: str | None = None,
    ):
        self.base_url = (base_url or CLAUDIUS_BASE_URL).rstrip("/")
        self._client: httpx.AsyncClient | None = None
        self.db = db
        self.default_usage_type = default_usage_type

    def _log_execution(
        self,
        *,
        usage_type: str | None,
        model: str,
        system_prompt: str,
        user_prompt: str,
        result: dict | None,
        start_time: float,
        error: Exception | None = None,
    ) -> None:
        if not self.db or not usage_type:
            return
        try:
            from app.models.ai_execution import AIExecution
            from app.models.ai_model import AIModel

            ai_model_id = None
            try:
                am = (
                    self.db.query(AIModel)
                    .filter(
                        AIModel.provider == "claudius",
                        AIModel.config["model_id"].astext == model,
                    )
                    .first()
                )
                if am:
                    ai_model_id = am.id
            except Exception:
                pass

            usage = (result or {}).get("usage") or {}
            total = (
                (usage.get("input_tokens") or 0) + (usage.get("output_tokens") or 0)
                if usage
                else None
            )
            log = AIExecution(
                ai_model_id=ai_model_id,
                usage_type=usage_type,
                input_messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                response_content=(result or {}).get("text"),
                input_tokens=usage.get("input_tokens"),
                output_tokens=usage.get("output_tokens"),
                total_tokens=total,
                provider="claudius",
                model_name=model,
                execution_time_ms=int((time.time() - start_time) * 1000),
                execution_metadata={"source": "claudius_pipeline"},
                error_message=str(error) if error else None,
                created_at=datetime.utcnow(),
            )
            self.db.add(log)
            self.db.commit()
        except Exception as log_err:
            try:
                self.db.rollback()
            except Exception:
                pass
            logger.warning(f"ai_executions log failed (non-blocking): {log_err}")

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                headers={
                    "x-api-key": CLAUDIUS_API_KEY,
                    "Accept-Encoding": "gzip",
                },
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
        usage_type: str | None = None,
        **kwargs,  # Accept and ignore Ollama params for cross-provider compat
    ) -> dict[str, Any]:
        """
        Make a single non-streaming call to Claudius.

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
        start_time = time.time()
        usage_type = usage_type or self.default_usage_type

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
                        f"Claudius returned {response.status_code} on attempt {attempt + 1}: {error_text}"
                    )
                    last_error = ClaudiusPipelineError(
                        f"HTTP {response.status_code}: {error_text}"
                    )
                    if attempt < retries:
                        await asyncio.sleep(2 ** attempt)
                    continue

                data = response.json()

                # Deteccao de quota: CLI retorna HTTP 200 com texto de limite e tokens=0
                text_blocks = [b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"]
                preview_text = "".join(text_blocks)
                usage_data = data.get("usage") or {}
                in_tok = usage_data.get("input_tokens", 0) or 0
                out_tok = usage_data.get("output_tokens", 0) or 0
                if in_tok == 0 and out_tok == 0 and len(preview_text) < 500 and _QUOTA_PATTERNS.search(preview_text):
                    quota_err = ClaudiusQuotaExhaustedError(f"Claude CLI quota exhausted: {preview_text[:200]}")
                    self._log_execution(
                        usage_type=usage_type, model=model,
                        system_prompt=system_prompt, user_prompt=user_prompt,
                        result=None, start_time=start_time, error=quota_err,
                    )
                    raise quota_err

                parsed = self._parse_response(data)
                self._log_execution(
                    usage_type=usage_type,
                    model=model,
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    result=parsed,
                    start_time=start_time,
                )
                return parsed

            except httpx.TimeoutException as e:
                logger.warning(
                    f"Claudius timeout on attempt {attempt + 1}/{retries + 1} "
                    f"(model={model}, timeout={timeout}s): {e}"
                )
                last_error = ClaudiusPipelineError(f"Timeout after {timeout}s: {e}")
                if attempt < retries:
                    timeout = int(timeout * 1.5)  # Increase timeout on retry
                    await asyncio.sleep(2 ** attempt)

            except httpx.ConnectError as e:
                logger.error(f"Cannot connect to Claudius at {self.base_url}: {e}")
                raise ClaudiusPipelineError(
                    f"Cannot connect to Claudius at {self.base_url}. Is it running?"
                ) from e

            except ClaudiusQuotaExhaustedError:
                # Quota exhausted: sem retry, propaga pra marcar pipeline como interrupted
                raise

            except Exception as e:
                logger.error(f"Unexpected error calling Claudius: {e}")
                last_error = ClaudiusPipelineError(f"Unexpected error: {e}")
                if attempt < retries:
                    await asyncio.sleep(2 ** attempt)

        self._log_execution(
            usage_type=usage_type,
            model=model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            result=None,
            start_time=start_time,
            error=last_error,
        )
        raise last_error or ClaudiusPipelineError("All retries exhausted")

    # ── Multi-turn Call (resume session) ─────────────────────────────────

    async def call_followup(
        self,
        model: str,
        session_key: str,
        user_prompt: str,
        thinking: dict | None = None,
        max_tokens: int | None = None,
        **kwargs,  # Accept and ignore Ollama params for cross-provider compat
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
        on_item_complete: Any = None,
    ) -> list[dict[str, Any] | ClaudiusPipelineError]:
        """
        Execute multiple calls in parallel with concurrency limit.

        Each request dict should have keys matching call() parameters:
        - model, system_prompt, user_prompt, session_key?, thinking?, max_tokens?

        on_item_complete: optional async callback(index, result, total) called
        as each item finishes, enabling real-time progress telemetry.

        Returns list of results (dict) or ClaudiusPipelineError for failed calls.
        """
        semaphore = asyncio.Semaphore(max_concurrency)
        results: list[dict[str, Any] | ClaudiusPipelineError] = [None] * len(requests)
        quota_hit: dict[str, Any] = {"flag": False, "error": None}

        async def _process(index: int, req: dict):
            async with semaphore:
                # Se outro item ja detectou quota, abortar sem chamar
                if quota_hit["flag"]:
                    results[index] = quota_hit["error"]
                    return
                try:
                    result = await self.call(**req)
                    results[index] = result
                except ClaudiusQuotaExhaustedError as e:
                    quota_hit["flag"] = True
                    quota_hit["error"] = e
                    results[index] = e
                    logger.warning(f"Batch item {index} hit quota; aborting remaining items")
                except ClaudiusPipelineError as e:
                    logger.warning(f"Batch item {index} failed: {e}")
                    results[index] = e
                # Notify caller immediately when each item completes
                if on_item_complete:
                    try:
                        await on_item_complete(index, results[index], len(requests))
                    except Exception:
                        pass

        tasks = [_process(i, req) for i, req in enumerate(requests)]
        await asyncio.gather(*tasks)

        succeeded = sum(1 for r in results if not isinstance(r, ClaudiusPipelineError))
        failed = len(results) - succeeded
        logger.info(
            f"Batch complete: {succeeded}/{len(requests)} succeeded, {failed} failed"
        )

        # Se qualquer item foi abortado por quota, propaga pra cima (pipeline marca interrupted)
        if quota_hit["flag"]:
            raise quota_hit["error"]

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
        """Check if Claudius is reachable."""
        try:
            client = await self._get_client()
            response = await client.get("/api/health", timeout=5.0)
            return response.status_code == 200
        except Exception:
            return False

    async def quota_status(self) -> dict:
        """Snapshot da cota do Claude (sem custar tokens).

        Le do quota_tracker do claudius. Use isso pra polling barato.
        Use quota_probe() so quando precisar validar com chamada real (5 tokens).
        """
        try:
            client = await self._get_client()
            response = await client.get("/api/quota/status", timeout=httpx.Timeout(10.0, connect=5.0))
            if response.status_code == 200:
                return response.json()
            return {"available": True, "tier": "unknown", "error": f"HTTP {response.status_code}"}
        except Exception as e:
            logger.warning(f"quota_status failed: {e}")
            return {"available": True, "tier": "unknown", "error": f"{type(e).__name__}"}

    async def quota_history(self, limit: int = 50) -> dict:
        """Recent quota events for charts."""
        try:
            client = await self._get_client()
            response = await client.get(
                f"/api/quota/history?limit={limit}",
                timeout=httpx.Timeout(10.0, connect=5.0),
            )
            if response.status_code == 200:
                return response.json()
            return {"events": [], "error": f"HTTP {response.status_code}"}
        except Exception as e:
            return {"events": [], "error": str(e)[:200]}

    async def quota_set_tier(self, tier: str) -> dict:
        """Change active plan tier in claudius."""
        try:
            client = await self._get_client()
            response = await client.post(
                "/api/quota/tier",
                json={"tier": tier},
                timeout=httpx.Timeout(10.0, connect=5.0),
            )
            return response.json()
        except Exception as e:
            return {"error": str(e)[:200]}

    async def quota_scan_now(self) -> dict:
        """Force refresh: claudius re-scans ~/.claude/projects jsonl files."""
        try:
            client = await self._get_client()
            response = await client.post(
                "/api/quota/scan-now",
                timeout=httpx.Timeout(15.0, connect=5.0),
            )
            return response.json()
        except Exception as e:
            return {"error": str(e)[:200]}

    async def quota_plan(self, project_meta: dict, mode: str = "balanced",
                         profile: dict | None = None) -> dict:
        """Ask claudius to estimate a Deep Pipeline cost vs remaining quota."""
        try:
            client = await self._get_client()
            payload = {"project_meta": project_meta, "mode": mode}
            if profile:
                payload["profile"] = profile
            response = await client.post(
                "/api/quota/plan",
                json=payload,
                timeout=httpx.Timeout(15.0, connect=5.0),
            )
            return response.json()
        except Exception as e:
            logger.warning(f"quota_plan failed: {e}")
            return {"error": str(e)[:200], "recommendation": "proceed", "fits": True}

    async def quota_probe(self) -> dict:
        """Ping Claude com prompt minimo pra detectar se cota esta disponivel.

        Retorna {"available": bool, "reason": str, "resets_at": str | None, "raw": str}.
        Usado pra UX: usuario clica "Retomar" e verificamos antes de disparar pipeline.
        Para polling barato, prefira quota_status() (sem custo de tokens).
        """
        try:
            client = await self._get_client()
            response = await client.post(
                "/v1/messages",
                json={
                    "model": MODEL_SONNET,
                    "max_tokens": 10,
                    "messages": [{"role": "user", "content": "ping"}],
                },
                timeout=httpx.Timeout(60.0, connect=5.0),
            )
            if response.status_code != 200:
                return {"available": False, "reason": "http_error", "resets_at": None, "raw": f"HTTP {response.status_code}"}
            data = response.json()
            text_blocks = [b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"]
            preview = "".join(text_blocks)
            usage = data.get("usage") or {}
            in_tok = usage.get("input_tokens", 0) or 0
            out_tok = usage.get("output_tokens", 0) or 0
            if in_tok == 0 and out_tok == 0 and len(preview) < 500 and _QUOTA_PATTERNS.search(preview):
                resets_at = None
                m = re.search(r"resets?\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*[ap]m\s*\([A-Z]+\))", preview, re.IGNORECASE)
                if m:
                    resets_at = m.group(1)
                return {"available": False, "reason": "quota_exhausted", "resets_at": resets_at, "raw": preview[:200]}
            return {"available": True, "reason": "ok", "resets_at": None, "raw": preview[:200]}
        except Exception as e:
            logger.exception("quota_probe failed")
            return {"available": False, "reason": "unreachable", "resets_at": None, "raw": f"{type(e).__name__}: {str(e)[:200]}"}

    # ── Response Parsing ─────────────────────────────────────────────────

    @staticmethod
    def _parse_response(data: dict) -> dict[str, Any]:
        """
        Parse Claudius API response into a clean result dict.

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
