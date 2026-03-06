"""
PromptLoader - Loads and renders hardcoded prompt constants.

All prompts are stored as Python string constants in domain modules.
This loader provides the same API as the original YAML-based loader
but reads from an in-memory registry instead of the filesystem.

Consolidation: YAML → Python constants (no more dynamic file loading).
"""

import logging
from typing import Dict, Any, Optional, Tuple, List

from jinja2 import Environment, BaseLoader, TemplateSyntaxError

from app.prompts.models import (
    PromptTemplate,
    PromptMetadata,
    PromptVariables,
    RenderedPrompt,
    PromptNotFoundError,
    VariableValidationError,
    PromptRenderError,
)
from app.prompts.components import ALL_COMPONENTS

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Build the global prompt registry from all domain modules
# ---------------------------------------------------------------------------
_REGISTRY: Dict[str, Dict[str, Any]] = {}


def _build_registry() -> Dict[str, Dict[str, Any]]:
    """Lazily build the prompt registry from all domain modules."""
    if _REGISTRY:
        return _REGISTRY

    from app.prompts.backlog import PROMPTS as backlog
    from app.prompts.interviews_prompts import PROMPTS as interviews
    from app.prompts.context_prompts import PROMPTS as context
    from app.prompts.commits_prompts import PROMPTS as commits
    from app.prompts.discovery_prompts import PROMPTS as discovery
    from app.prompts.memory_prompts import PROMPTS as memory
    from app.prompts.projects_prompts import PROMPTS as projects
    from app.prompts.rag_prompts import PROMPTS as rag
    from app.prompts.utility_prompts import PROMPTS as utility
    from app.prompts.wiki_prompts import PROMPTS as wiki

    for module_prompts in (backlog, interviews, context, commits, discovery,
                           memory, projects, rag, utility, wiki):
        _REGISTRY.update(module_prompts)

    logger.info(f"Prompt registry built with {len(_REGISTRY)} prompts")
    return _REGISTRY


# ---------------------------------------------------------------------------
# Jinja2 environment (shared, stateless)
# ---------------------------------------------------------------------------
_jinja_env = Environment(
    loader=BaseLoader(),
    trim_blocks=True,
    lstrip_blocks=True,
    autoescape=False,
)


def _render_template(template_str: str, variables: Dict[str, Any]) -> str:
    """Render a Jinja2 template string with variables."""
    if not template_str:
        return ""
    try:
        template = _jinja_env.from_string(template_str)
        return template.render(**variables)
    except TemplateSyntaxError as e:
        logger.error(f"Jinja2 syntax error: {e}")
        raise PromptRenderError("unknown", f"Template syntax error: {e}")
    except Exception as e:
        logger.error(f"Error rendering template: {e}")
        return template_str


# ---------------------------------------------------------------------------
# PromptLoader — same public API, backed by Python constants
# ---------------------------------------------------------------------------
class PromptLoader:
    """
    Loads and renders prompt templates from hardcoded Python constants.

    Usage:
        loader = PromptLoader()
        system_prompt, user_prompt = loader.render(
            "backlog/epic_from_interview",
            {"conversation_text": "...", "project_name": "My Project"}
        )
    """

    def __init__(self, prompts_dir=None, enable_cache: bool = True):
        """Initialize PromptLoader. Arguments kept for backward compatibility."""
        self._registry = _build_registry()

    def load(self, prompt_name: str) -> PromptTemplate:
        """
        Load a prompt template by name.

        Args:
            prompt_name: Prompt identifier (e.g., "backlog/epic_from_interview")

        Returns:
            PromptTemplate object

        Raises:
            PromptNotFoundError: If prompt is not in registry
        """
        entry = self._registry.get(prompt_name)
        if entry is None:
            raise PromptNotFoundError(prompt_name)

        category = prompt_name.split("/")[0] if "/" in prompt_name else "general"
        name = prompt_name.split("/")[-1]

        metadata = PromptMetadata(
            name=name,
            version=1,
            category=category,
            description="",
            usage_type=entry.get("usage_type", "general"),
            variables=PromptVariables(),
            components=[],
        )

        return PromptTemplate(
            metadata=metadata,
            system_prompt=entry.get("system", ""),
            user_prompt=entry.get("user", ""),
        )

    def render(
        self,
        prompt_name: str,
        variables: Dict[str, Any] = None,
        strict: bool = False,
    ) -> Tuple[str, str]:
        """
        Render a prompt template with variables.

        Args:
            prompt_name: Prompt identifier
            variables: Dictionary of variables to substitute
            strict: If True, raise error on missing required variables

        Returns:
            Tuple of (system_prompt, user_prompt)
        """
        variables = variables or {}
        entry = self._registry.get(prompt_name)
        if entry is None:
            raise PromptNotFoundError(prompt_name)

        render_vars = {**variables, "components": ALL_COMPONENTS}

        system_prompt = _render_template(entry.get("system", ""), render_vars)
        user_prompt = _render_template(entry.get("user", ""), render_vars)

        return system_prompt, user_prompt

    def render_full(
        self,
        prompt_name: str,
        variables: Dict[str, Any] = None,
        strict: bool = False,
    ) -> RenderedPrompt:
        """Render and return full RenderedPrompt object."""
        variables = variables or {}
        system_prompt, user_prompt = self.render(prompt_name, variables, strict)
        entry = self._registry.get(prompt_name, {})

        return RenderedPrompt(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            template_name=prompt_name.split("/")[-1],
            template_version=1,
            usage_type=entry.get("usage_type", "general"),
            variables_used=variables,
            components_loaded=[],
        )

    def clear_cache(self):
        """No-op — constants don't need cache clearing."""
        pass

    def list_prompts(self, category: str = None) -> List[str]:
        """List available prompt names, optionally filtered by category."""
        names = sorted(self._registry.keys())
        if category:
            names = [n for n in names if n.startswith(f"{category}/")]
        return names

    def exists(self, prompt_name: str) -> bool:
        """Check if a prompt exists in the registry."""
        return prompt_name in self._registry


# ---------------------------------------------------------------------------
# Global singleton
# ---------------------------------------------------------------------------
_loader_instance: Optional[PromptLoader] = None


def get_prompt_loader() -> PromptLoader:
    """Get the global PromptLoader instance."""
    global _loader_instance
    if _loader_instance is None:
        _loader_instance = PromptLoader()
    return _loader_instance
