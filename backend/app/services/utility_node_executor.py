"""
Utility Node Executor
PROMPT #205 - Real execution logic for AI Flow utility nodes.

Each utility node type has a pre-process and/or post-process hook that runs
inside the AIOrchestrator pipeline:

  PRE-PROCESS (before API call):
    - cache: Check Redis cache, return early if hit
    - rag_context: Enrich messages with RAG retrieval
    - prompt_transformer: Transform/compress prompt
    - router: Evaluate condition and pick sub-chain
    - rate_limiter: Enforce request throttling
    - cost_guard: Block if budget exceeded

  POST-PROCESS (after API call):
    - validator: Validate AI output, trigger retry on fail
    - retry: Retry same model on transient errors
    - cache: Store result in cache (write-through)
"""

import json
import hashlib
import time
import logging
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


class UtilityNodeExecutor:
    """
    Executes utility node logic in the AI orchestrator pipeline.

    Usage:
        executor = UtilityNodeExecutor(redis_client, rag_service, db)
        # Pre-process: may short-circuit with cached result
        result = executor.pre_process(utility_nodes, messages, system_prompt, context)
        if result is not None:
            return result  # Cache hit or blocked
        # ... normal API call ...
        # Post-process: validate output
        final = executor.post_process(utility_nodes, api_result, context)
    """

    def __init__(self, redis_client=None, rag_service=None, db=None, cache_service=None):
        self.redis = redis_client
        self.rag_service = rag_service
        self.db = db
        self.cache_service = cache_service
        logger.info("✅ UtilityNodeExecutor initialized")

    # =========================================================================
    # Main entry points
    # =========================================================================

    def pre_process(
        self,
        utility_nodes: List[Dict],
        messages: List[Dict],
        system_prompt: Optional[str],
        context: Dict[str, Any],
    ) -> Tuple[Optional[Dict], List[Dict], Optional[str]]:
        """
        Run all pre-processing utility nodes.

        Returns:
            (early_result, modified_messages, modified_system_prompt)
            - early_result: If not None, skip API call and return this
            - modified_messages: Messages after transformations
            - modified_system_prompt: System prompt after transformations
        """
        early_result = None
        modified_messages = list(messages)  # shallow copy
        modified_system_prompt = system_prompt

        PRE_PROCESS_ORDER = [
            "rate_limiter",
            "cost_guard",
            "cache",
            "rag_context",
            "prompt_transformer",
            "router",
        ]

        # Sort nodes by pre-process order
        sorted_nodes = sorted(
            [n for n in utility_nodes if n.get("enabled", True) and n.get("type") in PRE_PROCESS_ORDER],
            key=lambda n: PRE_PROCESS_ORDER.index(n["type"])
        )

        for node in sorted_nodes:
            node_type = node["type"]
            config = node.get("config", {})

            if node_type == "rate_limiter":
                blocked = self._pre_rate_limiter(config, context)
                if blocked:
                    early_result = blocked
                    return early_result, modified_messages, modified_system_prompt

            elif node_type == "cost_guard":
                blocked = self._pre_cost_guard(config, context)
                if blocked:
                    early_result = blocked
                    return early_result, modified_messages, modified_system_prompt

            elif node_type == "cache":
                cached = self._pre_cache(config, modified_messages, modified_system_prompt, context)
                if cached:
                    early_result = cached
                    return early_result, modified_messages, modified_system_prompt

            elif node_type == "rag_context":
                modified_messages = self._pre_rag_context(config, modified_messages, context)

            elif node_type == "prompt_transformer":
                modified_messages, modified_system_prompt = self._pre_prompt_transformer(
                    config, modified_messages, modified_system_prompt, context
                )

            elif node_type == "router":
                # Router can modify context to influence model selection
                self._pre_router(config, modified_messages, context)

        return early_result, modified_messages, modified_system_prompt

    def post_process(
        self,
        utility_nodes: List[Dict],
        api_result: Dict[str, Any],
        messages: List[Dict],
        system_prompt: Optional[str],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Run all post-processing utility nodes.

        Returns:
            Modified api_result (may flag retry_needed).
        """
        POST_PROCESS_ORDER = ["validator", "cache"]

        sorted_nodes = sorted(
            [n for n in utility_nodes if n.get("enabled", True) and n.get("type") in POST_PROCESS_ORDER],
            key=lambda n: POST_PROCESS_ORDER.index(n["type"])
        )

        result = dict(api_result)

        for node in sorted_nodes:
            node_type = node["type"]
            config = node.get("config", {})

            if node_type == "validator":
                result = self._post_validator(config, result)

            elif node_type == "cache":
                self._post_cache_store(config, messages, system_prompt, result, context)

        return result

    # =========================================================================
    # RATE LIMITER - Enforce request throttling via Redis sliding window
    # =========================================================================

    def _pre_rate_limiter(self, config: Dict, context: Dict) -> Optional[Dict]:
        """Check sliding window rate limit. Returns error dict if blocked.

        PROMPT #206 - The node values are capped by the AI Model's rate limit.
        The node can tighten the limit (use fewer requests / shorter window)
        but can NEVER exceed the model's configured ceiling.
        """
        if not self.redis:
            return None

        max_requests = config.get("max_requests", 60)
        window_seconds = config.get("window_seconds", 60)
        action = config.get("action_on_exceed", "queue")
        usage_type = context.get("usage_type", "general")

        # PROMPT #206 - Cap by model rate limits (model is the ceiling)
        model_caps = context.get("model_rate_caps", {})
        model_max = model_caps.get("rate_limit_requests")
        model_window = model_caps.get("rate_limit_window_seconds")

        if model_max is not None:
            if max_requests > model_max:
                logger.info(
                    f"📎 Rate Limiter Node: capped max_requests {max_requests} → {model_max} (model limit)"
                )
                max_requests = model_max
        if model_window is not None:
            if window_seconds > model_window:
                logger.info(
                    f"📎 Rate Limiter Node: capped window {window_seconds}s → {model_window}s (model limit)"
                )
                window_seconds = model_window

        key = f"utility_rate_limit:{usage_type}"
        now = time.time()
        window_start = now - window_seconds

        try:
            # Remove old entries
            self.redis.zremrangebyscore(key, 0, window_start)
            # Count current
            current_count = self.redis.zcard(key)

            if current_count >= max_requests:
                if action == "block":
                    logger.warning(f"🚫 Rate Limiter Node: BLOCKED ({current_count}/{max_requests} in {window_seconds}s)")
                    return {
                        "content": f"Rate limit exceeded: {current_count}/{max_requests} requests in {window_seconds}s window.",
                        "provider": "utility_node",
                        "model": "rate_limiter",
                        "usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0},
                        "blocked_by": "rate_limiter",
                        "error": True,
                    }
                else:
                    # "queue" mode: wait for oldest to expire
                    oldest = self.redis.zrangebyscore(key, window_start, "+inf", start=0, num=1)
                    if oldest:
                        oldest_score = self.redis.zscore(key, oldest[0])
                        if oldest_score:
                            wait_time = (oldest_score + window_seconds) - now
                            if wait_time > 0:
                                logger.info(f"⏳ Rate Limiter Node: queuing {wait_time:.1f}s")
                                import asyncio
                                # Note: This is sync context; the orchestrator will handle async waiting
                                context["_rate_limit_wait"] = wait_time

            # Record this request
            self.redis.zadd(key, {f"{now}:{id(config)}": now})
            self.redis.expire(key, window_seconds * 2)

        except Exception as e:
            logger.warning(f"⚠️ Rate Limiter Node error: {e}")

        return None

    # =========================================================================
    # COST GUARD - Block if budget exceeded
    # =========================================================================

    def _pre_cost_guard(self, config: Dict, context: Dict) -> Optional[Dict]:
        """Check cost budgets. Returns error dict if budget exceeded."""
        if not self.db:
            return None

        max_cost_per_call = config.get("max_cost_per_call", 0.10)
        daily_budget = config.get("daily_budget", 10.0)
        monthly_budget = config.get("monthly_budget", 100.0)
        action = config.get("action_on_exceed", "block")

        try:
            from datetime import datetime, timedelta
            from sqlalchemy import func
            from app.models.ai_execution import AIExecution
            from app.utils.pricing import calculate_cost

            now = datetime.utcnow()

            # Check daily spend
            day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            daily_rows = self.db.query(
                func.sum(AIExecution.input_tokens).label("input"),
                func.sum(AIExecution.output_tokens).label("output"),
            ).filter(
                AIExecution.created_at >= day_start,
                AIExecution.error_message.is_(None),
            ).first()

            daily_cost = 0.0
            if daily_rows and daily_rows.input:
                cost_info = calculate_cost(daily_rows.input or 0, daily_rows.output or 0, "")
                daily_cost = cost_info.get("total_cost", 0.0)

            if daily_cost >= daily_budget:
                logger.warning(f"🚫 Cost Guard Node: daily budget exceeded (${daily_cost:.4f} >= ${daily_budget:.2f})")
                if action == "block":
                    return {
                        "content": f"Daily budget exceeded: ${daily_cost:.4f} spent of ${daily_budget:.2f} limit.",
                        "provider": "utility_node",
                        "model": "cost_guard",
                        "usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0},
                        "blocked_by": "cost_guard",
                        "error": True,
                    }

            # Check monthly spend
            month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            monthly_rows = self.db.query(
                func.sum(AIExecution.input_tokens).label("input"),
                func.sum(AIExecution.output_tokens).label("output"),
            ).filter(
                AIExecution.created_at >= month_start,
                AIExecution.error_message.is_(None),
            ).first()

            monthly_cost = 0.0
            if monthly_rows and monthly_rows.input:
                cost_info = calculate_cost(monthly_rows.input or 0, monthly_rows.output or 0, "")
                monthly_cost = cost_info.get("total_cost", 0.0)

            if monthly_cost >= monthly_budget:
                logger.warning(f"🚫 Cost Guard Node: monthly budget exceeded (${monthly_cost:.4f} >= ${monthly_budget:.2f})")
                if action == "block":
                    return {
                        "content": f"Monthly budget exceeded: ${monthly_cost:.4f} spent of ${monthly_budget:.2f} limit.",
                        "provider": "utility_node",
                        "model": "cost_guard",
                        "usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0},
                        "blocked_by": "cost_guard",
                        "error": True,
                    }

            logger.info(f"✅ Cost Guard Node: OK (daily ${daily_cost:.4f}/${daily_budget:.2f}, monthly ${monthly_cost:.4f}/${monthly_budget:.2f})")

        except Exception as e:
            logger.warning(f"⚠️ Cost Guard Node error: {e}")

        return None

    # =========================================================================
    # CACHE - Check/store in Redis cache
    # =========================================================================

    def _pre_cache(
        self, config: Dict, messages: List[Dict],
        system_prompt: Optional[str], context: Dict
    ) -> Optional[Dict]:
        """Check cache for existing response. Returns cached result or None."""
        if not self.cache_service:
            return None

        cache_level = config.get("cache_level", "exact")
        usage_type = context.get("usage_type", "general")
        model_name = context.get("model_name", "")
        temperature = context.get("temperature", 0.7)

        cache_input = {
            "prompt": json.dumps(messages),
            "system_prompt": system_prompt or "",
            "usage_type": usage_type,
            "temperature": temperature,
            "model": model_name,
        }

        cached = self.cache_service.get(cache_input)
        if cached:
            logger.info(f"✅ Cache Node HIT ({cached.get('cache_type', cache_level)}) - Returning cached response")
            return {
                "content": cached["response"],
                "provider": context.get("provider", "cached"),
                "model": model_name,
                "usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0},
                "cache_hit": True,
                "cache_type": cached.get("cache_type", cache_level),
                "db_model_id": context.get("db_model_id", ""),
                "db_model_name": context.get("db_model_name", ""),
            }

        return None

    def _post_cache_store(
        self, config: Dict, messages: List[Dict],
        system_prompt: Optional[str], result: Dict, context: Dict
    ):
        """Store successful result in cache."""
        if not self.cache_service or result.get("error"):
            return

        usage_type = context.get("usage_type", "general")
        model_name = result.get("model", "")
        temperature = context.get("temperature", 0.7)

        cache_input = {
            "prompt": json.dumps(messages),
            "system_prompt": system_prompt or "",
            "usage_type": usage_type,
            "temperature": temperature,
            "model": model_name,
        }

        cache_output = {
            "response": result.get("content", ""),
            "model": model_name,
            "input_tokens": result.get("usage", {}).get("input_tokens", 0),
            "output_tokens": result.get("usage", {}).get("output_tokens", 0),
        }

        try:
            ttl = config.get("ttl_seconds", 86400)
            self.cache_service.set(cache_input, cache_output, ttl=ttl)
            logger.info(f"💾 Cache Node: stored response (TTL: {ttl}s)")
        except Exception as e:
            logger.warning(f"⚠️ Cache Node store error: {e}")

    # =========================================================================
    # RAG CONTEXT - Enrich prompt with vector store retrieval
    # =========================================================================

    def _pre_rag_context(self, config: Dict, messages: List[Dict], context: Dict) -> List[Dict]:
        """Retrieve and inject RAG context into messages."""
        if not self.rag_service:
            return messages

        max_results = config.get("max_results", 5)
        threshold = config.get("similarity_threshold", 0.7)
        include_metadata = config.get("include_metadata", True)
        project_id = context.get("project_id")

        try:
            # Extract query from last user message
            query = None
            for msg in reversed(messages):
                if msg.get("role") == "user":
                    query = msg.get("content", "")
                    break

            if not query:
                return messages

            filter_dict = {}
            if project_id:
                filter_dict["project_id"] = project_id

            rag_start = time.time()
            results = self.rag_service.retrieve(
                query=query,
                filter=filter_dict,
                top_k=max_results,
                similarity_threshold=threshold,
            )
            retrieval_ms = (time.time() - rag_start) * 1000

            if results:
                parts = []
                for i, r in enumerate(results):
                    sim = f" (similarity: {r['similarity']:.2f})" if include_metadata else ""
                    parts.append(f"[{i+1}]{sim}\n{r['content']}")

                rag_text = "\n\n".join(parts)
                rag_message = {
                    "role": "user",
                    "content": f"[RELEVANT CONTEXT FROM KNOWLEDGE BASE]\n\n{rag_text}\n\n[END CONTEXT]"
                }

                modified = list(messages)
                modified.insert(-1, rag_message)

                logger.info(
                    f"🔍 RAG Context Node: {len(results)} docs injected "
                    f"(top: {results[0]['similarity']:.2f}, {retrieval_ms:.0f}ms)"
                )
                return modified
            else:
                logger.info(f"🔍 RAG Context Node: no results above threshold {threshold}")

        except Exception as e:
            logger.warning(f"⚠️ RAG Context Node error: {e}")

        return messages

    # =========================================================================
    # PROMPT TRANSFORMER - Transform prompt before sending
    # =========================================================================

    def _pre_prompt_transformer(
        self, config: Dict, messages: List[Dict],
        system_prompt: Optional[str], context: Dict
    ) -> Tuple[List[Dict], Optional[str]]:
        """Transform prompt: compress, truncate, or add instructions.

        PROMPT #206 - Also supports overriding max_tokens and temperature:
          - override_max_tokens: capped by model's max_tokens (can reduce, not increase)
          - override_temperature: free to set any value (0.0-2.0)
        If set, these are written into context for the orchestrator to use.
        """
        transformation = config.get("transformation", "compress")
        max_tokens = config.get("max_tokens", 4000)

        modified_messages = list(messages)
        modified_system = system_prompt

        if transformation == "compress":
            # Simple compression: truncate long messages to max_tokens chars (~4 chars/token)
            char_limit = max_tokens * 4
            for i, msg in enumerate(modified_messages):
                content = msg.get("content", "")
                if len(content) > char_limit:
                    modified_messages[i] = {
                        **msg,
                        "content": content[:char_limit] + "\n\n[... truncated for brevity ...]"
                    }
                    logger.info(f"✂️ Prompt Transformer: compressed message {i} from {len(content)} to {char_limit} chars")

        elif transformation == "summarize_context":
            # Keep only last N messages for context window management
            keep_last = config.get("keep_last_messages", 10)
            if len(modified_messages) > keep_last:
                removed = len(modified_messages) - keep_last
                modified_messages = modified_messages[-keep_last:]
                logger.info(f"✂️ Prompt Transformer: kept last {keep_last} messages (removed {removed})")

        elif transformation == "add_instructions":
            # Append custom instructions to system prompt
            extra = config.get("extra_instructions", "")
            if extra and modified_system:
                modified_system = f"{modified_system}\n\n{extra}"
            elif extra:
                modified_system = extra
            logger.info(f"📝 Prompt Transformer: added instructions to system prompt")

        # PROMPT #206 - Override max_tokens (capped by model default)
        override_max_tokens = config.get("override_max_tokens")
        if override_max_tokens is not None:
            model_caps = context.get("model_rate_caps", {})
            # Get model max_tokens from context if available
            model_max_tokens = context.get("model_max_tokens")
            if model_max_tokens is not None and override_max_tokens > model_max_tokens:
                logger.info(
                    f"📎 Prompt Transformer: capped override_max_tokens "
                    f"{override_max_tokens} → {model_max_tokens} (model limit)"
                )
                override_max_tokens = model_max_tokens
            context["_override_max_tokens"] = override_max_tokens
            logger.info(f"🔧 Prompt Transformer: override max_tokens → {override_max_tokens}")

        # PROMPT #206 - Override temperature (free, no cap)
        override_temperature = config.get("override_temperature")
        if override_temperature is not None:
            # Clamp to valid range
            override_temperature = max(0.0, min(2.0, float(override_temperature)))
            context["_override_temperature"] = override_temperature
            logger.info(f"🔧 Prompt Transformer: override temperature → {override_temperature}")

        return modified_messages, modified_system

    # =========================================================================
    # ROUTER - Conditional routing (modifies context for model selection)
    # =========================================================================

    def _pre_router(self, config: Dict, messages: List[Dict], context: Dict):
        """Evaluate condition and set routing hints in context."""
        condition = config.get("condition", "complexity")
        threshold = config.get("threshold", "medium")

        # Estimate prompt complexity based on message length and count
        total_chars = sum(len(m.get("content", "")) for m in messages)
        msg_count = len(messages)

        if condition == "complexity":
            # Simple heuristic: short prompts = low, medium, long = high
            if total_chars < 500:
                complexity = "low"
            elif total_chars < 3000:
                complexity = "medium"
            else:
                complexity = "high"

            context["_router_complexity"] = complexity
            context["_router_recommendation"] = (
                "cheap" if complexity == "low"
                else "balanced" if complexity == "medium"
                else "quality"
            )
            logger.info(f"🔀 Router Node: complexity={complexity} → recommend {context['_router_recommendation']}")

        elif condition == "cost":
            # Route based on estimated token count
            estimated_tokens = total_chars // 4
            if estimated_tokens < 500:
                context["_router_recommendation"] = "cheap"
            elif estimated_tokens < 2000:
                context["_router_recommendation"] = "balanced"
            else:
                context["_router_recommendation"] = "quality"
            logger.info(f"🔀 Router Node: ~{estimated_tokens} tokens → recommend {context['_router_recommendation']}")

        elif condition == "message_count":
            if msg_count <= 2:
                context["_router_recommendation"] = "cheap"
            elif msg_count <= 6:
                context["_router_recommendation"] = "balanced"
            else:
                context["_router_recommendation"] = "quality"
            logger.info(f"🔀 Router Node: {msg_count} messages → recommend {context['_router_recommendation']}")

    # =========================================================================
    # VALIDATOR - Validate AI output
    # =========================================================================

    def _post_validator(self, config: Dict, result: Dict) -> Dict:
        """Validate AI output. Sets retry_needed flag if validation fails."""
        validation_type = config.get("validation_type", "json")
        retry_on_fail = config.get("retry_on_fail", True)
        content = result.get("content", "")

        is_valid = True
        reason = ""

        if validation_type == "json":
            try:
                json.loads(content)
            except (json.JSONDecodeError, TypeError):
                # Try extracting JSON from markdown code blocks
                import re
                json_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', content, re.DOTALL)
                if json_match:
                    try:
                        json.loads(json_match.group(1))
                    except (json.JSONDecodeError, TypeError):
                        is_valid = False
                        reason = "Response is not valid JSON"
                else:
                    is_valid = False
                    reason = "Response is not valid JSON"

        elif validation_type == "length":
            max_length = config.get("max_length", 0)
            if max_length > 0 and len(content) > max_length:
                is_valid = False
                reason = f"Response exceeds max length ({len(content)} > {max_length})"

        elif validation_type == "keywords":
            required = config.get("required_keywords", [])
            content_lower = content.lower()
            missing = [kw for kw in required if kw.lower() not in content_lower]
            if missing:
                is_valid = False
                reason = f"Missing required keywords: {', '.join(missing)}"

        elif validation_type == "not_empty":
            if not content or not content.strip():
                is_valid = False
                reason = "Response is empty"

        if is_valid:
            logger.info(f"✅ Validator Node: output is valid ({validation_type})")
            result["validated"] = True
        else:
            logger.warning(f"❌ Validator Node: FAILED - {reason}")
            result["validated"] = False
            result["validation_error"] = reason
            if retry_on_fail:
                result["retry_needed"] = True

        return result

    # =========================================================================
    # RETRY - Handled in orchestrator (sets flag for retry loop)
    # =========================================================================

    @staticmethod
    def get_retry_config(utility_nodes: List[Dict]) -> Optional[Dict]:
        """Extract retry configuration if a retry node is present and enabled."""
        for node in utility_nodes:
            if node.get("type") == "retry" and node.get("enabled", True):
                config = node.get("config", {})
                return {
                    "max_retries": config.get("max_retries", 3),
                    "backoff_base_ms": config.get("backoff_base_ms", 1000),
                    "backoff_multiplier": config.get("backoff_multiplier", 2.0),
                    "retry_on": config.get("retry_on", ["timeout", "rate_limit", "server_error"]),
                }
        return None
