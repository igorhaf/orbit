"""
Commits API Router
CRUD operations for managing conventional commits.
PROMPT #108 - Moved generation to background queue
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel

from app.database import get_db
from app.models.commit import Commit, CommitType
from app.models.async_job import JobType
from app.schemas.commit import CommitCreate, CommitResponse, CommitManualGenerateRequest
from app.api.dependencies import get_commit_or_404
from app.services.job_manager import JobManager
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


# PROMPT #108 - Response model for background job
class CommitJobResponse(BaseModel):
    """Response model for async commit generation job."""
    job_id: str
    status: str
    message: str


@router.get("/", response_model=List[CommitResponse])
async def list_commits(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    project_id: Optional[UUID] = Query(None, description="Filter by project ID"),
    task_id: Optional[UUID] = Query(None, description="Filter by task ID"),
    type: Optional[CommitType] = Query(None, description="Filter by commit type"),
    db: Session = Depends(get_db)
):
    """
    List all commits with filtering.

    - **project_id**: Filter by project
    - **task_id**: Filter by task
    - **type**: Filter by commit type (feat, fix, docs, etc)
    """
    query = db.query(Commit)

    if project_id:
        query = query.filter(Commit.project_id == project_id)
    if task_id:
        query = query.filter(Commit.task_id == task_id)
    if type:
        query = query.filter(Commit.type == type)

    commits = query.order_by(Commit.timestamp.desc()).offset(skip).limit(limit).all()

    return commits


@router.post("/", response_model=CommitResponse, status_code=status.HTTP_201_CREATED)
async def create_commit(
    commit_data: CommitCreate,
    db: Session = Depends(get_db)
):
    """
    Create a new commit record.

    - **task_id**: Task this commit is associated with (required)
    - **project_id**: Project this commit belongs to (required)
    - **type**: Commit type following Conventional Commits (required)
    - **message**: Commit message (required)
    - **changes**: Changes details as JSON (optional)
    - **created_by_ai_model**: AI model that created this commit (required)
    - **author**: Commit author (required)
    """
    db_commit = Commit(
        task_id=commit_data.task_id,
        project_id=commit_data.project_id,
        type=commit_data.type,
        message=commit_data.message,
        changes=commit_data.changes,
        created_by_ai_model=commit_data.created_by_ai_model,
        author=commit_data.author,
        timestamp=datetime.utcnow()
    )

    db.add(db_commit)
    db.commit()
    db.refresh(db_commit)

    return db_commit


@router.get("/{commit_id}", response_model=CommitResponse)
async def get_commit(
    commit: Commit = Depends(get_commit_or_404)
):
    """
    Get a specific commit by ID.

    - **commit_id**: UUID of the commit
    """
    return commit


@router.delete("/{commit_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_commit(
    commit: Commit = Depends(get_commit_or_404),
    db: Session = Depends(get_db)
):
    """
    Delete a commit.

    - **commit_id**: UUID of the commit to delete
    """
    db.delete(commit)
    db.commit()
    return None


@router.get("/project/{project_id}", response_model=List[CommitResponse])
async def get_commits_by_project(
    project_id: UUID,
    type: Optional[CommitType] = Query(None, description="Filter by commit type"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """
    Get all commits for a specific project.

    - **project_id**: UUID of the project
    - **type**: Filter by commit type (optional)
    """
    query = db.query(Commit).filter(Commit.project_id == project_id)

    if type:
        query = query.filter(Commit.type == type)

    commits = query.order_by(Commit.timestamp.desc()).offset(skip).limit(limit).all()

    return commits


@router.get("/task/{task_id}", response_model=List[CommitResponse])
async def get_commits_by_task(
    task_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get all commits for a specific task.

    - **task_id**: UUID of the task
    """
    commits = db.query(Commit).filter(
        Commit.task_id == task_id
    ).order_by(Commit.timestamp.desc()).all()

    return commits


@router.get("/types/statistics")
async def get_commit_type_statistics(
    project_id: Optional[UUID] = Query(None, description="Filter by project ID"),
    db: Session = Depends(get_db)
):
    """
    Get commit statistics grouped by type.

    - **project_id**: Filter by project (optional)
    """
    from sqlalchemy import func

    query = db.query(
        Commit.type,
        func.count(Commit.id).label('count')
    )

    if project_id:
        query = query.filter(Commit.project_id == project_id)

    stats = query.group_by(Commit.type).all()

    return {
        "statistics": [
            {"type": commit_type.value, "count": count}
            for commit_type, count in stats
        ],
        "total": sum(count for _, count in stats)
    }


