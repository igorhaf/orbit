"""
API Route Handlers
Exports all route modules for easy importing.
"""

from . import (
    projects,
    ai_models,
    ai_executions,  # PROMPT #54 - AI Execution Logging
    cost_analytics,  # PROMPT #54.2 - Cost Analytics Dashboard
    tasks,
    interviews,
    prompts,
    chat_sessions,
    commits,
    system_settings,
    backlog_generation,  # JIRA Transformation - AI-powered backlog generation
    jobs,  # PROMPT #65 - Async Job System
    knowledge,  # PROMPT #84 - RAG Phase 2: Knowledge Search
    discovery_queue  # Project-Specific Specs: Discovery queue management
)

__all__ = [
    "projects",
    "ai_models",
    "ai_executions",  # PROMPT #54 - AI Execution Logging
    "cost_analytics",  # PROMPT #54.2 - Cost Analytics Dashboard
    "tasks",
    "interviews",
    "prompts",
    "chat_sessions",
    "commits",
    "system_settings",
    "backlog_generation",  # JIRA Transformation - AI-powered backlog generation
    "jobs",  # PROMPT #65 - Async Job System
    "knowledge",  # PROMPT #84 - RAG Phase 2: Knowledge Search
    "discovery_queue"  # Project-Specific Specs: Discovery queue management
]
