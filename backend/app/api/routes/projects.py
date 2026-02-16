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


def _merge_memory_context(existing: dict, new_scan: dict) -> dict:
    """
    PROMPT #285 - Smart merge of memory context to prevent data loss on re-scan.

    Strategy:
    - List fields (business_rules, key_features, entities): union with dedup
    - Scalar fields (suggested_title, scan_summary, stack_info): new scan wins
      (these are factual observations that improve with each scan)
    - Preserves any keys from existing that new scan doesn't produce

    This ensures manually-added rules are never lost during re-scan.
    """
    if not existing:
        return new_scan
    if not new_scan:
        return existing

    merged = dict(existing)

    # List fields: merge with case-insensitive dedup
    list_fields = ["business_rules", "key_features", "entities"]
    for field in list_fields:
        old_items = existing.get(field, [])
        new_items = new_scan.get(field, [])
        if not isinstance(old_items, list):
            old_items = []
        if not isinstance(new_items, list):
            new_items = []

        # Case-insensitive dedup using lowercase set
        seen = set()
        merged_list = []
        for item in new_items + old_items:
            key = str(item).strip().lower()
            if key and key not in seen:
                seen.add(key)
                merged_list.append(item)
        merged[field] = merged_list

    # Scalar/dict fields: new scan wins (more recent data)
    scalar_fields = [
        "suggested_title", "scan_summary", "stack_info",
        "interview_context", "detected_stack"
    ]
    for field in scalar_fields:
        if field in new_scan:
            merged[field] = new_scan[field]

    # Any other keys from new scan that aren't in merged yet
    for key, value in new_scan.items():
        if key not in merged:
            merged[key] = value

    return merged


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
            "error": "Pasta de projetos não montada"
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
                detail="Caminho inválido: deve estar dentro de /projects"
            )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Caminho inválido"
        )

    if not full_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Caminho não encontrado: {path}"
        )

    if not full_path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Caminho não é um diretório"
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
    Browse files and folders within the mounted /projects directory.

    Returns folders (for navigation) and files (for selection).
    Path is relative to /projects (the mounted volume).
    """
    if not PROJECTS_BASE_PATH.exists():
        return {
            "current_path": "/projects",
            "parent_path": None,
            "folders": [],
            "files": [],
            "error": "Pasta de projetos não montada"
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
                detail="Caminho inválido: deve estar dentro de /projects"
            )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Caminho inválido"
        )

    if not full_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Caminho não encontrado: {path}"
        )

    if not full_path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Caminho não é um diretório"
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

        job_manager.update_progress(job_id, 10.0, f"Iniciando scan {scan_depth}...")

        memory_service = CodebaseMemoryService(db)

        # PROMPT #168 - Progress callback for granular updates
        def progress_callback(percent: float, message: str):
            job_manager.update_progress(job_id, percent, message)

        # PROMPT #163 - Pass scan_depth to memory service
        # PROMPT #168 - Pass progress callback for granular updates
        # PROMPT #298 - Pass job_id for sub-job hierarchy
        result = await memory_service.scan_and_memorize(
            code_path=code_path,
            project_id=project_id,
            scan_depth=scan_depth,
            progress_callback=progress_callback,
            job_id=job_id
        )

        # PROMPT #284 - Write scan result back to project.initial_memory_context
        # PROMPT #285 - Merge with existing data instead of blind overwrite
        if project_id:
            project = db.query(Project).filter(Project.id == project_id).first()
            if project:
                # PROMPT #285 - Protect project name: only update if still default folder name
                suggested_title = result.get("suggested_title")
                if suggested_title and suggested_title != project.name:
                    folder_based_name = folder_name.replace("-", " ").replace("_", " ").title()
                    if project.name == folder_based_name:
                        project.name = suggested_title
                        logger.info(f"Updated project name to: {suggested_title}")
                    else:
                        logger.info(
                            f"Keeping user-modified project name '{project.name}' "
                            f"(scan suggested '{suggested_title}')"
                        )

                # PROMPT #285 - Smart merge: preserve existing data, add new findings
                existing_ctx = project.initial_memory_context or {}
                merged_ctx = _merge_memory_context(existing_ctx, result)
                project.initial_memory_context = merged_ctx
                project.initial_scan_complete = True
                project.scan_depth = scan_depth
                project.updated_at = datetime.utcnow()
                db.commit()
                logger.info(
                    f"Updated initial_memory_context (merged): "
                    f"rules={len(merged_ctx.get('business_rules', []))}, "
                    f"features={len(merged_ctx.get('key_features', []))}"
                )

                # PROMPT #284 - Enrich wiki from updated RAG data (like quick-create does)
                job_manager.update_progress(job_id, 82.0, "Enriquecendo wiki do projeto a partir dos achados do scan...")
                try:
                    await _enrich_context_from_rag(db, project_id)
                    logger.info(f"Wiki enrichment done for project {project_id}")
                except Exception as e:
                    logger.warning(f"Wiki enrichment failed (non-blocking): {e}")

                # PROMPT #284 - Trigger card generation from business rules (like quick-create does)
                job_manager.update_progress(job_id, 85.0, "Gerando cards a partir das regras de negocio...")
                try:
                    has_rules = bool(
                        result.get("business_rules")
                        and isinstance(result.get("business_rules"), list)
                        and len(result.get("business_rules", [])) > 0
                    )
                    if has_rules:
                        logger.info(f"Triggering card generation for project {project_id}")
                        cards_job = job_manager.create_job(
                            job_type=JobType.CARDS_FROM_MEMORY,
                            input_data={"project_id": str(project_id)},
                            project_id=project_id,
                            deep_link=f"/projects/{project_id}",
                            notification_title=f"Gerando cards para '{project.name}'..."
                        )
                        from app.services.job_executor import PriorityJobExecutor as CardExec
                        card_executor = CardExec.get_instance()
                        await card_executor.submit(cards_job.priority, _process_cards_from_memory_async, cards_job.id, project_id)
                        logger.info(f"Card generation job {cards_job.id} submitted for project {project_id}")
                    else:
                        logger.info(f"No business rules found for {project_id}, skipping card generation")
                except Exception as e:
                    logger.warning(f"Card generation trigger failed (non-blocking): {e}")

        # PROMPT #202 - Discover specs and sync to RAG after memory scan
        if project_id:
            effective_max = _effective_max_patterns(db, project_id)
            if effective_max > 0:
                job_manager.update_progress(job_id, 90.0, "Descobrindo padrões de código e gerando specs...")
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

        job_manager.update_progress(job_id, 98.0, "Finalizando resultados...")

        # PROMPT #133 - Update notification_title for success
        job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if job:
            suggested_title = result.get("suggested_title", folder_name)
            job.notification_title = f"✅ Análise concluida: '{suggested_title}'"
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

        job_manager.update_progress(job_id, 10.0, "Escaneando estrutura de código...")

        memory_service = CodebaseMemoryService(db)

        job_manager.update_progress(job_id, 30.0, "Analisando código e extraindo padrões...")

        # PROMPT #163 - Pass scan_depth for configurable analysis depth
        # PROMPT #298 - Pass job_id for sub-job hierarchy
        result = await memory_service.scan_and_memorize(
            code_path=code_path,
            project_id=project_id,
            scan_depth=scan_depth,
            job_id=job_id
        )

        job_manager.update_progress(job_id, 80.0, "Atualizando projeto com achados...")

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
            job_manager.update_progress(job_id, 85.0, "Descobrindo padrões de código e gerando specs...")
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

        job_manager.update_progress(job_id, 95.0, "Finalizando...")

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

    # PROMPT #301 - Create project as ACTIVE immediately
    from app.models.project import ProjectStatus

    db_project = Project(
        name=temp_name,
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
        "message": "Projeto criado. Enriquecimento rodando em segundo plano."
    }


async def _process_initial_scan(
    job_id: UUID,
    project_id: UUID,
    code_path: str,
    scan_depth: str = "normal"
):
    """
    PROMPT #301 - Non-blocking initial scan.

    Runs memory scan, updates project progressively, then submits
    independent follow-up jobs (wiki, cards, batch processing).
    Project is already active - this just enriches it.
    """
    from app.database import SessionLocal

    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        logger.info(f"Initial scan started for project {project_id}")

        folder_name = Path(code_path).name

        # === Step A: Memory Scan ===
        job_manager.update_progress(job_id, 5.0, "Iniciando scan do codebase...")

        memory_service = CodebaseMemoryService(db)

        job_manager.update_progress(job_id, 15.0, "Analisando estrutura de codigo...")

        result = await memory_service.scan_and_memorize(
            code_path=code_path,
            project_id=project_id,
            scan_depth=scan_depth,
            job_id=job_id
        )

        job_manager.update_progress(job_id, 80.0, "Scan concluido. Salvando resultados...")

        # === Step B: Update project with scan results ===
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        # Update title if scan found a better one
        suggested_title = result.get("suggested_title")
        folder_based_name = folder_name.replace("-", " ").replace("_", " ").title()
        if suggested_title and project.name == folder_based_name:
            project.name = suggested_title
            logger.info(f"Updated project name to: {suggested_title}")

        project.initial_memory_context = result
        project.initial_scan_complete = True

        # Set initial description from scan summary
        if not project.description:
            summary = (result.get("interview_context") or "").strip()
            if not summary:
                scan_info = result.get("scan_summary", {})
                if isinstance(scan_info, dict) and scan_info:
                    langs = scan_info.get("languages", {})
                    lang_str = ", ".join(f"{k} ({v})" for k, v in sorted(langs.items(), key=lambda x: -x[1])[:5]) if langs else "N/A"
                    summary = (
                        f"Codebase com {scan_info.get('code_files', 0)} arquivos de codigo "
                        f"({scan_info.get('total_files', 0)} total). "
                        f"Linguagens: {lang_str}."
                    )
            if summary:
                project.description = summary[:2000]

        project.updated_at = datetime.utcnow()
        db.commit()

        # Complete scan job
        job_manager.complete_job(job_id, {
            "success": True,
            "project_id": str(project_id),
            "project_name": project.name,
            "scan_depth": scan_depth
        })

        # Update notification
        job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if job:
            job.notification_title = f"Scan concluido: '{project.name}'"
            db.commit()

        logger.info(f"Initial scan completed for project {project_id}")

        # === Step C: Submit independent follow-up jobs ===
        from app.services.job_executor import PriorityJobExecutor
        executor = PriorityJobExecutor.get_instance()

        # C1: Wiki enrichment as independent job
        try:
            wiki_job = job_manager.create_job(
                job_type=JobType.WIKI_RULE_ENRICHMENT,
                input_data={"project_id": str(project_id)},
                project_id=project_id,
                deep_link=f"/projects/{project_id}",
                notification_title=f"Enriquecendo wiki de '{project.name}'..."
            )
            await executor.submit(wiki_job.priority, _enrich_wiki_job, wiki_job.id, project_id)
            logger.info(f"Wiki enrichment job {wiki_job.id} submitted for project {project_id}")
        except Exception as e:
            logger.warning(f"Wiki enrichment job submission failed (non-blocking): {e}")

        # C2: Card generation as independent job (if business rules found)
        try:
            has_rules = bool(
                result and isinstance(result, dict) and result.get("business_rules")
            )
            if has_rules:
                cards_job = job_manager.create_job(
                    job_type=JobType.CARDS_FROM_MEMORY,
                    input_data={"project_id": str(project_id)},
                    project_id=project_id,
                    deep_link=f"/projects/{project_id}",
                    notification_title=f"Gerando cards para '{project.name}'..."
                )
                await executor.submit(cards_job.priority, _process_cards_from_memory_async, cards_job.id, project_id)
                logger.info(f"Card generation job {cards_job.id} submitted for project {project_id}")
            else:
                logger.info(f"No business rules for {project_id}, skipping card generation")
        except Exception as e:
            logger.warning(f"Card generation trigger failed (non-blocking): {e}")

        # C3: Register remaining files and start batch processing / watchdog
        try:
            if scan_depth != "deep":
                from app.services.continuous_rag_service import ContinuousRAGService
                rag_service = ContinuousRAGService(db)
                await rag_service.scan_for_changes(project_id)
                logger.info(f"Registered remaining files for batch processing")

                from app.services.watchdog import submit_batch_processing_cycle
                batch_size = {"quick": 15, "normal": 30}.get(scan_depth, 20)
                submit_batch_processing_cycle(db, project_id, batch_size=batch_size)
                logger.info(f"Batch processing started (batch_size={batch_size})")
            else:
                from app.services.watchdog import submit_watchdog_cycle
                submit_watchdog_cycle(db, project_id)
                logger.info(f"Watchdog started for project {project_id} (deep scan)")
        except Exception as e:
            logger.warning(f"Post-scan job start failed (non-blocking): {e}")

    except Exception as e:
        logger.error(f"Initial scan failed for project {project_id}: {str(e)}", exc_info=True)

        # Update notification title for failure
        try:
            job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
            if job:
                error_msg = str(e)[:80]
                job.notification_title = f"Erro no scan: {error_msg}"
                db.commit()
        except Exception:
            pass

        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()


async def _enrich_wiki_job(job_id: UUID, project_id: UUID):
    """
    PROMPT #301 - Wiki enrichment as independent job.
    Wraps _enrich_context_from_rag in a job for granular tracking.
    """
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        job_manager.update_progress(job_id, 10.0, "Enriquecendo wiki do projeto...")

        enriched = await _enrich_context_from_rag(db, project_id)

        if enriched:
            job_manager.complete_job(job_id, {"enriched": True})
            # Update notification
            project = db.query(Project).filter(Project.id == project_id).first()
            job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
            if job and project:
                job.notification_title = f"Wiki enriquecida: '{project.name}'"
                db.commit()
            logger.info(f"Wiki enrichment job completed for project {project_id}")
        else:
            job_manager.complete_job(job_id, {"enriched": False, "reason": "Sem dados suficientes"})
            logger.info(f"Wiki enrichment skipped for {project_id} - no data")

    except Exception as e:
        logger.error(f"Wiki enrichment job failed for {project_id}: {e}", exc_info=True)
        try:
            job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
            if job:
                job.notification_title = f"Erro na wiki: {str(e)[:80]}"
                db.commit()
        except Exception:
            pass
        job_manager.fail_job(job_id, str(e))
    finally:
        db.close()


async def _enrich_context_from_rag(db, project_id: UUID) -> bool:
    """
    PROMPT #239 - Living Wiki: enrich project description from RAG findings.
    PROMPT #252 - Removed context_locked guard. Description evolves continuously.
    PROMPT #258 - Enriched with interview answers, scan summary, features.
    context_semantic and context_human remain immutable (managed by epic flow).
    Returns True if enrichment actually happened, False otherwise.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        return False

    # --- 1. Get business rules from RAG ---
    # PROMPT #266 - Increased from LIMIT 50 to 500 for wiki enrichment
    from sqlalchemy import text as sql_text
    result = db.execute(sql_text("""
        SELECT content FROM rag_documents
        WHERE project_id = :pid
        AND (metadata->>'content_type' = 'business_rule' OR metadata->>'type' = 'business_rule')
        ORDER BY created_at DESC
        LIMIT 500
    """), {"pid": str(project_id)})
    rules = [row[0] for row in result.fetchall()]

    # --- 2. Get interview answers from RAG ---
    interview_result = db.execute(sql_text("""
        SELECT content FROM rag_documents
        WHERE project_id = :pid
        AND (metadata->>'content_type' = 'interview_answer' OR metadata->>'type' = 'interview_answer')
        ORDER BY created_at DESC
        LIMIT 30
    """), {"pid": str(project_id)})
    interview_answers = [row[0] for row in interview_result.fetchall()]

    # --- 3. Extract scan_summary and features from initial_memory_context ---
    scan_summary = ""
    existing_features = ""
    stack_info = ""
    if project.initial_memory_context and isinstance(project.initial_memory_context, dict):
        mem = project.initial_memory_context

        # Stack info
        si = mem.get("stack_info", {})
        if si and isinstance(si, dict):
            parts = []
            if si.get("languages"):
                parts.append(f"Linguagens: {', '.join(si['languages']) if isinstance(si['languages'], list) else si['languages']}")
            if si.get("frameworks"):
                parts.append(f"Frameworks: {', '.join(si['frameworks']) if isinstance(si['frameworks'], list) else si['frameworks']}")
            if si.get("databases"):
                parts.append(f"Bancos: {', '.join(si['databases']) if isinstance(si['databases'], list) else si['databases']}")
            stack_info = "\n".join(parts) if parts else str(si)
        elif si:
            stack_info = str(si)

        # Scan summary
        ss = mem.get("scan_summary", {})
        if ss and isinstance(ss, dict):
            parts = []
            if ss.get("total_files"):
                parts.append(f"Total de arquivos: {ss['total_files']}")
            if ss.get("code_files"):
                parts.append(f"Arquivos de código: {ss['code_files']}")
            langs = ss.get("languages", {})
            if langs and isinstance(langs, dict):
                lang_str = ", ".join(f"{k} ({v})" for k, v in sorted(langs.items(), key=lambda x: -x[1])[:8])
                parts.append(f"Linguagens detectadas: {lang_str}")
            scan_summary = "\n".join(parts) if parts else str(ss)
        elif ss:
            scan_summary = str(ss)

        # Features
        feats = mem.get("key_features", [])
        if feats and isinstance(feats, list):
            existing_features = "\n".join(f"- {f}" for f in feats[:30])

    # --- 4. Check if we have ANY data to enrich ---
    has_rules = bool(rules)
    has_interviews = bool(interview_answers)
    has_scan = bool(scan_summary)
    has_features = bool(existing_features)

    if not has_rules and not has_interviews and not has_scan and not has_features:
        logger.info(f"No RAG data for {project_id}, skipping wiki enrichment")
        return False

    logger.info(
        f"Wiki enrichment data for {project_id}: "
        f"{len(rules)} rules, {len(interview_answers)} interview answers, "
        f"scan={'yes' if has_scan else 'no'}, features={'yes' if has_features else 'no'}"
    )

    # --- 5. Render prompt with all available data ---
    from app.services.ai_orchestrator import AIOrchestrator
    from app.prompts.loader import PromptLoader

    loader = PromptLoader()
    try:
        template_vars = {
            "project_name": project.name or "",
            "current_description": project.description or "",
            "current_context": project.context_human or "",
            "new_rules": "\n".join(f"- {r}" for r in rules) if rules else "",
            "stack_info": stack_info,
            "interview_context": "\n".join(f"- {a}" for a in interview_answers) if interview_answers else "",
            "scan_summary": scan_summary,
            "existing_features": existing_features,
        }
        sys_prompt, usr_prompt = loader.render("context/wiki_enrichment", template_vars)
    except Exception as e:
        logger.warning(f"Wiki enrichment prompt not found: {e}")
        return False

    # --- 6. Call AI to enrich ---
    orchestrator = AIOrchestrator(db)
    # PROMPT #268 - Increased from 6000 to 12000 to allow richer rule coverage
    response = await orchestrator.execute(
        usage_type="memory",
        messages=[{"role": "user", "content": usr_prompt}],
        system_prompt=sys_prompt,
        max_tokens=12000,
        project_id=str(project_id),
        metadata={"type": "wiki_enrichment", "skip_context_build": True},
    )

    enriched = response.get("content", "")
    if enriched and len(enriched) > 100:
        # PROMPT #277 - Validate AI response before saving as description
        # Reject hallucinated content (e.g., maze-generator.py code) that doesn't match expected structure
        expected_sections = ["visao geral", "stack", "arquitetura", "regras", "features", "integracoes"]
        enriched_lower = enriched.lower()
        has_valid_section = any(s in enriched_lower for s in expected_sections)
        if not has_valid_section:
            logger.warning(
                f"Wiki enrichment rejected for {project_id}: no valid sections found "
                f"({len(enriched)} chars, first 200: {enriched[:200]})"
            )
            return False

        project.description = enriched

        # PROMPT #281 - Sync project name from wiki enrichment title
        # PROMPT #285 - Only update name if it appears to be auto-generated (not user-edited).
        # Auto-generated names: folder-based ("My Project"), or scan-suggested titles.
        # If the user manually edited the name, we preserve it.
        try:
            first_line = enriched.strip().split("\n")[0].strip()
            if first_line.startswith("# "):
                wiki_title = first_line[2:].strip()
                if wiki_title and len(wiki_title) > 3:
                    old_name = project.name
                    # Check if current name looks auto-generated
                    code_path = project.code_path or ""
                    folder_name = Path(code_path).name if code_path else ""
                    auto_names = set()
                    if folder_name:
                        auto_names.add(folder_name.replace("-", " ").replace("_", " ").title())
                        auto_names.add(folder_name)
                    # Also consider scan-suggested title as auto-generated
                    mem = project.initial_memory_context or {}
                    if mem.get("suggested_title"):
                        auto_names.add(mem["suggested_title"])

                    if old_name in auto_names or not old_name:
                        project.name = wiki_title
                        logger.info(f"Project name synced from wiki: '{old_name}' -> '{wiki_title}'")
                    else:
                        logger.info(
                            f"Keeping user-set project name '{old_name}' "
                            f"(wiki suggested '{wiki_title}')"
                        )
        except Exception as e:
            logger.warning(f"Failed to extract title from wiki enrichment: {e}")

        project.updated_at = datetime.utcnow()
        db.commit()
        logger.info(f"Wiki enriched for project {project_id} ({len(enriched)} chars)")

        # PROMPT #265 - Parse AI-enriched markdown into separate wiki pages
        # The AI generates a structured markdown with ## sections (Visao Geral,
        # Stack Tecnologica, Arquitetura, Regras de Negocio, Features, Integracoes).
        # We parse each section into its own wiki page instead of dumping everything
        # into a single "Visao Geral" page.
        try:
            from app.api.routes.wiki import _upsert_wiki_page, _parse_wiki_sections

            sections = _parse_wiki_sections(enriched)

            order = 0
            for slug, (title, content) in sections.items():
                _upsert_wiki_page(db, project_id, slug, title, content, order, "enrichment")
                order += 1

            # Fallback: if parsing produced no sections, create single overview page
            if not sections:
                _upsert_wiki_page(db, project_id, "visao-geral", "Visao Geral", enriched, 0, "enrichment")

            # PROMPT #266/#268 - Raw rules catalog as separate reference page.
            # The AI enrichment creates the main "regras-de-negocio" page in Portuguese.
            # This raw catalog is a supplementary reference with ALL extracted rules.
            if rules:
                rules_md_parts = [
                    "## Catálogo de Referência - Regras Brutas\n",
                    f"Total de regras extraidas do codebase: **{len(rules)}**\n",
                    "Estas são as regras brutas extraidas automaticamente do código-fonte.",
                    "A página principal de Regras de Negocio contém a versão enriquecida e organizada.\n",
                ]
                for i, rule in enumerate(rules, 1):
                    rule_text = rule[:500] if len(rule) > 500 else rule
                    rules_md_parts.append(f"{i}. {rule_text}")
                rules_md = "\n".join(rules_md_parts)
                # PROMPT #277 - Set parent_id to regras-de-negocio to avoid appearing in sidebar
                from app.models.wiki_page import WikiPage as WikiPageModel
                regras_parent = (
                    db.query(WikiPageModel)
                    .filter(WikiPageModel.project_id == project_id, WikiPageModel.slug == "regras-de-negocio")
                    .first()
                )
                _upsert_wiki_page(
                    db, project_id, "regras-catálogo-bruto",
                    "Catálogo de Referência - Regras Brutas", rules_md,
                    12, "ai_generated",
                    parent_id=regras_parent.id if regras_parent else None,
                )
                logger.info(f"Wiki: raw rules catalog with {len(rules)} rules for project {project_id}")

            # PROMPT #267 - Generate wiki pages from ALL RAG data types
            from app.api.routes.wiki import (
                _build_architecture_patterns_page,
                _build_code_conventions_page,
                _build_ui_components_page,
                _build_code_structure_page,
                _build_git_history_page,
                _build_business_rules_wiki_pages,
            )
            page_builders = [
                ("padrões-arquitetura", "Padrões de Arquitetura", _build_architecture_patterns_page, 6),
                ("convencoes-código", "Convencoes de Código", _build_code_conventions_page, 7),
                ("componentes-interface", "Componentes e Interface", _build_ui_components_page, 8),
                ("estrutura-código", "Estrutura de Código", _build_code_structure_page, 9),
                ("histórico-desenvolvimento", "Histórico de Desenvolvimento", _build_git_history_page, 10),
            ]
            rag_pages_count = 0
            for slug, title, builder, order in page_builders:
                content = builder(db, project_id)
                if content:
                    _upsert_wiki_page(db, project_id, slug, title, content, order, "ai_generated")
                    rag_pages_count += 1
            if rag_pages_count:
                logger.info(f"Wiki: {rag_pages_count} RAG data pages for project {project_id}")

            # PROMPT #269 - Individual business rule wiki pages (hierarchical)
            rule_pages = _build_business_rules_wiki_pages(db, project_id)
            if rule_pages:
                logger.info(f"Wiki: {len(rule_pages)} business rule pages for project {project_id}")

            db.commit()

            # PROMPT #274 - Apply semantic hypertext linking
            try:
                from app.api.routes.wiki import _apply_semantic_links_to_project
                _apply_semantic_links_to_project(db, project_id)
            except Exception as e:
                logger.warning(f"Failed to apply semantic links: {e}")

            # PROMPT #270 - Auto-trigger AI enrichment for individual rule pages
            rule_page_count = len([p for p in rule_pages if p and p.slug.startswith("regra-")])
            if rule_page_count > 0:
                try:
                    from app.api.routes.wiki import _trigger_rule_enrichment_job
                    await _trigger_rule_enrichment_job(db, project_id, rule_page_count)
                except Exception as e:
                    logger.warning(f"Failed to trigger rule enrichment: {e}")
            logger.info(f"Wiki: {len(sections) or 1} pages from enriched content for project {project_id}")
        except Exception as e:
            logger.warning(f"Failed to parse wiki sections: {e}")

        return True

    logger.info(f"Wiki enrichment response too short for {project_id}, skipping")
    return False


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

        job_manager.update_progress(job_id, 10.0, "Gerando cards de regras de negocio...")

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
                job.notification_title = f"ℹ️ Cards ja existem para este projeto"
            elif business_count > 0 or epic_count > 0:
                job.notification_title = f"✅ {business_count} regras + {epic_count} epicos gerados"
            else:
                job.notification_title = f"ℹ️ Nenhum card gerado (nenhuma regra/epico detectado)"

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
    project_id = project.id
    project_name = project.name or str(project_id)[:8]
    logger.info(f"Deleting project '{project_name}' ({project_id}) - full cascade cleanup")

    # Step 1: Cancel and delete ALL async_jobs for this project
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

    # Step 5: Delete project folder from disk
    try:
        import shutil
        if project.project_folder:
            projects_dir = Path("/projects")
            project_path = projects_dir / project.project_folder
            if project_path.exists():
                shutil.rmtree(project_path)
                logger.info(f"Deleted project folder: {project_path}")
    except Exception as e:
        logger.warning(f"Failed to delete project folder: {e}")

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
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

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
            return {"status": "skipped", "message": "Nenhum dado RAG disponível para enriquecimento"}
    except Exception as e:
        logger.error(f"Wiki enrichment failed for {project_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Enriquecimento wiki falhou: {str(e)[:200]}")


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

    # Check if project has memory context
    if not project.initial_memory_context:
        raise HTTPException(
            status_code=400,
            detail="Projeto não tem contexto de memória. Execute um scan de memória primeiro."
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
