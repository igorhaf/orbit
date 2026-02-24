"""
Tasks API Package

Aggregates all task-related sub-routers into a single router.
Each sub-module defines its own APIRouter with NO prefix;
the prefix is set by the parent (main.py) when including this router.

Sub-modules:
    crud.py              - list, create, get, update, delete tasks
    kanban.py            - move task, kanban board, blocked tasks
    execution.py         - execute task, execute all, get result
    hierarchy.py         - children, descendants, ancestors, move, validate
    relationships.py     - create/list/delete task relationships
    comments.py          - create/list/update/delete task comments
    status.py            - status transitions, history, valid transitions
    workflow.py          - activate items, generate children, reject epics,
                           create interview, project backlog
    blocking.py          - approve/reject modifications, blocking analytics
    workflow_helpers.py   - async background functions for activation/generation
    orbit_integration.py - card inference, suggest title, export prompt,
                           orbit status, check result
"""

from fastapi import APIRouter

from .crud import router as crud_router
from .kanban import router as kanban_router
from .execution import router as execution_router
from .hierarchy import router as hierarchy_router
from .relationships import router as relationships_router
from .comments import router as comments_router
from .status import router as status_router
from .workflow import router as workflow_router
from .blocking import router as blocking_router
from .orbit_integration import router as orbit_integration_router

router = APIRouter()

# Include all sub-routers (no prefix - parent sets the prefix)
# IMPORTANT: kanban_router must come before crud_router because
# GET /blocked would otherwise match crud's GET /{task_id} first.
router.include_router(kanban_router)
router.include_router(crud_router)
router.include_router(execution_router)
router.include_router(hierarchy_router)
router.include_router(relationships_router)
router.include_router(comments_router)
router.include_router(status_router)
router.include_router(workflow_router)
router.include_router(blocking_router)
router.include_router(orbit_integration_router)

__all__ = ["router"]
