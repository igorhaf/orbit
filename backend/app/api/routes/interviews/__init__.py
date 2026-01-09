"""
Interviews API Module
PROMPT #69 - Refactor interviews.py (Modularization)

This module provides interview management endpoints and utilities:
- CRUD operations for interviews
- Dual-mode interviews (requirements vs task-focused)
- Fixed questions (Q1-Q7 stack configuration)
- AI-generated business questions
- Async backlog generation
- Project provisioning

Refactored from single 2465-line file into focused modules:
- response_cleaners.py: AI response cleaning (~100 lines)
- context_builders.py: Context preparation for AI (~150 lines)
- task_type_prompts.py: Type-specific prompts (~300 lines)
- fixed_questions.py: Fixed interview questions (~200 lines)
- endpoints.py: HTTP endpoints (~400 lines)
"""

from .endpoints import router

# Export router for main application
__all__ = ["router"]
