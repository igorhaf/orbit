"""
Streaming provider execution mixin for AIOrchestrator.
Contains _create_stream_callback() and all _execute_*_streaming() methods:
_execute_anthropic_streaming, _execute_claudio_streaming, _execute_openai_streaming,
_execute_google_streaming, _execute_ollama_streaming, _execute_cohere_streaming.
"""

from typing import Any, Dict, List, Optional
import logging
import os
import time
import json
import asyncio

from .satellite_logger import logger
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

    async def _execute_anthropic_streaming(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str],
        max_tokens: int,
        temperature: float,
        stream_callback,
        flush_callback,
        api_key_override: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
        client_key: str = "anthropic",
    ) -> Dict:
        """Anthropic/Claudio streaming using client.messages.stream()
        PROMPT #246 - client_key param for Claudio support
        """
        client = self.clients.get(client_key) or self.clients.get("anthropic")

        # Skip override for claudio (no API key needed)
        if client_key != "claudio" and api_key_override and api_key_override not in ("CONFIGURE_VIA_WEB_INTERFACE", "configure-via-web-interface"):
            from anthropic import AsyncAnthropic
            client = AsyncAnthropic(api_key=api_key_override)

        accumulated = ""
        input_tokens = 0
        output_tokens = 0
        _stream_start = time.time()

        async with client.messages.stream(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system_prompt or "You are a helpful AI assistant.",
            messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                accumulated += text
                await stream_callback(text)

            await flush_callback()
            final_message = await stream.get_final_message()
            input_tokens = final_message.usage.input_tokens
            output_tokens = final_message.usage.output_tokens

        # PROMPT #233 - CQ-3 fix: include execution_time_ms in streaming responses
        _streaming_time_ms = int((time.time() - _stream_start) * 1000)
        return {
            "provider": client_key,
            "model": model,
            "content": accumulated,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
                "execution_time_ms": _streaming_time_ms,
            }
        }

    async def _execute_claudio_streaming(
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
        business_mode: bool = False,
    ) -> Dict:
        """
        PROMPT #253 - Claudio streaming via httpx SSE.
        Supports cwd and thinking parameters.
        """
        import httpx

        claudio_base = os.getenv("CLAUDIO_BASE_URL", "http://localhost:8001")
        url = f"{claudio_base}/v1/messages"

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

        if business_mode:
            body["business_mode"] = True

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
                            raise RuntimeError(f"Claudio streaming error: {err_msg}")

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
            "provider": "claudio",
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

    async def _execute_openai_streaming(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str],
        max_tokens: int,
        temperature: float,
        stream_callback,
        flush_callback,
        api_key_override: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
    ) -> Dict:
        """OpenAI streaming using stream=True"""
        client = self.clients["openai"]

        if api_key_override and api_key_override not in ("CONFIGURE_VIA_WEB_INTERFACE", "configure-via-web-interface"):
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=api_key_override)

        openai_messages = []
        if system_prompt:
            openai_messages.append({"role": "system", "content": system_prompt})
        openai_messages.extend(messages)

        accumulated = ""
        input_tokens = 0
        output_tokens = 0
        _stream_start = time.time()

        response_stream = await client.chat.completions.create(
            model=model,
            messages=openai_messages,
            max_tokens=max_tokens,
            temperature=temperature,
            stream=True,
            stream_options={"include_usage": True},
        )

        async for chunk in response_stream:
            if chunk.choices and chunk.choices[0].delta.content:
                text = chunk.choices[0].delta.content
                accumulated += text
                await stream_callback(text)
            if hasattr(chunk, 'usage') and chunk.usage:
                input_tokens = chunk.usage.prompt_tokens or 0
                output_tokens = chunk.usage.completion_tokens or 0

        await flush_callback()

        return {
            "provider": "openai",
            "model": model,
            "content": accumulated,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
                "execution_time_ms": int((time.time() - _stream_start) * 1000),
            }
        }

    async def _execute_google_streaming(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str],
        max_tokens: int,
        temperature: float,
        stream_callback,
        flush_callback,
        api_key_override: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
    ) -> Dict:
        """Google Gemini streaming using streamGenerateContent with alt=sse"""
        google_config = self.clients["google"]
        api_key = api_key_override or google_config["api_key"]
        http_client = google_config["http_client"]

        conversation = []
        if system_prompt:
            conversation.append(f"System Instructions: {system_prompt}\n")
        for msg in messages:
            role = "User" if msg["role"] == "user" else "Model"
            conversation.append(f"{role}: {msg['content']}")
        prompt = "\n\n".join(conversation)

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?key={api_key}&alt=sse"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "maxOutputTokens": max_tokens,
                "temperature": temperature,
            }
        }

        accumulated = ""
        input_tokens = 0
        output_tokens = 0
        effective_timeout = timeout_seconds or 120.0
        _stream_start = time.time()

        async with http_client.stream("POST", url, json=payload, timeout=effective_timeout) as response:
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                try:
                    data = json.loads(line[6:])
                    candidates = data.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        for part in parts:
                            text = part.get("text", "")
                            if text:
                                accumulated += text
                                await stream_callback(text)
                    usage_meta = data.get("usageMetadata", {})
                    if usage_meta:
                        input_tokens = usage_meta.get("promptTokenCount", input_tokens)
                        output_tokens = usage_meta.get("candidatesTokenCount", output_tokens)
                except json.JSONDecodeError:
                    pass

        await flush_callback()

        return {
            "provider": "google",
            "model": model,
            "content": accumulated,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
                "execution_time_ms": int((time.time() - _stream_start) * 1000),
            }
        }

    async def _execute_ollama_streaming(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str],
        max_tokens: int,
        temperature: float,
        stream_callback,
        flush_callback,
        timeout_seconds: Optional[float] = None,
        top_p: Optional[float] = None,
        top_k: Optional[int] = None,
        num_ctx: Optional[int] = None,
        num_batch: Optional[int] = None,
        keep_alive: Optional[str] = None,
    ) -> Dict:
        """Ollama streaming using stream=True (NDJSON response)
        PROMPT #221 - Added top_p/top_k and streaming timeout
        """
        ollama_config = self.clients["ollama"]
        base_url = ollama_config["base_url"]
        http_client = ollama_config["http_client"]

        ollama_messages = []
        if system_prompt:
            ollama_messages.append({"role": "system", "content": system_prompt})
        ollama_messages.extend(messages)

        # PROMPT #221 - Build options with optional top_p/top_k
        # PROMPT #224 - Add num_ctx to limit context window (saves memory, speeds up inference)
        # PROMPT #229 - Ollama GPU optimization: num_gpu layers, batch size
        # PROMPT #289 - Read num_ctx/num_batch/keep_alive from model config instead of hardcoding
        options = {
            "num_predict": max_tokens,
            "temperature": temperature,
            "num_ctx": num_ctx or 4096,
            "num_gpu": 99,  # PROMPT #229 - Offload all layers to GPU
            "num_batch": num_batch or 512,  # PROMPT #229 - Batch size for prompt eval
        }
        if top_p is not None:
            options["top_p"] = top_p
        if top_k is not None:
            options["top_k"] = top_k

        url = f"{base_url}/api/chat"
        payload = {
            "model": model,
            "messages": ollama_messages,
            "stream": True,
            "options": options,
            "keep_alive": keep_alive or "5m",  # PROMPT #289 - Configurable keep_alive
        }

        effective_timeout = timeout_seconds or 300.0
        logger.info(f"🦙 Calling Ollama (streaming): {url} with model {model} (timeout={effective_timeout}s)")

        accumulated = ""
        input_tokens = 0
        output_tokens = 0

        # PROMPT #221 - Wrap streaming loop with timeout to prevent indefinite hangs
        async def _consume_stream(response):
            nonlocal accumulated, input_tokens, output_tokens
            async for line in response.aiter_lines():
                if not line.strip():
                    continue
                try:
                    data = json.loads(line)
                    chunk_text = data.get("message", {}).get("content", "")
                    if chunk_text:
                        accumulated += chunk_text
                        await stream_callback(chunk_text)
                    if data.get("done"):
                        input_tokens = data.get("prompt_eval_count", 0)
                        output_tokens = data.get("eval_count", 0)
                except json.JSONDecodeError:
                    pass

        async with http_client.stream("POST", url, json=payload, timeout=effective_timeout) as response:
            await asyncio.wait_for(
                _consume_stream(response),
                timeout=effective_timeout
            )

        await flush_callback()

        # PROMPT #230 - Strip <think>...</think> tags from qwen3 thinking mode
        import re
        cleaned = re.sub(r'<think>[\s\S]*?</think>\s*', '', accumulated).strip()
        if cleaned != accumulated:
            logger.info(f"🧠 Stripped thinking tags from Ollama response ({len(accumulated)} → {len(cleaned)} chars)")
            accumulated = cleaned

        return {
            "provider": "ollama",
            "model": model,
            "content": accumulated,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
            }
        }

    async def _execute_cohere_streaming(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str],
        max_tokens: int,
        temperature: float,
        stream_callback,
        flush_callback,
        api_key_override: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
    ) -> Dict:
        """Cohere streaming using stream=True (NDJSON with event_type)"""
        cohere_config = self.clients["cohere"]
        api_key = api_key_override or cohere_config["api_key"]
        http_client = cohere_config["http_client"]

        chat_history = []
        current_message = ""
        for msg in messages:
            role = msg.get("role", "user").lower()
            cohere_role = "USER" if role == "user" else "CHATBOT"
            chat_history.append({"role": cohere_role, "message": msg.get("content", "")})

        if chat_history and chat_history[-1]["role"] == "USER":
            current_message = chat_history.pop()["message"]
        else:
            current_message = "Continue the conversation."

        url = "https://api.cohere.ai/v1/chat"
        payload = {
            "model": model,
            "message": current_message,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }
        if chat_history:
            payload["chat_history"] = chat_history
        if system_prompt:
            payload["preamble"] = system_prompt

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        accumulated = ""
        input_tokens = 0
        output_tokens = 0
        effective_timeout = timeout_seconds or 60.0

        async with http_client.stream("POST", url, json=payload, headers=headers, timeout=effective_timeout) as response:
            async for line in response.aiter_lines():
                if not line.strip():
                    continue
                try:
                    data = json.loads(line)
                    event_type = data.get("event_type", "")
                    if event_type == "text-generation":
                        text = data.get("text", "")
                        if text:
                            accumulated += text
                            await stream_callback(text)
                    elif event_type == "stream-end":
                        response_data = data.get("response", {})
                        meta = response_data.get("meta", {})
                        tokens = meta.get("tokens", {})
                        input_tokens = tokens.get("input_tokens", 0)
                        output_tokens = tokens.get("output_tokens", 0)
                except json.JSONDecodeError:
                    pass

        await flush_callback()

        return {
            "provider": "cohere",
            "model": model,
            "content": accumulated,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
            }
        }
