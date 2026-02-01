"""
PromptService - High-level service for prompt management and AI execution

Integrates PromptLoader with AIOrchestrator for seamless prompt-to-response flow.
Supports feature flag USE_EXTERNAL_PROMPTS for gradual rollout.

PROMPT #103 - Externalize Hardcoded Prompts to YAML Files
"""

import logging
from typing import Dict, Any, Optional, Tuple, Callable, Awaitable
from sqlalchemy.orm import Session

from app.config import settings
from app.prompts.loader import PromptLoader, get_prompt_loader
from app.prompts.models import (
    PromptNotFoundError,
    PromptRenderError,
    RenderedPrompt,
)
from app.services.ai_orchestrator import AIOrchestrator

logger = logging.getLogger(__name__)


class PromptService:
    """
    High-level service for loading prompts and executing AI calls.

    Features:
    - Loads prompts from external YAML files
    - Falls back to hardcoded prompts when feature flag is disabled
    - Integrates with AIOrchestrator for AI execution
    - Supports caching for performance

    Usage:
        service = PromptService(db)

        # Execute with external prompt
        result = await service.execute(
            prompt_name="backlog/epic_from_interview",
            variables={"conversation_text": "...", "project_name": "My Project"},
            project_id=project_id
        )

        # Or use with fallback
        result = await service.execute_with_fallback(
            prompt_name="backlog/epic_from_interview",
            variables={"conversation_text": "...", "project_name": "My Project"},
            fallback_fn=self._legacy_generate_epic,
            project_id=project_id
        )
    """

    def __init__(self, db: Session, enable_cache: bool = True):
        """
        Initialize PromptService.

        Args:
            db: Database session for AIOrchestrator
            enable_cache: Whether to cache loaded prompts (default True)
        """
        self.db = db
        self.loader = PromptLoader(enable_cache=enable_cache)
        self.orchestrator = AIOrchestrator(db)

    def is_external_prompts_enabled(self) -> bool:
        """Check if external prompts feature flag is enabled."""
        return getattr(settings, 'use_external_prompts', False)

    def render_prompt(
        self,
        prompt_name: str,
        variables: Dict[str, Any] = None
    ) -> Tuple[str, str]:
        """
        Load and render a prompt template.

        Args:
            prompt_name: Prompt identifier (e.g., "backlog/epic_from_interview")
            variables: Dictionary of variables to substitute

        Returns:
            Tuple of (system_prompt, user_prompt)

        Raises:
            PromptNotFoundError: If prompt file doesn't exist
            PromptRenderError: If rendering fails
        """
        return self.loader.render(prompt_name, variables or {})

    async def execute(
        self,
        prompt_name: str,
        variables: Dict[str, Any] = None,
        max_tokens: int = None,
        project_id: Any = None,
        interview_id: Any = None,
        task_id: Any = None,
        metadata: Dict[str, Any] = None,
        **orchestrator_kwargs
    ) -> Dict[str, Any]:
        """
        Load prompt, render, and execute via AIOrchestrator.

        Args:
            prompt_name: Prompt identifier (e.g., "backlog/epic_from_interview")
            variables: Dictionary of variables to substitute
            max_tokens: Optional max tokens override
            project_id: Project ID for logging
            interview_id: Interview ID for logging
            task_id: Task ID for logging
            metadata: Additional metadata for logging
            **orchestrator_kwargs: Additional arguments for orchestrator

        Returns:
            AIOrchestrator response dict with:
            - content: AI response text
            - provider: Provider used
            - model: Model used
            - usage: Token usage
            - prompt_name: Name of prompt used (added by this service)

        Raises:
            PromptNotFoundError: If prompt file doesn't exist
            PromptRenderError: If rendering fails
        """
        # Load and render prompt
        template = self.loader.load(prompt_name)
        system_prompt, user_prompt = self.loader.render(prompt_name, variables or {})

        # Get usage_type from template metadata
        usage_type = template.metadata.usage_type

        # Build messages
        messages = [{"role": "user", "content": user_prompt}]

        # Execute via orchestrator
        logger.info(f"🎯 Executing prompt: {prompt_name} (usage_type={usage_type})")

        result = await self.orchestrator.execute(
            usage_type=usage_type,
            messages=messages,
            system_prompt=system_prompt,
            max_tokens=max_tokens,
            project_id=project_id,
            interview_id=interview_id,
            task_id=task_id,
            metadata={
                "prompt_name": prompt_name,
                "prompt_version": template.metadata.version,
                **(metadata or {})
            },
            **orchestrator_kwargs
        )

        # Add prompt info to result
        result["prompt_name"] = prompt_name
        result["prompt_version"] = template.metadata.version

        return result

    async def execute_with_fallback(
        self,
        prompt_name: str,
        variables: Dict[str, Any],
        fallback_fn: Callable[..., Awaitable[Dict[str, Any]]],
        fallback_args: tuple = None,
        fallback_kwargs: dict = None,
        **execute_kwargs
    ) -> Dict[str, Any]:
        """
        Execute prompt with fallback to legacy function if external prompts are disabled
        or if the prompt file is not found.

        This is the recommended way to integrate external prompts with existing code.
        It allows gradual migration without breaking existing functionality.

        Args:
            prompt_name: Prompt identifier
            variables: Variables for prompt rendering
            fallback_fn: Async function to call if external prompts disabled/unavailable
            fallback_args: Positional args for fallback function
            fallback_kwargs: Keyword args for fallback function
            **execute_kwargs: Additional arguments for execute()

        Returns:
            Result from either execute() or fallback_fn()

        Example:
            result = await service.execute_with_fallback(
                prompt_name="backlog/epic_from_interview",
                variables={"conversation_text": text},
                fallback_fn=self._legacy_generate_epic,
                fallback_args=(interview_id, project_id),
                project_id=project_id
            )
        """
        fallback_args = fallback_args or ()
        fallback_kwargs = fallback_kwargs or {}

        # Check feature flag
        if not self.is_external_prompts_enabled():
            logger.debug(f"External prompts disabled, using fallback for: {prompt_name}")
            return await fallback_fn(*fallback_args, **fallback_kwargs)

        # Try external prompt
        try:
            return await self.execute(prompt_name, variables, **execute_kwargs)
        except PromptNotFoundError:
            logger.warning(f"Prompt not found: {prompt_name}, using fallback")
            return await fallback_fn(*fallback_args, **fallback_kwargs)
        except PromptRenderError as e:
            logger.warning(f"Prompt render error: {e}, using fallback")
            return await fallback_fn(*fallback_args, **fallback_kwargs)

    def get_prompt_info(self, prompt_name: str) -> Dict[str, Any]:
        """
        Get information about a prompt without rendering.

        Args:
            prompt_name: Prompt identifier

        Returns:
            Dict with prompt metadata
        """
        template = self.loader.load(prompt_name)
        return {
            "name": template.metadata.name,
            "version": template.metadata.version,
            "category": template.metadata.category,
            "description": template.metadata.description,
            "usage_type": template.metadata.usage_type,
            "estimated_tokens": template.metadata.estimated_tokens,
            "required_variables": template.required_variables,
            "optional_variables": template.optional_variables,
            "components": template.metadata.components,
            "tags": template.metadata.tags,
        }

    def list_available_prompts(self, category: str = None) -> list:
        """
        List all available prompts.

        Args:
            category: Optional category filter

        Returns:
            List of prompt names
        """
        return self.loader.list_prompts(category)


# Global instance factory
_service_instances: Dict[int, PromptService] = {}


def get_prompt_service(db: Session) -> PromptService:
    """
    Get or create a PromptService instance for the given database session.

    Args:
        db: Database session

    Returns:
        PromptService instance
    """
    # Use session id as key (simple approach)
    session_id = id(db)
    if session_id not in _service_instances:
        _service_instances[session_id] = PromptService(db)
    return _service_instances[session_id]
