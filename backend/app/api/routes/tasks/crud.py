"""
Tasks CRUD Router
Basic CRUD operations for tasks: list, create, get, update, delete.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel

from app.database import get_db
from app.models.task import Task, TaskStatus, ItemType
from app.schemas.task import (
    TaskCreate,
    TaskUpdate,
    TaskResponse,
)
from app.api.dependencies import get_task_or_404

import logging

logger = logging.getLogger(__name__)

router = APIRouter()


class MoveTaskRequest(BaseModel):
    """Request model for moving a task to a new status/column."""
    new_status: TaskStatus
    new_order: Optional[int] = None


class ReorderTaskRequest(BaseModel):
    """Request model for reordering a task within the same column."""
    new_order: int


@router.get("/", response_model=List[TaskResponse])
async def list_tasks(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    project_id: Optional[UUID] = Query(None, description="Filter by project ID"),
    status: Optional[TaskStatus] = Query(None, description="Filter by status"),
    prompt_id: Optional[UUID] = Query(None, description="Filter by prompt ID"),
    db: Session = Depends(get_db)
):
    """
    List all tasks with filtering options.

    - **project_id**: Filter by project
    - **status**: Filter by task status
    - **prompt_id**: Filter tasks created from a specific prompt
    """
    query = db.query(Task)

    # Apply filters
    if project_id:
        query = query.filter(Task.project_id == project_id)
    if status:
        query = query.filter(Task.status == status)
    if prompt_id:
        query = query.filter(Task.prompt_id == prompt_id)

    # Order by column and order within column
    tasks = query.order_by(Task.status, Task.order).offset(skip).limit(limit).all()

    return tasks


@router.post("/", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task(
    task_data: TaskCreate,
    db: Session = Depends(get_db)
):
    """
    Create a new task.

    - **project_id**: Project this task belongs to (required)
    - **title**: Task title (required)
    - **description**: Task description (optional)
    - **status**: Task status (default: backlog)
    - **prompt_id**: Related prompt ID (optional)
    """
    # PROMPT #232 - IC-3 fix: Validate project exists
    from app.models.project import Project
    project = db.query(Project).filter(Project.id == task_data.project_id).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Projeto {task_data.project_id} não encontrado"
        )

    # PROMPT #232 - IC-3 fix: Validate hierarchy rules when parent_id is set
    if task_data.parent_id:
        parent = db.query(Task).filter(Task.id == task_data.parent_id).first()
        if not parent:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Task pai {task_data.parent_id} não encontrada"
            )
        # Validate hierarchy: Epic→Story, Story→Task/Bug, Task→Subtask
        valid_children = {
            ItemType.EPIC: [ItemType.STORY],
            ItemType.STORY: [ItemType.TASK, ItemType.BUG],
            ItemType.TASK: [ItemType.SUBTASK],
            ItemType.SUBTASK: [],
            ItemType.BUG: [],
        }
        allowed = valid_children.get(parent.item_type, [])
        if task_data.item_type not in allowed:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{task_data.item_type.value} não pode ser filho de {parent.item_type.value}. "
                       f"Filhos válidos: {[c.value for c in allowed]}"
            )

    # Get the current max order for the status column
    max_order = db.query(Task).filter(
        Task.project_id == task_data.project_id,
        Task.status == task_data.status
    ).count()

    # Create new task
    db_task = Task(
        project_id=task_data.project_id,
        prompt_id=task_data.prompt_id,
        title=task_data.title,
        description=task_data.description,
        item_type=task_data.item_type,
        parent_id=task_data.parent_id,
        priority=task_data.priority,
        status=task_data.status,
        column=task_data.status.value,  # Column matches status
        order=max_order,
        complexity=task_data.complexity,
        labels=task_data.labels,
        acceptance_criteria=task_data.acceptance_criteria,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )

    db.add(db_task)
    db.commit()
    db.refresh(db_task)

    return db_task


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(
    task: Task = Depends(get_task_or_404)
):
    """
    Get a specific task by ID.

    - **task_id**: UUID of the task
    """
    return task


@router.patch("/{task_id}", response_model=TaskResponse)
async def update_task(
    task_update: TaskUpdate,
    task: Task = Depends(get_task_or_404),
    db: Session = Depends(get_db)
):
    """
    Update a task (partial update).

    PROMPT #85 - RAG Phase 3: Completed tasks/stories indexed in RAG

    - **title**: New title (optional)
    - **description**: New description (optional)
    - **status**: New status (optional, use /move endpoint for proper reordering)
    - **prompt_id**: New prompt ID (optional)
    """
    update_data = task_update.model_dump(exclude_unset=True)

    # Track if status changed to done
    status_changed_to_done = False
    old_status = task.status

    # PROMPT #232 - REGRA #0: Mark fields as human-edited when user updates them
    if 'description' in update_data:
        task.description_edited_by = 'human'
    if 'generated_prompt' in update_data:
        task.prompt_edited_by = 'human'

    for field, value in update_data.items():
        setattr(task, field, value)

    task.updated_at = datetime.utcnow()

    # Check if status changed to done
    if 'status' in update_data:
        new_status = update_data['status']
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


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task: Task = Depends(get_task_or_404),
    db: Session = Depends(get_db)
):
    """
    Delete a task.

    - **task_id**: UUID of the task to delete

    Note: This will cascade delete related chat sessions and commits.
    """
    # Reorder remaining tasks in the same column
    db.query(Task).filter(
        Task.project_id == task.project_id,
        Task.status == task.status,
        Task.order > task.order
    ).update({"order": Task.order - 1})

    db.delete(task)
    db.commit()
    return None
