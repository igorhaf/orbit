"""
Projects API - Scanning endpoints.
Memory scan, quick-create, code indexing, code stats, create-and-process.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import Optional
from uuid import UUID
from datetime import datetime
from pathlib import Path
import logging

from app.database import get_db
from app.models.project import Project
from app.models.async_job import AsyncJob, JobType, JobStatus
from app.services.job_manager import JobManager
from app.services.codebase_indexer import CodebaseIndexer
from app.services.project_service import (
    _process_memory_scan_async,
    _process_quick_create_scan,
    _process_initial_scan,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/scan-memory")
async def scan_codebase_memory(
    code_path: str = Query(..., description="Absolute path to the codebase folder"),
    project_id: Optional[UUID] = Query(None, description="Optional project ID for RAG storage"),
    scan_depth: str = Query("normal", description="Scan depth: quick, normal, or deep"),
    db: Session = Depends(get_db)
):
    """
    Scan a codebase and extract memory (business rules, features, context).

    PROMPT #118 - Initial codebase memory scan during project creation
    PROMPT #133 - Now runs as background job with notifications
    PROMPT #163 - Configurable scan depth for better quality with local models

    This endpoint creates a background job to scan the codebase.
    The user can navigate freely while the scan processes.
    A notification will appear when the scan completes.

    **POST** `/api/v1/projects/scan-memory?code_path=/projects/my-app&scan_depth=normal`

    **Query Parameters:**
    - `code_path` (required): Absolute path to the codebase folder
    - `project_id` (optional): Project UUID for storing results in RAG
    - `scan_depth` (optional): Depth of analysis - "quick", "normal" (default), or "deep"
      - quick: 30 files, 2 phases (~1-2 min)
      - normal: 100 files, 4 phases (~5-10 min)
      - deep: ALL files, N phases (~15-30+ min)

    **Response:**
    ```json
    {
        "job_id": "uuid-of-job",
        "status": "pending",
        "message": "Scan de memoria iniciado...",
        "deep_link": "/projects/new?projectId=xxx&step=1",
        "scan_depth": "normal"
    }
    ```

    Poll GET /api/v1/jobs/{job_id} for status and result.

    **Errors:**
    - 400: If code_path doesn't exist or is not a directory
    """
    # PROMPT #163 - Validate scan_depth
    valid_depths = {"quick", "normal", "deep"}
    if scan_depth not in valid_depths:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"scan_depth invalido '{scan_depth}'. Deve ser um de: {', '.join(valid_depths)}"
        )
    # Validate code_path
    path = Path(code_path)
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Caminho do codigo nao existe: {code_path}"
        )
    if not path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Caminho do codigo nao e um diretorio: {code_path}"
        )

    # PROMPT #285 - Concurrent scan guard: reject if scan already running for this project
    if project_id:
        from app.models.async_job import AsyncJob, JobStatus
        running_scan = db.query(AsyncJob).filter(
            AsyncJob.project_id == project_id,
            AsyncJob.job_type == JobType.MEMORY_SCAN,
            AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING])
        ).first()
        if running_scan:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Um scan ja esta em andamento para este projeto (job {running_scan.id}). "
                       f"Aguarde a conclusao antes de iniciar um novo scan."
            )

    # PROMPT #133 - Create background job for memory scan
    job_manager = JobManager(db)

    # Build deep link for notification
    if project_id:
        deep_link = f"/projects/new?projectId={project_id}&step=1"
    else:
        deep_link = "/projects/new"

    # Get folder name for notification title
    folder_name = path.name

    # PROMPT #163 - Include scan_depth in job input
    job = job_manager.create_job(
        job_type=JobType.MEMORY_SCAN,
        input_data={
            "code_path": code_path,
            "project_id": str(project_id) if project_id else None,
            "scan_depth": scan_depth
        },
        project_id=project_id,
        deep_link=deep_link,
        notification_title=f"Analisando codigo em '{folder_name}' ({scan_depth})..."
    )

    # Start background task via priority queue
    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(job.priority, _process_memory_scan_async, job.id, code_path, project_id, scan_depth)

    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": f"Scan de memoria iniciado (modo {scan_depth}). Voce pode navegar livremente - uma notificacao aparecera quando concluir.",
        "deep_link": deep_link,
        "notification_title": job.notification_title,
        "scan_depth": scan_depth
    }


@router.post("/quick-create")
async def quick_create_project(
    code_path: str = Query(..., description="Absolute path to existing code folder"),
    scan_depth: str = Query("normal", description="Scan depth: quick, normal, or deep"),
    db: Session = Depends(get_db)
):
    """
    Create project immediately when folder is selected.

    PROMPT #137 - Immediate Project Creation

    This endpoint:
    1. Validates code_path exists
    2. Creates project with temporary name based on folder name
    3. Starts memory scan job in background
    4. Returns project + job_id for tracking

    The memory scan will:
    - Analyze codebase structure
    - Suggest a better title (auto-update project name)
    - Extract business rules and key features
    - Store findings for Context Interview

    **POST** `/api/v1/projects/quick-create?code_path=/projects/my-app`

    **Response:**
    ```json
    {
        "project": { ... project data ... },
        "job_id": "uuid-of-memory-scan-job",
        "status": "created",
        "message": "Projeto criado. Scan de memoria rodando em segundo plano."
    }
    ```
    """
    # Validate code_path
    path = Path(code_path)
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Caminho do codigo nao existe: {code_path}"
        )
    if not path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Caminho do codigo nao e um diretorio: {code_path}"
        )

    # Use folder name as temporary title
    folder_name = path.name
    temp_name = folder_name.replace("-", " ").replace("_", " ").title()

    # Create project as draft (no context yet)
    from app.models.project import ProjectStatus

    db_project = Project(
        name=temp_name,
        code_path=code_path,
        context_locked=False,  # Draft status - needs Context Interview
        status=ProjectStatus.draft,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )

    db.add(db_project)
    db.commit()
    db.refresh(db_project)

    logger.info(f"Quick-created project '{temp_name}' (ID: {db_project.id}) with code_path: {code_path}")

    # Start memory scan in background
    job_manager = JobManager(db)

    deep_link = f"/projects/{db_project.id}"

    # PROMPT #163 - Validate scan_depth
    if scan_depth not in ["quick", "normal", "deep"]:
        scan_depth = "normal"

    job = job_manager.create_job(
        job_type=JobType.MEMORY_SCAN,
        input_data={
            "code_path": code_path,
            "project_id": str(db_project.id),
            "update_project_name": True,  # Flag to auto-update project name
            "scan_depth": scan_depth  # PROMPT #163
        },
        project_id=db_project.id,
        deep_link=deep_link,
        notification_title=f"Analisando '{folder_name}' ({scan_depth})..."
    )

    # Launch background task that will update project with results
    # PROMPT #163 - Pass scan_depth to background task
    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(job.priority, _process_quick_create_scan, job.id, db_project.id, code_path, scan_depth)

    return {
        "project": {
            "id": str(db_project.id),
            "name": db_project.name,
            "code_path": db_project.code_path,
            "context_locked": db_project.context_locked,
            "status": db_project.status.value if db_project.status else "draft",
            "created_at": db_project.created_at.isoformat() if db_project.created_at else None,
        },
        "job_id": str(job.id),
        "status": "created",
        "message": "Projeto criado. Scan de memoria rodando em segundo plano."
    }


@router.post("/create-and-process")
async def create_and_process_project(
    code_path: str = Query(..., description="Absolute path to existing code folder"),
    scan_depth: str = Query("normal", description="Scan depth: quick, normal, or deep"),
    name: Optional[str] = Query(None, description="Project name (default: folder name)"),
    description: Optional[str] = Query(None, description="Project description"),
    db: Session = Depends(get_db)
):
    """
    Create project and start background enrichment jobs.

    PROMPT #301 - Non-blocking progressive project creation.

    1. Creates project immediately with status=active (folder name as title)
    2. Submits MEMORY_SCAN job in background
    3. When scan completes, submits wiki/cards/batch jobs individually
    4. Project is immediately navigable; data fills in progressively

    **POST** `/api/v1/projects/create-and-process?code_path=/projects/my-app&scan_depth=normal`
    """
    # Validate scan_depth
    valid_depths = {"quick", "normal", "deep"}
    if scan_depth not in valid_depths:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"scan_depth invalido '{scan_depth}'. Deve ser um de: {', '.join(valid_depths)}"
        )

    # Validate code_path - only reject if it exists but is a file
    # (PROMPT #235: if it doesn't exist, it will be created with .satellite + .orbit/ structure)
    path = Path(code_path)
    if path.exists() and not path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Caminho do codigo nao e um diretorio: {code_path}"
        )

    # PROMPT #239 - Use provided name or fall back to folder name
    folder_name = path.name
    temp_name = name.strip() if name and name.strip() else folder_name.replace("-", " ").replace("_", " ").title()

    # PROMPT #235 - Initialize .satellite + .orbit/ structure (creates code_path if needed)
    from app.services.project_service import initialize_project_knowledge_base
    initialize_project_knowledge_base(code_path, temp_name)

    # PROMPT #232 - IC-5 fix: Start as draft, promote to active on scan success
    from app.models.project import ProjectStatus

    db_project = Project(
        name=temp_name,
        description=description.strip() if description and description.strip() else None,
        code_path=code_path,
        context_locked=False,
        status=ProjectStatus.active,
        scan_depth=scan_depth,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )

    db.add(db_project)
    db.commit()
    db.refresh(db_project)

    logger.info(f"Created project '{temp_name}' (ID: {db_project.id}) status=active")

    # No automatic MEMORY_SCAN -- Deep Pipeline handles all enrichment.
    # User triggers Deep Pipeline manually from the project page.

    return {
        "project": {
            "id": str(db_project.id),
            "name": db_project.name,
            "code_path": db_project.code_path,
            "status": "active",
            "created_at": db_project.created_at.isoformat() if db_project.created_at else None,
        },
        "job_id": None,
        "status": "active",
        "message": "Projeto criado. Execute o Deep Pipeline para analisar o codebase."
    }


@router.post("/{project_id}/index-code")
async def index_project_code(
    project_id: UUID,
    force: bool = Query(False, description="Force re-indexing of all files"),
    db: Session = Depends(get_db)
):
    """
    Index project codebase for RAG-based context retrieval.

    PROMPT #89 - Code RAG Implementation

    Scans project folder recursively and indexes all code files in RAG.
    This enables context-aware code generation during task execution.

    Runs as background job for large projects.

    **POST** `/api/v1/projects/{project_id}/index-code?force=false`

    **Query Parameters:**
    - `force` (bool): If true, re-index all files even if unchanged

    **Response:**
    ```json
    {
        "job_id": "uuid",
        "status": "pending",
        "message": "Indexacao de codigo iniciada"
    }
    ```

    **After completion, job result contains:**
    ```json
    {
        "project_id": "uuid",
        "files_scanned": 150,
        "files_indexed": 145,
        "files_skipped": 5,
        "languages": {"php": 80, "typescript": 50, "css": 15},
        "total_lines": 12500
    }
    ```
    """

    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto nao encontrado")

    if not project.project_folder:
        raise HTTPException(
            status_code=400,
            detail="Projeto nao tem project_folder configurado. Nao e possivel indexar codigo."
        )

    # Create background job
    job_manager = JobManager(db)

    job = job_manager.create_job(
        job_type="code_indexing",
        project_id=project_id,
        metadata={
            "force": force,
            "project_folder": project.project_folder
        }
    )

    # Start indexing in background
    # (In production, this would be picked up by a worker process)
    # For now, we'll execute it asynchronously
    indexer = CodebaseIndexer(db)

    try:
        result = await indexer.index_project(project_id, force=force)

        # Update job with result
        job_manager.complete_job(
            job_id=job.id,
            result=result
        )

    except Exception as e:
        logger.error(f"Code indexing failed for project {project_id}: {e}")
        job_manager.fail_job(
            job_id=job.id,
            error_message=str(e)
        )

        raise HTTPException(
            status_code=500,
            detail=f"Indexacao de codigo falhou: {str(e)}"
        )

    return {
        "job_id": str(job.id),
        "status": "completed",
        "message": "Indexacao de codigo concluida",
        "result": result
    }

@router.get("/{project_id}/code-stats")
async def get_code_indexing_stats(
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get code indexing statistics for project.

    PROMPT #89 - Code RAG Implementation

    Returns statistics about indexed code files in RAG.

    **GET** `/api/v1/projects/{project_id}/code-stats`

    **Response:**
    ```json
    {
        "project_id": "uuid",
        "total_documents": 145,
        "avg_content_length": 1250.5,
        "document_types": ["code_file", "interview_answer"]
    }
    ```
    """

    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto nao encontrado")

    indexer = CodebaseIndexer(db)
    stats = await indexer.get_indexing_stats(project_id)

    return stats
