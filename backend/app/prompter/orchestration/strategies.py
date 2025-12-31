"""
Execution Strategies for Different Use Cases

Strategies configure ExecutionContext for different priorities:
- DefaultExecutionStrategy: Balanced (quality vs cost vs speed)
- FastExecutionStrategy: Prioritize speed and cost
- QualityExecutionStrategy: Prioritize quality and accuracy
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
from .context import ExecutionContext


class ExecutionStrategy(ABC):
    """Base class for execution strategies"""

    @abstractmethod
    def configure(self, context: ExecutionContext) -> ExecutionContext:
        """
        Configure execution context based on strategy

        Args:
            context: Execution context to configure

        Returns:
            Configured context
        """
        pass

    @abstractmethod
    def get_model_preferences(self) -> list[str]:
        """
        Get list of preferred models in priority order

        Returns:
            List of model names
        """
        pass

    @abstractmethod
    def get_fallback_models(self) -> list[str]:
        """
        Get list of fallback models for retry

        Returns:
            List of model names
        """
        pass


class DefaultExecutionStrategy(ExecutionStrategy):
    """
    Balanced strategy for general use cases

    Configuration:
    - Model: claude-sonnet-4 or gpt-4o
    - Temperature: 0.7 (balanced creativity)
    - Max tokens: 4000
    - Retry: 3 attempts with exponential backoff
    - Cache: Enabled
    - Fallback: claude-haiku-3 (cheaper)
    """

    def configure(self, context: ExecutionContext) -> ExecutionContext:
        """Configure for balanced execution"""
        # Model selection
        if not context.model:
            context.model = "claude-sonnet-4"

        # Parameters
        if context.temperature is None:
            context.temperature = 0.7

        if context.max_tokens is None:
            context.max_tokens = 4000

        # Retry configuration
        context.max_attempts = 3
        context.enable_retry = True
        context.enable_fallback = True
        context.fallback_models = self.get_fallback_models()

        # Cache configuration
        context.enable_cache = True

        # Strategy identifier
        context.execution_strategy = "default"
        context.metadata["strategy_config"] = {
            "priority": "balanced",
            "cost_weight": 0.33,
            "quality_weight": 0.34,
            "speed_weight": 0.33,
        }

        return context

    def get_model_preferences(self) -> list[str]:
        """Balanced model selection"""
        return [
            "claude-sonnet-4",  # Best balance of quality/cost
            "gpt-4o",  # Alternative balanced option
            "claude-haiku-3",  # Fast fallback
        ]

    def get_fallback_models(self) -> list[str]:
        """Cheaper models for fallback"""
        return [
            "claude-haiku-3",  # 5x cheaper than Sonnet
            "gemini-flash",  # Very cheap fallback
        ]


class FastExecutionStrategy(ExecutionStrategy):
    """
    Speed-optimized strategy for quick responses

    Configuration:
    - Model: claude-haiku-3 or gemini-flash
    - Temperature: 0.8 (faster generation)
    - Max tokens: 2000 (shorter responses)
    - Retry: 1 attempt (fail fast)
    - Cache: Enabled (speed boost)
    - Fallback: Disabled (no retry overhead)

    Use cases:
    - Interactive chat
    - Quick suggestions
    - Non-critical tasks
    """

    def configure(self, context: ExecutionContext) -> ExecutionContext:
        """Configure for fast execution"""
        # Fast model selection
        if not context.model:
            context.model = "claude-haiku-3"

        # Parameters optimized for speed
        if context.temperature is None:
            context.temperature = 0.8  # Higher temp = faster sampling

        if context.max_tokens is None:
            context.max_tokens = 2000  # Shorter responses

        # Minimal retry (fail fast)
        context.max_attempts = 1
        context.enable_retry = False
        context.enable_fallback = False
        context.fallback_models = []

        # Cache enabled for speed boost
        context.enable_cache = True

        # Strategy identifier
        context.execution_strategy = "fast"
        context.metadata["strategy_config"] = {
            "priority": "speed",
            "cost_weight": 0.3,
            "quality_weight": 0.2,
            "speed_weight": 0.5,
        }

        return context

    def get_model_preferences(self) -> list[str]:
        """Fast models only"""
        return [
            "claude-haiku-3",  # Fast and cheap
            "gemini-flash",  # Very fast
            "gpt-4o-mini",  # Alternative fast option
        ]

    def get_fallback_models(self) -> list[str]:
        """No fallback for fast strategy"""
        return []


class QualityExecutionStrategy(ExecutionStrategy):
    """
    Quality-optimized strategy for critical tasks

    Configuration:
    - Model: claude-opus-4 or claude-sonnet-4
    - Temperature: 0.3 (more deterministic)
    - Max tokens: 8000 (comprehensive responses)
    - Retry: 3 attempts
    - Cache: Disabled (fresh responses)
    - Fallback: claude-sonnet-4 (still high quality)

    Use cases:
    - Task generation
    - Code review
    - Critical analysis
    - Production decisions
    """

    def configure(self, context: ExecutionContext) -> ExecutionContext:
        """Configure for quality execution"""
        # Best model selection
        if not context.model:
            context.model = "claude-sonnet-4"  # Sonnet 4 is excellent quality

        # Parameters optimized for quality
        if context.temperature is None:
            context.temperature = 0.3  # Lower temp = more consistent/accurate

        if context.max_tokens is None:
            context.max_tokens = 8000  # Longer, more comprehensive responses

        # Max retry for reliability
        context.max_attempts = 3
        context.enable_retry = True
        context.enable_fallback = True
        context.fallback_models = self.get_fallback_models()

        # Cache disabled (prefer fresh, high-quality responses)
        context.enable_cache = False

        # Strategy identifier
        context.execution_strategy = "quality"
        context.metadata["strategy_config"] = {
            "priority": "quality",
            "cost_weight": 0.2,
            "quality_weight": 0.6,
            "speed_weight": 0.2,
        }

        return context

    def get_model_preferences(self) -> list[str]:
        """Best models only"""
        return [
            "claude-opus-4",  # Best quality (if available)
            "claude-sonnet-4",  # Excellent quality
            "gpt-4o",  # High quality alternative
        ]

    def get_fallback_models(self) -> list[str]:
        """High-quality fallback only"""
        return [
            "claude-sonnet-4",  # Still excellent quality
        ]


class CostOptimizedExecutionStrategy(ExecutionStrategy):
    """
    Cost-optimized strategy for budget-conscious applications

    Configuration:
    - Model: gemini-flash or claude-haiku-3
    - Temperature: 0.7 (balanced)
    - Max tokens: 2000 (shorter = cheaper)
    - Retry: 2 attempts (limited retries)
    - Cache: Enabled (avoid repeated costs)
    - Fallback: None (cheapest model already)

    Use cases:
    - High-volume operations
    - Testing/development
    - Non-critical tasks
    """

    def configure(self, context: ExecutionContext) -> ExecutionContext:
        """Configure for minimal cost"""
        # Cheapest model
        if not context.model:
            context.model = "gemini-flash"  # $0.35/$1.05 per MTok

        # Parameters
        if context.temperature is None:
            context.temperature = 0.7

        if context.max_tokens is None:
            context.max_tokens = 2000  # Keep responses short

        # Limited retry (reduce API costs)
        context.max_attempts = 2
        context.enable_retry = True
        context.enable_fallback = False
        context.fallback_models = []

        # Cache critical for cost savings
        context.enable_cache = True

        # Strategy identifier
        context.execution_strategy = "cost"
        context.metadata["strategy_config"] = {
            "priority": "cost",
            "cost_weight": 0.6,
            "quality_weight": 0.2,
            "speed_weight": 0.2,
        }

        return context

    def get_model_preferences(self) -> list[str]:
        """Cheapest models"""
        return [
            "gemini-flash",  # Cheapest
            "claude-haiku-3",  # Cheap alternative
            "gpt-4o-mini",  # Another cheap option
        ]

    def get_fallback_models(self) -> list[str]:
        """No fallback (already using cheapest)"""
        return []


# Strategy factory
STRATEGIES = {
    "default": DefaultExecutionStrategy,
    "balanced": DefaultExecutionStrategy,
    "fast": FastExecutionStrategy,
    "speed": FastExecutionStrategy,
    "quality": QualityExecutionStrategy,
    "high_quality": QualityExecutionStrategy,
    "cost": CostOptimizedExecutionStrategy,
    "cheap": CostOptimizedExecutionStrategy,
}


def get_strategy(strategy_name: str = "default") -> ExecutionStrategy:
    """
    Get execution strategy by name

    Args:
        strategy_name: Strategy name (default, fast, quality, cost)

    Returns:
        ExecutionStrategy instance

    Raises:
        ValueError: If strategy name not found
    """
    strategy_class = STRATEGIES.get(strategy_name.lower())
    if not strategy_class:
        raise ValueError(
            f"Unknown strategy: {strategy_name}. "
            f"Available: {list(STRATEGIES.keys())}"
        )
    return strategy_class()


def apply_strategy(
    context: ExecutionContext, strategy_name: str = "default"
) -> ExecutionContext:
    """
    Apply execution strategy to context

    Args:
        context: Execution context to configure
        strategy_name: Strategy to apply

    Returns:
        Configured context
    """
    strategy = get_strategy(strategy_name)
    return strategy.configure(context)
