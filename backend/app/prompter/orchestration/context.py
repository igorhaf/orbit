"""
Execution Context for Prompt Orchestration

Encapsulates all state for a single prompt execution including:
- Input configuration (prompt, model, parameters)
- Metadata (project, interview, task references)
- Execution state (attempts, status)
- Results (response, tokens, cost)
- Timing information
"""

from dataclasses import dataclass, field
from typing import Dict, Any, Optional
from uuid import UUID
from datetime import datetime


@dataclass
class ExecutionContext:
    """
    Context for a single prompt execution with retry support.

    This dataclass tracks all information needed for orchestrating
    a prompt execution, including retry attempts, fallback strategies,
    and result tracking.
    """

    # ========== INPUT ==========
    prompt: str
    system_prompt: Optional[str] = None
    usage_type: str = "general"  # task_generation, interview, code_execution, etc.
    max_tokens: int = 4000
    temperature: float = 0.7
    model: Optional[str] = None  # If None, will be selected by ModelSelector

    # ========== METADATA ==========
    project_id: Optional[UUID] = None
    interview_id: Optional[UUID] = None
    task_id: Optional[UUID] = None
    template_name: Optional[str] = None
    template_version: Optional[int] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    # ========== EXECUTION STATE ==========
    attempt: int = 1
    max_attempts: int = 3
    status: str = "pending"  # pending, executing, success, failed, cached

    # ========== RESULTS ==========
    response: Optional[str] = None
    error: Optional[Exception] = None
    error_message: Optional[str] = None

    # Token usage
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0

    # Cost tracking
    cost: float = 0.0

    # Cache information
    cache_hit: bool = False
    cache_type: Optional[str] = None  # exact, semantic, template

    # Quality tracking
    quality_score: Optional[float] = None
    validation_passed: bool = False

    # ========== TIMING ==========
    created_at: datetime = field(default_factory=datetime.utcnow)
    start_time: Optional[float] = None  # Unix timestamp
    end_time: Optional[float] = None    # Unix timestamp

    # ========== STRATEGIES ==========
    execution_strategy: str = "default"  # default, fast, quality
    enable_cache: bool = True
    enable_retry: bool = True
    enable_fallback: bool = True

    # Fallback models (tried in order on retry)
    fallback_models: list[str] = field(default_factory=list)

    # ========== HOOKS ==========
    pre_hooks: list[callable] = field(default_factory=list)
    post_hooks: list[callable] = field(default_factory=list)

    def __post_init__(self):
        """Validate context after initialization"""
        if not self.prompt:
            raise ValueError("Prompt cannot be empty")

        if self.max_attempts < 1:
            raise ValueError("max_attempts must be >= 1")

        if self.temperature < 0 or self.temperature > 2:
            raise ValueError("temperature must be between 0 and 2")

    @property
    def duration_seconds(self) -> Optional[float]:
        """Calculate execution duration in seconds"""
        if self.start_time and self.end_time:
            return self.end_time - self.start_time
        return None

    @property
    def is_success(self) -> bool:
        """Check if execution was successful"""
        return self.status == "success" and self.response is not None

    @property
    def is_failed(self) -> bool:
        """Check if execution failed"""
        return self.status == "failed"

    @property
    def is_cached(self) -> bool:
        """Check if result came from cache"""
        return self.cache_hit

    @property
    def can_retry(self) -> bool:
        """Check if another retry is allowed"""
        return self.enable_retry and self.attempt < self.max_attempts

    def mark_started(self, timestamp: float):
        """Mark execution as started"""
        self.start_time = timestamp
        self.status = "executing"

    def mark_success(self, response: str, timestamp: float, tokens: Dict[str, int], cost: float):
        """Mark execution as successful"""
        self.response = response
        self.end_time = timestamp
        self.status = "success"
        self.input_tokens = tokens.get("input", 0)
        self.output_tokens = tokens.get("output", 0)
        self.total_tokens = tokens.get("total", 0)
        self.cost = cost

    def mark_failed(self, error: Exception, timestamp: float):
        """Mark execution as failed"""
        self.error = error
        self.error_message = str(error)
        self.end_time = timestamp
        self.status = "failed"

    def mark_cached(self, response: str, cache_type: str):
        """Mark result as coming from cache"""
        self.response = response
        self.cache_hit = True
        self.cache_type = cache_type
        self.status = "cached"
        self.cost = 0.0  # No API cost for cached results

    def increment_attempt(self):
        """Increment retry attempt counter"""
        self.attempt += 1

    def to_dict(self) -> Dict[str, Any]:
        """Convert context to dictionary for logging/serialization"""
        return {
            "usage_type": self.usage_type,
            "model": self.model,
            "status": self.status,
            "attempt": self.attempt,
            "max_attempts": self.max_attempts,
            "cache_hit": self.cache_hit,
            "cache_type": self.cache_type,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.total_tokens,
            "cost": self.cost,
            "quality_score": self.quality_score,
            "validation_passed": self.validation_passed,
            "duration_seconds": self.duration_seconds,
            "project_id": str(self.project_id) if self.project_id else None,
            "interview_id": str(self.interview_id) if self.interview_id else None,
            "task_id": str(self.task_id) if self.task_id else None,
            "template_name": self.template_name,
            "template_version": self.template_version,
            "error_message": self.error_message,
        }

    def __repr__(self) -> str:
        return (
            f"ExecutionContext(usage_type={self.usage_type}, "
            f"model={self.model}, status={self.status}, "
            f"attempt={self.attempt}/{self.max_attempts}, "
            f"cost=${self.cost:.4f})"
        )
