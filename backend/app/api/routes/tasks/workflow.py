"""
Tasks Workflow Router
Workflow endpoints: activate items, generate children, reject epics,
create interview from task, project backlog.

Blocking endpoints moved to blocking.py.
Async helpers moved to workflow_helpers.py.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel

from app.database import get_db
from app.models.task import Task, TaskStatus, ItemType, PriorityLevel
from app.schemas.task import TaskResponse
from app.services.backlog_view import BacklogViewService
from .workflow_helpers import activate_item_async, generate_children_async

import logging

logger = logging.getLogger(__name__)

router = APIRouter()


class ActivateEpicResponse(BaseModel):
    """Response model for activating a suggested item (Epic, Story, Task, Subtask)."""
    id: str
    title: str
    description: Optional[str] = None
    generated_prompt: Optional[str] = None
    acceptance_criteria: Optional[List[str]] = None
    story_points: Optional[int] = None
    priority: str
    activated: bool
    children_generated: Optional[int] = 0  # PROMPT #102 - Number of draft children generated


class ActivateJobResponse(BaseModel):
    """Response model for async activation job."""
    job_id: str
    status: str
    message: str


# ============================================================================
# JIRA TRANSFORMATION - BACKLOG VIEW ENDPOINTS
# ============================================================================

@router.get("/projects/{project_id}/backlog")
async def get_project_backlog(
    project_id: UUID,
    item_type: Optional[List[ItemType]] = Query(None, description="Filter by item types"),
    priority: Optional[List[PriorityLevel]] = Query(None, description="Filter by priorities"),
    assignee: Optional[str] = Query(None, description="Filter by assignee"),
    labels: Optional[List[str]] = Query(None, description="Filter by labels (match ANY)"),
    status: Optional[List[TaskStatus]] = Query(None, description="Filter by statuses"),
    db: Session = Depends(get_db)
):
    """
    Get hierarchical backlog for a project with filters.

    GET /api/v1/tasks/projects/{project_id}/backlog?item_type=epic&item_type=story&priority=high

    Filters:
    - item_type: List of ItemType values
    - priority: List of PriorityLevel values
    - assignee: Username string
    - labels: List of label strings (match ANY)
    - status: List of TaskStatus values

    Returns hierarchical tree structure: Epic → Story → Task → Subtask
    """
    backlog_service = BacklogViewService(db)

    filters = {}
    if item_type:
        filters["item_type"] = item_type
    if priority:
        filters["priority"] = priority
    if assignee:
        filters["assignee"] = assignee
    if labels:
        filters["labels"] = labels
    if status:
        filters["status"] = status

    backlog = backlog_service.get_project_backlog(project_id, filters)

    return backlog


# ============================================================================
# PROMPT #68 - TASK EXPLORATION ENDPOINT
# ============================================================================

@router.post("/{task_id}/create-interview")
async def create_interview_from_task(
    task_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Create task-focused interview to explore task deeper.

    POST /api/v1/tasks/{task_id}/create-interview

    Use cases:
    - Task has suggested subtasks → explore with AI
    - Task is complex → break down further
    - Task needs clarification

    Returns:
    - Interview instance with pre-filled conversation
    - interview_mode: "task_focused"
    - parent_task_id: Links back to this task

    Example response:
    {
        "id": "uuid",
        "project_id": "uuid",
        "interview_mode": "task_focused",
        "parent_task_id": "uuid",
        "conversation_data": [...],
        "ai_model_used": "system",
        "status": "active",
        "created_at": "2026-01-06T..."
    }
    """
    # Get task
    task = db.query(Task).filter(Task.id == task_id).first()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tarefa {task_id} não encontrada"
        )

    # Build initial context message
    acceptance_criteria_text = ""
    if task.acceptance_criteria:
        criteria_lines = "\n".join([f"  - {criterion}" for criterion in task.acceptance_criteria])
        acceptance_criteria_text = f"\n- Critérios de Aceitação:\n{criteria_lines}"

    subtasks_text = ""
    if task.subtask_suggestions and len(task.subtask_suggestions) > 0:
        subtask_lines = "\n".join([
            f"  {i+1}. {st.get('title', 'Sem título')} ({st.get('story_points', '?')} pts)"
            for i, st in enumerate(task.subtask_suggestions)
        ])
        subtasks_text = f"\n- Subtasks Sugeridas:\n{subtask_lines}"

    initial_message = {
        "role": "assistant",
        "content": f"""👋 Vou ajudá-lo a explorar a task "{task.title}".

CONTEXTO DA TASK:
- Título: {task.title}
- Descrição: {task.description or 'Sem descrição'}
- Tipo: {task.item_type.value if task.item_type else 'task'}
- Story Points: {task.story_points or 'Não estimado'}
- Prioridade: {task.priority.value if task.priority else 'medium'}{acceptance_criteria_text}{subtasks_text}

O que deseja fazer com esta task?
- Explorar mais detalhes sobre a implementação?
- Quebrar em subtasks menores?
- Esclarecer requisitos?
- Adicionar mais critérios de aceitação?

Me diga como posso ajudar!""",
        "timestamp": datetime.utcnow().isoformat()
    }

    # Import Interview model
    from app.models.interview import Interview, InterviewStatus

    # PROMPT #97 - Determine interview mode based on task item_type (hierarchical flow)
    if task.item_type == ItemType.EPIC:
        interview_mode = "orchestrator"  # Epic → Story
        logger.info(f"Creating Story interview from Epic '{task.title}'")
    elif task.item_type == ItemType.STORY:
        interview_mode = "task_orchestrated"  # Story → Task
        logger.info(f"Creating Task interview from Story '{task.title}'")
    elif task.item_type == ItemType.TASK:
        interview_mode = "subtask_orchestrated"  # Task → Subtask
        logger.info(f"Creating Subtask interview from Task '{task.title}'")
    else:
        # Fallback for other types (bug, etc)
        interview_mode = "task_orchestrated"
        logger.warning(f"Unknown parent type {task.item_type}, defaulting to task_orchestrated")

    # Create interview
    interview = Interview(
        project_id=task.project_id,
        conversation_data=[initial_message],
        ai_model_used="system",
        interview_mode=interview_mode,  # PROMPT #97 - Hierarchical mode
        parent_task_id=task_id,
        status=InterviewStatus.ACTIVE,
        created_at=datetime.utcnow()
    )

    db.add(interview)
    db.commit()
    db.refresh(interview)

    logger.info(f"Created task exploration interview {interview.id} for task {task_id}")

    return {
        "id": str(interview.id),
        "project_id": str(interview.project_id),
        "interview_mode": interview.interview_mode,
        "parent_task_id": str(interview.parent_task_id) if interview.parent_task_id else None,
        "conversation_data": interview.conversation_data,
        "ai_model_used": interview.ai_model_used,
        "status": interview.status.value,
        "created_at": interview.created_at.isoformat(),
        "task_context": {
            "task_id": str(task.id),
            "task_title": task.title,
            "task_type": task.item_type.value if task.item_type else "task",
            "has_subtask_suggestions": len(task.subtask_suggestions) > 0 if task.subtask_suggestions else False
        }
    }


