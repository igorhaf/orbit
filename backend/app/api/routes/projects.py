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

from app.database import get_db
from app.models.project import Project
from app.models.interview import Interview
from app.models.prompt import Prompt
from app.models.task import Task
from app.schemas.project import ProjectCreate, ProjectUpdate, ProjectResponse
from app.api.dependencies import get_project_or_404
from app.services.consistency_validator import ConsistencyValidator
from app.services.codebase_indexer import CodebaseIndexer
from app.services.job_manager import JobManager
from app.services.rag_service import RAGService
from app.services.pattern_discovery import PatternDiscoveryService
from app.models.spec import Spec, SpecScope

logger = logging.getLogger(__name__)

router = APIRouter()


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

    - **name**: Project name (required, max 255 characters)
    - **description**: Project description (optional)
    - **git_repository_info**: Git repository information as JSON (optional)

    Creates:
    - Database record for the project
    - Empty project folder in backend/projects/{sanitized-name}/
    """
    # Create new project instance
    db_project = Project(
        name=project.name,
        description=project.description,
        git_repository_info=project.git_repository_info,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )

    db.add(db_project)
    db.commit()
    db.refresh(db_project)

    # Create project folder (empty, will be populated during provisioning)
    try:
        sanitized_name = _sanitize_project_name(project.name)
        # Projects created in /projects/ (mounted from ./projects/ on host)
        projects_dir = Path("/projects")
        projects_dir.mkdir(exist_ok=True)

        project_path = projects_dir / sanitized_name
        project_path.mkdir(exist_ok=True)

        # Save folder path to database
        db_project.project_folder = sanitized_name
        db.commit()
        db.refresh(db_project)

        logger.info(f"✅ Created project folder: {project_path}")
    except Exception as e:
        logger.warning(f"Failed to create project folder: {e}")
        # Don't fail the request if folder creation fails

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
    max_patterns: int = Query(20, ge=1, le=50, description="Maximum patterns to discover"),
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

    # Run pattern discovery
    discovery_service = PatternDiscoveryService(db)

    try:
        patterns = await discovery_service.discover_patterns(
            project_path=code_path,
            project_id=project_id,
            max_patterns=max_patterns,
            min_occurrences=min_occurrences
        )

        return {
            "project_id": str(project_id),
            "discovered_count": len(patterns),
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
