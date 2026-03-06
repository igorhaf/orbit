"""
Projects API - Context endpoints.
Summary, context, lock-context, cleanup/incomplete.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from uuid import UUID
import logging

from app.database import get_db
from app.models.project import Project
from app.models.interview import Interview
from app.models.prompt import Prompt
from app.models.task import Task

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/{project_id}/summary")
async def get_project_summary(
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get project statistics and summary.

    Returns:
    - Project details
    - Count of interviews
    - Count of prompts
    - Count of tasks
    - Tasks breakdown by status
    """
    from app.api.dependencies import get_project_or_404

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto nao encontrado")

    # Count related entities
    interviews_count = db.query(Interview).filter(
        Interview.project_id == project.id
    ).count()

    prompts_count = db.query(Prompt).filter(
        Prompt.project_id == project.id
    ).count()

    tasks_count = db.query(Task).filter(
        Task.project_id == project.id
    ).count()

    # Get tasks breakdown by status
    from sqlalchemy import func
    tasks_by_status = db.query(
        Task.status,
        func.count(Task.id).label('count')
    ).filter(
        Task.project_id == project.id
    ).group_by(Task.status).all()

    tasks_status_breakdown = {
        status: count for status, count in tasks_by_status
    }

    return {
        "project": project,
        "statistics": {
            "total_interviews": interviews_count,
            "total_prompts": prompts_count,
            "total_tasks": tasks_count,
            "tasks_by_status": tasks_status_breakdown
        }
    }


# ============================================================================
# CONTEXT ENDPOINTS - PROMPT #89
# ============================================================================

@router.get("/{project_id}/context")
async def get_project_context(
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get project context (semantic and human-readable).

    PROMPT #89 - Context Interview: Foundational Project Description

    Returns the project's context information:
    - context_semantic: Structured text for AI consumption
    - context_human: Human-readable description
    - context_locked: Whether context is immutable
    - context_locked_at: When context was locked

    Raises:
        404: If project not found
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Projeto {project_id} nao encontrado"
        )

    return {
        "project_id": str(project.id),
        "project_name": project.name,
        "context_semantic": project.context_semantic,
        "context_human": project.context_human,
        "context_locked": project.context_locked,
        "context_locked_at": project.context_locked_at.isoformat() if project.context_locked_at else None,
        "has_context": bool(project.context_semantic)
    }

@router.post("/{project_id}/lock-context")
async def lock_project_context(
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Lock project context (make it immutable).

    PROMPT #89 - Context is locked automatically when first Epic is generated,
    but can also be locked manually via this endpoint.

    Once locked, context cannot be modified or regenerated.

    Returns:
        {
            "success": True,
            "message": "Contexto bloqueado com sucesso",
            "context_locked_at": "2026-01-19T..."
        }

    Raises:
        400: If context not generated yet or already locked
        404: If project not found
    """
    from app.services.context_generator import ContextGeneratorService

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Projeto {project_id} nao encontrado"
        )

    if project.context_locked:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Contexto ja esta bloqueado"
        )

    # PROMPT #247 - context_semantic is manual, no fallback auto-generation

    if not project.context_semantic:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nao e possivel bloquear contexto: nenhum contexto foi gerado ainda"
        )

    try:
        context_service = ContextGeneratorService(db)
        context_service.lock_context(project_id)

        # Refresh to get updated values
        db.refresh(project)

        return {
            "success": True,
            "message": "Contexto bloqueado com sucesso",
            "context_locked_at": project.context_locked_at.isoformat()
        }

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


# ============================================================================
# CLEANUP ENDPOINTS - PROMPT #126
# ============================================================================

@router.delete("/cleanup/incomplete")
async def cleanup_incomplete_projects(
    db: Session = Depends(get_db)
):
    """
    Delete all incomplete projects (projects without context).

    PROMPT #126 - Cleanup Incomplete Projects

    A project is considered incomplete if:
    - context_locked = False (context not generated)
    - Has no tasks associated

    These are projects where the user abandoned the wizard before
    completing the Context Interview.

    Returns:
        {
            "deleted_count": 5,
            "deleted_projects": [
                {"id": "uuid", "name": "Project Name"},
                ...
            ]
        }
    """
    from sqlalchemy import func

    # Find incomplete projects (no context and no tasks)
    subquery = db.query(
        Project.id,
        func.count(Task.id).label('task_count')
    ).outerjoin(Task, Task.project_id == Project.id).filter(
        Project.context_locked == False
    ).group_by(Project.id).having(
        func.count(Task.id) == 0
    ).subquery()

    incomplete_projects = db.query(Project).join(
        subquery, Project.id == subquery.c.id
    ).all()

    # Collect info before deletion
    deleted_projects = [
        {"id": str(p.id), "name": p.name}
        for p in incomplete_projects
    ]

    # Delete projects
    for project in incomplete_projects:
        db.delete(project)

    db.commit()

    logger.info(f"Cleaned up {len(deleted_projects)} incomplete projects")

    return {
        "deleted_count": len(deleted_projects),
        "deleted_projects": deleted_projects
    }
