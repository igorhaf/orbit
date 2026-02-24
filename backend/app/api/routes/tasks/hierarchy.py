"""
Tasks Hierarchy Router
Hierarchy endpoints: children, descendants, ancestors, move in hierarchy, validate.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID

from app.database import get_db
from app.models.task import Task, ItemType
from app.schemas.task import (
    TaskResponse,
    HierarchyMoveRequest,
    HierarchyValidationResponse,
)
from app.services.task_hierarchy import TaskHierarchyService

import logging

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================================
# JIRA TRANSFORMATION - HIERARCHY ENDPOINTS
# ============================================================================

@router.get("/{task_id}/children", response_model=List[TaskResponse])
async def get_task_children(
    task_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get direct children of a task.

    GET /api/v1/tasks/{task_id}/children

    Returns list of tasks that have this task as parent.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")

    children = db.query(Task).filter(Task.parent_id == task_id).order_by(Task.order).all()

    return children


@router.get("/{task_id}/descendants", response_model=List[TaskResponse])
async def get_task_descendants(
    task_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get all descendants of a task (recursive: children, grandchildren, etc.).

    GET /api/v1/tasks/{task_id}/descendants

    Returns flat list of all descendant tasks.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")

    hierarchy_service = TaskHierarchyService(db)
    descendants = hierarchy_service.get_all_descendants(task_id)

    return descendants


@router.get("/{task_id}/ancestors", response_model=List[TaskResponse])
async def get_task_ancestors(
    task_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get all ancestors of a task (parent, grandparent, etc. up to root).

    GET /api/v1/tasks/{task_id}/ancestors

    Returns list ordered from immediate parent to root.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")

    hierarchy_service = TaskHierarchyService(db)
    ancestors = hierarchy_service.get_all_ancestors(task_id)

    return ancestors


@router.post("/{task_id}/move", response_model=TaskResponse)
async def move_task_in_hierarchy(
    task_id: UUID,
    move_request: HierarchyMoveRequest,
    db: Session = Depends(get_db)
):
    """
    Move task to a new parent in hierarchy.

    POST /api/v1/tasks/{task_id}/move
    Body: {"new_parent_id": "uuid" or null, "validate_rules": true}

    - new_parent_id: New parent UUID (null = make root)
    - validate_rules: Whether to validate Epic→Story→Task rules (default: true)

    Raises 400 if move would create cycle or violate hierarchy rules.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")

    hierarchy_service = TaskHierarchyService(db)

    try:
        success = hierarchy_service.move_task(
            task_id=task_id,
            new_parent_id=move_request.new_parent_id,
            validate_rules=move_request.validate_rules
        )

        if success:
            db.refresh(task)
            return task
        else:
            raise HTTPException(status_code=400, detail="Falha ao mover")

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{task_id}/validate-child/{child_type}", response_model=HierarchyValidationResponse)
async def validate_hierarchy(
    task_id: UUID,
    child_type: ItemType,
    db: Session = Depends(get_db)
):
    """
    Validate if a child type can be added to this task.

    GET /api/v1/tasks/{task_id}/validate-child/{child_type}

    Returns:
    - valid: bool
    - message: str
    - allowed_children: list of allowed child types

    Useful for UI to show/hide "Add Child" buttons.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")

    hierarchy_service = TaskHierarchyService(db)
    valid = hierarchy_service.validate_hierarchy_rules(child_type, task.item_type)

    allowed_children = []
    if task.item_type == ItemType.EPIC:
        allowed_children = ["story"]
    elif task.item_type == ItemType.STORY:
        allowed_children = ["task", "bug"]
    elif task.item_type == ItemType.TASK:
        allowed_children = ["subtask"]

    return HierarchyValidationResponse(
        valid=valid,
        message=f"{'Valid' if valid else 'Invalid'}: {task.item_type.value} cannot contain {child_type.value}" if not valid else f"{task.item_type.value} can contain {child_type.value}",
        allowed_children=allowed_children
    )
