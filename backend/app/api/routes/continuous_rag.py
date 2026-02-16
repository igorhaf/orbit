"""
Continuous RAG Evolution API Routes

PROMPT #218 - Endpoints for managing continuous RAG processing per project.

Provides manual scan triggers, status monitoring, file listing, and reset.
"""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.async_job import AsyncJob, JobStatus, JobType
from app.models.project import Project
from app.models.rag_file_state import FileProcessingStatus, RAGFileState
from app.services.continuous_rag_service import ContinuousRAGService
from app.services.job_manager import JobManager

router = APIRouter()


@router.post("/{project_id}/rag/scan")
async def trigger_rag_scan(
    project_id: UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Trigger a manual continuous RAG scan for a project.
    Creates an AsyncJob that runs at LOW priority.
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    if not project.code_path:
        raise HTTPException(status_code=400, detail="Projeto não tem code_path configurado")

    # Check for existing pending/running scan
    existing = db.query(AsyncJob).filter(
        AsyncJob.job_type == JobType.RAG_CONTINUOUS_SCAN,
        AsyncJob.project_id == project_id,
        AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING])
    ).first()

    if existing:
        return {
            "message": "Uma varredura de RAG ja esta em andamento",
            "job_id": str(existing.id),
            "status": existing.status.value,
        }

    # Create async job
    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.RAG_CONTINUOUS_SCAN,
        input_data={"project_id": str(project_id), "manual": True},
        project_id=project_id,
        notification_title=f"Varredura RAG: {project.name or 'Projeto'}",
        deep_link=f"/projects/{project_id}",
    )

    # Execute in background
    async def _run_scan(job_id, proj_id):
        from app.database import get_db as get_db_gen
        db_session = next(get_db_gen())
        try:
            jm = JobManager(db_session)
            jm.start_job(job_id)

            service = ContinuousRAGService(db_session)
            # PROMPT #298 - Pass job_id for per-file sub-jobs
            result = await service.run_full_cycle(proj_id, job_id=job_id)

            jm.complete_job(job_id, result)
        except Exception as e:
            try:
                jm.fail_job(job_id, str(e))
            except Exception:
                pass
        finally:
            db_session.close()

    background_tasks.add_task(_run_scan, job.id, project_id)

    return {
        "message": "Varredura de RAG iniciada",
        "job_id": str(job.id),
        "status": "pending",
    }


@router.get("/{project_id}/rag/status")
async def get_rag_status(
    project_id: UUID,
    db: Session = Depends(get_db),
):
    """
    Get continuous RAG evolution status for a project.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    service = ContinuousRAGService(db)
    stats = await service.get_project_stats(project_id)

    # Check if a scan is currently running
    active_job = db.query(AsyncJob).filter(
        AsyncJob.job_type == JobType.RAG_CONTINUOUS_SCAN,
        AsyncJob.project_id == project_id,
        AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING])
    ).first()

    stats["is_scanning"] = active_job is not None
    if active_job:
        stats["active_job"] = {
            "id": str(active_job.id),
            "status": active_job.status.value,
            "progress_percent": active_job.progress_percent,
            "progress_message": active_job.progress_message,
        }

    return stats


@router.get("/{project_id}/rag/files")
async def list_rag_files(
    project_id: UUID,
    status: Optional[str] = Query(None, description="Filter by status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """
    List tracked files with their processing status (paginated).
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    query = db.query(RAGFileState).filter(RAGFileState.project_id == project_id)

    if status:
        try:
            status_enum = FileProcessingStatus(status)
            query = query.filter(RAGFileState.status == status_enum)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Status inválido: {status}")

    total = query.count()
    files = (
        query
        .order_by(RAGFileState.updated_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
        "files": [f.to_dict() for f in files],
    }


@router.delete("/{project_id}/rag/reset")
async def reset_rag_state(
    project_id: UUID,
    db: Session = Depends(get_db),
):
    """
    Clear all file tracking state and continuous scan RAG documents.
    Next scan will re-process all files from scratch.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    service = ContinuousRAGService(db)
    result = await service.reset_project(project_id)

    return {
        "message": "Estado do RAG continuo redefinido com sucesso",
        **result,
    }


@router.get("/{project_id}/rag/enrichment-status")
async def get_enrichment_status(
    project_id: UUID,
    db: Session = Depends(get_db),
):
    """
    PROMPT #239 - Get background enrichment status for a project.
    PROMPT #301 - Expanded to check ALL active job types (not just RAG_CONTINUOUS_SCAN).
    Used by the frontend to show enrichment progress indicator.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    # PROMPT #301 - Check ALL active jobs for this project (scan, wiki, cards, RAG, etc.)
    active_jobs = db.query(AsyncJob).filter(
        AsyncJob.project_id == project_id,
        AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
        AsyncJob.parent_job_id.is_(None),  # Only top-level jobs
    ).all()

    # PROMPT #241 - Count auto-discovered cards
    from app.models.task import Task
    from sqlalchemy import func as sql_func, cast
    from sqlalchemy.dialects.postgresql import ARRAY
    auto_discovered_count = db.query(sql_func.count(Task.id)).filter(
        Task.project_id == project_id,
        Task.reporter == "watchdog",
    ).scalar() or 0

    return {
        "is_enriching": len(active_jobs) > 0,
        "active_jobs": [
            {
                "id": str(j.id),
                "type": j.job_type.value if j.job_type else None,
                "status": j.status.value if j.status else None,
                "progress_percent": j.progress_percent,
                "progress_message": j.progress_message,
            }
            for j in active_jobs
        ],
        "context_locked": project.context_locked or False,
        "has_description": bool(project.description),
        "has_context": bool(project.context_human),
        "auto_discovered_cards": auto_discovered_count,
    }
