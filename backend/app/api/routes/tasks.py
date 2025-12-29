"""
Tasks API Router
CRUD operations for managing tasks with Kanban board functionality.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status, Body
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel

from app.database import get_db
from app.models.task import Task, TaskStatus
from app.models.task_result import TaskResult
from app.schemas.task import (
    TaskCreate,
    TaskUpdate,
    TaskResponse,
    TaskExecuteRequest,
    TaskResultResponse,
    BatchExecuteRequest,
    BatchExecuteResponse
)
from app.api.dependencies import get_task_or_404, get_project_or_404
from app.services.task_executor import TaskExecutor
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
        status=task_data.status,
        column=task_data.status.value,  # Column matches status
        order=max_order,
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

    - **title**: New title (optional)
    - **description**: New description (optional)
    - **status**: New status (optional, use /move endpoint for proper reordering)
    - **prompt_id**: New prompt ID (optional)
    """
    update_data = task_update.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        setattr(task, field, value)

    task.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(task)

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


@router.patch("/{task_id}/move", response_model=TaskResponse)
async def move_task(
    move_request: MoveTaskRequest,
    task: Task = Depends(get_task_or_404),
    db: Session = Depends(get_db)
):
    """
    Move a task to a different column/status with proper reordering.

    - **new_status**: Target status/column
    - **new_order**: Position in the new column (optional, defaults to end)
    """
    old_status = task.status
    old_order = task.order
    new_status = move_request.new_status

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

    db.commit()
    db.refresh(task)

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
            detail=f"Project {project_id} not found"
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
        "done": []
    }

    for task in tasks:
        status_key = task.status.value
        kanban[status_key].append({
            "id": task.id,
            "project_id": task.project_id,
            "prompt_id": task.prompt_id,
            "title": task.title,
            "description": task.description,
            "status": task.status.value,
            "column": task.column,
            "order": task.order,
            "created_at": task.created_at,
            "updated_at": task.updated_at
        })

    return kanban


# Task Execution Endpoints

@router.post("/{task_id}/execute", response_model=TaskResultResponse)
async def execute_task(
    task_id: UUID,
    request: TaskExecuteRequest = Body(default=TaskExecuteRequest()),
    db: Session = Depends(get_db)
):
    """
    Executa uma task específica com validação automática

    POST /api/v1/tasks/{task_id}/execute

    Body:
    {
        "max_attempts": 3  // Número máximo de tentativas se validação falhar
    }

    Retorna:
    - Código gerado
    - Métricas (tokens, custo, tempo)
    - Validação (passed, issues)
    - Número de tentativas necessárias

    Custo estimado:
    - Tasks simples (Haiku): ~$0.005
    - Tasks complexas (Sonnet): ~$0.035
    """

    try:
        # Buscar task para obter project_id
        task = db.query(Task).filter(Task.id == task_id).first()

        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        project_id = str(task.project_id)

        # Executar
        executor = TaskExecutor(db)
        result = await executor.execute_task(
            task_id=str(task_id),
            project_id=project_id,
            max_attempts=request.max_attempts
        )

        return result

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to execute task {task_id}: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to execute task: {str(e)}"
        )


@router.post("/projects/{project_id}/execute-all", response_model=BatchExecuteResponse)
async def execute_all_tasks(
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Executa todas as tasks de um projeto

    POST /api/v1/tasks/projects/{project_id}/execute-all

    Respeita dependências entre tasks (executa em ordem topológica).
    Tasks sem dependências são executadas primeiro.

    Retorna:
    - Total de tasks
    - Número de sucessos
    - Número de falhas
    - Resultados de cada task

    Custo estimado para projeto com 5 tasks:
    - ~$0.085 (3x Haiku + 2x Sonnet)
    """

    try:
        # Buscar todas tasks do projeto
        tasks = db.query(Task).filter(Task.project_id == project_id).all()

        if not tasks:
            raise HTTPException(status_code=404, detail="No tasks found for project")

        task_ids = [str(t.id) for t in tasks]

        # Executar batch
        executor = TaskExecutor(db)
        results = await executor.execute_batch(task_ids, str(project_id))

        succeeded = sum(1 for r in results if r.validation_passed)
        failed = len(results) - succeeded

        return BatchExecuteResponse(
            total=len(results),
            succeeded=succeeded,
            failed=failed,
            results=results
        )

    except Exception as e:
        logger.error(f"Failed to execute batch for project {project_id}: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to execute batch: {str(e)}"
        )


@router.get("/{task_id}/result", response_model=TaskResultResponse)
async def get_task_result(
    task_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Busca resultado de uma task executada

    GET /api/v1/tasks/{task_id}/result

    Retorna:
    - Código gerado
    - Métricas de execução
    - Status de validação

    Retorna 404 se a task ainda não foi executada.
    """

    result = db.query(TaskResult).filter(TaskResult.task_id == task_id).first()

    if not result:
        raise HTTPException(status_code=404, detail="Result not found. Task may not have been executed yet.")

    return result
