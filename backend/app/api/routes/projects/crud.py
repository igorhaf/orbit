"""
Projects API - CRUD endpoints.
List all, create, get single, update, delete.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from pathlib import Path
import os
import logging

from app.database import get_db
from app.models.project import Project
from app.models.interview import Interview
from app.models.prompt import Prompt
from app.models.task import Task
from app.models.async_job import AsyncJob, JobType, JobStatus
from app.schemas.project import ProjectCreate, ProjectUpdate, ProjectResponse
from app.api.dependencies import get_project_or_404
from app.services.job_manager import JobManager
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/", response_model=List[ProjectResponse])
async def list_projects(
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=100, description="Maximum number of records to return"),
    search: Optional[str] = Query(None, description="Search by project name"),
    sort_by: str = Query("created_at", description="Field to sort by"),
    sort_desc: bool = Query(True, description="Sort in descending order"),
    db: Session = Depends(get_db)
):
    """
    List all projects with pagination and filtering.

    - **skip**: Number of records to skip (pagination)
    - **limit**: Maximum number of records to return (1-100)
    - **search**: Filter by project name (case-insensitive)
    - **sort_by**: Field to sort by (name, created_at, updated_at)
    - **sort_desc**: Sort in descending order
    """
    query = db.query(Project)

    # Apply search filter
    if search:
        query = query.filter(Project.name.ilike(f"%{search}%"))

    # Apply sorting
    sort_column = getattr(Project, sort_by, Project.created_at)
    if sort_desc:
        query = query.order_by(sort_column.desc())
    else:
        query = query.order_by(sort_column.asc())

    # Apply pagination
    projects = query.offset(skip).limit(limit).all()
    return projects

@router.post("/", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    project: ProjectCreate,
    db: Session = Depends(get_db)
):
    """
    Create a new project.

    PROMPT #111 - code_path e OBRIGATORIO e IMUTAVEL

    - **name**: Project name (required, max 255 characters)
    - **code_path**: Path to existing code folder (REQUIRED, IMMUTABLE after creation)
    - **description**: Project description (optional)
    - **git_repository_info**: Git repository information as JSON (optional)

    Validates:
    - code_path must exist
    - code_path must be a directory

    Note: ORBIT focuses on analyzing existing code, not provisioning.
    """
    # PROMPT #111 - Validar que pasta existe e e um diretorio
    code_path = Path(project.code_path)
    if not code_path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Caminho do codigo nao existe: {project.code_path}"
        )
    if not code_path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Caminho do codigo nao e um diretorio: {project.code_path}"
        )

    # PROMPT #127 - Determine initial status based on memory scan results
    # If codebase already has business rules or key features developed,
    # the project starts as "active" (existing code = completed work)
    from app.models.project import ProjectStatus

    initial_status = ProjectStatus.draft  # Default status

    if project.initial_memory_context:
        memory_ctx = project.initial_memory_context
        has_business_rules = bool(memory_ctx.get("business_rules", []))
        has_key_features = bool(memory_ctx.get("key_features", []))

        if has_business_rules or has_key_features:
            initial_status = ProjectStatus.active
            logger.info(f"Project will start as 'active' - detected existing code:")
            if has_business_rules:
                logger.info(f"   - {len(memory_ctx.get('business_rules', []))} business rules")
            if has_key_features:
                logger.info(f"   - {len(memory_ctx.get('key_features', []))} key features")

    # Create new project instance with code_path
    db_project = Project(
        name=project.name,
        description=project.description,
        git_repository_info=project.git_repository_info,
        code_path=project.code_path,  # PROMPT #111 - Obrigatorio e imutavel
        initial_memory_context=project.initial_memory_context,  # PROMPT #118 - Memory scan context
        status=initial_status,  # PROMPT #127 - Active if existing code detected
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )

    db.add(db_project)
    db.commit()
    db.refresh(db_project)

    logger.info(f"Created project '{project.name}' with code_path: {project.code_path} (status: {initial_status.value})")

    return db_project

@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project: Project = Depends(get_project_or_404)
):
    """
    Get a specific project by ID.

    - **project_id**: UUID of the project
    """
    return project

@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_update: ProjectUpdate,
    project: Project = Depends(get_project_or_404),
    db: Session = Depends(get_db)
):
    """
    Update a project (partial update).

    Only provided fields will be updated.
    - **name**: New project name (optional)
    - **description**: New description (optional)
    - **git_repository_info**: New git info (optional)
    """
    # Update only provided fields
    update_data = project_update.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        setattr(project, field, value)

    # Update timestamp
    project.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(project)

    return project

@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project: Project = Depends(get_project_or_404),
    db: Session = Depends(get_db)
):
    """
    Delete a project with full cascade cleanup.

    - **project_id**: UUID of the project to delete

    PROMPT #279: Complete cascade delete:
    1. Cancel/delete all async_jobs (stops watchdog, batch processing, etc.)
    2. Delete ALL RAG documents for the project
    3. Delete project_analyses linked to the project
    4. Delete prompt_templates linked to the project
    5. Delete project folder from disk
    6. Delete the project (SQLAlchemy CASCADE handles interviews, tasks, wiki, etc.)
    """
    # PROMPT #236 - Protection guard
    if project.protected:
        from app.models.system_settings import SystemSettings
        setting = db.query(SystemSettings).filter(
            SystemSettings.key == "allow_protected_project_deletion"
        ).first()
        if not setting or setting.value != "true":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Este projeto esta protegido contra exclusao. "
                       "Ative 'Permitir exclusao de projetos protegidos' "
                       "nas Configuracoes para excluir."
            )

    project_id = project.id
    project_name = project.name or str(project_id)[:8]
    logger.info(f"Deleting project '{project_name}' ({project_id}) - full cascade cleanup")

    # Step 1: Cancel and delete ALL async_jobs + job_log_entries for this project
    try:
        # Mark running/pending jobs as cancelled so they won't re-queue
        active_jobs = db.query(AsyncJob).filter(
            AsyncJob.project_id == project_id,
            AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING])
        ).all()
        for job in active_jobs:
            job.status = JobStatus.FAILED
            job.error = "Projeto deletado"
            job.result = {"cancelled": True, "reason": "project_deleted"}
        if active_jobs:
            db.flush()
            logger.info(f"Cancelled {len(active_jobs)} active jobs for project {project_id}")
            # PROMPT #248 - Broadcast cancellation so frontend bell clears immediately
            from app.api.websocket import broadcast_job_event
            import asyncio
            for job in active_jobs:
                if not job.parent_job_id:  # Only root jobs notify bell
                    try:
                        loop = asyncio.get_running_loop()
                        loop.create_task(broadcast_job_event("job_failed", {
                            "job_id": str(job.id),
                            "job_type": job.job_type.value,
                            "status": "failed",
                            "error": "Projeto deletado",
                            "notification_title": job.notification_title,
                            "project_id": str(project_id),
                        }))
                    except Exception:
                        pass

        # Delete job_log_entries explicitly before jobs (async_jobs has no FK to projects)
        from app.models.job_log_entry import JobLogEntry
        job_ids = [j.id for j in db.query(AsyncJob.id).filter(
            AsyncJob.project_id == project_id
        ).all()]
        if job_ids:
            deleted_logs = db.query(JobLogEntry).filter(
                JobLogEntry.job_id.in_(job_ids)
            ).delete(synchronize_session='fetch')
            if deleted_logs:
                logger.info(f"Deleted {deleted_logs} job_log_entries for project {project_id}")

        # Delete ALL jobs for this project (completed, failed, etc.)
        deleted_jobs = db.query(AsyncJob).filter(
            AsyncJob.project_id == project_id
        ).delete(synchronize_session='fetch')
        logger.info(f"Deleted {deleted_jobs} total async_jobs for project {project_id}")
    except Exception as e:
        logger.warning(f"Failed to cleanup async_jobs: {e}")

    # Step 2: Delete ALL RAG documents for this project
    try:
        rag_service = RAGService(db)
        deleted_rag = rag_service.delete_by_project(project_id)
        logger.info(f"Deleted {deleted_rag} RAG documents for project {project_id}")
    except Exception as e:
        logger.warning(f"Failed to delete RAG documents: {e}")

    # Step 3: Delete project_analyses linked to this project
    try:
        from app.models.project_analysis import ProjectAnalysis
        deleted_analyses = db.query(ProjectAnalysis).filter(
            ProjectAnalysis.project_id == project_id
        ).delete(synchronize_session='fetch')
        if deleted_analyses:
            logger.info(f"Deleted {deleted_analyses} project_analyses for project {project_id}")
    except Exception as e:
        logger.warning(f"Failed to delete project_analyses: {e}")

    # Step 4: Delete prompt_templates linked to this project
    try:
        from app.models.prompt_template import PromptTemplate
        deleted_templates = db.query(PromptTemplate).filter(
            PromptTemplate.project_id == project_id
        ).delete(synchronize_session='fetch')
        if deleted_templates:
            logger.info(f"Deleted {deleted_templates} prompt_templates for project {project_id}")
    except Exception as e:
        logger.warning(f"Failed to delete prompt_templates: {e}")

    # Step 5: Clean up AI-generated wiki .md files from filesystem.
    # REGRA #0: Preserve human-edited pages (source: manual/enrichment).
    if project.code_path:
        wiki_dir = os.path.join(project.code_path, "satellite", "knowledge", "wiki")
        if os.path.isdir(wiki_dir):
            cleaned_files = 0
            preserved_files = 0
            for fname in os.listdir(wiki_dir):
                if not fname.endswith(".md"):
                    continue
                fpath = os.path.join(wiki_dir, fname)
                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        header = f.read(500)
                    if "source: manual" in header or "source: enrichment" in header:
                        preserved_files += 1
                        continue
                    os.remove(fpath)
                    cleaned_files += 1
                except Exception:
                    pass
            if cleaned_files or preserved_files:
                logger.info(
                    f"Wiki cleanup: {cleaned_files} ai_generated files removed, "
                    f"{preserved_files} human-edited files preserved (REGRA #0)"
                )

    # Step 5b: Clean up satellite/memory/ files (pipeline execution logs)
    if project.code_path:
        import shutil
        for subdir in ["memory", os.path.join("knowledge", "results")]:
            sat_dir = os.path.join(project.code_path, "satellite", subdir)
            if os.path.isdir(sat_dir):
                try:
                    file_count = sum(1 for f in os.listdir(sat_dir) if os.path.isfile(os.path.join(sat_dir, f)))
                    shutil.rmtree(sat_dir)
                    os.makedirs(sat_dir, exist_ok=True)  # Recreate empty dir
                    logger.info(f"Cleaned satellite/{subdir}/: {file_count} files removed")
                except Exception as e:
                    logger.warning(f"Failed to clean satellite/{subdir}/: {e}")

    logger.info(
        f"Project '{project_name}' disk cleanup complete "
        f"(code_path={project.code_path})"
    )

    # Step 6: Delete the project (CASCADE handles interviews, tasks, wiki, specs, etc.)
    db.delete(project)
    db.commit()
    logger.info(f"Project '{project_name}' ({project_id}) fully deleted")
    return None
