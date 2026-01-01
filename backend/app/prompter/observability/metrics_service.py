"""
Prometheus Metrics for Prompter

Exposes detailed metrics for monitoring cost, performance, and quality.
"""

import logging
from prometheus_client import Counter, Histogram, Gauge, Info
from typing import Optional

logger = logging.getLogger(__name__)


# ============================================================================
# EXECUTION METRICS
# ============================================================================

prompter_executions_total = Counter(
    'prompter_executions_total',
    'Total number of prompt executions',
    ['usage_type', 'model', 'status']  # status: success, error, cached
)

prompter_execution_duration_seconds = Histogram(
    'prompter_execution_duration_seconds',
    'Prompt execution duration in seconds',
    ['usage_type', 'model'],
    buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0]
)

prompter_token_usage = Histogram(
    'prompter_token_usage',
    'Token usage per execution',
    ['usage_type', 'model', 'token_type'],  # token_type: input, output
    buckets=[100, 500, 1000, 2000, 5000, 10000, 20000, 50000]
)

prompter_cost_per_execution_usd = Histogram(
    'prompter_cost_per_execution_usd',
    'Cost per execution in USD',
    ['usage_type', 'model'],
    buckets=[0.0001, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0]
)

# ============================================================================
# CACHE METRICS
# ============================================================================

prompter_cache_hits_total = Counter(
    'prompter_cache_hits_total',
    'Total cache hits',
    ['cache_level']  # L1 (exact), L2 (semantic), L3 (template)
)

prompter_cache_misses_total = Counter(
    'prompter_cache_misses_total',
    'Total cache misses',
    ['cache_level']
)

prompter_cache_hit_rate = Gauge(
    'prompter_cache_hit_rate',
    'Current cache hit rate (0-1)',
    ['cache_level']
)

prompter_cache_size = Gauge(
    'prompter_cache_size',
    'Number of entries in cache',
    ['cache_level']
)

# ============================================================================
# QUALITY METRICS
# ============================================================================

prompter_quality_score = Histogram(
    'prompter_quality_score',
    'Quality score per execution (0-1)',
    ['usage_type', 'model'],
    buckets=[0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0]
)

prompter_validation_failures_total = Counter(
    'prompter_validation_failures_total',
    'Total validation failures',
    ['usage_type', 'validation_type']  # validation_type: syntax, completeness, etc
)

# ============================================================================
# TEMPLATE METRICS
# ============================================================================

prompter_template_usage = Counter(
    'prompter_template_usage',
    'Template usage count',
    ['template_name', 'version']
)

prompter_template_render_duration_seconds = Histogram(
    'prompter_template_render_duration_seconds',
    'Template rendering duration',
    ['template_name'],
    buckets=[0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0]
)

# ============================================================================
# BATCH METRICS
# ============================================================================

prompter_batch_size = Histogram(
    'prompter_batch_size',
    'Number of requests per batch',
    ['usage_type'],
    buckets=[1, 2, 5, 10, 20, 50, 100]
)

prompter_batch_wait_time_ms = Histogram(
    'prompter_batch_wait_time_ms',
    'Time requests wait in batch queue (milliseconds)',
    ['usage_type'],
    buckets=[10, 50, 100, 200, 500, 1000, 2000]
)

# ============================================================================
# RETRY METRICS
# ============================================================================

prompter_retry_attempts_total = Counter(
    'prompter_retry_attempts_total',
    'Total retry attempts',
    ['usage_type', 'attempt']  # attempt: 1, 2, 3
)

prompter_fallback_model_usage_total = Counter(
    'prompter_fallback_model_usage_total',
    'Total fallback model usage',
    ['original_model', 'fallback_model']
)

# ============================================================================
# INFO METRIC
# ============================================================================

prompter_info = Info(
    'prompter_info',
    'Prompter system information'
)

# Set static info
prompter_info.info({
    'version': '2.1.0',
    'architecture': 'modular',
    'cache_levels': '3',
    'features': 'templates,caching,batching,tracing,metrics'
})


# ============================================================================
# METRICS SERVICE
# ============================================================================

