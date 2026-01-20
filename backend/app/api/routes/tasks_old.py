"""
Tasks API Router
CRUD operations for managing tasks with Kanban board functionality.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status, Body
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel

from app.database import get_db
from app.models.task import Task, TaskStatus, ItemType, PriorityLevel
from app.models.task_result import TaskResult
from app.models.task_relationship import TaskRelationship, RelationshipType
from app.models.task_comment import TaskComment, CommentType
from app.models.status_transition import StatusTransition
from app.schemas.task import (
    TaskCreate,
    TaskUpdate,
    TaskResponse,
    TaskExecuteRequest,
    TaskResultResponse,
    BatchExecuteRequest,
    BatchExecuteResponse,
    RelationshipCreate,
    RelationshipResponse,
    CommentCreate,
    CommentUpdate,
    CommentResponse,
    StatusTransitionCreate,
    StatusTransitionResponse,
    TaskWithRelations,
    HierarchyMoveRequest,
    HierarchyValidationResponse
)
from app.api.dependencies import get_task_or_404, get_project_or_404
from app.services.task_executor import TaskExecutor
from app.services.task_hierarchy import TaskHierarchyService
from app.services.backlog_view import BacklogViewService
from app.services.workflow_validator import WorkflowValidator
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
        raise HTTPException(status_code=404, detail="Task not found")

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
        raise HTTPException(status_code=404, detail="Task not found")

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
        raise HTTPException(status_code=404, detail="Task not found")

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
        raise HTTPException(status_code=404, detail="Task not found")

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
            raise HTTPException(status_code=400, detail="Move failed")

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
        raise HTTPException(status_code=404, detail="Task not found")

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


# ============================================================================
# JIRA TRANSFORMATION - RELATIONSHIP ENDPOINTS
# ============================================================================

@router.post("/{task_id}/relationships", response_model=RelationshipResponse, status_code=status.HTTP_201_CREATED)
async def create_relationship(
    task_id: UUID,
    relationship_data: RelationshipCreate,
    db: Session = Depends(get_db)
):
    """
    Create a task relationship (blocks, depends_on, relates_to, etc.).

    POST /api/v1/tasks/{task_id}/relationships
    Body: {"source_task_id": "uuid", "target_task_id": "uuid", "relationship_type": "blocks"}

    Relationship types:
    - blocks: This task blocks the target
    - blocked_by: This task is blocked by the target
    - depends_on: This task depends on the target
    - relates_to: This task relates to the target
    - duplicates: This task duplicates the target
    - clones: This task clones the target
    """
    # Verify both tasks exist
    source_task = db.query(Task).filter(Task.id == relationship_data.source_task_id).first()
    target_task = db.query(Task).filter(Task.id == relationship_data.target_task_id).first()

    if not source_task:
        raise HTTPException(status_code=404, detail=f"Source task {relationship_data.source_task_id} not found")
    if not target_task:
        raise HTTPException(status_code=404, detail=f"Target task {relationship_data.target_task_id} not found")

    # Check for existing relationship
    existing = db.query(TaskRelationship).filter(
        TaskRelationship.source_task_id == relationship_data.source_task_id,
        TaskRelationship.target_task_id == relationship_data.target_task_id,
        TaskRelationship.relationship_type == relationship_data.relationship_type
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="Relationship already exists")

    # Create relationship
    from uuid import uuid4
    relationship = TaskRelationship(
        id=uuid4(),
        source_task_id=relationship_data.source_task_id,
        target_task_id=relationship_data.target_task_id,
        relationship_type=relationship_data.relationship_type,
        created_at=datetime.utcnow()
    )

    db.add(relationship)
    db.commit()
    db.refresh(relationship)

    return relationship


@router.get("/{task_id}/relationships", response_model=List[RelationshipResponse])
async def get_task_relationships(
    task_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get all relationships for a task (both as source and target).

    GET /api/v1/tasks/{task_id}/relationships

    Returns all relationships where task is either source or target.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Get relationships where task is source OR target
    relationships = db.query(TaskRelationship).filter(
        (TaskRelationship.source_task_id == task_id) |
        (TaskRelationship.target_task_id == task_id)
    ).all()

    return relationships


@router.delete("/relationships/{relationship_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_relationship(
    relationship_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Delete a task relationship.

    DELETE /api/v1/tasks/relationships/{relationship_id}

    Returns 204 No Content on success.
    """
    relationship = db.query(TaskRelationship).filter(TaskRelationship.id == relationship_id).first()

    if not relationship:
        raise HTTPException(status_code=404, detail="Relationship not found")

    db.delete(relationship)
    db.commit()

    return None