# ============================================================================
# PROMPT #94 - ACTIVATE/REJECT SUGGESTED EPICS
# PROMPT #108 - Moved to background queue
# ============================================================================

@router.post("/{task_id}/activate", response_model=ActivateJobResponse)
async def activate_suggested_item(
    task_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Activate a suggested item (Epic, Story, Task, or Subtask) - ASYNC.

    PROMPT #94 - Original Activate Suggested Epic
    PROMPT #102 - Extended to support all item types with hierarchical draft generation
    PROMPT #108 - Moved to background queue for better UX

    This endpoint now runs asynchronously in the background.
    Poll GET /api/v1/jobs/{job_id} for progress and result.

    When user approves a suggested item:
    1. Creates a background job
    2. Returns job_id immediately
    3. Background task:
       - Fetches project context
       - Generates full item content using AI
       - Auto-generates draft children

    POST /api/v1/tasks/{task_id}/activate

    Returns immediately:
    {
        "job_id": "uuid",
        "status": "pending",
        "message": "Activation started. Poll GET /api/v1/jobs/{job_id} for progress."
    }

    Poll /api/v1/jobs/{job_id} to get:
    - status: "running" with progress_percent and progress_message
    - status: "completed" with result (ActivateEpicResponse format)
    - status: "failed" with error message
    """
    from app.models.async_job import JobType
    from app.services.job_manager import JobManager

    # Fetch the task to determine its type
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Item {task_id} não encontrado"
        )

    # Determine job type based on item type
    job_type_map = {
        ItemType.EPIC: JobType.EPIC_ACTIVATION,
        ItemType.STORY: JobType.STORY_ACTIVATION,
        ItemType.TASK: JobType.TASK_ACTIVATION,
        ItemType.SUBTASK: JobType.SUBTASK_ACTIVATION,
    }
    job_type = job_type_map.get(task.item_type, JobType.EPIC_ACTIVATION)

    # Create job
    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=job_type,
        input_data={
            "task_id": str(task_id),
            "item_type": task.item_type.value,
            "title": task.title
        },
        project_id=task.project_id,
        task_id=task_id,
        deep_link=f"/projects/{task.project_id}?task={task_id}",
        notification_title=f"Ativacao concluida: {task.title[:50]}"
    )

    logger.info(f"Created activation job {job.id} for {task.item_type.value} {task_id}")

    # Execute in background via priority queue
    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(job.priority, activate_item_async, job.id, task_id, task.item_type)

    # Return job_id immediately
    return ActivateJobResponse(
        job_id=str(job.id),
        status="pending",
        message=f"Ativacao iniciada para {task.item_type.value}. Use GET /api/v1/jobs/{job.id} para acompanhar progresso."
    )


@router.post("/{task_id}/generate-children", response_model=ActivateJobResponse)
async def generate_children(
    task_id: UUID,
    body: Optional[dict] = None,
    db: Session = Depends(get_db)
):
    """
    PROMPT #127 - Generate draft children for an approved item on-demand.

    Epic -> generates Stories
    Story -> generates Tasks
    Task -> generates Subtasks

    POST /api/v1/tasks/{task_id}/generate-children
    Body (optional): { "count": 10 }
    """
    from app.models.async_job import JobType
    from app.services.job_manager import JobManager

    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Item {task_id} não encontrado"
        )

    if task.item_type == ItemType.SUBTASK:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Subtarefas são nos folha e não podem ter filhos"
        )

    default_counts = {
        ItemType.EPIC: 10,
        ItemType.STORY: 8,
        ItemType.TASK: 5,
    }
    count = default_counts.get(task.item_type, 10)
    if body and isinstance(body, dict) and "count" in body:
        count = max(1, min(30, int(body["count"])))

    child_type = {
        ItemType.EPIC: "stories",
        ItemType.STORY: "tasks",
        ItemType.TASK: "subtasks",
    }.get(task.item_type, "items")

    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.CHILDREN_GENERATION,
        input_data={
            "task_id": str(task_id),
            "item_type": task.item_type.value,
            "title": task.title,
            "count": count,
            "child_type": child_type,
        },
        project_id=task.project_id,
        task_id=task_id,  # PROMPT #181 - Required for persistent loading state via WebSocket
        deep_link=f"/projects/{task.project_id}?task={task_id}",
        notification_title=f"Geração concluida: {count} {child_type} para {task.title[:50]}"
    )

    logger.info(f"Created children generation job {job.id}: {count} {child_type} for {task.item_type.value} {task_id}")

    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(job.priority, generate_children_async, job.id, task_id, count)

    return ActivateJobResponse(
        job_id=str(job.id),
        status="pending",
        message=f"Gerando {count} {child_type}. Use GET /api/v1/jobs/{job.id} para acompanhar progresso."
    )


@router.delete("/{task_id}/reject", status_code=status.HTTP_204_NO_CONTENT)
async def reject_suggested_epic(
    task_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Reject (delete) a suggested epic.

    PROMPT #94 - Reject Suggested Epic:

    When user rejects a suggested epic:
    1. Validate it's a suggested epic (labels=["suggested"] or workflow_state="draft")
    2. Delete the epic from database

    DELETE /api/v1/tasks/{task_id}/reject

    Requirements:
    - Task must be an EPIC
    - Task must have labels=["suggested"] or workflow_state="draft"

    Returns:
    - 204 No Content on success

    Note: This permanently deletes the suggested epic. If the user wants to
    create a similar epic later, they can do so manually or re-run the
    Context Interview.
    """
    from app.services.context_generator import ContextGeneratorService

    context_service = ContextGeneratorService(db)

    try:
        await context_service.reject_suggested_epic(epic_id=task_id)

        logger.info(f"❌ Suggested epic rejected and deleted: {task_id}")

        return None

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
