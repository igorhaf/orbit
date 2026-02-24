"""
Tasks Kanban Router
Kanban board operations: move tasks, get board, get blocked tasks.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel

from app.database import get_db
from app.models.task import Task, TaskStatus, ItemType
from app.schemas.task import TaskResponse
from app.api.dependencies import get_task_or_404

import logging

logger = logging.getLogger(__name__)

router = APIRouter()


class MoveTaskRequest(BaseModel):
    """Request model for moving a task to a new status/column."""
    new_status: TaskStatus
    new_order: Optional[int] = None


# PROMPT #82 - Moved before /{task_id} to avoid route conflict
@router.get("/blocked", response_model=List[TaskResponse])
async def get_blocked_tasks(
    project_id: UUID = Query(..., description="Project ID to filter blocked tasks"),
    db: Session = Depends(get_db)
):
    """
    Get all blocked tasks for a project (for "Bloqueados" Kanban column).

    PROMPT #94 FASE 4 - Blocking System:
    When AI suggests modifying an existing task (>90% semantic similarity):
    - Task gets BLOCKED status
    - Modification saved in pending_modification field
    - User must approve/reject via UI

    GET /api/v1/tasks/blocked?project_id={uuid}

    Returns:
    - List of blocked tasks with pending_modification data
    """
    from app.services.modification_manager import get_blocked_tasks as get_blocked

    blocked_tasks = get_blocked(project_id=project_id, db=db)

    logger.info(f"Retrieved {len(blocked_tasks)} blocked tasks for project {project_id}")

    return blocked_tasks


@router.patch("/{task_id}/move", response_model=TaskResponse)
async def move_task(
    move_request: MoveTaskRequest,
    task: Task = Depends(get_task_or_404),
    db: Session = Depends(get_db)
):
    """
    Move a task to a different column/status with proper reordering.

    PROMPT #85 - RAG Phase 3: Completed tasks/stories indexed in RAG

    - **new_status**: Target status/column
    - **new_order**: Position in the new column (optional, defaults to end)
    """
    old_status = task.status
    old_order = task.order
    new_status = move_request.new_status
    status_changed_to_done = False

    # If moving to a different column
    if old_status != new_status:
        # Update orders in old column (move tasks up to fill the gap)
        db.query(Task).filter(
            Task.project_id == task.project_id,
            Task.status == old_status,
            Task.order > old_order
        ).update({"order": Task.order - 1})

        # Get count of tasks in new column
        new_column_count = db.query(Task).filter(
            Task.project_id == task.project_id,
            Task.status == new_status
        ).count()

        # Determine new order
        new_order = move_request.new_order if move_request.new_order is not None else new_column_count

        # Make space in new column if needed
        if new_order < new_column_count:
            db.query(Task).filter(
                Task.project_id == task.project_id,
                Task.status == new_status,
                Task.order >= new_order
            ).update({"order": Task.order + 1})

        # Update task
        task.status = new_status
        task.column = new_status.value
        task.order = new_order
    else:
        # Moving within same column - just reorder
        new_order = move_request.new_order if move_request.new_order is not None else old_order

        if new_order != old_order:
            if new_order > old_order:
                # Moving down
                db.query(Task).filter(
                    Task.project_id == task.project_id,
                    Task.status == old_status,
                    Task.order > old_order,
                    Task.order <= new_order
                ).update({"order": Task.order - 1})
            else:
                # Moving up
                db.query(Task).filter(
                    Task.project_id == task.project_id,
                    Task.status == old_status,
                    Task.order >= new_order,
                    Task.order < old_order
                ).update({"order": Task.order + 1})

            task.order = new_order

    task.updated_at = datetime.utcnow()

    # Check if task was moved to done status
    if new_status == TaskStatus.DONE and old_status != TaskStatus.DONE:
        status_changed_to_done = True

    db.commit()
    db.refresh(task)

    # PROMPT #85 - RAG Phase 3: Index completed tasks/stories in RAG
    if status_changed_to_done and task.item_type in [ItemType.TASK, ItemType.STORY]:
        try:
            from app.services.rag_service import RAGService

            rag_service = RAGService(db)

            # Build comprehensive content for RAG
            content_parts = [
                f"Title: {task.title}",
                f"Type: {task.item_type.value}",
                f"Description: {task.description or 'N/A'}"
            ]

            if task.acceptance_criteria:
                criteria_text = "\n".join([f"- {ac}" for ac in task.acceptance_criteria])
                content_parts.append(f"Acceptance Criteria:\n{criteria_text}")

            if task.story_points:
                content_parts.append(f"Story Points: {task.story_points}")

            if task.resolution_comment:
                content_parts.append(f"Resolution: {task.resolution_comment}")

            content = "\n\n".join(content_parts)

            # Store in RAG with metadata
            rag_service.store(
                content=content,
                metadata={
                    "type": f"completed_{task.item_type.value}",  # "completed_task" or "completed_story"
                    "task_id": str(task.id),
                    "title": task.title,
                    "item_type": task.item_type.value,
                    "story_points": task.story_points,
                    "priority": task.priority.value if task.priority else None,
                    "resolution": task.resolution.value if task.resolution else None,
                    "labels": task.labels or [],
                    "components": task.components or [],
                    "completed_at": task.updated_at.isoformat()
                },
                project_id=task.project_id
            )

            logger.info(f"✅ RAG: Indexed completed {task.item_type.value} '{task.title}' (ID: {task.id})")

        except Exception as e:
            # Don't fail the request if RAG indexing fails
            logger.warning(f"⚠️  RAG indexing failed for completed {task.item_type.value}: {e}")

    return task


@router.get("/kanban/{project_id}")
async def get_kanban_board(
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get complete Kanban board structure for a project.

    Returns tasks organized by status columns.
    """
    # Verify project exists
    from app.api.dependencies import get_project_or_404
    from app.models.project import Project

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Projeto {project_id} não encontrado"
        )

    # Get all tasks for the project ordered by status and order
    tasks = db.query(Task).filter(
        Task.project_id == project_id
    ).order_by(Task.status, Task.order).all()

    # Organize into kanban structure
    kanban = {
        "backlog": [],
        "todo": [],
        "in_progress": [],
        "review": [],
        "done": [],
        "blocked": []
    }

    for task in tasks:
        status_key = task.status.value
        if status_key not in kanban:
            status_key = "backlog"
        kanban[status_key].append({
            "id": task.id,
            "project_id": task.project_id,
            "prompt_id": task.prompt_id,
            "title": task.title,
            "description": task.description,
            "status": task.status.value,
            "column": task.column,
            "order": task.order,
            "item_type": task.item_type.value if task.item_type else "task",  # PROMPT #82 - Include item type for Epic/Story/Task display
            "generated_prompt": task.generated_prompt,  # PROMPT #86 - Include for Prompt tab
            "priority": task.priority.value if task.priority else "medium",
            "story_points": task.story_points,
            "acceptance_criteria": task.acceptance_criteria,
            "labels": task.labels,
            "assignee": task.assignee,
            "reporter": task.reporter,
            "workflow_state": task.workflow_state,
            "parent_id": task.parent_id,
            "interview_insights": task.interview_insights,
            "subtask_suggestions": task.subtask_suggestions,
            "pending_modification": task.pending_modification,  # PROMPT #95
            "created_at": task.created_at,
            "updated_at": task.updated_at
        })

    return kanban
