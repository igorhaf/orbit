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
    """
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
