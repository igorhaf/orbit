"""
ORBIT Prompt Management System

Externalizes AI prompts from Python code to YAML files for easier maintenance,
versioning, and A/B testing.

Usage:
    from app.prompts import PromptLoader

    loader = PromptLoader()
    system_prompt, user_prompt = loader.render(
        "backlog/epic_from_interview",
        {"conversation_text": "...", "project_name": "My Project"}
    )

Feature Flag:
    Set USE_EXTERNAL_PROMPTS=true in .env to enable external prompts.
    When disabled, services fall back to hardcoded prompts.

PROMPT #103 - Externalize Hardcoded Prompts to YAML Files
"""

from app.prompts.loader import PromptLoader, get_prompt_loader
from app.prompts.models import (
    PromptTemplate,
    PromptMetadata,
    PromptVariables,
    PromptNotFoundError,
    PromptRenderError,
    RenderedPrompt,
)
from app.prompts.service import PromptService, get_prompt_service

__all__ = [
    # Loader
    "PromptLoader",
    "get_prompt_loader",
    # Models
    "PromptTemplate",
    "PromptMetadata",
    "PromptVariables",
    "RenderedPrompt",
    # Errors
    "PromptNotFoundError",
    "PromptRenderError",
    # Service
    "PromptService",
    "get_prompt_service",
]
