"""
PromptLoader - Loads and renders YAML prompt templates

Features:
- YAML file parsing with Jinja2 templating
- Component inclusion and reuse
- Variable validation
- Caching for performance
- Graceful error handling

PROMPT #103 - Externalize Hardcoded Prompts to YAML Files
"""

import os
import logging
from pathlib import Path
from typing import Dict, Any, Optional, Tuple, List
from functools import lru_cache

import yaml
from jinja2 import Environment, BaseLoader, TemplateNotFound, TemplateSyntaxError

from app.prompts.models import (
    PromptTemplate,
    PromptMetadata,
    PromptVariables,
    RenderedPrompt,
    PromptNotFoundError,
    ComponentNotFoundError,
    VariableValidationError,
    PromptRenderError,
)

logger = logging.getLogger(__name__)

# Base directory for prompts
PROMPTS_DIR = Path(__file__).parent


class PromptLoader:
    """
    Loads and renders YAML prompt templates with Jinja2 support.

    Usage:
        loader = PromptLoader()

        # Load template metadata
        template = loader.load("backlog/epic_from_interview")

        # Render with variables
        system_prompt, user_prompt = loader.render(
            "backlog/epic_from_interview",
            {"conversation_text": "...", "project_name": "My Project"}
        )

        # Or get full rendered result
        result = loader.render_full(
            "backlog/epic_from_interview",
            {"conversation_text": "...", "project_name": "My Project"}
        )
    """

    def __init__(self, prompts_dir: Path = None, enable_cache: bool = True):
        """
        Initialize PromptLoader.

        Args:
            prompts_dir: Directory containing prompt YAML files. Defaults to app/prompts/
            enable_cache: Whether to cache loaded templates (default True)
        """
        self.prompts_dir = Path(prompts_dir) if prompts_dir else PROMPTS_DIR
        self.enable_cache = enable_cache
        self._template_cache: Dict[str, PromptTemplate] = {}
        self._component_cache: Dict[str, str] = {}

        # Initialize Jinja2 environment
        self.jinja_env = Environment(
            loader=BaseLoader(),
            trim_blocks=True,
            lstrip_blocks=True,
            autoescape=False,
        )

        logger.info(f"PromptLoader initialized with prompts_dir: {self.prompts_dir}")

    def _get_prompt_path(self, prompt_name: str) -> Path:
        """Get full path for a prompt file."""
        # prompt_name format: "category/name" -> "category/name.yaml"
        if not prompt_name.endswith('.yaml'):
            prompt_name = f"{prompt_name}.yaml"
        return self.prompts_dir / prompt_name

    def _get_component_path(self, component_name: str) -> Path:
        """Get full path for a component file."""
        if not component_name.endswith('.yaml'):
            component_name = f"{component_name}.yaml"
        return self.prompts_dir / "components" / component_name

    def _parse_yaml(self, content: str) -> Dict[str, Any]:
        """Parse YAML content."""
        try:
            return yaml.safe_load(content) or {}
        except yaml.YAMLError as e:
            raise ValueError(f"Invalid YAML: {e}")

    def _load_component(self, component_name: str) -> str:
        """
        Load a component's content.

        Args:
            component_name: Name of the component (without .yaml extension)

        Returns:
            Component content as string
        """
        # Check cache
        if self.enable_cache and component_name in self._component_cache:
            return self._component_cache[component_name]

        component_path = self._get_component_path(component_name)

        if not component_path.exists():
            logger.warning(f"Component not found: {component_name}")
            return ""  # Return empty string instead of failing

        try:
            content = component_path.read_text(encoding='utf-8')
            data = self._parse_yaml(content)

            # Components can have 'content' field or be just text
            component_content = data.get('content', '')
            if not component_content and 'system_prompt' in data:
                component_content = data.get('system_prompt', '')

            # Cache if enabled
            if self.enable_cache:
                self._component_cache[component_name] = component_content

            return component_content

        except Exception as e:
            logger.error(f"Error loading component {component_name}: {e}")
            return ""

    def load(self, prompt_name: str) -> PromptTemplate:
        """
        Load a prompt template by name.

        Args:
            prompt_name: Prompt identifier (e.g., "backlog/epic_from_interview")

        Returns:
            PromptTemplate object

        Raises:
            PromptNotFoundError: If prompt file doesn't exist
        """
        # Check cache
        if self.enable_cache and prompt_name in self._template_cache:
            return self._template_cache[prompt_name]

        prompt_path = self._get_prompt_path(prompt_name)

        if not prompt_path.exists():
            raise PromptNotFoundError(prompt_name)

        try:
            content = prompt_path.read_text(encoding='utf-8')
            data = self._parse_yaml(content)

            # Parse variables
            vars_data = data.get('variables', {})
            variables = PromptVariables(
                required=vars_data.get('required', []),
                optional=vars_data.get('optional', [])
            )

            # Parse metadata
            metadata = PromptMetadata(
                name=data.get('name', prompt_name.split('/')[-1]),
                version=data.get('version', 1),
                category=data.get('category', prompt_name.split('/')[0] if '/' in prompt_name else 'general'),
                description=data.get('description', ''),
                usage_type=data.get('usage_type', 'general'),
                estimated_tokens=data.get('estimated_tokens'),
                tags=data.get('tags', []),
                variables=variables,
                components=data.get('components', [])
            )

            # Create template
            template = PromptTemplate(
                metadata=metadata,
                system_prompt=data.get('system_prompt', ''),
                user_prompt=data.get('user_prompt', ''),
                raw_content=content
            )

            # Cache if enabled
            if self.enable_cache:
                self._template_cache[prompt_name] = template

            logger.debug(f"Loaded prompt template: {prompt_name}")
            return template

        except PromptNotFoundError:
            raise
        except Exception as e:
            logger.error(f"Error loading prompt {prompt_name}: {e}")
            raise PromptNotFoundError(prompt_name)

    def _render_template(self, template_str: str, variables: Dict[str, Any]) -> str:
        """Render a Jinja2 template string with variables."""
        if not template_str:
            return ""

        try:
            template = self.jinja_env.from_string(template_str)
            return template.render(**variables)
        except TemplateSyntaxError as e:
            logger.error(f"Jinja2 syntax error: {e}")
            raise PromptRenderError("unknown", f"Template syntax error: {e}")
        except Exception as e:
            logger.error(f"Error rendering template: {e}")
            # Return original template if rendering fails
            return template_str

    def render(
        self,
        prompt_name: str,
        variables: Dict[str, Any] = None,
        strict: bool = False
    ) -> Tuple[str, str]:
        """
        Load and render a prompt template.

        Args:
            prompt_name: Prompt identifier (e.g., "backlog/epic_from_interview")
            variables: Dictionary of variables to substitute
            strict: If True, raise error on missing required variables

        Returns:
            Tuple of (system_prompt, user_prompt)

        Raises:
            PromptNotFoundError: If prompt file doesn't exist
            VariableValidationError: If strict=True and required variables are missing
        """
        variables = variables or {}

        # Load template
        template = self.load(prompt_name)

        # Validate required variables if strict mode
        if strict:
            missing = template.validate_variables(variables)
            if missing:
                raise VariableValidationError(prompt_name, missing)

        # Load components and add to variables
        components = {}
        for component_name in template.metadata.components:
            components[component_name] = self._load_component(component_name)

        # Add components to render context
        render_vars = {
            **variables,
            'components': components
        }

        # Render system and user prompts
        system_prompt = self._render_template(template.system_prompt, render_vars)
        user_prompt = self._render_template(template.user_prompt, render_vars)

        return system_prompt, user_prompt

    def render_full(
        self,
        prompt_name: str,
        variables: Dict[str, Any] = None,
        strict: bool = False
    ) -> RenderedPrompt:
        """
        Load and render a prompt template, returning full result object.

        Args:
            prompt_name: Prompt identifier
            variables: Dictionary of variables to substitute
            strict: If True, raise error on missing required variables

        Returns:
            RenderedPrompt object with all metadata
        """
        variables = variables or {}

        # Load template
        template = self.load(prompt_name)

        # Render
        system_prompt, user_prompt = self.render(prompt_name, variables, strict)

        return RenderedPrompt(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            template_name=template.metadata.name,
            template_version=template.metadata.version,
            usage_type=template.metadata.usage_type,
            variables_used=variables,
            components_loaded=template.metadata.components
        )

    def clear_cache(self):
        """Clear all cached templates and components."""
        self._template_cache.clear()
        self._component_cache.clear()
        logger.info("Prompt cache cleared")

    def list_prompts(self, category: str = None) -> List[str]:
        """
        List available prompts.

        Args:
            category: Optional category filter

        Returns:
            List of prompt names
        """
        prompts = []

        for yaml_file in self.prompts_dir.rglob("*.yaml"):
            # Skip components
            if "components" in yaml_file.parts:
                continue

            # Get relative path without extension
            rel_path = yaml_file.relative_to(self.prompts_dir)
            prompt_name = str(rel_path.with_suffix(''))

            # Filter by category if specified
            if category:
                if not prompt_name.startswith(f"{category}/"):
                    continue

            prompts.append(prompt_name)

        return sorted(prompts)

    def exists(self, prompt_name: str) -> bool:
        """Check if a prompt exists."""
        return self._get_prompt_path(prompt_name).exists()


# Global singleton instance
_loader_instance: Optional[PromptLoader] = None


def get_prompt_loader() -> PromptLoader:
    """Get the global PromptLoader instance."""
    global _loader_instance
    if _loader_instance is None:
        _loader_instance = PromptLoader()
    return _loader_instance