@router.post("/auto-generate/{chat_session_id}", response_model=CommitJobResponse)
async def auto_generate_commit(
    chat_session_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Gera commit automaticamente a partir de uma chat session usando IA (Gemini) - ASYNC.

    PROMPT #108 - Moved to background queue

    Este endpoint agora roda assincronamente em background.
    Poll GET /api/v1/jobs/{job_id} para obter progresso e resultado.

    Returns immediately:
    {
        "job_id": "uuid",
        "status": "pending",
        "message": "Commit generation started. Poll GET /api/v1/jobs/{job_id} for progress."
    }
    """
    from app.models.chat_session import ChatSession

    # Buscar session para pegar task_id
    session = db.query(ChatSession).filter(
        ChatSession.id == chat_session_id
    ).first()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Chat session {chat_session_id} not found"
        )

    # Create job
    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.COMMIT_GENERATION,
        input_data={
            "operation": "auto_generate",
            "chat_session_id": str(chat_session_id),
            "task_id": str(session.task_id)
        },
        project_id=session.project_id if hasattr(session, 'project_id') else None
    )

    logger.info(f"Created commit generation job {job.id} for chat session {chat_session_id}")

    # Execute in background
    import asyncio
    asyncio.create_task(
        _generate_commit_auto_async(
            job_id=job.id,
            task_id=session.task_id,
            chat_session_id=chat_session_id
        )
    )

    # Return job_id immediately
    return CommitJobResponse(
        job_id=str(job.id),
        status="pending",
        message=f"Commit generation started. Poll GET /api/v1/jobs/{job.id} for progress."
    )


@router.post("/generate-manual/{task_id}", response_model=CommitJobResponse)
async def generate_manual_commit(
    task_id: UUID,
    commit_request: CommitManualGenerateRequest,
    db: Session = Depends(get_db)
):
    """
    Gera commit manualmente com descrição fornecida pelo usuário - ASYNC.

    PROMPT #108 - Moved to background queue

    Este endpoint agora roda assincronamente em background.
    Poll GET /api/v1/jobs/{job_id} para obter progresso e resultado.

    - **task_id**: UUID da task
    - **description**: Descrição das mudanças feitas

    Returns immediately:
    {
        "job_id": "uuid",
        "status": "pending",
        "message": "Commit generation started. Poll GET /api/v1/jobs/{job_id} for progress."
    }
    """
    from app.models.task import Task

    # Verify task exists
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task {task_id} not found"
        )

    # Create job
    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.COMMIT_GENERATION,
        input_data={
            "operation": "manual_generate",
            "task_id": str(task_id),
            "description": commit_request.description
        },
        project_id=task.project_id
    )

    logger.info(f"Created manual commit generation job {job.id} for task {task_id}")

    # Execute in background
    import asyncio
    asyncio.create_task(
        _generate_commit_manual_async(
            job_id=job.id,
            task_id=task_id,
            description=commit_request.description
        )
    )

    # Return job_id immediately
    return CommitJobResponse(
        job_id=str(job.id),
        status="pending",
        message=f"Commit generation started. Poll GET /api/v1/jobs/{job.id} for progress."
    )


# ============================================================================
# PROMPT #108 - BACKGROUND TASK FUNCTIONS
# ============================================================================

async def _generate_commit_auto_async(
    job_id: UUID,
    task_id: UUID,
    chat_session_id: UUID
):
    """
    Background task to auto-generate commit from chat session.

    PROMPT #108 - Background queue for prompt executions
    """
    from app.database import SessionLocal
    from app.services.commit_generator import CommitGenerator

    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        logger.info(f"🚀 Starting commit generation job {job_id} for chat session {chat_session_id}")

        job_manager.update_progress(job_id, 10.0, "Analyzing chat session...")

        generator = CommitGenerator()
        commit = await generator.generate_from_task_completion(
            task_id=str(task_id),
            chat_session_id=str(chat_session_id),
            db=db
        )

        job_manager.update_progress(job_id, 90.0, "Commit generated!")

        logger.info(f"✅ Commit generation job {job_id} completed")

        # Complete job with result (CommitResponse format)
        job_manager.complete_job(job_id, {
            "id": str(commit.id),
            "project_id": str(commit.project_id) if commit.project_id else None,
            "task_id": str(commit.task_id) if commit.task_id else None,
            "type": commit.type.value if commit.type else None,
            "scope": commit.scope,
            "subject": commit.subject,
            "body": commit.body,
            "message": commit.message,
            "timestamp": commit.timestamp.isoformat() if commit.timestamp else None,
            "metadata": commit.metadata
        })

    except Exception as e:
        logger.error(f"❌ Commit generation job {job_id} failed: {e}")
        job_manager = JobManager(db)
        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()


async def _generate_commit_manual_async(
    job_id: UUID,
    task_id: UUID,
    description: str
):
    """
    Background task to generate commit from manual description.

    PROMPT #108 - Background queue for prompt executions
    """
    from app.database import SessionLocal
    from app.services.commit_generator import CommitGenerator

    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        logger.info(f"🚀 Starting manual commit generation job {job_id} for task {task_id}")

        job_manager.update_progress(job_id, 10.0, "Generating commit message...")

        generator = CommitGenerator()
        commit = await generator.generate_manual(
            task_id=str(task_id),
            changes_description=description,
            db=db
        )

        job_manager.update_progress(job_id, 90.0, "Commit generated!")

        logger.info(f"✅ Manual commit generation job {job_id} completed")

        # Complete job with result (CommitResponse format)
        job_manager.complete_job(job_id, {
            "id": str(commit.id),
            "project_id": str(commit.project_id) if commit.project_id else None,
            "task_id": str(commit.task_id) if commit.task_id else None,
            "type": commit.type.value if commit.type else None,
            "scope": commit.scope,
            "subject": commit.subject,
            "body": commit.body,
            "message": commit.message,
            "timestamp": commit.timestamp.isoformat() if commit.timestamp else None,
            "metadata": commit.metadata
        })

    except Exception as e:
        logger.error(f"❌ Manual commit generation job {job_id} failed: {e}")
        job_manager = JobManager(db)
        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()
