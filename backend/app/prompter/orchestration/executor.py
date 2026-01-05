"""
Prompt Executor with Retry, Fallback, and Validation

Core orchestrator for executing prompts with:
- Exponential backoff retry (2^attempt seconds, max 30s)
- Fallback to cheaper models on final attempt
- Cache integration (exact, semantic, template)
- Pre/post-execution hooks
- Response validation
- Comprehensive metrics tracking
"""

import asyncio
import time
import logging
from typing import Optional, Dict, Any
from contextlib import contextmanager
from sqlalchemy.orm import Session

from .context import ExecutionContext
from .validation import get_pipeline
from ..core.exceptions import ExecutionError, CacheError
from app.services.ai_orchestrator import AIOrchestrator
from app.prompter.observability import get_tracing_service

logger = logging.getLogger(__name__)


class PromptExecutor:
    """
    Orchestrates prompt execution with advanced retry and fallback strategies.

    Pipeline:
    1. Pre-hooks - Transform context before execution
    2. Cache check - Check all cache levels (exact, semantic, template)
    3. Execute with retry - Exponential backoff, max 3 attempts
    4. Validation - Validate response format/content
    5. Post-hooks - Transform response after execution
    6. Cache result - Store in cache for future use
    """

    def __init__(
        self,
        db: Session,
        ai_orchestrator: Optional[AIOrchestrator] = None,
        cache_service: Optional[Any] = None,
        batch_service: Optional[Any] = None,
        enable_cache: bool = True,
        enable_retry: bool = True,
    ):
        """
        Initialize executor

        Args:
            db: Database session
            ai_orchestrator: AI service (if None, will create default)
            cache_service: Cache service (optional, for optimization)
            batch_service: Batch service (optional, for request batching)
            enable_cache: Enable caching globally
            enable_retry: Enable retry globally
        """
        self.db = db
        self.ai_orchestrator = ai_orchestrator or AIOrchestrator(db)
        self.cache_service = cache_service
        self.batch_service = batch_service
        self.enable_cache = enable_cache
        self.enable_retry = enable_retry

    async def execute(self, context: ExecutionContext) -> ExecutionContext:
        """
        Execute prompt with full orchestration pipeline

        Args:
            context: Execution context with prompt and configuration

        Returns:
            Updated context with results

        Raises:
            ExecutionError: If execution fails after all retries
        """
        # Get tracing service (if enabled)
        tracing = get_tracing_service()

        # Create root span for this execution
        with tracing.start_span(
            "prompter.execute",
            {
                "usage_type": context.usage_type,
                "model": context.model,
                "temperature": context.temperature,
                "max_tokens": context.max_tokens,
            }
        ) if tracing else contextmanager(lambda: (yield None))() as root_span:

            try:
                # PROMPT #54.3 - DEBUG: Log cache configuration
                logger.info(
                    f"🔍 PromptExecutor cache config: "
                    f"enable_cache={self.enable_cache}, "
                    f"context.enable_cache={context.enable_cache}, "
                    f"cache_service={self.cache_service is not None}"
                )

                # Step 1: Run pre-hooks
                with tracing.start_span("pre_hooks") if tracing else contextmanager(lambda: (yield None))():
                    await self._run_pre_hooks(context)

                # Step 2: Check cache (if enabled)
                if self.enable_cache and context.enable_cache and self.cache_service:
                    with tracing.start_span("cache.check") if tracing else contextmanager(lambda: (yield None))() as cache_span:
                        cached_result = await self._check_cache(context)
                        if cached_result:
                            if tracing and cache_span:
                                tracing.set_attribute(cache_span, "cache.hit", True)
                                tracing.set_attribute(cache_span, "cache.type", cached_result['cache_type'])

                            logger.info(
                                f"Cache hit ({cached_result['cache_type']}) for "
                                f"usage_type={context.usage_type}"
                            )
                            context.mark_cached(
                                response=cached_result["response"],
                                cache_type=cached_result["cache_type"],
                            )
                            await self._run_post_hooks(context)

                            if tracing and root_span:
                                tracing.set_status_ok(root_span)

                            return context

                        if tracing and cache_span:
                            tracing.set_attribute(cache_span, "cache.hit", False)

                # Step 3: Execute with retry
                with tracing.start_span("ai.execute") if tracing else contextmanager(lambda: (yield None))() as ai_span:
                    await self._execute_with_retry(context)

                    if tracing and ai_span and context.is_success:
                        tracing.set_attribute(ai_span, "tokens.input", context.input_tokens)
                        tracing.set_attribute(ai_span, "tokens.output", context.output_tokens)
                        tracing.set_attribute(ai_span, "cost.usd", context.cost)
                        tracing.set_attribute(ai_span, "model.used", context.model)

                # Step 4: Validate response
                if context.is_success:
                    with tracing.start_span("validation") if tracing else contextmanager(lambda: (yield None))() as val_span:
                        validation_result = await self._validate_response(context)
                        context.validation_passed = validation_result["passed"]
                        context.quality_score = validation_result.get("quality_score")

                        if tracing and val_span:
                            tracing.set_attribute(val_span, "validation.passed", validation_result["passed"])
                            if context.quality_score:
                                tracing.set_attribute(val_span, "quality.score", context.quality_score)

                        if not validation_result["passed"]:
                            logger.warning(
                                f"Validation failed for usage_type={context.usage_type}: "
                                f"{validation_result.get('errors')}"
                            )

                # Step 5: Run post-hooks
                with tracing.start_span("post_hooks") if tracing else contextmanager(lambda: (yield None))():
                    await self._run_post_hooks(context)

                # Step 6: Cache result (if successful and cache enabled)
                if (
                    context.is_success
                    and self.enable_cache
                    and context.enable_cache
                    and self.cache_service
                ):
                    with tracing.start_span("cache.store") if tracing else contextmanager(lambda: (yield None))():
                        await self._cache_result(context)

                if tracing and root_span:
                    tracing.set_status_ok(root_span)

                return context

            except Exception as e:
                logger.error(f"Executor error: {e}", exc_info=True)

                if tracing and root_span:
                    tracing.record_exception(root_span, e)

                if not context.is_failed:
                    context.mark_failed(e, time.time())

                raise ExecutionError(f"Execution failed: {e}") from e

    async def _execute_with_retry(self, context: ExecutionContext):
        """
        Execute with exponential backoff retry

        Retry strategy:
        - Attempt 1: Use specified/selected model
        - Attempt 2: Retry with same model after 2s wait
        - Attempt 3: Fallback to cheaper model after 4s wait (if enabled)

        Args:
            context: Execution context
        """
        last_error = None

        while context.attempt <= context.max_attempts:
            try:
                # Calculate backoff delay (2^(attempt-1) seconds, max 30s)
                if context.attempt > 1:
                    delay = min(2 ** (context.attempt - 1), 30)
                    logger.info(
                        f"Retry attempt {context.attempt}/{context.max_attempts} "
                        f"after {delay}s delay"
                    )
                    await asyncio.sleep(delay)

                # Fallback to cheaper model on last attempt (if enabled)
                if (
                    context.attempt == context.max_attempts
                    and context.enable_fallback
                    and context.fallback_models
                ):
                    original_model = context.model
                    context.model = context.fallback_models[0]
                    logger.info(
                        f"Fallback: {original_model} -> {context.model} "
                        f"(attempt {context.attempt})"
                    )

                # Execute single attempt
                await self._execute_single(context)

                # Success - break retry loop
                if context.is_success:
                    logger.info(
                        f"Execution succeeded on attempt {context.attempt}, "
                        f"cost=${context.cost:.4f}, tokens={context.total_tokens}"
                    )
                    break

            except Exception as e:
                last_error = e
                logger.warning(
                    f"Attempt {context.attempt} failed: {e}",
                    exc_info=context.attempt == context.max_attempts,
                )

                # If no more retries, mark as failed
                if not context.can_retry:
                    context.mark_failed(e, time.time())
                    break

                # Increment for next attempt
                context.increment_attempt()

        # If still not successful after all retries, raise error
        if not context.is_success and not context.is_cached:
            error_msg = f"Failed after {context.max_attempts} attempts"
            if last_error:
                error_msg += f": {last_error}"
            raise ExecutionError(error_msg)

    async def _execute_single(self, context: ExecutionContext):
        """
        Execute single attempt without retry

        Args:
            context: Execution context
        """
        start_time = time.time()
        context.mark_started(start_time)

        try:
            # PROMPT #54.3 - Direct execution (batch service disabled due to parameter issues)
            # Call AIOrchestrator directly without batching
            result = await self.ai_orchestrator.execute(
                usage_type=context.usage_type,
                messages=[{"role": "user", "content": context.prompt}],
                system_prompt=context.system_prompt,
                max_tokens=context.max_tokens,
            )

            end_time = time.time()

            # Extract results
            # PROMPT #54.3 - FIX: AIOrchestrator returns "content", not "response"
            response = result.get("content")
            if not response:
                raise ExecutionError("Empty response from AI orchestrator")

            # Calculate tokens and cost
            # AIOrchestrator returns usage nested in "usage" dict
            usage = result.get("usage", {})
            tokens = {
                "input": usage.get("input_tokens", 0),
                "output": usage.get("output_tokens", 0),
                "total": usage.get("total_tokens", 0),
            }
            # Cost needs to be calculated (not returned by AIOrchestrator)
            cost = 0.0  # Will be calculated elsewhere

            # Mark success
            context.mark_success(
                response=response,
                timestamp=end_time,
                tokens=tokens,
                cost=cost,
            )

            # Store actual model used (may differ from requested)
            if "model" in result:
                context.model = result["model"]

        except Exception as e:
            end_time = time.time()
            context.mark_failed(e, end_time)
            raise

    async def _check_cache(self, context: ExecutionContext) -> Optional[Dict[str, Any]]:
        """
        Check all cache levels for existing result

        Cache levels (in order):
        1. Exact match - Hash of prompt + config
        2. Semantic match - Embedding similarity > 95%
        3. Template cache - For deterministic prompts (temp=0)

        Args:
            context: Execution context

        Returns:
            Cached result dict or None
        """
        if not self.cache_service:
            return None

        try:
            # Build cache key
            cache_key = {
                "prompt": context.prompt,
                "system_prompt": context.system_prompt,
                "usage_type": context.usage_type,
                "temperature": context.temperature,
                "model": context.model,
            }

            # Check cache
            result = await self.cache_service.get(cache_key)
            return result

        except Exception as e:
            logger.warning(f"Cache check failed: {e}")
            # Don't fail execution on cache errors
            return None

    async def _cache_result(self, context: ExecutionContext):
        """
        Cache successful result for future use

        Args:
            context: Execution context with successful result
        """
        if not self.cache_service or not context.is_success:
            return

        try:
            cache_entry = {
                "response": context.response,
                "model": context.model,
                "input_tokens": context.input_tokens,
                "output_tokens": context.output_tokens,
                "cost": context.cost,
                "quality_score": context.quality_score,
            }

            cache_key = {
                "prompt": context.prompt,
                "system_prompt": context.system_prompt,
                "usage_type": context.usage_type,
                "temperature": context.temperature,
                "model": context.model,
            }

            await self.cache_service.set(cache_key, cache_entry)
            logger.debug(f"Cached result for usage_type={context.usage_type}")

        except Exception as e:
            logger.warning(f"Cache write failed: {e}")
            # Don't fail execution on cache errors

    async def _validate_response(self, context: ExecutionContext) -> Dict[str, Any]:
        """
        Validate response using comprehensive validation pipeline

        Uses usage_type-specific validation pipeline with multiple validators:
        - Empty response check
        - JSON validation (for task_generation, code_execution)
        - Length validation (min/max)
        - Truncation detection
        - Format validation

        Args:
            context: Execution context with response

        Returns:
            Validation result dict with passed flag, errors, and quality score
        """
        response = context.response
        if not response:
            return {"passed": False, "errors": ["Empty response"], "quality_score": 0.0}

        # Get validation pipeline for usage type
        pipeline = get_pipeline(context.usage_type)

        # Build validation context
        validation_context = {
            "usage_type": context.usage_type,
            "max_tokens": context.max_tokens,
            "temperature": context.temperature,
        }

        # Run validation pipeline
        result = pipeline.validate(response, validation_context)

        # Log validation results
        if not result.passed:
            logger.warning(
                f"Validation failed for {context.usage_type}: {result.errors}"
            )
        if result.warnings:
            logger.info(
                f"Validation warnings for {context.usage_type}: {result.warnings}"
            )

        return {
            "passed": result.passed,
            "errors": result.errors if result.errors else None,
            "warnings": result.warnings if result.warnings else None,
            "quality_score": result.score,
            "metadata": result.metadata,
        }

    async def _run_pre_hooks(self, context: ExecutionContext):
        """
        Run pre-execution hooks

        Hooks can transform the context before execution.
        Example: prompt compression, variable injection, etc.

        Args:
            context: Execution context
        """
        for hook in context.pre_hooks:
            try:
                await hook(context)
            except Exception as e:
                logger.warning(f"Pre-hook failed: {e}", exc_info=True)
                # Continue execution even if hook fails

    async def _run_post_hooks(self, context: ExecutionContext):
        """
        Run post-execution hooks

        Hooks can transform the response after execution.
        Example: formatting, extraction, logging, etc.

        Args:
            context: Execution context
        """
        for hook in context.post_hooks:
            try:
                await hook(context)
            except Exception as e:
                logger.warning(f"Post-hook failed: {e}", exc_info=True)
                # Continue even if hook fails