# ============================================================================
# JIRA TRANSFORMATION - COMMENT ENDPOINTS
# ============================================================================

@router.post("/{task_id}/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
async def create_comment(
    task_id: UUID,
    comment_data: CommentCreate,
    db: Session = Depends(get_db)
):
    """
    Add a comment to a task.

    POST /api/v1/tasks/{task_id}/comments
    Body: {"author": "username", "content": "comment text", "comment_type": "comment"}

    Comment types:
    - comment: Regular comment
    - system: System-generated comment
    - ai_insight: AI-generated insight
    - validation: Validation message
    - code_snippet: Code snippet
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    from uuid import uuid4
    comment = TaskComment(
        id=uuid4(),
        task_id=task_id,
        author=comment_data.author,
        content=comment_data.content,
        comment_type=comment_data.comment_type,
        comment_metadata=comment_data.comment_metadata,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )

    db.add(comment)
    db.commit()
    db.refresh(comment)

    return comment


@router.get("/{task_id}/comments", response_model=List[CommentResponse])
async def get_task_comments(
    task_id: UUID,
    comment_type: Optional[CommentType] = Query(None, description="Filter by comment type"),
    db: Session = Depends(get_db)
):
    """
    Get all comments for a task.

    GET /api/v1/tasks/{task_id}/comments?comment_type=comment

    Optionally filter by comment_type.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    query = db.query(TaskComment).filter(TaskComment.task_id == task_id)

    if comment_type:
        query = query.filter(TaskComment.comment_type == comment_type)

    comments = query.order_by(TaskComment.created_at).all()

    return comments


@router.patch("/comments/{comment_id}", response_model=CommentResponse)
async def update_comment(
    comment_id: UUID,
    comment_data: CommentUpdate,
    db: Session = Depends(get_db)
):
    """
    Update a comment.

    PATCH /api/v1/tasks/comments/{comment_id}
    Body: {"content": "updated text", "metadata": {...}}

    Only content and metadata can be updated.
    """
    comment = db.query(TaskComment).filter(TaskComment.id == comment_id).first()

    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    if comment_data.content is not None:
        comment.content = comment_data.content
    if comment_data.comment_metadata is not None:
        comment.comment_metadata = comment_data.comment_metadata

    comment.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(comment)

    return comment


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    comment_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Delete a comment.

    DELETE /api/v1/tasks/comments/{comment_id}

    Returns 204 No Content on success.
    """
    comment = db.query(TaskComment).filter(TaskComment.id == comment_id).first()

    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    db.delete(comment)
    db.commit()

    return None


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
        raise HTTPException(status_code=404, detail="Task not found")

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
        raise HTTPException(status_code=404, detail="Task not found")

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
        raise HTTPException(status_code=404, detail="Task not found")

    workflow_validator = WorkflowValidator(db)
    current_status = task.workflow_state or "backlog"

    valid_statuses = workflow_validator.get_valid_next_statuses(
        item_type=task.item_type or ItemType.TASK,
        current_status=current_status
    )

    return valid_statuses


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
            detail=f"Task {task_id} not found"
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
# PROMPT #94 FASE 4 - BLOCKING SYSTEM FOR MODIFICATION DETECTION
# ============================================================================

class RejectModificationRequest(BaseModel):
    """Request model for rejecting a proposed modification."""
    rejection_reason: Optional[str] = None


@router.post("/{task_id}/approve-modification", response_model=TaskResponse)
async def approve_task_modification(
    task_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Approve a proposed modification - creates new task with modifications.

    PROMPT #94 FASE 4 - Blocking System Approval:

    When user approves:
    1. Create new task with the proposed modifications
    2. Mark old task as DONE (archived, not deleted for traceability)
    3. Add comment to old task: "Replaced by new task [link]"
    4. Clear pending_modification field

    POST /api/v1/tasks/{task_id}/approve-modification

    Requirements:
    - Task must have status BLOCKED
    - Task must have pending_modification data

    Returns:
    - The newly created task (with modifications applied)

    Example response:
    {
        "id": "new-uuid",
        "title": "Add JWT authentication with refresh tokens",
        "description": "...",
        "status": "backlog",
        "comments": [
            {
                "text": "Created from approved modification of task: Create user authentication",
                "created_at": "2026-01-09T12:34:56",
                "created_by": "system"
            }
        ]
    }
    """
    from app.services.modification_manager import approve_modification

    try:
        new_task = approve_modification(task_id=task_id, db=db, approved_by="user")

        logger.info(
            f"✅ Modification approved for task {task_id}\n"
            f"   New task created: {new_task.id}"
        )

        return new_task

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post("/{task_id}/reject-modification", response_model=TaskResponse)
async def reject_task_modification(
    task_id: UUID,
    request: Optional[RejectModificationRequest] = None,
    db: Session = Depends(get_db)
):
    """
    Reject a proposed modification - unblocks task and discards changes.

    PROMPT #94 FASE 4 - Blocking System Rejection:

    When user rejects:
    1. Unblock the task (restore to original status, likely BACKLOG or TODO)
    2. Clear pending_modification field
    3. Add comment explaining rejection
    4. Task continues as originally defined

    POST /api/v1/tasks/{task_id}/reject-modification

    Optional body:
    {
        "rejection_reason": "AI suggested changes are not needed"
    }

    Requirements:
    - Task must have status BLOCKED
    - Task must have pending_modification data

    Returns:
    - The unblocked task (restored to original state)

    Example response:
    {
        "id": "uuid",
        "title": "Create user authentication",
        "status": "backlog",
        "blocked_reason": null,
        "pending_modification": null,
        "comments": [
            {
                "text": "Proposed modification was rejected by user: AI suggested changes are not needed",
                "created_at": "2026-01-09T12:34:56",
                "created_by": "system"
            }
        ]
    }
    """
    from app.services.modification_manager import reject_modification

    try:
        rejection_reason = request.rejection_reason if request else None

        unblocked_task = reject_modification(
            task_id=task_id,
            db=db,
            rejected_by="user",
            rejection_reason=rejection_reason
        )

        logger.info(
            f"❌ Modification rejected for task {task_id}\n"
            f"   Task unblocked (restored to: {unblocked_task.status.value})\n"
            f"   Reason: {rejection_reason or 'Not specified'}"
        )

        return unblocked_task

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


# PROMPT #97 - BLOCKING ANALYTICS DASHBOARD
# ============================================================================

class BlockingAnalytics(BaseModel):
    """Analytics data for the blocking system."""
    # Current state
    total_blocked: int
    total_approved: int
    total_rejected: int

    # Rates
    approval_rate: float  # % of resolved modifications that were approved
    rejection_rate: float  # % of resolved modifications that were rejected
    blocking_rate: float  # % of all tasks that got blocked

    # Similarity metrics
    avg_similarity_score: float
    similarity_distribution: Dict[str, int]  # {"90+": X, "80-90": Y, ...}

    # Timeline
    blocked_by_date: List[Dict[str, Any]]  # [{"date": "2026-01-09", "count": 5}, ...]

    # Project breakdown
    blocked_by_project: List[Dict[str, Any]]  # [{"project_name": "X", "count": Y}, ...]


@router.get("/analytics/blocking", response_model=BlockingAnalytics)
async def get_blocking_analytics(
    project_id: Optional[UUID] = Query(None, description="Filter by project ID (optional)"),
    days: int = Query(30, ge=1, le=365, description="Number of days to analyze"),
    db: Session = Depends(get_db)
):
    """
    Get analytics and metrics for the blocking system.

    PROMPT #97 - Blocking Analytics Dashboard:

    Provides comprehensive statistics about AI-suggested modifications:
    - How many tasks are currently blocked
    - Approval vs rejection rates
    - Similarity score distribution
    - Timeline of blocking events
    - Project breakdown

    GET /api/v1/tasks/analytics/blocking?project_id={uuid}&days=30

    Query Parameters:
    - project_id (optional): Filter analytics to specific project
    - days (default: 30): Number of days to analyze (1-365)

    Returns comprehensive analytics:
    {
        "total_blocked": 5,
        "total_approved": 12,
        "total_rejected": 8,
        "approval_rate": 0.60,  // 60% of resolved modifications were approved
        "rejection_rate": 0.40,  // 40% of resolved modifications were rejected
        "blocking_rate": 0.25,  // 25% of all tasks got blocked
        "avg_similarity_score": 0.92,
        "similarity_distribution": {
            "90+": 15,
            "80-90": 8,
            "70-80": 2,
            "<70": 0
        },
        "blocked_by_date": [
            {"date": "2026-01-09", "count": 3},
            {"date": "2026-01-08", "count": 5}
        ],
        "blocked_by_project": [
            {"project_id": "uuid", "project_name": "Project A", "count": 10},
            {"project_id": "uuid", "project_name": "Project B", "count": 5}
        ]
    }

    Use Cases:
    - Monitor blocking system effectiveness
    - Identify projects with high modification rates
    - Track AI suggestion quality (similarity scores)
    - Understand user approval patterns
    """
    from datetime import timedelta
    from app.models.project import Project
    from sqlalchemy import func, and_, or_

    # Calculate date range
    end_date = datetime.utcnow()
    start_date = end_date - timedelta(days=days)

    # Base query for all tasks in the time range
    base_query = db.query(Task)

    if project_id:
        base_query = base_query.filter(Task.project_id == project_id)

    # CURRENT BLOCKED TASKS
    # Tasks that are currently blocked (pending user decision)
    currently_blocked = base_query.filter(
        Task.status == TaskStatus.BLOCKED,
        Task.pending_modification.isnot(None)
    ).count()

    # APPROVED MODIFICATIONS
    # Tasks that were blocked but got approved (now have new tasks created)
    # We identify these by looking at task_metadata.approved_modification = true
    approved_query = base_query.filter(
        Task.created_at >= start_date,
        Task.task_metadata['approved_modification'].astext == 'true'
    )
    total_approved = approved_query.count()

    # REJECTED MODIFICATIONS
    # Tasks that were blocked and then rejected (status changed from BLOCKED to something else)
    # We identify these by checking status_history for BLOCKED → other transition
    rejected_tasks = []
    all_tasks_with_history = base_query.filter(
        Task.status_history.isnot(None),
        Task.created_at >= start_date
    ).all()

    for task in all_tasks_with_history:
        if task.status_history:
            for i, transition in enumerate(task.status_history):
                if (transition.get('from') == 'blocked' and
                    transition.get('to') != 'blocked' and
                    transition.get('by') == 'system' and
                    'rejected' in transition.get('reason', '').lower()):
                    rejected_tasks.append(task)
                    break

    total_rejected = len(rejected_tasks)

    # RATES CALCULATION
    total_resolved = total_approved + total_rejected
    approval_rate = total_approved / total_resolved if total_resolved > 0 else 0.0
    rejection_rate = total_rejected / total_resolved if total_resolved > 0 else 0.0

    # Blocking rate = (blocked + approved + rejected) / total tasks
    total_tasks = base_query.filter(Task.created_at >= start_date).count()
    total_blocking_events = currently_blocked + total_approved + total_rejected
    blocking_rate = total_blocking_events / total_tasks if total_tasks > 0 else 0.0

    # SIMILARITY METRICS
    # Get all tasks that have/had pending_modification
    tasks_with_modifications = base_query.filter(
        or_(
            Task.pending_modification.isnot(None),
            Task.task_metadata['had_pending_modification'].astext == 'true'
        )
    ).all()

    similarity_scores = []
    similarity_distribution = {
        "90+": 0,
        "80-90": 0,
        "70-80": 0,
        "<70": 0
    }

    for task in tasks_with_modifications:
        score = None

        # Check current pending_modification
        if task.pending_modification and isinstance(task.pending_modification, dict):
            score = task.pending_modification.get('similarity_score')

        # Check task_metadata for historical score
        if not score and task.task_metadata and isinstance(task.task_metadata, dict):
            score = task.task_metadata.get('original_similarity_score')

        if score and isinstance(score, (int, float)):
            similarity_scores.append(score)

            # Categorize
            percentage = score * 100
            if percentage >= 90:
                similarity_distribution["90+"] += 1
            elif percentage >= 80:
                similarity_distribution["80-90"] += 1
            elif percentage >= 70:
                similarity_distribution["70-80"] += 1
            else:
                similarity_distribution["<70"] += 1

    avg_similarity_score = sum(similarity_scores) / len(similarity_scores) if similarity_scores else 0.0

    # TIMELINE DATA
    # Group blocking events by date
    blocked_by_date_data = {}

    for task in tasks_with_modifications:
        task_date = task.created_at.date().isoformat()
        blocked_by_date_data[task_date] = blocked_by_date_data.get(task_date, 0) + 1

    # Sort by date descending
    blocked_by_date = [
        {"date": date, "count": count}
        for date, count in sorted(blocked_by_date_data.items(), reverse=True)
    ]

    # PROJECT BREAKDOWN
    # Group by project
    if not project_id:  # Only show breakdown if not filtering by project
        project_counts = {}

        for task in tasks_with_modifications:
            if task.project_id:
                if task.project_id not in project_counts:
                    project = db.query(Project).filter(Project.id == task.project_id).first()
                    project_counts[task.project_id] = {
                        "project_id": str(task.project_id),
                        "project_name": project.name if project else "Unknown",
                        "count": 0
                    }
                project_counts[task.project_id]["count"] += 1

        blocked_by_project = sorted(
            project_counts.values(),
            key=lambda x: x["count"],
            reverse=True
        )
    else:
        # If filtering by project, just return that project
        project = db.query(Project).filter(Project.id == project_id).first()
        blocked_by_project = [{
            "project_id": str(project_id),
            "project_name": project.name if project else "Unknown",
            "count": len(tasks_with_modifications)
        }]

    logger.info(
        f"📊 Blocking Analytics Generated:\n"
        f"   Project: {project_id or 'All projects'}\n"
        f"   Days: {days}\n"
        f"   Currently Blocked: {currently_blocked}\n"
        f"   Approved: {total_approved}\n"
        f"   Rejected: {total_rejected}\n"
        f"   Approval Rate: {approval_rate:.1%}\n"
        f"   Avg Similarity: {avg_similarity_score:.2%}"
    )

    return BlockingAnalytics(
        total_blocked=currently_blocked,
        total_approved=total_approved,
        total_rejected=total_rejected,
        approval_rate=approval_rate,
        rejection_rate=rejection_rate,
        blocking_rate=blocking_rate,
        avg_similarity_score=avg_similarity_score,
        similarity_distribution=similarity_distribution,
        blocked_by_date=blocked_by_date,
        blocked_by_project=blocked_by_project
    )


# ============================================================================
# PROMPT #94 - ACTIVATE/REJECT SUGGESTED EPICS
# ============================================================================

class ActivateEpicResponse(BaseModel):
    """Response model for activating a suggested epic."""
    id: str
    title: str
    description: Optional[str] = None
    generated_prompt: Optional[str] = None
    acceptance_criteria: Optional[List[str]] = None
    story_points: Optional[int] = None
    priority: str
    activated: bool


@router.post("/{task_id}/activate", response_model=ActivateEpicResponse)
async def activate_suggested_epic(
    task_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Activate a suggested epic by generating full semantic content.

    PROMPT #94 - Activate Suggested Epic:

    When user approves a suggested epic:
    1. Fetch project context (context_semantic, context_human)
    2. Generate full epic content using AI:
       - Semantic markdown (generated_prompt) for AI/child cards
       - Human description for reading
       - Acceptance criteria
       - Story points estimation
    3. Update epic:
       - Remove "suggested" label
       - Change workflow_state from "draft" to "open"
       - Add generated content
    4. Lock project context (first activated epic triggers lock)

    POST /api/v1/tasks/{task_id}/activate

    Requirements:
    - Task must be an EPIC
    - Task must have labels=["suggested"] or workflow_state="draft"
    - Project must have context_semantic (Context Interview completed)

    Returns:
    - The activated epic with full content

    Example response:
    {
        "id": "uuid",
        "title": "Autenticação e Autorização",
        "description": "Sistema completo de autenticação...",
        "generated_prompt": "# Epic: Autenticação\\n\\n## Mapa Semântico...",
        "acceptance_criteria": ["AC1: ...", "AC2: ..."],
        "story_points": 13,
        "priority": "critical",
        "activated": true
    }
    """
    from app.services.context_generator import ContextGeneratorService

    context_service = ContextGeneratorService(db)

    try:
        result = await context_service.activate_suggested_epic(epic_id=task_id)

        logger.info(
            f"✅ Suggested epic activated: {task_id}\n"
            f"   Title: {result['title']}\n"
            f"   Description: {len(result.get('description', ''))} chars\n"
            f"   Generated Prompt: {len(result.get('generated_prompt', ''))} chars"
        )

        return ActivateEpicResponse(**result)

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
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
