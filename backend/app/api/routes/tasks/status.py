"""
Tasks Status Router
Status transition endpoints: transition status, get history, get valid transitions.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID

from app.database import get_db
from app.models.task import Task, ItemType
from app.models.status_transition import StatusTransition
from app.schemas.task import (
    StatusTransitionCreate,
    StatusTransitionResponse,
)
from app.services.workflow_validator import WorkflowValidator

import logging

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================================
# JIRA TRANSFORMATION - STATUS TRANSITION ENDPOINTS
# ============================================================================

@router.post("/{task_id}/transition", response_model=StatusTransitionResponse)
async def transition_task_status(
    task_id: UUID,
    transition_data: StatusTransitionCreate,
    db: Session = Depends(get_db)
):
    """
    Transition task to a new status with validation.

    POST /api/v1/tasks/{task_id}/transition
    Body: {"to_status": "in_progress", "transitioned_by": "username", "transition_reason": "Starting work"}

    Validates transition against workflow rules.
    Raises 400 if transition is invalid for the task's item_type.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")

    workflow_validator = WorkflowValidator(db)

    try:
        workflow_validator.validate_and_transition(
            task=task,
            to_status=transition_data.to_status,
            transitioned_by=transition_data.transitioned_by,
            transition_reason=transition_data.transition_reason
        )

        # Get the created transition
        latest_transition = db.query(StatusTransition).filter(
            StatusTransition.task_id == task_id
        ).order_by(StatusTransition.created_at.desc()).first()

        return latest_transition

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{task_id}/transitions", response_model=List[StatusTransitionResponse])
async def get_task_transitions(
    task_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get status transition history for a task.

    GET /api/v1/tasks/{task_id}/transitions

    Returns all status transitions ordered by created_at (oldest first).
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")

    transitions = db.query(StatusTransition).filter(
        StatusTransition.task_id == task_id
    ).order_by(StatusTransition.created_at).all()

    return transitions


@router.get("/{task_id}/valid-transitions", response_model=List[str])
async def get_valid_transitions(
    task_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get list of valid next statuses for a task.

    GET /api/v1/tasks/{task_id}/valid-transitions

    Returns array of status strings that are valid from current state.
    Useful for UI to show available status buttons.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")

    workflow_validator = WorkflowValidator(db)
    current_status = task.workflow_state or "backlog"

    valid_statuses = workflow_validator.get_valid_next_statuses(
        item_type=task.item_type or ItemType.TASK,
        current_status=current_status
    )

    return valid_statuses
