"""
AI Model Pricing Utility
Centralized pricing calculations for all AI providers

PROMPT #54.2 - Phase 2: Cost Analytics Dashboard
"""

from typing import Dict, Tuple


# Pricing per million tokens (input, output)
# Source: Official provider pricing pages (as of January 2026)
MODEL_PRICING = {
    # Anthropic Claude models
    "claude-sonnet-4-20250514": (3.00, 15.00),
    "claude-sonnet-4": (3.00, 15.00),
    "claude-haiku-4-5": (0.80, 4.00),
    "claude-haiku-4": (0.80, 4.00),
    "claude-opus-4-5": (15.00, 75.00),
    "claude-opus-4": (15.00, 75.00),

    # OpenAI models
    "gpt-4o": (2.50, 10.00),
    "gpt-4-turbo-preview": (10.00, 30.00),
    "gpt-4-turbo": (10.00, 30.00),
    "gpt-3.5-turbo": (0.50, 1.50),

    # Google Gemini models
    "gemini-1.5-pro": (1.25, 5.00),
    "gemini-1.5-flash": (0.35, 1.05),
    "gemini-pro": (0.50, 1.50),
}


def get_model_pricing(model_name: str) -> Tuple[float, float]:
    """
    Get pricing for a specific model

    Args:
        model_name: Name of the AI model

    Returns:
        Tuple of (input_price_per_mtok, output_price_per_mtok)
        Returns default pricing (1.00, 5.00) if model not found
    """
    # Try exact match first
    if model_name in MODEL_PRICING:
        return MODEL_PRICING[model_name]

    # Try partial match (for model names with versions)
    model_lower = model_name.lower()
    for key, pricing in MODEL_PRICING.items():
        if key.lower() in model_lower or model_lower in key.lower():
            return pricing

    # Default pricing if model not found (conservative estimate)
    return (1.00, 5.00)


def calculate_cost(
    input_tokens: int,
    output_tokens: int,
    model_name: str
) -> Dict[str, float]:
    """
    Calculate cost for an AI execution

    PROMPT #54.2 - Phase 2: Centralized cost calculation

    Args:
        input_tokens: Number of input tokens
        output_tokens: Number of output tokens
        model_name: Name of the AI model

    Returns:
        Dict with:
        - input_cost: Cost of input tokens in USD
        - output_cost: Cost of output tokens in USD
        - total_cost: Total cost in USD
    """
    input_price, output_price = get_model_pricing(model_name)

    # Calculate costs (price is per million tokens)
    input_cost = (input_tokens / 1_000_000) * input_price
    output_cost = (output_tokens / 1_000_000) * output_price
    total_cost = input_cost + output_cost

    return {
        "input_cost": round(input_cost, 6),
        "output_cost": round(output_cost, 6),
        "total_cost": round(total_cost, 6)
    }


def get_all_models() -> Dict[str, Tuple[float, float]]:
    """
    Get all available models and their pricing

    Returns:
        Dictionary of model_name: (input_price, output_price)
    """
    return MODEL_PRICING.copy()


def format_cost(cost: float) -> str:
    """
    Format cost for display

    Args:
        cost: Cost in USD

    Returns:
        Formatted string (e.g., "$0.0234")
    """
    if cost < 0.0001:
        return f"${cost:.6f}"
    elif cost < 0.01:
        return f"${cost:.4f}"
    else:
        return f"${cost:.2f}"
