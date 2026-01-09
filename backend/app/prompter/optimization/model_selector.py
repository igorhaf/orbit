"""
Model Selector - Intelligent Model Selection

Selects optimal AI model based on constraints:
- Cost budget (max cost per request)
- Quality requirements (min quality score)
- Latency requirements (max latency)
- Optimization goal (cost/quality/latency/balanced)

Models supported:
- Claude Sonnet 4: $3/$15 per MTok (quality: 0.95, latency: ~3s)
- Claude Haiku 3: $0.8/$4 per MTok (quality: 0.85, latency: ~1.5s)
- GPT-4o: $2.5/$10 per MTok (quality: 0.93, latency: ~2.5s)
- Gemini Flash: $0.35/$1.05 per MTok (quality: 0.78, latency: ~1s)
"""

import logging
from typing import Dict, Any, Optional, List
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)


class OptimizationGoal(Enum):
    """Optimization goal for model selection"""
    COST = "cost"
    QUALITY = "quality"
    LATENCY = "latency"
    BALANCED = "balanced"


@dataclass
class ModelProfile:
    """Profile of an AI model with cost/quality/latency characteristics"""
    name: str
    provider: str

    # Pricing (per million tokens)
    input_price_per_mtok: float
    output_price_per_mtok: float

    # Performance characteristics
    quality_score: float  # 0-1 (higher is better)
    avg_latency_ms: int  # Average latency in milliseconds

    # Context limits
    max_input_tokens: int
    max_output_tokens: int

    # Availability
    available: bool = True


