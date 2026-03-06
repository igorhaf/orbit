"""
Thin Jinja2 render utility for hardcoded prompt templates.

Replaces the YAML-based PromptLoader with a simple string rendering function.
All prompts are now Python constants — this module only handles variable substitution.
"""

from typing import Dict, Any, Tuple, Optional
from jinja2 import Environment, BaseLoader

_env = Environment(
    loader=BaseLoader(),
    trim_blocks=True,
    lstrip_blocks=True,
    autoescape=False,
)


def render(template: str, variables: Dict[str, Any] = None) -> str:
    """Render a Jinja2 template string with variables.

    Args:
        template: Jinja2 template string
        variables: Dictionary of variables to substitute

    Returns:
        Rendered string
    """
    if not template:
        return ""
    variables = variables or {}
    return _env.from_string(template).render(**variables)
