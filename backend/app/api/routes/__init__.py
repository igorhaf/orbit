"""
API Route Handlers
Exports all route modules for easy importing.
"""

from . import (
    projects,
    ai_models,
    ai_executions,  # PROMPT #54 - AI Execution Logging
    tasks,
    interviews,
    prompts,
    chat_sessions,
    commits,
    system_settings,
    backlog_generation  # JIRA Transformation - AI-powered backlog generation
)

__all__ = [
    "projects",
    "ai_models",
    "ai_executions",  # PROMPT #54 - AI Execution Logging
    "tasks",
    "interviews",
    "prompts",
    "chat_sessions",
    "commits",
    "system_settings",
    "backlog_generation"  # JIRA Transformation - AI-powered backlog generation
]
