"""
Provider execution mixin for AIOrchestrator.
Contains _execute_with_config() and non-streaming provider methods:
_execute_anthropic, _execute_claudius, _execute_openai, _execute_google,
_execute_ollama, _execute_cohere.
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
            try:
                if provider == "anthropic":
                    result = await self._execute_anthropic_streaming(model_name, messages, system_prompt, tokens_limit, temperature, stream_callback=_stream_cb, flush_callback=_flush_cb, api_key_override=api_key_override, timeout_seconds=resolved_timeout)
                elif provider == "openai":
                    result = await self._execute_openai_streaming(model_name, messages, system_prompt, tokens_limit, temperature, stream_callback=_stream_cb, flush_callback=_flush_cb, api_key_override=api_key_override, timeout_seconds=resolved_timeout)
                elif provider == "google":
                    result = await self._execute_google_streaming(model_name, messages, system_prompt, tokens_limit, temperature, stream_callback=_stream_cb, flush_callback=_flush_cb, api_key_override=api_key_override, timeout_seconds=resolved_timeout)
                elif provider == "ollama":
                    result = await self._execute_ollama_streaming(model_name, messages, system_prompt, tokens_limit, temperature, stream_callback=_stream_cb, flush_callback=_flush_cb, timeout_seconds=resolved_timeout, top_p=top_p, top_k=top_k, num_ctx=_num_ctx, num_batch=_num_batch, keep_alive=_keep_alive)
                elif provider == "cohere":
                    result = await self._execute_cohere_streaming(model_name, messages, system_prompt, tokens_limit, temperature, stream_callback=_stream_cb, flush_callback=_flush_cb, api_key_override=api_key_override, timeout_seconds=resolved_timeout)
                elif provider == "claudius":
                    result = await self._execute_claudius_streaming(model_name, messages, system_prompt, tokens_limit, temperature, stream_callback=_stream_cb, flush_callback=_flush_cb, timeout_seconds=resolved_timeout, cwd=_claudius_cwd, thinking=thinking, disable_tools=disable_tools)
                else:
                    raise ValueError(f"Provedor desconhecido: {provider}")

                # Emit stream completion
                console = get_console_logger()
                asyncio.create_task(console.log_ai_streaming_chunk(
                    stream_id=_stream_id, model=_model_label,
                    chunk_text="", chunk_index=_chunk_counter[0] + 1,
                    is_complete=True, accumulated_text=result.get("content", ""),
                ))
            except Exception as stream_err:
                logger.warning(f"⚠️ Chain streaming failed, falling back: {stream_err}")
                if provider == "anthropic":
                    result = await self._execute_anthropic(model_name, messages, system_prompt, tokens_limit, temperature, api_key_override=api_key_override, timeout_seconds=resolved_timeout)
                elif provider == "openai":
                    result = await self._execute_openai(model_name, messages, system_prompt, tokens_limit, temperature, api_key_override=api_key_override, timeout_seconds=resolved_timeout)
                elif provider == "google":
                    result = await self._execute_google(model_name, messages, system_prompt, tokens_limit, temperature, api_key_override=api_key_override, timeout_seconds=resolved_timeout)
                elif provider == "ollama":
                    result = await self._execute_ollama(model_name, messages, system_prompt, tokens_limit, temperature, timeout_seconds=resolved_timeout, top_p=top_p, top_k=top_k, num_ctx=_num_ctx, num_batch=_num_batch, keep_alive=_keep_alive)
                elif provider == "cohere":
                    result = await self._execute_cohere(model_name, messages, system_prompt, tokens_limit, temperature, api_key_override=api_key_override, timeout_seconds=resolved_timeout)
                elif provider == "claudius":
                    result = await self._execute_claudius(model_name, messages, system_prompt, tokens_limit, temperature, timeout_seconds=resolved_timeout, cwd=_claudius_cwd, thinking=thinking, disable_tools=disable_tools)
                else:
                    raise ValueError(f"Provedor desconhecido: {provider}")

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

    async def _execute_anthropic(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str],
        max_tokens: int,
        temperature: float,
        api_key_override: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
        client_key: str = "anthropic",
    ) -> Dict:
        """
        Executa com Anthropic Claude (ou Claudius proxy) usando configurações do banco
        PROMPT #51 - Dynamic AI Model Integration
        PROMPT #75 - Async execution with await (non-blocking)
        PROMPT #207 - Configurable timeout
        PROMPT #246 - client_key param for Claudius support
        """
        client = self.clients.get(client_key) or self.clients.get("anthropic")

        # PROMPT #127 - Use override key if provided (chain execution)
        # Skip override for claudius (no API key needed)
        if client_key != "claudius" and api_key_override and api_key_override not in ("CONFIGURE_VIA_WEB_INTERFACE", "configure-via-web-interface"):
            from anthropic import AsyncAnthropic
            client = AsyncAnthropic(api_key=api_key_override)

        # PROMPT #75 - Await async call to yield to event loop during API request
        # PROMPT #207 - Apply configurable timeout
        api_call = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system_prompt if system_prompt else "You are a helpful AI assistant.",
            messages=messages
        )
        if timeout_seconds:
            response = await asyncio.wait_for(api_call, timeout=timeout_seconds)
        else:
            response = await api_call

        return {
            "provider": client_key,
            "model": model,
            "content": response.content[0].text,
            "usage": {
                "input_tokens": response.usage.input_tokens,
                "output_tokens": response.usage.output_tokens,
                "total_tokens": response.usage.input_tokens + response.usage.output_tokens
            }
        }

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

    async def _execute_openai(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str],
        max_tokens: int,
        temperature: float,
        api_key_override: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
    ) -> Dict:
        """
        Executa com OpenAI GPT usando configurações do banco
        PROMPT #51 - Dynamic AI Model Integration
        PROMPT #75 - Async execution with await (non-blocking)
        PROMPT #207 - Configurable timeout
        """
        client = self.clients["openai"]  # AsyncOpenAI instance

        # PROMPT #127 - Use override key if provided (chain execution)
        if api_key_override and api_key_override not in ("CONFIGURE_VIA_WEB_INTERFACE", "configure-via-web-interface"):
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=api_key_override)

        # Adicionar system message se fornecido
        openai_messages = []
        if system_prompt:
            openai_messages.append({
                "role": "system",
                "content": system_prompt
            })
        openai_messages.extend(messages)

        # PROMPT #75 - Await async call to yield to event loop during API request
        # PROMPT #207 - Apply configurable timeout
        api_call = client.chat.completions.create(
            model=model,
            messages=openai_messages,
            max_tokens=max_tokens,
            temperature=temperature
        )
        if timeout_seconds:
            response = await asyncio.wait_for(api_call, timeout=timeout_seconds)
        else:
            response = await api_call

        return {
            "provider": "openai",
            "model": model,
            "content": response.choices[0].message.content,
            "usage": {
                "input_tokens": response.usage.prompt_tokens,
                "output_tokens": response.usage.completion_tokens,
                "total_tokens": response.usage.total_tokens
            }
        }

    async def _execute_google(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str],
        max_tokens: int,
        temperature: float,
        api_key_override: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
    ) -> Dict:
        """
        Executa com Google Gemini usando configurações do banco
        PROMPT #51 - Dynamic AI Model Integration
        PROMPT #75 - Async execution with httpx AsyncClient (non-blocking)
        PROMPT #207 - Configurable timeout
        """
        google_config = self.clients["google"]  # Dict with api_key and http_client
        api_key = api_key_override or google_config["api_key"]
        http_client = google_config["http_client"]

        # Converter mensagens para formato Gemini
        conversation = []
        if system_prompt:
            conversation.append(f"System Instructions: {system_prompt}\n")

        for msg in messages:
            role = "User" if msg["role"] == "user" else "Model"
            conversation.append(f"{role}: {msg['content']}")

        prompt = "\n\n".join(conversation)

        # Construir URL e payload para Gemini API
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"

        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "maxOutputTokens": max_tokens,
                "temperature": temperature
            }
        }

        # PROMPT #75 - Await async HTTP call to yield to event loop during API request
        # PROMPT #207 - Use configurable timeout (was hardcoded 120.0)
        effective_timeout = timeout_seconds if timeout_seconds else 120.0
        try:
            response = await http_client.post(url, json=payload, timeout=effective_timeout)
        except Exception as http_error:
            raise Exception(f"Requisicao HTTP falhou: {type(http_error).__name__}: {str(http_error)}")

        # PROMPT #118 FIX - Better error handling for Gemini API
        try:
            data = response.json()
        except Exception as json_error:
            raise Exception(f"Falha ao analisar resposta JSON: {response.text[:500]}")

        # Check for API error in response body (Gemini can return errors with 200 status)
        if "error" in data:
            error_msg = data.get("error", {}).get("message", str(data["error"]))
            # PROMPT #159 - Extract retry time and set provider backoff
            # Error format: "...Please retry in 29.438272654s."
            if "retry in" in error_msg.lower():
                import re
                match = re.search(r"retry in (\d+\.?\d*)s", error_msg.lower())
                if match:
                    retry_seconds = float(match.group(1))
                    # Store model_id in instance for backoff (set by execute())
                    if hasattr(self, '_current_model_id') and self._current_model_id and self.rate_limiter:
                        self.rate_limiter.set_provider_backoff(self._current_model_id, retry_seconds)
            raise Exception(f"Erro da API Gemini: {error_msg}")

        # Check HTTP status
        response.raise_for_status()

        # Check if candidates exist
        candidates = data.get("candidates", [])
        if not candidates:
            # Check for safety blocks or other issues
            prompt_feedback = data.get("promptFeedback", {})
            block_reason = prompt_feedback.get("blockReason", "Unknown")
            raise Exception(f"Gemini não retornou candidatos. Motivo do bloqueio: {block_reason}")

        # Extract content from response
        candidate = candidates[0]
        content_data = candidate.get("content", {})
        parts = content_data.get("parts", [])

        if not parts:
            finish_reason = candidate.get("finishReason", "Unknown")
            raise Exception(f"Gemini retornou conteúdo vazio. Motivo da conclusão: {finish_reason}")

        content = parts[0].get("text", "")

        # Extract token usage from response (Gemini provides usageMetadata)
        usage_metadata = data.get("usageMetadata", {})

        return {
            "provider": "google",
            "model": model,
            "content": content,
            "usage": {
                "input_tokens": usage_metadata.get("promptTokenCount", 0),
                "output_tokens": usage_metadata.get("candidatesTokenCount", 0),
                "total_tokens": usage_metadata.get("totalTokenCount", 0)
            }
        }

    async def _execute_ollama(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str],
        max_tokens: int,
        temperature: float,
        timeout_seconds: Optional[float] = None,
        top_p: Optional[float] = None,
        top_k: Optional[int] = None,
        num_ctx: Optional[int] = None,
        num_batch: Optional[int] = None,
        keep_alive: Optional[str] = None,
    ) -> Dict:
        """
        Executa com Ollama local LLM usando configurações do banco
        PROMPT #106 - Ollama local LLM integration
        PROMPT #207 - Configurable timeout
        PROMPT #221 - top_p/top_k sampling parameters

        Ollama API é compatível com OpenAI, usando endpoint /api/chat
        Docs: https://github.com/ollama/ollama/blob/main/docs/api.md
        """
        ollama_config = self.clients["ollama"]
        base_url = ollama_config["base_url"]
        http_client = ollama_config["http_client"]

        # Construir mensagens no formato Ollama (compatível com OpenAI)
        ollama_messages = []
        if system_prompt:
            ollama_messages.append({
                "role": "system",
                "content": system_prompt
            })
        ollama_messages.extend(messages)

        # Endpoint e payload para Ollama
        url = f"{base_url}/api/chat"

        # PROMPT #221 - Build options with optional top_p/top_k
        # PROMPT #224 - Add num_ctx to limit context window
        # PROMPT #229 - Ollama GPU optimization: num_gpu layers, keep_alive
        # PROMPT #289 - Read num_ctx/num_batch/keep_alive from model config instead of hardcoding
        options = {
            "num_predict": max_tokens,
            "temperature": temperature,
            "num_ctx": num_ctx or 4096,
            "num_gpu": 99,  # PROMPT #229 - Offload all layers to GPU for max throughput
            "num_batch": num_batch or 512,  # PROMPT #229 - Batch size for prompt eval
        }
        if top_p is not None:
            options["top_p"] = top_p
        if top_k is not None:
            options["top_k"] = top_k

        payload = {
            "model": model,
            "messages": ollama_messages,
            "stream": False,
            "options": options,
            "keep_alive": keep_alive or "5m",  # PROMPT #289 - Configurable keep_alive
        }

        logger.info(f"🦙 Calling Ollama: {url} with model {model} (options={options})")

        # PROMPT #207 - Use configurable timeout if provided (Ollama client already has its own timeout)
        try:
            if timeout_seconds:
                response = await asyncio.wait_for(http_client.post(url, json=payload), timeout=timeout_seconds)
            else:
                response = await http_client.post(url, json=payload)
            response.raise_for_status()
        except asyncio.TimeoutError:
            raise Exception(f"Requisicao Ollama expirou apos {timeout_seconds}s")
        except Exception as e:
            logger.error(f"❌ Ollama request failed: {e}")
            logger.error(f"   Tip: Without GPU, large prompts can take 2-5+ minutes. Consider enabling GPU or using cloud APIs.")
            raise

        data = response.json()

        # PROMPT #218 - Ollama returns HTTP 200 with {"error": "..."} for OOM and other errors
        if "error" in data:
            error_msg = data["error"]
            logger.error(f"❌ Ollama returned error: {error_msg}")
            raise Exception(f"Erro Ollama: {error_msg}")

        content = data.get("message", {}).get("content", "")

        # PROMPT #240 - Strip <think>...</think> tags from qwen3 thinking mode (non-streaming)
        if content:
            import re
            cleaned = re.sub(r'<think>[\s\S]*?</think>\s*', '', content).strip()
            if cleaned != content:
                logger.info(f"🧠 Stripped thinking tags from Ollama response ({len(content)} → {len(cleaned)} chars)")
                content = cleaned

        # Log execution time info from response
        total_duration = data.get("total_duration", 0) / 1e9  # nanoseconds to seconds
        if total_duration > 0:
            logger.info(f"🦙 Ollama execution completed in {total_duration:.1f}s")

        # Ollama retorna token counts em eval_count e prompt_eval_count
        return {
            "provider": "ollama",
            "model": model,
            "content": content,
            "usage": {
                "input_tokens": data.get("prompt_eval_count", 0),
                "output_tokens": data.get("eval_count", 0),
                "total_tokens": data.get("prompt_eval_count", 0) + data.get("eval_count", 0)
            }
        }

    async def _execute_cohere(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str],
        max_tokens: int,
        temperature: float,
        api_key_override: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
    ) -> Dict:
        """
        Executa com Cohere AI usando configurações do banco
        PROMPT #122 - Cohere AI integration
        PROMPT #207 - Configurable timeout

        Cohere Chat API docs: https://docs.cohere.com/reference/chat

        Modelos disponíveis:
        - command-r-plus: Modelo mais poderoso para tarefas complexas
        - command-r: Modelo balanceado para uso geral
        - command-light: Modelo leve e rápido
        """
        cohere_config = self.clients["cohere"]
        api_key = api_key_override or cohere_config["api_key"]
        http_client = cohere_config["http_client"]

        # Converter mensagens para formato Cohere Chat
        # Cohere usa: role="USER" ou "CHATBOT", message="..."
        chat_history = []
        current_message = ""

        for msg in messages:
            role = msg.get("role", "user").lower()
            content = msg.get("content", "")

            # Cohere usa "USER" e "CHATBOT" como roles
            if role == "user":
                cohere_role = "USER"
            elif role == "assistant":
                cohere_role = "CHATBOT"
            else:
                cohere_role = "USER"

            chat_history.append({
                "role": cohere_role,
                "message": content
            })

        # A última mensagem do usuário vai no campo "message" separado
        if chat_history and chat_history[-1]["role"] == "USER":
            current_message = chat_history.pop()["message"]
        else:
            # Se não houver última mensagem do usuário, usar placeholder
            current_message = "Continue the conversation."

        # Construir payload para Cohere Chat API
        url = "https://api.cohere.ai/v1/chat"

        payload = {
            "model": model,
            "message": current_message,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        # Adicionar chat_history se existir
        if chat_history:
            payload["chat_history"] = chat_history

        # Adicionar preamble (system prompt) se fornecido
        if system_prompt:
            payload["preamble"] = system_prompt

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }

        logger.info(f"🟠 Calling Cohere: {url} with model {model}")

        # PROMPT #207 - Use configurable timeout
        effective_timeout = timeout_seconds if timeout_seconds else 60.0
        try:
            response = await http_client.post(url, json=payload, headers=headers, timeout=effective_timeout)
        except Exception as http_error:
            raise Exception(f"Requisicao HTTP falhou: {type(http_error).__name__}: {str(http_error)}")

        # Parse response
        try:
            data = response.json()
        except Exception as json_error:
            raise Exception(f"Falha ao analisar resposta JSON: {response.text[:500]}")

        # Check for API error
        if response.status_code != 200:
            error_msg = data.get("message", str(data))
            raise Exception(f"Erro da API Cohere ({response.status_code}): {error_msg}")

        # Extract content from response
        content = data.get("text", "")

        # Extract token usage from response
        meta = data.get("meta", {})
        tokens = meta.get("tokens", {})

        return {
            "provider": "cohere",
            "model": model,
            "content": content,
            "usage": {
                "input_tokens": tokens.get("input_tokens", 0),
                "output_tokens": tokens.get("output_tokens", 0),
                "total_tokens": tokens.get("input_tokens", 0) + tokens.get("output_tokens", 0)
            }
        }
