"""
API Route Handlers
Exports all route modules for easy importing.
"""

from . import (
    projects,
    ai_models,
    tasks,
    interviews,
    prompts,
    chat_sessions,
    commits,
    system_settings
)

__all__ = [
    "projects",
    "ai_models",
    "tasks",
    "interviews",
    "prompts",
    "chat_sessions",
    "commits",
    "system_settings"
]
