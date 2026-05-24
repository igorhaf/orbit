"""
Provider execution mixin for AIOrchestrator.

v2.5: claudius-only lockdown. Contains _execute_with_config() (chain dispatch)
and _execute_claudius() (non-streaming HTTP call to the local Claudius proxy).
"""

from typing import Any, Dict, List, Optional
from uuid import UUID
import logging
import os
import time
import json
import asyncio

from .constants import (
    _get_model_semaphore, UsageType, logger,
)
from app.models.system_settings import SystemSettings  # PROMPT #207 - System default timeout
from app.services.console_logger import get_console_logger  # PROMPT #168 - Real-time Console Logs


class ProvidersMixin:
    """Non-streaming provider execution methods and _execute_with_config."""

    async def _execute_with_config(
        self,
        model_config: Dict,
        messages: List[Dict],
        system_prompt: Optional[str] = None,
        max_tokens: Optional[int] = None,
        overrides: Optional[Dict] = None,
        project_id: Optional[UUID] = None,
        thinking: Optional[Dict] = None,
        disable_cwd: bool = False,
        disable_tools: bool = False,
    ) -> Dict:
        """
        PROMPT #122 - Execute with a specific model config (for chain-based execution).
        Bypasses choose_model() and uses the provided config directly.

        PROMPT #206 - overrides dict can contain:
          - _override_max_tokens: capped by model (can reduce, not increase)
          - _override_temperature: free value (0.0-2.0)
        """
        provider = model_config["provider"]
        model_name = model_config["model"]
        tokens_limit = max_tokens if max_tokens is not None else model_config["max_tokens"]
        temperature = model_config["temperature"]

        # PROMPT #221 - Sampling parameters (primarily for Ollama)
        top_p = model_config.get("top_p")
        top_k = model_config.get("top_k")
        # PROMPT #289 - Ollama context/batch/keep_alive from model config
        _num_ctx = model_config.get("context_length")
        _num_batch = model_config.get("num_batch")
        _keep_alive = model_config.get("keep_alive")
        # Claudius business_mode from model config
        _business_mode = model_config.get("business_mode", False)

        # PROMPT #206 - Apply utility node overrides
        if overrides:
            if overrides.get("_override_max_tokens") is not None:
                tokens_limit = overrides["_override_max_tokens"]
                logger.info(f"🔧 Override max_tokens → {tokens_limit}")
            if overrides.get("_override_temperature") is not None:
                temperature = overrides["_override_temperature"]
                logger.info(f"🔧 Override temperature → {temperature}")

        # Rate limiting check
        if self.rate_limiter and model_config.get("rate_limit_requests"):
            can_proceed, wait_time = self.rate_limiter.check_rate_limit(
                model_config["db_model_id"],
                model_config["rate_limit_requests"],
                model_config["rate_limit_window_seconds"],
            )
            if not can_proceed:
                logger.info(f"⏳ Rate limit for {model_config['db_model_name']}, waiting {wait_time:.1f}s")
                await asyncio.sleep(wait_time)
            self.rate_limiter.record_request(
                model_config["db_model_id"],
                model_config["rate_limit_window_seconds"],
            )

        # PROMPT #228 - Concurrency control for chain execution
        _chain_sem = None
        _chain_max_concurrent = model_config.get('max_concurrent_requests')
        if _chain_max_concurrent:
            _chain_sem = _get_model_semaphore(model_config['db_model_id'], _chain_max_concurrent)
            await _chain_sem.acquire()
            logger.info(
                f"🔒 Chain concurrency slot acquired for {model_config['db_model_name']} "
                f"(max: {_chain_max_concurrent})"
            )

        # PROMPT #127 - Pass API key from chain model config to override default client key
        api_key_override = model_config.get("api_key")

        # PROMPT #207 - Resolve timeout: diagram node → model config → system settings
        resolved_timeout = None
        if overrides and overrides.get("_override_timeout") is not None:
            resolved_timeout = float(overrides["_override_timeout"])
            logger.info(f"⏱️ Chain timeout from diagram node: {resolved_timeout}s")
        elif model_config.get("timeout_seconds"):
            resolved_timeout = float(model_config["timeout_seconds"])
            logger.info(f"⏱️ Chain timeout from model config: {resolved_timeout}s")
        else:
            # Fallback to system settings
            try:
                setting = self.db.query(SystemSettings).filter(
                    SystemSettings.key == "default_api_timeout_seconds"
                ).first()
                if setting and setting.value:
                    resolved_timeout = float(setting.value)
            except Exception:
                pass
            if not resolved_timeout:
                resolved_timeout = 120.0

        # PROMPT #231 - Adaptive timeout: if router estimated tokens, adjust timeout
        if overrides:
            _est_tokens = overrides.get("_router_estimated_tokens")
            _provider = model_config.get("provider")
            if _est_tokens and _provider:
                _speed = self.PROVIDER_SPEED_PROFILES.get(_provider, 50)
                _adaptive = (_est_tokens / _speed) * 1.5 + 5.0
                if _adaptive > resolved_timeout:
                    logger.info(
                        f"⏱️ Chain adaptive timeout: {_adaptive:.1f}s "
                        f"(est {_est_tokens} tokens @ {_speed} tok/s) > static {resolved_timeout}s"
                    )
                    resolved_timeout = _adaptive

        # PROMPT #217 - Streaming dispatch with fallback to non-streaming
        import uuid as _uuid
        _stream_id = str(_uuid.uuid4())
        _model_label = f"{provider}/{model_name}"
        _stream_cb, _chunk_counter, _flush_cb = self._create_stream_callback(
            stream_id=_stream_id, model_label=_model_label,
        )

        # PROMPT #253 - Resolve cwd from project_id for Claudius calls
        # PROMPT #259 - disable_cwd sends /tmp so Claude CLI runs in neutral dir
        # (cwd=None would inherit poc_chat's working dir, causing agent mode)
        _claudius_cwd = None
        if provider == "claudius":
            if disable_cwd:
                _claudius_cwd = "/tmp"
                logger.info("📂 Claudius cwd: /tmp (disable_cwd=True, neutral dir)")
            elif project_id:
                try:
                    from app.models.project import Project
                    _proj = self.db.query(Project).filter(Project.id == project_id).first()
                    if _proj and _proj.code_path:
                        _claudius_cwd = _proj.code_path
                        logger.info(f"📂 Claudius cwd: {_claudius_cwd}")
                except Exception as _cwd_err:
                    logger.warning(f"Could not resolve cwd for Claudius: {_cwd_err}")

        try:
            # v2.5: claudius-only lockdown. Streaming first; fallback to non-streaming.
            try:
                result = await self._execute_claudius_streaming(
                    model_name, messages, system_prompt, tokens_limit, temperature,
                    stream_callback=_stream_cb, flush_callback=_flush_cb,
                    timeout_seconds=resolved_timeout, cwd=_claudius_cwd,
                    thinking=thinking, disable_tools=disable_tools,
                )
                console = get_console_logger()
                asyncio.create_task(console.log_ai_streaming_chunk(
                    stream_id=_stream_id, model=_model_label,
                    chunk_text="", chunk_index=_chunk_counter[0] + 1,
                    is_complete=True, accumulated_text=result.get("content", ""),
                ))
            except Exception as stream_err:
                logger.warning(f"⚠️ Chain streaming failed, falling back: {stream_err}")
                result = await self._execute_claudius(
                    model_name, messages, system_prompt, tokens_limit, temperature,
                    timeout_seconds=resolved_timeout, cwd=_claudius_cwd,
                    thinking=thinking, disable_tools=disable_tools,
                )

            result["db_model_id"] = model_config["db_model_id"]
            result["db_model_name"] = model_config["db_model_name"]

            # Business mode: translate technical output to business language (ORBIT-side)
            if _business_mode and result.get("content"):
                result["content"] = await self._translate_to_business(result["content"])

            return result
        finally:
            # PROMPT #228 - Release concurrency slot
            if _chain_sem is not None:
                _chain_sem.release()
                logger.info(f"🔓 Chain concurrency slot released for {model_config.get('db_model_name', 'unknown')}")

    # ── Business Mode: translate technical output to business language ──────

    BUSINESS_TRANSLATE_PROMPT = (
        "Voce e um tradutor de linguagem tecnica para linguagem de negocio. "
        "Recebera uma saida tecnica de um sistema de software. "
        "Sua tarefa e reescrever essa saida de forma funcional, "
        "descrevendo O QUE o sistema faz e QUAL o impacto, "
        "sem mencionar detalhes de implementacao como nomes de funcoes, "
        "variaveis, tipos de dados, frameworks, ou trechos de codigo. "
        "Mantenha o mesmo idioma do texto original. "
        "Seja conciso e direto. Nao adicione introducoes como 'Aqui esta a traducao'. "
        "Apenas reescreva o conteudo."
    )

    async def _translate_to_business(self, technical_text: str) -> str:
        """Translate technical AI output to business language using Haiku via Claudius."""
        try:
            result = await self._execute_claudius(
                model="haiku",
                messages=[{"role": "user", "content": technical_text}],
                system_prompt=self.BUSINESS_TRANSLATE_PROMPT,
                max_tokens=4000,
                temperature=0.3,
                timeout_seconds=120,
            )
            translated = result.get("content", "")
            return translated if translated else technical_text
        except Exception as e:
            logger.warning(f"Business mode translation failed, using original: {e}")
            return technical_text

    async def _execute_claudius(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str],
        max_tokens: int,
        temperature: float,
        timeout_seconds: Optional[float] = None,
        cwd: Optional[str] = None,
        thinking: Optional[Dict] = None,
        disable_tools: bool = False,
    ) -> Dict:
        """
        PROMPT #253 - Execute via Claudius proxy using httpx (not SDK).
        Supports cwd (working directory) and thinking (extended thinking)
        which are Claudius-specific parameters not available in AsyncAnthropic SDK.
        """
        import httpx

        claudius_base = os.getenv("CLAUDIUS_BASE_URL", "http://localhost:8001")
        claudius_key = os.getenv("CLAUDIUS_API_KEY", "123456789")
        url = f"{claudius_base}/v1/messages"

        body: Dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
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

        async with httpx.AsyncClient(timeout=httpx.Timeout(_timeout)) as client:
            resp = await client.post(
                url,
                json=body,
                headers={
                    "Content-Type": "application/json",
                    "anthropic-version": "2023-06-01",
                    "x-api-key": claudius_key,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        # Extract text from content blocks (may include thinking + text blocks)
        content_text = ""
        thinking_text = ""
        for block in data.get("content", []):
            if block.get("type") == "text":
                content_text += block.get("text", "")
            elif block.get("type") == "thinking":
                thinking_text += block.get("thinking", "")

        usage = data.get("usage", {})
        result = {
            "provider": "claudius",
            "model": model,
            "content": content_text,
            "usage": {
                "input_tokens": usage.get("input_tokens", 0),
                "output_tokens": usage.get("output_tokens", 0),
                "total_tokens": usage.get("input_tokens", 0) + usage.get("output_tokens", 0),
            },
        }
        if thinking_text:
            result["thinking"] = thinking_text

        return result

