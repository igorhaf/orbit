"""
Error Classifier for AI Flow Smart Fallback & Retry
PROMPT #229 - AI Flow Performance Refactor

Classifies exceptions into categories to enable intelligent decisions:
- permanent: Don't retry, skip to next model (401, 403, 404, auth, model_not_found)
- oom: Skip ALL models of same provider (prevent GPU thrashing)
- transient: Safe to retry (timeout, 429, 500+, connection errors)
"""

import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Error patterns for classification
PERMANENT_PATTERNS = [
    "401", "403", "404",
    "invalid_api_key", "invalid api key",
    "authentication", "unauthorized", "forbidden",
    "model_not_found", "model not found",
    "not found", "does not exist",
    "permission denied", "access denied",
    "invalid model", "unknown model",
]

OOM_PATTERNS = [
    "out of memory", "oom",
    "not enough memory", "insufficient memory",
    "cuda out of memory", "cuda error",
    "memory allocation", "gpu memory",
    "failed to allocate", "ggml_cuda",
]

TRANSIENT_PATTERNS = [
    "timeout", "timed out", "deadline exceeded",
    "rate_limit", "rate limit", "429", "too many requests",
    "500", "502", "503", "504",
    "server_error", "server error", "internal server error",
    "connection", "connect", "network",
    "overloaded", "temporarily unavailable",
    "service unavailable", "bad gateway",
]


def classify_error(error: Exception) -> str:
    """
    Classify an error into: 'permanent', 'transient', or 'oom'.

    Args:
        error: The exception to classify.

    Returns:
        'permanent' - Don't retry, skip immediately.
        'oom' - Skip all models of same provider (GPU thrashing).
        'transient' - Safe to retry with backoff.
    """
    error_str = str(error).lower()

    # Check HTTP status code if available
    status_code = getattr(error, "status_code", None)
    if status_code is None and hasattr(error, "response"):
        response = getattr(error, "response", None)
        if response is not None:
            status_code = getattr(response, "status_code", None)

    # OOM first (most specific)
    if any(p in error_str for p in OOM_PATTERNS):
        return "oom"

    # Permanent errors by status code
    if status_code in (401, 403, 404):
        return "permanent"

    # Transient errors by status code
    if status_code in (429, 500, 502, 503, 504):
        return "transient"

    # Pattern-based classification
    if any(p in error_str for p in PERMANENT_PATTERNS):
        return "permanent"

    if any(p in error_str for p in TRANSIENT_PATTERNS):
        return "transient"

    # Default: transient (safer to retry than to give up)
    return "transient"


def is_retryable(error: Exception) -> bool:
    """Check if an error is retryable (not permanent)."""
    return classify_error(error) != "permanent"


def format_error_classification(error: Exception) -> str:
    """Return human-readable classification string for logging."""
    cls = classify_error(error)
    status = getattr(error, "status_code", None)
    return f"{cls} (status={status}, msg={str(error)[:80]})"