class MetricsService:
    """
    Service for recording Prompter metrics to Prometheus

    All methods are static and thread-safe (Prometheus client handles locking).

    Example:
        MetricsService.record_execution(
            usage_type="task_generation",
            model="gpt-4o",
            status="success",
            duration_seconds=2.5,
            input_tokens=1000,
            output_tokens=500,
            cost_usd=0.025,
            quality_score=0.92
        )
    """

    @staticmethod
    def record_execution(
        usage_type: str,
        model: str,
        status: str,  # success, error, cached
        duration_seconds: float,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cost_usd: float = 0.0,
        quality_score: Optional[float] = None
    ):
        """
        Record execution metrics

        Args:
            usage_type: Type of usage (task_generation, interview, etc.)
            model: Model name
            status: Execution status (success, error, cached)
            duration_seconds: Execution duration
            input_tokens: Input token count
            output_tokens: Output token count
            cost_usd: Execution cost in USD
            quality_score: Optional quality score (0-1)
        """
        try:
            # Increment counter
            prompter_executions_total.labels(
                usage_type=usage_type,
                model=model,
                status=status
            ).inc()

            # Record duration
            prompter_execution_duration_seconds.labels(
                usage_type=usage_type,
                model=model
            ).observe(duration_seconds)

            # Record tokens
            if input_tokens > 0:
                prompter_token_usage.labels(
                    usage_type=usage_type,
                    model=model,
                    token_type="input"
                ).observe(input_tokens)

            if output_tokens > 0:
                prompter_token_usage.labels(
                    usage_type=usage_type,
                    model=model,
                    token_type="output"
                ).observe(output_tokens)

            # Record cost
            if cost_usd > 0:
                prompter_cost_per_execution_usd.labels(
                    usage_type=usage_type,
                    model=model
                ).observe(cost_usd)

            # Record quality
            if quality_score is not None:
                prompter_quality_score.labels(
                    usage_type=usage_type,
                    model=model
                ).observe(quality_score)

        except Exception as e:
            logger.error(f"Failed to record execution metrics: {e}")

    @staticmethod
    def record_cache_hit(level: str):
        """Record cache hit"""
        try:
            prompter_cache_hits_total.labels(cache_level=level).inc()
        except Exception as e:
            logger.error(f"Failed to record cache hit: {e}")

    @staticmethod
    def record_cache_miss(level: str):
        """Record cache miss"""
        try:
            prompter_cache_misses_total.labels(cache_level=level).inc()
        except Exception as e:
            logger.error(f"Failed to record cache miss: {e}")

    @staticmethod
    def update_cache_hit_rate(level: str, hit_rate: float):
        """Update cache hit rate gauge (0-1)"""
        try:
            prompter_cache_hit_rate.labels(cache_level=level).set(hit_rate)
        except Exception as e:
            logger.error(f"Failed to update cache hit rate: {e}")

    @staticmethod
    def update_cache_size(level: str, size: int):
        """Update cache size gauge"""
        try:
            prompter_cache_size.labels(cache_level=level).set(size)
        except Exception as e:
            logger.error(f"Failed to update cache size: {e}")

    @staticmethod
    def record_template_usage(template_name: str, version: str or int):
        """Record template usage"""
        try:
            prompter_template_usage.labels(
                template_name=template_name,
                version=str(version)
            ).inc()
        except Exception as e:
            logger.error(f"Failed to record template usage: {e}")

    @staticmethod
    def record_template_render_duration(template_name: str, duration_seconds: float):
        """Record template rendering duration"""
        try:
            prompter_template_render_duration_seconds.labels(
                template_name=template_name
            ).observe(duration_seconds)
        except Exception as e:
            logger.error(f"Failed to record template render duration: {e}")

    @staticmethod
    def record_batch(usage_type: str, batch_size: int, wait_time_ms: float):
        """Record batch execution"""
        try:
            prompter_batch_size.labels(usage_type=usage_type).observe(batch_size)
            prompter_batch_wait_time_ms.labels(usage_type=usage_type).observe(wait_time_ms)
        except Exception as e:
            logger.error(f"Failed to record batch metrics: {e}")

    @staticmethod
    def record_retry(usage_type: str, attempt: int):
        """Record retry attempt"""
        try:
            prompter_retry_attempts_total.labels(
                usage_type=usage_type,
                attempt=str(attempt)
            ).inc()
        except Exception as e:
            logger.error(f"Failed to record retry: {e}")

    @staticmethod
    def record_fallback(original_model: str, fallback_model: str):
        """Record fallback model usage"""
        try:
            prompter_fallback_model_usage_total.labels(
                original_model=original_model,
                fallback_model=fallback_model
            ).inc()
        except Exception as e:
            logger.error(f"Failed to record fallback: {e}")

    @staticmethod
    def record_validation_failure(usage_type: str, validation_type: str):
        """Record validation failure"""
        try:
            prompter_validation_failures_total.labels(
                usage_type=usage_type,
                validation_type=validation_type
            ).inc()
        except Exception as e:
            logger.error(f"Failed to record validation failure: {e}")
