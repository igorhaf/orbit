"""
Projects API Router
CRUD operations for managing projects.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from pathlib import Path
import os
import re
import logging

import asyncio

from app.database import get_db
from app.models.project import Project
from app.models.interview import Interview
from app.models.prompt import Prompt
from app.models.task import Task
from app.models.async_job import AsyncJob, JobType, JobStatus  # PROMPT #133
from app.schemas.project import ProjectCreate, ProjectUpdate, ProjectResponse
from app.api.dependencies import get_project_or_404
from app.services.codebase_indexer import CodebaseIndexer
from app.services.codebase_memory import CodebaseMemoryService
from app.services.job_manager import JobManager
from app.services.rag_service import RAGService
from app.services.pattern_discovery import PatternDiscoveryService
from app.models.spec import Spec, SpecScope
from app.models.system_settings import SystemSettings

logger = logging.getLogger(__name__)

router = APIRouter()

# Business logic extracted to project_service.py (PROMPT #252 - Frente 4)
from app.services.project_service import (
    MAX_SPECS_PER_PROJECT,
    _get_max_patterns,
    _merge_memory_context,
    _effective_max_patterns,
    _sanitize_project_name,
    _process_memory_scan_async,
    _process_quick_create_scan,
    _process_initial_scan,
    _enrich_wiki_job,
    _enrich_context_from_rag,
    _process_cards_from_memory_async,
    _process_full_hierarchy_async,
    _process_description_async,  # PROMPT #241
)

# PROMPT #111 - Base path for projects folder (configurable via PROJECTS_BASE_PATH env var)
from app.config import settings as app_settings
PROJECTS_BASE_PATH = Path(app_settings.projects_base_path)


@router.get("/browse-folders")
async def browse_folders(
    path: str = Query("", description="Relative path within /projects to browse")
):
    """
    Browse folders starting from PROJECTS_BASE_PATH (default: user home).

    PROMPT #111 - Folder picker for project creation

    Returns a list of directories at the specified path.
    Path is relative to PROJECTS_BASE_PATH.

    Example:
    - GET /browse-folders?path= → lists PROJECTS_BASE_PATH/*
    - GET /browse-folders?path=my-app → lists PROJECTS_BASE_PATH/my-app/*
    """
    # Ensure base path exists
    if not PROJECTS_BASE_PATH.exists():
        return {
            "current_path": str(PROJECTS_BASE_PATH),
            "parent_path": None,
            "folders": [],
            "error": f"Pasta base nao encontrada: {PROJECTS_BASE_PATH}"
        }

    # Build full path (sanitize to prevent directory traversal)
    if path:
        # Remove leading slashes and normalize
        clean_path = path.lstrip("/").replace("..", "")
        full_path = PROJECTS_BASE_PATH / clean_path
    else:
        full_path = PROJECTS_BASE_PATH

    # Verify path is within PROJECTS_BASE_PATH (prevent directory traversal)
    try:
        full_path = full_path.resolve()
        if not str(full_path).startswith(str(PROJECTS_BASE_PATH.resolve())):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Caminho invalido: deve estar dentro de {PROJECTS_BASE_PATH}"
            )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Caminho invalido"
        )

    if not full_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Caminho nao encontrado: {path}"
        )

    if not full_path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Caminho nao e um diretorio"
        )

    # List directories only (not files)
    folders = []
    try:
        for item in sorted(full_path.iterdir()):
            if item.is_dir() and not item.name.startswith("."):
                # Check if it looks like a code project (has common project files)
                is_project = any(
                    (item / f).exists()
                    for f in ["package.json", "composer.json", "requirements.txt",
                              "Cargo.toml", "go.mod", "pom.xml", "build.gradle",
                              ".git", "src", "app", "lib"]
                )
                folders.append({
                    "name": item.name,
                    "path": str(item.relative_to(PROJECTS_BASE_PATH)),
                    "full_path": str(item),
                    "is_project": is_project
                })
    except PermissionError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permissão negada para ler diretório"
        )

    # Calculate parent path
    if full_path == PROJECTS_BASE_PATH:
        parent_path = None
    else:
        parent_rel = full_path.parent.relative_to(PROJECTS_BASE_PATH)
        parent_path = str(parent_rel) if str(parent_rel) != "." else ""

    return {
        "current_path": str(full_path),
        "relative_path": str(full_path.relative_to(PROJECTS_BASE_PATH)) if full_path != PROJECTS_BASE_PATH else "",
        "parent_path": parent_path,
        "folders": folders,
        "can_select": True  # This folder can be selected as project root
    }


@router.get("/browse-files")
async def browse_files(
    path: str = Query("", description="Relative path within /projects to browse")
):
    """
    Browse files and folders starting from PROJECTS_BASE_PATH (default: user home).

    Returns folders (for navigation) and files (for selection).
    Path is relative to PROJECTS_BASE_PATH.
    """
    if not PROJECTS_BASE_PATH.exists():
        return {
            "current_path": str(PROJECTS_BASE_PATH),
            "parent_path": None,
            "folders": [],
            "files": [],
            "error": f"Pasta base nao encontrada: {PROJECTS_BASE_PATH}"
        }

    if path:
        clean_path = path.lstrip("/").replace("..", "")
        full_path = PROJECTS_BASE_PATH / clean_path
    else:
        full_path = PROJECTS_BASE_PATH

    try:
        full_path = full_path.resolve()
        if not str(full_path).startswith(str(PROJECTS_BASE_PATH.resolve())):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Caminho invalido: deve estar dentro de {PROJECTS_BASE_PATH}"
            )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Caminho invalido"
        )

    if not full_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Caminho nao encontrado: {path}"
        )

    if not full_path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Caminho nao e um diretorio"
        )

    folders = []
    files = []
    try:
        for item in sorted(full_path.iterdir()):
            if item.name.startswith("."):
                continue
            if item.is_dir():
                folders.append({
                    "name": item.name,
                    "path": str(item.relative_to(PROJECTS_BASE_PATH)),
                    "full_path": str(item),
                })
            elif item.is_file():
                files.append({
                    "name": item.name,
                    "path": str(item.relative_to(PROJECTS_BASE_PATH)),
                    "full_path": str(item),
                    "extension": item.suffix,
                    "size": item.stat().st_size,
                })
    except PermissionError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permissão negada para ler diretório"
        )

    if full_path == PROJECTS_BASE_PATH:
        parent_path = None
    else:
        parent_rel = full_path.parent.relative_to(PROJECTS_BASE_PATH)
        parent_path = str(parent_rel) if str(parent_rel) != "." else ""

    return {
        "current_path": str(full_path),
        "relative_path": str(full_path.relative_to(PROJECTS_BASE_PATH)) if full_path != PROJECTS_BASE_PATH else "",
        "parent_path": parent_path,
        "folders": folders,
        "files": files,
    }

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
        "message": "Scan de memória iniciado...",
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
            detail=f"scan_depth inválido '{scan_depth}'. Deve ser um de: {', '.join(valid_depths)}"
        )
    # Validate code_path
    path = Path(code_path)
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Caminho do código não existe: {code_path}"
        )
    if not path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Caminho do código não é um diretório: {code_path}"
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
                       f"Aguarde a conclusão antes de iniciar um novo scan."
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
        notification_title=f"Analisando código em '{folder_name}' ({scan_depth})..."
    )

    # Start background task via priority queue
    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(job.priority, _process_memory_scan_async, job.id, code_path, project_id, scan_depth)

    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": f"Scan de memória iniciado (modo {scan_depth}). Você pode navegar livremente - uma notificação aparecera quando concluir.",
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
        "message": "Projeto criado. Scan de memória rodando em segundo plano."
    }
    ```
    """
    # Validate code_path
    path = Path(code_path)
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Caminho do código não existe: {code_path}"
        )
    if not path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Caminho do código não é um diretório: {code_path}"
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

    logger.info(f"✅ Quick-created project '{temp_name}' (ID: {db_project.id}) with code_path: {code_path}")

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
        "message": "Projeto criado. Scan de memória rodando em segundo plano."
    }


@router.post("/generate-title")
async def generate_project_title(
    body: dict,
    db: Session = Depends(get_db),
):
    """
    PROMPT #239 — Generate/reformulate a project title from the description using AI.

    **POST** `/api/v1/projects/generate-title`
    Body: `{"description": "...", "current_title": "..." (optional)}`
    Response: `{"title": "Generated title..."}`
    """
    desc = (body.get("description") or "").strip()
    if not desc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Campo 'description' é obrigatório",
        )

    try:
        from app.prompts.loader import PromptLoader
        from app.services.ai_orchestrator import AIOrchestrator

        loader = PromptLoader()
        variables = {"description": desc}
        current_title = (body.get("current_title") or "").strip()
        if current_title:
            variables["current_title"] = current_title

        system_prompt, user_prompt = loader.render(
            "projects/generate_title", variables
        )

        orchestrator = AIOrchestrator(db)
        response = await orchestrator.execute(
            usage_type="general",
            messages=[{"role": "user", "content": user_prompt}],
            system_prompt=system_prompt,
            max_tokens=500,
            metadata={"skip_context_build": True},
            disable_tools=True,
        )

        title = (response.get("content") or "").strip().strip('"').strip("'")
        return {"title": title}

    except Exception as e:
        logger.error(f"Failed to generate title: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Falha ao gerar título: {str(e)}",
        )


@router.post("/generate-description")
async def generate_project_description(
    body: dict,
    db: Session = Depends(get_db),
):
    """
    PROMPT #239 / #241 — Generate a short project description from the title using AI.
    Now uses PriorityJobExecutor (async job queue) with NORMAL priority.

    **POST** `/api/v1/projects/generate-description`
    Body: `{"title": "My Project", "project_id": "optional-uuid"}`
    Response: `{"job_id": "...", "status": "pending", ...}`
    """
    title = (body.get("title") or "").strip()
    project_id = body.get("project_id")
    if not title:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Campo 'title' é obrigatório",
        )

    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.DESCRIPTION_GENERATION,
        input_data={
            "action": "generate",
            "title": title,
            "project_id": project_id,
        },
        project_id=UUID(project_id) if project_id else None,
        notification_title=f"Gerando descrição — '{title[:40]}'"
    )

    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(
        job.priority,
        _process_description_async,
        job.id, "generate", title, None, project_id, 800,
    )

    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": "Geração de descrição enfileirada.",
    }


@router.post("/expand-description")
async def expand_project_description(
    body: dict,
    db: Session = Depends(get_db),
):
    """
    PROMPT #241 — Expand/detail an existing project description using AI.
    Now uses PriorityJobExecutor (async job queue) with NORMAL priority.

    **POST** `/api/v1/projects/expand-description`
    Body: `{"title": "...", "current_description": "...", "project_id": "optional-uuid"}`
    Response: `{"job_id": "...", "status": "pending", ...}`
    """
    title = (body.get("title") or "").strip()
    current_description = (body.get("current_description") or "").strip()
    project_id = body.get("project_id")
    if not current_description:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Campo 'current_description' é obrigatório",
        )

    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.DESCRIPTION_GENERATION,
        input_data={
            "action": "expand",
            "title": title,
            "current_description": current_description,
            "project_id": project_id,
        },
        project_id=UUID(project_id) if project_id else None,
        notification_title=f"Detalhando descrição — '{title[:40]}'"
    )

    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(
        job.priority,
        _process_description_async,
        job.id, "expand", title, current_description, project_id, 800,
    )

    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": "Expansão de descrição enfileirada.",
    }


@router.post("/summarize-description")
async def summarize_project_description(
    body: dict,
    db: Session = Depends(get_db),
):
    """
    PROMPT #241 — Summarize/condense an existing project description using AI.
    Now uses PriorityJobExecutor (async job queue) with NORMAL priority.

    **POST** `/api/v1/projects/summarize-description`
    Body: `{"title": "...", "current_description": "...", "project_id": "optional-uuid"}`
    Response: `{"job_id": "...", "status": "pending", ...}`
    """
    title = (body.get("title") or "").strip()
    current_description = (body.get("current_description") or "").strip()
    project_id = body.get("project_id")
    if not current_description:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Campo 'current_description' é obrigatório",
        )

    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.DESCRIPTION_GENERATION,
        input_data={
            "action": "summarize",
            "title": title,
            "current_description": current_description,
            "project_id": project_id,
        },
        project_id=UUID(project_id) if project_id else None,
        notification_title=f"Resumindo descrição — '{title[:40]}'"
    )

    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(
        job.priority,
        _process_description_async,
        job.id, "summarize", title, current_description, project_id, 500,
    )

    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": "Resumo de descrição enfileirado.",
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
            detail=f"scan_depth inválido '{scan_depth}'. Deve ser um de: {', '.join(valid_depths)}"
        )

    # Validate code_path - only reject if it exists but is a file
    # (PROMPT #235: if it doesn't exist, it will be created with satellite/ KB structure)
    path = Path(code_path)
    if path.exists() and not path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Caminho do código não é um diretório: {code_path}"
        )

    # PROMPT #239 - Use provided name or fall back to folder name
    folder_name = path.name
    temp_name = name.strip() if name and name.strip() else folder_name.replace("-", " ").replace("_", " ").title()

    # PROMPT #235 - Initialize satellite/ KB structure (creates code_path if needed)
    from app.services.project_service import initialize_project_knowledge_base
    initialize_project_knowledge_base(code_path, temp_name)

    # PROMPT #232 - IC-5 fix: Start as draft, promote to active on scan success
    from app.models.project import ProjectStatus

    db_project = Project(
        name=temp_name,
        description=description.strip() if description and description.strip() else None,
        code_path=code_path,
        context_locked=False,
        status=ProjectStatus.draft,
        scan_depth=scan_depth,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )

    db.add(db_project)
    db.commit()
    db.refresh(db_project)

    logger.info(f"Created project '{temp_name}' (ID: {db_project.id}) status=active (PROMPT #301)")

    # Submit MEMORY_SCAN as individual job (not monolithic pipeline)
    job_manager = JobManager(db)

    job = job_manager.create_job(
        job_type=JobType.MEMORY_SCAN,
        input_data={
            "code_path": code_path,
            "project_id": str(db_project.id),
            "scan_depth": scan_depth
        },
        project_id=db_project.id,
        deep_link=f"/projects/{db_project.id}",
        notification_title=f"Escaneando '{folder_name}'..."
    )

    # Launch scan in background - completion triggers dependent jobs
    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(job.priority, _process_initial_scan, job.id, db_project.id, code_path, scan_depth)

    return {
        "project": {
            "id": str(db_project.id),
            "name": db_project.name,
            "code_path": db_project.code_path,
            "status": "active",
            "created_at": db_project.created_at.isoformat() if db_project.created_at else None,
        },
        "job_id": str(job.id),
        "status": "active",
        "message": "Projeto criado. Expansao rodando em segundo plano."
    }


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

    PROMPT #111 - code_path é OBRIGATÓRIO e IMUTÁVEL

    - **name**: Project name (required, max 255 characters)
    - **code_path**: Path to existing code folder (REQUIRED, IMMUTABLE after creation)
    - **description**: Project description (optional)
    - **git_repository_info**: Git repository information as JSON (optional)

    Validates:
    - code_path must exist
    - code_path must be a directory

    Note: ORBIT focuses on analyzing existing code, not provisioning.
    """
    # PROMPT #111 - Validar que pasta existe e é um diretório
    code_path = Path(project.code_path)
    if not code_path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Caminho do código não existe: {project.code_path}"
        )
    if not code_path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Caminho do código não é um diretório: {project.code_path}"
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
            logger.info(f"🚀 Project will start as 'active' - detected existing code:")
            if has_business_rules:
                logger.info(f"   - {len(memory_ctx.get('business_rules', []))} business rules")
            if has_key_features:
                logger.info(f"   - {len(memory_ctx.get('key_features', []))} key features")

    # Create new project instance with code_path
    db_project = Project(
        name=project.name,
        description=project.description,
        git_repository_info=project.git_repository_info,
        code_path=project.code_path,  # PROMPT #111 - Obrigatório e imutável
        initial_memory_context=project.initial_memory_context,  # PROMPT #118 - Memory scan context
        status=initial_status,  # PROMPT #127 - Active if existing code detected
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )

    db.add(db_project)
    db.commit()
    db.refresh(db_project)

    logger.info(f"✅ Created project '{project.name}' with code_path: {project.code_path} (status: {initial_status.value})")

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

    # Debug logging
    print(f"🔧 PATCH /projects/{project.id}")
    print(f"📦 Update data keys: {list(update_data.keys())}")
    if 'description' in update_data:
        desc_preview = update_data['description'][:100] if update_data['description'] else 'None'
        print(f"📝 Description preview: {desc_preview}...")

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

@router.get("/{project_id}/summary")
async def get_project_summary(
    project: Project = Depends(get_project_or_404),
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
            detail=f"Projeto {project_id} não encontrado"
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
            detail=f"Projeto {project_id} não encontrado"
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
            detail="Não é possível bloquear contexto: nenhum contexto foi gerado ainda"
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
        "message": "Indexação de código iniciada"
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
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    if not project.project_folder:
        raise HTTPException(
            status_code=400,
            detail="Projeto não tem project_folder configurado. Não é possível indexar código."
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
            detail=f"Indexação de código falhou: {str(e)}"
        )

    return {
        "job_id": str(job.id),
        "status": "completed",
        "message": "Indexação de código concluida",
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
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    indexer = CodebaseIndexer(db)
    stats = await indexer.get_indexing_stats(project_id)

    return stats

@router.post("/{project_id}/discover-specs")
async def discover_project_specs(
    project_id: UUID,
    replace_existing: bool = Query(False, description="Delete existing specs before discovery"),
    max_patterns: Optional[int] = Query(None, ge=1, le=100, description="Maximum patterns to discover (uses system setting if not provided)"),
    min_occurrences: int = Query(3, ge=2, le=10, description="Minimum file occurrences for a pattern"),
    db: Session = Depends(get_db)
):
    """
    Discover and save project-specific code patterns.

    Project-Specific Specs: AI-powered pattern discovery

    Scans the project codebase, identifies repeating patterns,
    and saves them to the specs table for use during task execution.

    **POST** `/api/v1/projects/{project_id}/discover-specs`

    **Query Parameters:**
    - `replace_existing`: Delete existing specs before discovery (default: false)
    - `max_patterns`: Maximum patterns to discover (default: 20)
    - `min_occurrences`: Minimum file count to consider a pattern (default: 3)

    **Response:**
    ```json
    {
        "project_id": "uuid",
        "discovered_count": 15,
        "patterns": [
            {
                "title": "Controller Pattern",
                "category": "api",
                "confidence": 0.85
            }
        ]
    }
    ```
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    # Check if project has code_path configured
    if not project.code_path:
        raise HTTPException(
            status_code=400,
            detail="code_path do projeto não configurado. Configure o code_path antes de executar a descoberta."
        )

    # Verify code_path exists
    code_path = Path(project.code_path)
    if not code_path.exists():
        raise HTTPException(
            status_code=400,
            detail=f"Caminho do código não existe: {project.code_path}"
        )

    # Delete existing specs if requested
    if replace_existing:
        deleted_count = db.query(Spec).filter(
            Spec.project_id == project_id,
            Spec.scope == SpecScope.PROJECT
        ).delete()
        db.commit()
        logger.info(f"Deleted {deleted_count} existing specs for project {project_id}")

    # Calculate effective max patterns (cap at 50 per project)
    if max_patterns is None:
        effective_max = _effective_max_patterns(db, project_id)
    else:
        existing_count = db.query(Spec).filter(Spec.project_id == project_id).count()
        effective_max = max(0, min(max_patterns, MAX_SPECS_PER_PROJECT - existing_count))

    if effective_max <= 0:
        return {
            "project_id": str(project_id),
            "discovered_count": 0,
            "patterns": [],
            "message": f"Projeto ja possui {MAX_SPECS_PER_PROJECT} specs (máximo atingido)"
        }

    # Run pattern discovery
    discovery_service = PatternDiscoveryService(db)

    try:
        patterns = await discovery_service.discover_patterns(
            project_path=code_path,
            project_id=project_id,
            max_patterns=effective_max,
            min_occurrences=min_occurrences
        )

        # Sync discovered specs to RAG
        try:
            from app.services.spec_rag_sync import SpecRAGSync
            spec_sync = SpecRAGSync(db)
            sync_result = spec_sync.sync_all_framework_specs()
            logger.info(f"📡 Specs synced to RAG after manual discovery")
        except Exception as e:
            logger.warning(f"⚠️ RAG sync after discovery failed: {e}")

        return {
            "project_id": str(project_id),
            "discovered_count": len(patterns),
            "patterns_saved": len(patterns),
            "patterns": [
                {
                    "title": p.title,
                    "category": p.category,
                    "spec_type": p.spec_type,
                    "confidence": p.confidence_score,
                    "occurrences": p.occurrences,
                    "is_framework_worthy": p.is_framework_worthy
                }
                for p in patterns
            ]
        }

    except Exception as e:
        logger.error(f"Pattern discovery failed for project {project_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Descoberta de padrões falhou: {str(e)}"
        )

@router.get("/{project_id}/specs")
async def get_project_specs(
    project_id: UUID,
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    category: Optional[str] = Query(None, description="Filter by category"),
    db: Session = Depends(get_db)
):
    """
    Get all discovered specs for a project.

    Project-Specific Specs: List patterns stored in database

    **GET** `/api/v1/projects/{project_id}/specs`

    **Query Parameters:**
    - `is_active`: Filter by active status (optional)
    - `category`: Filter by category (optional)

    **Response:**
    ```json
    {
        "project_id": "uuid",
        "specs_count": 15,
        "specs": [
            {
                "id": "uuid",
                "title": "Controller Pattern",
                "category": "api",
                "spec_type": "controller",
                "language": "php",
                "is_active": true,
                "confidence": 0.85,
                "occurrences": 12,
                "created_at": "2026-01-18T10:00:00Z"
            }
        ]
    }
    ```
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    # Build query
    query = db.query(Spec).filter(
        Spec.project_id == project_id,
        Spec.scope == SpecScope.PROJECT
    )

    # Apply filters
    if is_active is not None:
        query = query.filter(Spec.is_active == is_active)
    if category:
        query = query.filter(Spec.category == category)

    # Order by created_at descending
    specs = query.order_by(Spec.created_at.desc()).all()

    return {
        "project_id": str(project_id),
        "specs_count": len(specs),
        "specs": [
            {
                "id": str(s.id),
                "title": s.title,
                "description": s.description,
                "category": s.category,
                "name": s.name,
                "spec_type": s.spec_type,
                "language": s.language,
                "is_active": s.is_active,
                "usage_count": s.usage_count,
                "confidence": s.discovery_metadata.get("confidence_score", 0) if s.discovery_metadata else 0,
                "occurrences": s.discovery_metadata.get("occurrences", 0) if s.discovery_metadata else 0,
                "key_characteristics": s.discovery_metadata.get("key_characteristics", []) if s.discovery_metadata else [],
                "created_at": s.created_at.isoformat() if s.created_at else None,
                "updated_at": s.updated_at.isoformat() if s.updated_at else None
            }
            for s in specs
        ]
    }

@router.patch("/{project_id}/specs/{spec_id}/toggle")
async def toggle_spec_active(
    project_id: UUID,
    spec_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Toggle a spec's active status.

    **PATCH** `/api/v1/projects/{project_id}/specs/{spec_id}/toggle`

    **Response:**
    ```json
    {
        "id": "uuid",
        "title": "Controller Pattern",
        "is_active": false
    }
    ```
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    # Find spec
    spec = db.query(Spec).filter(
        Spec.id == spec_id,
        Spec.project_id == project_id
    ).first()

    if not spec:
        raise HTTPException(status_code=404, detail="Spec não encontrada")

    # Toggle active status
    spec.is_active = not spec.is_active
    spec.updated_at = datetime.utcnow()
    db.commit()

    return {
        "id": str(spec.id),
        "title": spec.title,
        "is_active": spec.is_active
    }


# ============================================================================
# WIKI ENRICHMENT ENDPOINT - PROMPT #284
# ============================================================================

@router.post("/{project_id}/enrich-wiki")
async def enrich_wiki(
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    PROMPT #284 - Re-run wiki enrichment from RAG data.

    Re-generates all wiki pages from current RAG data (business rules,
    interview answers, scan summary, features). Useful after a re-scan
    when RAG has new data that should be reflected in the wiki.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    try:
        result = await _enrich_context_from_rag(db, project_id)
        if result:
            return {"status": "enriched", "message": "Páginas wiki regeneradas a partir dos dados RAG"}
        else:
            return {"status": "skipped", "message": "Nenhum dado RAG disponivel para expansao"}
    except Exception as e:
        logger.error(f"Wiki enrichment failed for {project_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Expansao wiki falhou: {str(e)[:200]}")

@router.post("/{project_id}/generate-cards")
async def generate_cards_from_memory(
    project_id: UUID,
    body: Optional[dict] = None,
    db: Session = Depends(get_db)
):
    """
    Generate cards (epics and business rules) from memory scan.

    PROMPT #153 - Manual trigger for card generation

    This endpoint manually triggers the generation of:
    1. Business rule cards (closed) - rules verified in existing code
    2. Suggested epics (drafts) - new functionality to develop

    This is useful when:
    - User abandoned the wizard before cards were generated
    - Cards need to be regenerated after a new memory scan
    - Testing/debugging card generation

    **POST** `/api/v1/projects/{project_id}/generate-cards`

    **Response:**
    ```json
    {
        "job_id": "uuid",
        "status": "pending",
        "message": "Geração de cards iniciada em segundo plano"
    }
    ```

    **After completion, job result contains:**
    ```json
    {
        "success": true,
        "business_rule_cards": [...],
        "suggested_epics": [...]
    }
    ```

    **Errors:**
    - 400: If project has no memory context
    - 404: If project not found
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    # PROMPT #242 - Check if RAG indexing is complete (not just memory context)
    if not project.initial_scan_complete:
        raise HTTPException(
            status_code=400,
            detail="A indexacao RAG ainda nao foi concluida. Aguarde o scan completar."
        )

    # PROMPT #242 - Block if RAG re-indexing is in progress
    active_rag = db.query(AsyncJob).filter(
        AsyncJob.project_id == project_id,
        AsyncJob.job_type == JobType.RAG_CONTINUOUS_SCAN,
        AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
    ).first()
    if active_rag:
        raise HTTPException(
            status_code=400,
            detail="Indexacao RAG em andamento. Aguarde a conclusao antes de gerar cards."
        )

    # Extract epic_count from request body (default: 10)
    epic_count = 10
    if body and isinstance(body, dict) and "epic_count" in body:
        epic_count = max(1, min(30, int(body["epic_count"])))

    # Create background job
    job_manager = JobManager(db)

    job = job_manager.create_job(
        job_type=JobType.CARDS_FROM_MEMORY,
        input_data={
            "project_id": str(project_id),
            "manual_trigger": True,
            "epic_count": epic_count
        },
        project_id=project_id,
        deep_link=f"/projects/{project_id}/backlog",
        notification_title=f"Gerando {epic_count} epicos para '{project.name}'..."
    )

    # Launch card generation in background via priority queue
    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(job.priority, _process_cards_from_memory_async, job.id, project_id)

    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": "Geração de cards iniciada em segundo plano. Uma notificação aparecera quando concluir.",
        "deep_link": f"/projects/{project_id}/backlog"
    }

@router.post("/{project_id}/generate-hierarchy")
async def generate_full_hierarchy(
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    PROMPT #237 - Generate full card hierarchy from project knowledge.

    One-click generation of the complete project backlog:
    Epics → Stories → Tasks → Subtasks

    Each level is processed sequentially, with individual items
    activated via the existing context_generator functions.

    No parameters needed — uses all project knowledge (memory context,
    RAG-extracted business rules, detected stack) to generate the hierarchy.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    # PROMPT #242 - Check if RAG indexing is complete
    if not project.initial_scan_complete:
        raise HTTPException(
            status_code=400,
            detail="A indexacao RAG ainda nao foi concluida. Aguarde o scan completar."
        )

    # PROMPT #242 - Block if RAG re-indexing is in progress
    active_rag = db.query(AsyncJob).filter(
        AsyncJob.project_id == project_id,
        AsyncJob.job_type == JobType.RAG_CONTINUOUS_SCAN,
        AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
    ).first()
    if active_rag:
        raise HTTPException(
            status_code=400,
            detail="Indexacao RAG em andamento. Aguarde a conclusao antes de gerar cards."
        )

    # Check for existing epics (exclude business_rule epics from system)
    from app.models.task import ItemType
    existing_epics = db.query(Task).filter(
        Task.project_id == project_id,
        Task.item_type == ItemType.EPIC,
        ~Task.labels.contains(["business_rule"]),
    ).count()
    if existing_epics > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Projeto já possui {existing_epics} epics. Delete-os antes de gerar novamente."
        )

    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.CARDS_FROM_MEMORY,
        input_data={
            "project_id": str(project_id),
            "full_hierarchy": True,
        },
        project_id=project_id,
        deep_link=f"/projects/{project_id}",
        notification_title=f"Gerando hierarquia - '{project.name}'"
    )

    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(job.priority, _process_full_hierarchy_async, job.id, project_id)

    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": "Geração de hierarquia iniciada. Acompanhe pelo sininho de notificações.",
    }


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

    logger.info(f"🧹 Cleaned up {len(deleted_projects)} incomplete projects")

    return {
        "deleted_count": len(deleted_projects),
        "deleted_projects": deleted_projects
    }
