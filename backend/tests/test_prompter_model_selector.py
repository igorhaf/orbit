"""
Tests for Prompter Model Selector

Tests intelligent model selection based on constraints.
"""

import pytest
from app.prompter.optimization import ModelSelector, OptimizationGoal


class TestModelSelector:
    """Test ModelSelector functionality"""

    def setup_method(self):
        """Setup test model selector"""
        self.selector = ModelSelector()

    def test_selector_initialization(self):
        """Test selector initializes with models"""
        assert self.selector is not None
        assert len(self.selector.models) == 4
        assert "claude-sonnet-4" in self.selector.models
        assert "claude-haiku-3" in self.selector.models
        assert "gpt-4o" in self.selector.models
        assert "gemini-flash" in self.selector.models

    def test_select_default_no_constraints(self):
        """Test selection with no constraints"""
        model = self.selector.select(
            estimated_input_tokens=1000,
            estimated_output_tokens=500,
            optimize_for="balanced"
        )
        assert model in ["claude-sonnet-4", "claude-haiku-3", "gpt-4o", "gemini-flash"]

    def test_select_cost_optimized(self):
        """Test cost optimization selects cheapest model"""
        model = self.selector.select(
            estimated_input_tokens=1000,
            estimated_output_tokens=500,
            optimize_for="cost"
        )
        # Should select gemini-flash (cheapest)
        assert model == "gemini-flash"

    def test_select_quality_optimized(self):
        """Test quality optimization selects best model"""
        model = self.selector.select(
            estimated_input_tokens=1000,
            estimated_output_tokens=500,
            optimize_for="quality"
        )
        # Should select claude-sonnet-4 (best quality: 0.95)
        assert model == "claude-sonnet-4"

    def test_select_latency_optimized(self):
        """Test latency optimization selects fastest model"""
        model = self.selector.select(
            estimated_input_tokens=1000,
            estimated_output_tokens=500,
            optimize_for="latency"
        )
        # Should select gemini-flash (fastest: 1000ms)
        assert model == "gemini-flash"

    def test_select_with_cost_constraint(self):
        """Test selection with max cost constraint"""
        # Set very low cost constraint
        model = self.selector.select(
            estimated_input_tokens=1000,
            estimated_output_tokens=500,
            max_cost=0.001,  # Very low budget
            optimize_for="quality"
        )
        # Should select cheapest model that meets constraint
        assert model == "gemini-flash"

    def test_select_with_quality_constraint(self):
        """Test selection with minimum quality constraint"""
        model = self.selector.select(
            estimated_input_tokens=1000,
            estimated_output_tokens=500,
            min_quality=0.90,  # High quality requirement
            optimize_for="cost"
        )
        # Should exclude haiku (0.85) and gemini (0.78)
        assert model in ["claude-sonnet-4", "gpt-4o"]

    def test_select_with_latency_constraint(self):
        """Test selection with max latency constraint"""
        model = self.selector.select(
            estimated_input_tokens=1000,
            estimated_output_tokens=500,
            max_latency_ms=2000,  # Max 2 seconds
            optimize_for="quality"
        )
        # Should exclude claude-sonnet-4 (3000ms) and gpt-4o (2500ms)
        assert model in ["claude-haiku-3", "gemini-flash"]

    def test_select_with_multiple_constraints(self):
        """Test selection with multiple constraints"""
        model = self.selector.select(
            estimated_input_tokens=1000,
            estimated_output_tokens=500,
            max_cost=0.01,
            min_quality=0.80,
            max_latency_ms=2000,
            optimize_for="balanced"
        )
        # Should find a model that meets all constraints
        assert model is not None

    def test_select_no_models_meet_constraints(self):
        """Test error when no models meet constraints"""
        with pytest.raises(ValueError, match="No models meet the constraints"):
            self.selector.select(
                estimated_input_tokens=1000,
                estimated_output_tokens=500,
                max_cost=0.0001,  # Impossibly low
                min_quality=0.99,  # Impossibly high
                optimize_for="balanced"
            )

    def test_select_exclude_models(self):
        """Test excluding specific models"""
        model = self.selector.select(
            estimated_input_tokens=1000,
            estimated_output_tokens=500,
            exclude_models=["gemini-flash", "claude-haiku-3"],
            optimize_for="cost"
        )
        # Should select from remaining models
        assert model in ["claude-sonnet-4", "gpt-4o"]

    def test_get_model_info(self):
        """Test getting model information"""
        info = self.selector.get_model_info("claude-sonnet-4")
        assert info is not None
        assert info.name == "claude-sonnet-4"
        assert info.provider == "anthropic"
        assert info.quality_score == 0.95
        assert info.input_price_per_mtok == 3.0

    def test_list_models(self):
        """Test listing available models"""
        models = self.selector.list_models(available_only=True)
        assert len(models) == 4
        assert "claude-sonnet-4" in models

    def test_estimate_cost(self):
        """Test cost estimation"""
        model = self.selector.models["claude-sonnet-4"]
        cost = self.selector._estimate_cost(model, 1000, 500)

        # 1000 tokens input = 0.001 MTok * $3 = $0.003
        # 500 tokens output = 0.0005 MTok * $15 = $0.0075
        # Total = $0.0105
        expected_cost = (1000 / 1_000_000) * 3.0 + (500 / 1_000_000) * 15.0
        assert cost == pytest.approx(expected_cost)

    def test_balanced_optimization(self):
        """Test balanced optimization scoring"""
        # Balanced should consider cost, quality, and latency
        model = self.selector.select(
            estimated_input_tokens=1000,
            estimated_output_tokens=500,
            optimize_for="balanced"
        )
        # Should be a reasonable middle ground
        assert model in self.selector.models


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
