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
from app.services.consistency_validator import ConsistencyValidator
from app.services.codebase_indexer import CodebaseIndexer
from app.services.codebase_memory import CodebaseMemoryService
from app.services.job_manager import JobManager
from app.services.rag_service import RAGService
from app.services.pattern_discovery import PatternDiscoveryService
from app.models.spec import Spec, SpecScope
from app.models.system_settings import SystemSettings

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_SPECS_PER_PROJECT = 50


def _get_max_patterns(db: Session) -> int:
    """Read max_discovery_patterns from system_settings, default 20.
    Auto-creates the setting with default value if it doesn't exist."""
    setting = db.query(SystemSettings).filter(
        SystemSettings.key == "max_discovery_patterns"
    ).first()
    if not setting:
        setting = SystemSettings(
            key="max_discovery_patterns",
            value="20",
            description="Max patterns per discovery scan (default 20, cap 50 per project)"
        )
        db.add(setting)
        db.commit()
    return int(setting.value)


def _effective_max_patterns(db: Session, project_id) -> int:
    """Calculate effective max patterns considering the 50 specs cap."""
    max_patterns = _get_max_patterns(db)
    existing_count = db.query(Spec).filter(Spec.project_id == project_id).count()
    return max(0, min(max_patterns, MAX_SPECS_PER_PROJECT - existing_count))


# PROMPT #111 - Base path for mounted projects folder
PROJECTS_BASE_PATH = Path("/projects")


@router.get("/browse-folders")
async def browse_folders(
    path: str = Query("", description="Relative path within /projects to browse")
):
    """
    Browse folders within the mounted /projects directory.

    PROMPT #111 - Folder picker for project creation

    Returns a list of directories at the specified path.
    Path is relative to /projects (the mounted volume).

    Example:
    - GET /browse-folders?path= → lists /projects/*
    - GET /browse-folders?path=my-app → lists /projects/my-app/*
    """
    # Ensure base path exists
    if not PROJECTS_BASE_PATH.exists():
        return {
            "current_path": "/projects",
            "parent_path": None,
            "folders": [],
            "error": "Projects folder not mounted"
        }

    # Build full path (sanitize to prevent directory traversal)
    if path:
        # Remove leading slashes and normalize
        clean_path = path.lstrip("/").replace("..", "")
        full_path = PROJECTS_BASE_PATH / clean_path
    else:
        full_path = PROJECTS_BASE_PATH

    # Verify path is within /projects (prevent directory traversal)
    try:
        full_path = full_path.resolve()
        if not str(full_path).startswith(str(PROJECTS_BASE_PATH.resolve())):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid path: must be within /projects"
            )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid path"
        )

    if not full_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Path not found: {path}"
        )

    if not full_path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path is not a directory"
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
            detail="Permission denied to read directory"
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


def _sanitize_project_name(name: str) -> str:
    """
    Sanitize project name for filesystem usage.
    Converts to lowercase, replaces spaces/special chars with hyphens.
    """
    sanitized = name.lower()
    sanitized = re.sub(r'[^\w\s-]', '', sanitized)
    sanitized = re.sub(r'[\s_]+', '-', sanitized)
    sanitized = sanitized.strip('-')
    return sanitized or 'project'


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
        "message": "Memory scan started...",
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
            detail=f"Invalid scan_depth '{scan_depth}'. Must be one of: {', '.join(valid_depths)}"
        )
    # Validate code_path
    path = Path(code_path)
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Code path does not exist: {code_path}"
        )
    if not path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Code path is not a directory: {code_path}"
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
        "message": f"Memory scan started ({scan_depth} mode). You can navigate freely - a notification will appear when complete.",
        "deep_link": deep_link,
        "notification_title": job.notification_title,
        "scan_depth": scan_depth
    }


