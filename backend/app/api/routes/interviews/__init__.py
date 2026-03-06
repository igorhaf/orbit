"""
Interviews API Module
PROMPT #69 - Refactor interviews.py (Modularization)
PROMPT #261 - Refactor endpoints.py into sub-modules

This module provides interview management endpoints and utilities:
- CRUD operations for interviews
- Interview flow control (start, save-stack, status, prompts)
- Generation endpoints (task, context, hierarchy)
- Messaging endpoints (send-message, update-project-info)
- Fixed questions (Q1-Q7 stack configuration)
- AI-generated business questions
- Async backlog generation

Sub-modules:
- crud.py: CRUD endpoints (list, create, get, update, delete, messages)
- flow.py: Interview flow (start, save-stack, status, prompts, generate-prompts-async)
- generation.py: Generation (generate-task-direct, generate-context, generate-hierarchy-from-meta)
- messaging.py: Messaging (send-message, update-project-info, send-message-async)
- models.py: Shared request models (MessageRequest, StatusUpdateRequest)
- response_cleaners.py: AI response cleaning
- context_builders.py: Context preparation for AI
- task_type_prompts.py: Type-specific prompts
- fixed_questions.py: Fixed interview questions
"""

from fastapi import APIRouter

from .crud import router as crud_router
from .flow import router as flow_router
from .generation import router as generation_router
from .messaging import router as messaging_router

# Create main router that includes all sub-routers
router = APIRouter()
router.include_router(crud_router)
router.include_router(flow_router)
router.include_router(generation_router)
router.include_router(messaging_router)

# Export router for main application
__all__ = ["router"]