class ModelSelector:
    """
    Intelligent model selector based on constraints

    Selects the best model for a given request considering:
    - Cost budget
    - Quality requirements
    - Latency requirements
    - Optimization goal
    """

    # Model catalog with current pricing (as of 2025)
    MODELS = {
        "claude-sonnet-4": ModelProfile(
            name="claude-sonnet-4",
            provider="anthropic",
            input_price_per_mtok=3.0,
            output_price_per_mtok=15.0,
            quality_score=0.95,
            avg_latency_ms=3000,
            max_input_tokens=200000,
            max_output_tokens=8000,
            available=True,
        ),
        "claude-haiku-3": ModelProfile(
            name="claude-haiku-3",
            provider="anthropic",
            input_price_per_mtok=0.8,
            output_price_per_mtok=4.0,
            quality_score=0.85,
            avg_latency_ms=1500,
            max_input_tokens=200000,
            max_output_tokens=4000,
            available=True,
        ),
        "gpt-4o": ModelProfile(
            name="gpt-4o",
            provider="openai",
            input_price_per_mtok=2.5,
            output_price_per_mtok=10.0,
            quality_score=0.93,
            avg_latency_ms=2500,
            max_input_tokens=128000,
            max_output_tokens=4096,
            available=True,
        ),
        "gemini-flash": ModelProfile(
            name="gemini-flash",
            provider="google",
            input_price_per_mtok=0.35,
            output_price_per_mtok=1.05,
            quality_score=0.78,
            avg_latency_ms=1000,
            max_input_tokens=1000000,
            max_output_tokens=8000,
            available=True,
        ),
    }

    def __init__(self):
        """Initialize model selector"""
        self.models = self.MODELS.copy()

    def select(
        self,
        estimated_input_tokens: int,
        estimated_output_tokens: int,
        max_cost: Optional[float] = None,
        min_quality: Optional[float] = None,
        max_latency_ms: Optional[int] = None,
        optimize_for: str = "balanced",
        exclude_models: Optional[List[str]] = None,
    ) -> str:
        """
        Select best model based on constraints

        Args:
            estimated_input_tokens: Estimated input token count
            estimated_output_tokens: Estimated output token count
            max_cost: Maximum cost per request in USD (None = no limit)
            min_quality: Minimum quality score 0-1 (None = no minimum)
            max_latency_ms: Maximum latency in ms (None = no limit)
            optimize_for: Optimization goal (cost/quality/latency/balanced)
            exclude_models: List of model names to exclude

        Returns:
            Selected model name

        Raises:
            ValueError: If no model meets the constraints
        """
        exclude_models = exclude_models or []

        # Filter available models
        candidates = [
            model for name, model in self.models.items()
            if model.available and name not in exclude_models
        ]

        if not candidates:
            raise ValueError("No models available for selection")

        # Apply constraints
        filtered = []
        for model in candidates:
            # Calculate estimated cost
            cost = self._estimate_cost(
                model,
                estimated_input_tokens,
                estimated_output_tokens
            )

            # Check cost constraint
            if max_cost and cost > max_cost:
                logger.debug(f"❌ {model.name}: cost ${cost:.4f} > max ${max_cost:.4f}")
                continue

            # Check quality constraint
            if min_quality and model.quality_score < min_quality:
                logger.debug(f"❌ {model.name}: quality {model.quality_score} < min {min_quality}")
                continue

            # Check latency constraint
            if max_latency_ms and model.avg_latency_ms > max_latency_ms:
                logger.debug(f"❌ {model.name}: latency {model.avg_latency_ms}ms > max {max_latency_ms}ms")
                continue

            # Check token limits
            if estimated_input_tokens > model.max_input_tokens:
                logger.debug(f"❌ {model.name}: input tokens {estimated_input_tokens} > max {model.max_input_tokens}")
                continue

            if estimated_output_tokens > model.max_output_tokens:
                logger.debug(f"❌ {model.name}: output tokens {estimated_output_tokens} > max {model.max_output_tokens}")
                continue

            # Model passes all constraints
            filtered.append((model, cost))
            logger.debug(f"✓ {model.name}: cost=${cost:.4f}, quality={model.quality_score}, latency={model.avg_latency_ms}ms")

        if not filtered:
            raise ValueError(
                f"No models meet the constraints: "
                f"max_cost=${max_cost}, min_quality={min_quality}, "
                f"max_latency_ms={max_latency_ms}"
            )

        # Select best model based on optimization goal
        goal = OptimizationGoal(optimize_for)
        selected_model = self._optimize(filtered, goal)

        logger.info(
            f"Selected {selected_model.name} "
            f"(optimize_for={optimize_for}, "
            f"quality={selected_model.quality_score}, "
            f"latency={selected_model.avg_latency_ms}ms)"
        )

        return selected_model.name

    def _estimate_cost(
        self,
        model: ModelProfile,
        input_tokens: int,
        output_tokens: int
    ) -> float:
        """
        Estimate cost for a model

        Args:
            model: Model profile
            input_tokens: Input token count
            output_tokens: Output token count

        Returns:
            Estimated cost in USD
        """
        input_cost = (input_tokens / 1_000_000) * model.input_price_per_mtok
        output_cost = (output_tokens / 1_000_000) * model.output_price_per_mtok
        return input_cost + output_cost

    def _optimize(
        self,
        candidates: List[tuple[ModelProfile, float]],
        goal: OptimizationGoal
    ) -> ModelProfile:
        """
        Select best model based on optimization goal

        Args:
            candidates: List of (model, estimated_cost) tuples
            goal: Optimization goal

        Returns:
            Selected model
        """
        if goal == OptimizationGoal.COST:
            # Minimize cost
            return min(candidates, key=lambda x: x[1])[0]

        elif goal == OptimizationGoal.QUALITY:
            # Maximize quality
            return max(candidates, key=lambda x: x[0].quality_score)[0]

        elif goal == OptimizationGoal.LATENCY:
            # Minimize latency
            return min(candidates, key=lambda x: x[0].avg_latency_ms)[0]

        else:  # BALANCED
            # Score each model (normalized 0-1)
            scored = []

            # Get ranges for normalization
            costs = [c for _, c in candidates]
            qualities = [m.quality_score for m, _ in candidates]
            latencies = [m.avg_latency_ms for m, _ in candidates]

            min_cost, max_cost = min(costs), max(costs)
            min_quality, max_quality = min(qualities), max(qualities)
            min_latency, max_latency = min(latencies), max(latencies)

            for model, cost in candidates:
                # Normalize (lower is better for cost/latency, higher for quality)
                cost_score = 1 - self._normalize(cost, min_cost, max_cost)
                quality_score = self._normalize(model.quality_score, min_quality, max_quality)
                latency_score = 1 - self._normalize(model.avg_latency_ms, min_latency, max_latency)

                # Balanced weights: 33% each
                total_score = (cost_score * 0.33 + quality_score * 0.34 + latency_score * 0.33)

                scored.append((model, total_score))
                logger.debug(
                    f"{model.name}: balanced_score={total_score:.3f} "
                    f"(cost={cost_score:.2f}, quality={quality_score:.2f}, latency={latency_score:.2f})"
                )

            # Return highest scoring model
            return max(scored, key=lambda x: x[1])[0]

    def _normalize(self, value: float, min_val: float, max_val: float) -> float:
        """
        Normalize value to 0-1 range

        Args:
            value: Value to normalize
            min_val: Minimum value in range
            max_val: Maximum value in range

        Returns:
            Normalized value (0-1)
        """
        if max_val == min_val:
            return 0.5  # All values are the same

        return (value - min_val) / (max_val - min_val)

    def get_model_info(self, model_name: str) -> Optional[ModelProfile]:
        """
        Get model profile

        Args:
            model_name: Model name

        Returns:
            ModelProfile or None if not found
        """
        return self.models.get(model_name)

    def list_models(self, available_only: bool = True) -> List[str]:
        """
        List all models

        Args:
            available_only: Only list available models

        Returns:
            List of model names
        """
        if available_only:
            return [name for name, model in self.models.items() if model.available]
        return list(self.models.keys())