async def _process_memory_scan_async(
    job_id: UUID,
    code_path: str,
    project_id: Optional[UUID],
    scan_depth: str = "normal"
):
    """
    Background task to process codebase memory scan.

    PROMPT #133 - Background jobs for memory scan
    PROMPT #163 - Now accepts scan_depth parameter for multi-phase analysis
    """
    from app.database import SessionLocal

    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        logger.info(f"🚀 Memory scan background task started for job {job_id} (depth={scan_depth})")

        # Get folder name for notification
        folder_name = Path(code_path).name

        job_manager.update_progress(job_id, 10.0, f"Starting {scan_depth} scan...")

        memory_service = CodebaseMemoryService(db)

        # PROMPT #168 - Progress callback for granular updates
        def progress_callback(percent: float, message: str):
            job_manager.update_progress(job_id, percent, message)

        # PROMPT #163 - Pass scan_depth to memory service
        # PROMPT #168 - Pass progress callback for granular updates
        result = await memory_service.scan_and_memorize(
            code_path=code_path,
            project_id=project_id,
            scan_depth=scan_depth,
            progress_callback=progress_callback
        )

        # PROMPT #202 - Discover specs and sync to RAG after memory scan
        if project_id:
            effective_max = _effective_max_patterns(db, project_id)
            if effective_max > 0:
                job_manager.update_progress(job_id, 90.0, "Discovering code patterns and generating specs...")
                try:
                    discovery_service = PatternDiscoveryService(db)
                    discovered_patterns = await discovery_service.discover_patterns(
                        project_path=Path(code_path),
                        project_id=project_id,
                        max_patterns=effective_max,
                        min_occurrences=2
                    )
                    logger.info(f"📋 Discovered {len(discovered_patterns)} patterns for project {project_id}")

                    from app.services.spec_rag_sync import SpecRAGSync
                    spec_sync = SpecRAGSync(db)
                    sync_result = spec_sync.sync_all_framework_specs()
                    logger.info(f"📡 Specs synced to RAG: {sync_result.get('synced', 0)} new, {sync_result.get('skipped', 0)} skipped")
                except Exception as e:
                    logger.warning(f"⚠️ Spec discovery/sync failed (non-blocking): {e}")
            else:
                logger.info(f"📋 Project {project_id} already has {MAX_SPECS_PER_PROJECT} specs, skipping discovery")

        job_manager.update_progress(job_id, 98.0, "Finalizing results...")

        # PROMPT #133 - Update notification_title for success
        job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if job:
            suggested_title = result.get("suggested_title", folder_name)
            job.notification_title = f"✅ Análise concluída: '{suggested_title}'"
            db.commit()

        job_manager.complete_job(job_id, result)
        logger.info(f"✅ Memory scan job {job_id} completed")

    except Exception as e:
        logger.error(f"❌ Memory scan job {job_id} failed: {str(e)}", exc_info=True)

        # PROMPT #133 - Update notification_title for failure
        try:
            job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
            if job:
                error_msg = str(e)[:80]
                job.notification_title = f"❌ Erro na análise: {error_msg}"
                db.commit()
        except Exception:
            pass

        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()


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
        "message": "Project created. Memory scan running in background."
    }
    ```
    """
    # Validate code_path
    path = Path(code_path)
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Code path does not exist: {code_path}"
        )
    if not path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Code path is not a directory: {code_path}"
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
        "message": "Project created. Memory scan running in background."
    }


async def _process_quick_create_scan(
    job_id: UUID,
    project_id: UUID,
    code_path: str,
    scan_depth: str = "normal"  # PROMPT #163
):
    """
    Background task for quick-create memory scan.

    PROMPT #137 - Updates project name with AI-suggested title.
    PROMPT #163 - Supports configurable scan_depth (quick/normal/deep).
    """
    from app.database import SessionLocal

    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        logger.info(f"🚀 Quick-create scan started for project {project_id}")

        folder_name = Path(code_path).name

        job_manager.update_progress(job_id, 10.0, "Scanning codebase structure...")

        memory_service = CodebaseMemoryService(db)

        job_manager.update_progress(job_id, 30.0, "Analyzing code and extracting patterns...")

        # PROMPT #163 - Pass scan_depth for configurable analysis depth
        result = await memory_service.scan_and_memorize(
            code_path=code_path,
            project_id=project_id,
            scan_depth=scan_depth
        )

        job_manager.update_progress(job_id, 80.0, "Updating project with findings...")

        # PROMPT #137 - Update project name with suggested title
        project = db.query(Project).filter(Project.id == project_id).first()
        if project:
            suggested_title = result.get("suggested_title")

            # Update name if we have a better suggestion
            folder_based_name = folder_name.replace("-", " ").replace("_", " ").title()
            if suggested_title and project.name == folder_based_name:
                project.name = suggested_title
                logger.info(f"📝 Updated project name to: {suggested_title}")

            # Store memory context for Context Interview
            project.initial_memory_context = result
            # PROMPT #222 - Signal that initial scan is done so Continuous RAG can start
            project.initial_scan_complete = True
            project.updated_at = datetime.utcnow()
            db.commit()

        # PROMPT #202 - Discover specs and sync to RAG after memory scan
        effective_max = _effective_max_patterns(db, project_id)
        if effective_max > 0:
            job_manager.update_progress(job_id, 85.0, "Discovering code patterns and generating specs...")
            try:
                discovery_service = PatternDiscoveryService(db)
                discovered_patterns = await discovery_service.discover_patterns(
                    project_path=Path(code_path),
                    project_id=project_id,
                    max_patterns=effective_max,
                    min_occurrences=2
                )
                logger.info(f"📋 Discovered {len(discovered_patterns)} patterns for project {project_id}")

                # Sync all project specs to RAG
                from app.services.spec_rag_sync import SpecRAGSync
                spec_sync = SpecRAGSync(db)
                sync_result = spec_sync.sync_all_framework_specs()
                logger.info(f"📡 Specs synced to RAG: {sync_result.get('synced', 0)} new, {sync_result.get('skipped', 0)} skipped")
            except Exception as e:
                logger.warning(f"⚠️ Spec discovery/sync failed (non-blocking): {e}")
        else:
            logger.info(f"📋 Project {project_id} already has {MAX_SPECS_PER_PROJECT} specs, skipping discovery")

        job_manager.update_progress(job_id, 95.0, "Finalizing...")

        # Update notification title for success
        job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if job:
            final_title = project.name if project else folder_name
            job.notification_title = f"✅ Projeto criado: '{final_title}'"
            db.commit()

        job_manager.complete_job(job_id, result)
        logger.info(f"✅ Quick-create scan completed for project {project_id}")

        # PROMPT #153 - Trigger background card generation after memory scan
        # This generates business rule cards and suggested epics in background
        try:
            logger.info(f"🚀 Starting background card generation for project {project_id}")
            cards_job = job_manager.create_job(
                job_type=JobType.CARDS_FROM_MEMORY,
                input_data={
                    "project_id": str(project_id)
                },
                project_id=project_id,
                deep_link=f"/projects/{project_id}/backlog",
                notification_title=f"Gerando cards para '{project.name if project else 'projeto'}'..."
            )
            # Launch card generation in background via priority queue
            from app.services.job_executor import PriorityJobExecutor
            cards_executor = PriorityJobExecutor.get_instance()
            await cards_executor.submit(cards_job.priority, _process_cards_from_memory_async, cards_job.id, project_id)
        except Exception as e:
            logger.warning(f"⚠️ Failed to start card generation: {e}")
            # Don't fail the main job if card generation fails to start

    except Exception as e:
        logger.error(f"❌ Quick-create scan failed for project {project_id}: {str(e)}", exc_info=True)

        # Update notification title for failure
        try:
            job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
            if job:
                error_msg = str(e)[:80]
                job.notification_title = f"❌ Erro na análise: {error_msg}"
                db.commit()
        except Exception:
            pass

        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()


@router.post("/create-and-process")
async def create_and_process_project(
    code_path: str = Query(..., description="Absolute path to existing code folder"),
    scan_depth: str = Query("normal", description="Scan depth: quick, normal, or deep"),
    db: Session = Depends(get_db)
):
    """
    Create project and run full pipeline: scan + rich context + title.

    PROMPT #121 - Project Creation Redesign

    Pipeline steps:
    1. Validate code_path, create project with status=processing
    2. Background job runs:
       - 0-40%: CodebaseMemoryService.scan_and_memorize()
       - 40-85%: ContextGenerator.generate_rich_context_from_memory()
       - 85-95%: Title refinement from memory
       - 95-100%: Finalize → status=active

    **POST** `/api/v1/projects/create-and-process?code_path=/projects/my-app&scan_depth=normal`
    """
    # Validate scan_depth
    valid_depths = {"quick", "normal", "deep"}
    if scan_depth not in valid_depths:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid scan_depth '{scan_depth}'. Must be one of: {', '.join(valid_depths)}"
        )

    # Validate code_path
    path = Path(code_path)
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Code path does not exist: {code_path}"
        )
    if not path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Code path is not a directory: {code_path}"
        )

    # Use folder name as temporary title
    folder_name = path.name
    temp_name = folder_name.replace("-", " ").replace("_", " ").title()

    # Create project with processing status
    from app.models.project import ProjectStatus

    db_project = Project(
        name=temp_name,
        code_path=code_path,
        context_locked=False,
        status=ProjectStatus.processing,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )

    db.add(db_project)
    db.commit()
    db.refresh(db_project)

    logger.info(f"Created project '{temp_name}' (ID: {db_project.id}) status=processing")

    # Create single pipeline job
    job_manager = JobManager(db)

    job = job_manager.create_job(
        job_type=JobType.PROJECT_PIPELINE,
        input_data={
            "code_path": code_path,
            "project_id": str(db_project.id),
            "scan_depth": scan_depth
        },
        project_id=db_project.id,
        deep_link=f"/projects/{db_project.id}",
        notification_title=f"Processando '{folder_name}'..."
    )

    # Launch pipeline in background
    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(job.priority, _process_project_pipeline, job.id, db_project.id, code_path, scan_depth)

    return {
        "project": {
            "id": str(db_project.id),
            "name": db_project.name,
            "code_path": db_project.code_path,
            "status": "processing",
            "created_at": db_project.created_at.isoformat() if db_project.created_at else None,
        },
        "job_id": str(job.id),
        "status": "processing",
        "message": "Project created. Pipeline running in background."
    }


async def _process_project_pipeline(
    job_id: UUID,
    project_id: UUID,
    code_path: str,
    scan_depth: str = "normal"
):
    """
    Background pipeline: scan codebase → activate → start watchdog.

    PROMPT #241 - Fast project creation. Rich context deferred to watchdog.
    """
    from app.database import SessionLocal
    from app.models.project import ProjectStatus

    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        logger.info(f"Pipeline started for project {project_id}")

        folder_name = Path(code_path).name

        # === Step A: Memory Scan (0-80%) ===
        job_manager.update_progress(job_id, 5.0, "Iniciando varredura do codebase...")

        memory_service = CodebaseMemoryService(db)

        job_manager.update_progress(job_id, 15.0, "Analisando estrutura do codigo...")

        result = await memory_service.scan_and_memorize(
            code_path=code_path,
            project_id=project_id,
            scan_depth=scan_depth
        )

        job_manager.update_progress(job_id, 70.0, "Varredura concluida. Salvando resultados...")

        # Update project with scan results
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        suggested_title = result.get("suggested_title")
        folder_based_name = folder_name.replace("-", " ").replace("_", " ").title()
        if suggested_title and project.name == folder_based_name:
            project.name = suggested_title
            logger.info(f"Updated project name to: {suggested_title}")

        project.initial_memory_context = result
        project.initial_scan_complete = True
        # PROMPT #241: Set initial description from scan summary
        if not project.description:
            # interview_context is AI-generated text; scan_summary is a dict (stats only)
            summary = (result.get("interview_context") or "").strip()
            if not summary:
                # Build readable description from scan_summary dict
                scan_info = result.get("scan_summary", {})
                if isinstance(scan_info, dict) and scan_info:
                    langs = scan_info.get("languages", {})
                    lang_str = ", ".join(f"{k} ({v})" for k, v in sorted(langs.items(), key=lambda x: -x[1])[:5]) if langs else "N/A"
                    summary = (
                        f"Codebase with {scan_info.get('code_files', 0)} code files "
                        f"({scan_info.get('total_files', 0)} total). "
                        f"Languages: {lang_str}."
                    )
            if summary:
                project.description = summary[:2000]
        project.updated_at = datetime.utcnow()
        db.commit()

        # === Step B: Finalize (80-95%) ===
        job_manager.update_progress(job_id, 85.0, "Finalizando projeto...")

        project.status = ProjectStatus.active
        project.updated_at = datetime.utcnow()
        db.commit()

        # Update notification title
        job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if job:
            final_title = project.name if project else folder_name
            job.notification_title = f"Projeto pronto: '{final_title}'"
            db.commit()

        job_manager.complete_job(job_id, {
            "success": True,
            "project_id": str(project_id),
            "project_name": project.name if project else folder_name,
            "scan_depth": scan_depth
        })

        logger.info(f"Pipeline completed for project {project_id}")

        # === Step C: Start watchdog (PROMPT #241) ===
        try:
            from app.services.watchdog import submit_watchdog_cycle
            submit_watchdog_cycle(db, project_id)
            logger.info(f"Watchdog started for project {project_id}")
        except Exception as e:
            logger.warning(f"Watchdog start failed (non-blocking): {e}")

    except Exception as e:
        logger.error(f"Pipeline failed for project {project_id}: {str(e)}", exc_info=True)

        # Set project back to draft on failure
        try:
            project = db.query(Project).filter(Project.id == project_id).first()
            if project:
                project.status = ProjectStatus.draft
                db.commit()
        except Exception:
            pass

        # Update notification title for failure
        try:
            job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
            if job:
                error_msg = str(e)[:80]
                job.notification_title = f"Erro no pipeline: {error_msg}"
                db.commit()
        except Exception:
            pass

        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()


    # PROMPT #241: _run_post_pipeline_enrichment removed - replaced by watchdog service


async def _enrich_context_from_rag(db, project_id: UUID):
    """
    PROMPT #239 - Living Wiki: enrich project description from RAG findings.
    Only runs when context is NOT locked.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        return

    # Respect context_locked
    if project.context_locked:
        logger.info(f"Context locked for {project_id}, skipping wiki enrichment")
        return

    # Get business rules from RAG
    from sqlalchemy import text as sql_text
    result = db.execute(sql_text("""
        SELECT content FROM rag_documents
        WHERE project_id = :pid
        AND metadata->>'content_type' = 'business_rule'
        ORDER BY created_at DESC
        LIMIT 50
    """), {"pid": str(project_id)})
    rules = [row[0] for row in result.fetchall()]

    if not rules:
        logger.info(f"No RAG rules for {project_id}, skipping wiki enrichment")
        return

    # Use AI to enrich the description
    from app.services.ai_orchestrator import AIOrchestrator
    from app.prompts.loader import PromptLoader

    loader = PromptLoader()
    try:
        sys_prompt, usr_prompt = loader.render(
            "context/wiki_enrichment",
            {
                "project_name": project.name or "",
                "current_description": project.description or "",
                "current_context": project.context_human or "",
                "new_rules": "\n".join(f"- {r}" for r in rules),
                "stack_info": str(project.initial_memory_context.get("stack_info", {})) if project.initial_memory_context else "",
            },
        )
    except Exception as e:
        logger.warning(f"Wiki enrichment prompt not found: {e}")
        return

    orchestrator = AIOrchestrator(db)
    response = await orchestrator.execute(
        usage_type="memory",
        messages=[{"role": "user", "content": usr_prompt}],
        system_prompt=sys_prompt,
        max_tokens=4000,
        project_id=str(project_id),
        metadata={"type": "wiki_enrichment"},
    )

    enriched = response.get("content", "")
    if enriched and len(enriched) > 100:
        project.description = enriched
        project.updated_at = datetime.utcnow()
        db.commit()
        logger.info(f"Wiki enriched for project {project_id} ({len(enriched)} chars)")


async def _process_cards_from_memory_async(
    job_id: UUID,
    project_id: UUID
):
    """
    Background task to generate cards from memory scan.

    PROMPT #153 - Background Card Generation

    This task runs after the memory scan completes and generates:
    1. Business rule cards (closed) - rules verified in existing code
    2. Suggested epics (drafts) - new functionality to develop

    These cards are generated regardless of whether the user completes
    the Context Interview, allowing work to begin immediately.
    """
    from app.database import SessionLocal
    from app.services.context_generator import ContextGeneratorService

    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        logger.info(f"🚀 Card generation started for project {project_id}")

        job_manager.update_progress(job_id, 5.0, "Preparando geração de cards...")

        context_service = ContextGeneratorService(db)

        job_manager.update_progress(job_id, 10.0, "Gerando cards de regras de negócio...")

        # Extract epic_count from job input_data (default: 10)
        job_obj = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        epic_count = 10
        if job_obj and job_obj.input_data and isinstance(job_obj.input_data, dict):
            epic_count = job_obj.input_data.get("epic_count", 10)

        # PROMPT #155 - Pass job_manager and job_id for incremental epic generation
        result = await context_service.generate_cards_from_memory(
            project_id=project_id,
            job_manager=job_manager,
            job_id=job_id,
            epic_count=epic_count
        )

        job_manager.update_progress(job_id, 95.0, "Finalizando...")

        # Update notification title with results
        job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if job:
            business_count = len(result.get("business_rule_cards", []))
            epic_count = len(result.get("suggested_epics", []))

            if result.get("skipped"):
                job.notification_title = f"ℹ️ Cards já existem para este projeto"
            elif business_count > 0 or epic_count > 0:
                job.notification_title = f"✅ {business_count} regras + {epic_count} épicos gerados"
            else:
                job.notification_title = f"ℹ️ Nenhum card gerado (sem regras/épicos detectados)"

            db.commit()

        job_manager.complete_job(job_id, result)
        logger.info(f"✅ Card generation completed for project {project_id}")

    except Exception as e:
        logger.error(f"❌ Card generation failed for project {project_id}: {str(e)}", exc_info=True)

        # Update notification title for failure
        try:
            job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
            if job:
                error_msg = str(e)[:80]
                job.notification_title = f"❌ Erro na geração de cards: {error_msg}"
                db.commit()
        except Exception:
            pass

        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()


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
            detail=f"Code path does not exist: {project.code_path}"
        )
    if not code_path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Code path is not a directory: {project.code_path}"
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
    Delete a project.

    - **project_id**: UUID of the project to delete

    Note: This will cascade delete all related interviews, prompts, and tasks.
    Also deletes the project folder from backend/projects/

    PROMPT #97: Also cleans up interview questions from RAG.
    """
    # PROMPT #97 - Delete interview questions from RAG
    try:
        rag_service = RAGService(db)
        deleted_count = rag_service.delete_by_filter({
            "type": "interview_question",
            "project_id": str(project.id)
        })
        logger.info(f"✅ Deleted {deleted_count} interview questions from RAG for project {project.id}")
    except Exception as e:
        logger.warning(f"⚠️ Failed to delete interview questions from RAG: {e}")
        # Don't fail the request if RAG cleanup fails

    # Delete project folder
    try:
        import shutil
        # Use stored folder path from database
        if project.project_folder:
            projects_dir = Path("/projects")
            project_path = projects_dir / project.project_folder

            if project_path.exists():
                shutil.rmtree(project_path)
                logger.info(f"✅ Deleted project folder: {project_path}")
    except Exception as e:
        logger.warning(f"Failed to delete project folder: {e}")
        # Don't fail the request if folder deletion fails

    db.delete(project)
    db.commit()
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
            detail=f"Project {project_id} not found"
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
            "message": "Context locked successfully",
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
            detail=f"Project {project_id} not found"
        )

    if project.context_locked:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Context is already locked"
        )

    if not project.context_semantic:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot lock context: no context has been generated yet"
        )

    try:
        context_service = ContextGeneratorService(db)
        context_service.lock_context(project_id)

        # Refresh to get updated values
        db.refresh(project)

        return {
            "success": True,
            "message": "Context locked successfully",
            "context_locked_at": project.context_locked_at.isoformat()
        }

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.get("/{project_id}/consistency-report")
async def get_consistency_report(
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get consistency validation report for a project.

    Returns detailed information about consistency issues detected between tasks:
    - Summary: Total issues, breakdown by severity
    - Issues by category: Naming, imports, types, etc.
    - Recommendations: Actionable suggestions
    - Detailed issue list: All issues with fix suggestions

    **GET** `/api/v1/projects/{project_id}/consistency-report`

    **Response:**
    ```json
    {
        "summary": {
            "total_issues": 5,
            "critical": 2,
            "warnings": 3,
            "info": 0,
            "auto_fixable": 4
        },
        "issues_by_category": {
            "naming": 4,
            "import": 1
        },
        "issues_by_severity": {
            "critical": 2,
            "warning": 3,
            "info": 0
        },
        "recommendations": [
            "🔴 2 critical issues found. These MUST be fixed before deploying.",
            "💡 4 issues can be auto-fixed. Run auto-fix to resolve them automatically."
        ],
        "issues": [...]
    }
    ```
    """

    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    validator = ConsistencyValidator(db)
    report = validator.generate_report(str(project_id))

    return report


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
        "message": "Code indexing started"
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
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.project_folder:
        raise HTTPException(
            status_code=400,
            detail="Project has no project_folder configured. Cannot index code."
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
            detail=f"Code indexing failed: {str(e)}"
        )

    return {
        "job_id": str(job.id),
        "status": "completed",
        "message": "Code indexing completed",
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
        raise HTTPException(status_code=404, detail="Project not found")

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
        raise HTTPException(status_code=404, detail="Project not found")

    # Check if project has code_path configured
    if not project.code_path:
        raise HTTPException(
            status_code=400,
            detail="Project code_path not configured. Set the code_path before running discovery."
        )

    # Verify code_path exists
    code_path = Path(project.code_path)
    if not code_path.exists():
        raise HTTPException(
            status_code=400,
            detail=f"Code path does not exist: {project.code_path}"
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
            "message": f"Project already has {MAX_SPECS_PER_PROJECT} specs (maximum reached)"
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
            detail=f"Pattern discovery failed: {str(e)}"
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
        raise HTTPException(status_code=404, detail="Project not found")

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
        raise HTTPException(status_code=404, detail="Project not found")

    # Find spec
    spec = db.query(Spec).filter(
        Spec.id == spec_id,
        Spec.project_id == project_id
    ).first()

    if not spec:
        raise HTTPException(status_code=404, detail="Spec not found")

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
# CARD GENERATION ENDPOINTS - PROMPT #153
# ============================================================================

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
        "message": "Card generation started in background"
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
        raise HTTPException(status_code=404, detail="Project not found")

    # Check if project has memory context
    if not project.initial_memory_context:
        raise HTTPException(
            status_code=400,
            detail="Project has no memory context. Run a memory scan first."
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
        notification_title=f"Gerando {epic_count} épicos para '{project.name}'..."
    )

    # Launch card generation in background via priority queue
    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(job.priority, _process_cards_from_memory_async, job.id, project_id)

    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": "Card generation started in background. A notification will appear when complete.",
        "deep_link": f"/projects/{project_id}/backlog"
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
