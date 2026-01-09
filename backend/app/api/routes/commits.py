"""
Commits API Router
CRUD operations for managing conventional commits.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import datetime

from app.database import get_db
from app.models.commit import Commit, CommitType
from app.schemas.commit import CommitCreate, CommitResponse, CommitManualGenerateRequest
from app.api.dependencies import get_commit_or_404

router = APIRouter()


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


@router.post("/auto-generate/{chat_session_id}", response_model=CommitResponse, status_code=status.HTTP_201_CREATED)
async def auto_generate_commit(
    chat_session_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Gera commit automaticamente a partir de uma chat session usando IA (Gemini).

    Este endpoint:
    1. Busca a chat session e task associada
    2. Extrai o contexto das mudanças da conversa
    3. Usa AI Orchestrator (Gemini) para gerar commit message
    4. Segue Conventional Commits specification
    5. Salva o commit no banco de dados

    - **chat_session_id**: UUID da chat session

    Returns:
        Commit gerado com message, type e metadata
    """
    from app.services.commit_generator import CommitGenerator
    from app.models.chat_session import ChatSession
    import logging

    logger = logging.getLogger(__name__)

    # Buscar session para pegar task_id
    session = db.query(ChatSession).filter(
        ChatSession.id == chat_session_id
    ).first()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Chat session {chat_session_id} not found"
        )

    # Gerar commit usando IA
    try:
        generator = CommitGenerator()
        commit = await generator.generate_from_task_completion(
            task_id=str(session.task_id),
            chat_session_id=str(chat_session_id),
            db=db
        )

        return commit

    except ValueError as e:
        logger.error(f"Validation error during commit generation: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Failed to generate commit: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate commit: {str(e)}"
        )


@router.post("/generate-manual/{task_id}", response_model=CommitResponse, status_code=status.HTTP_201_CREATED)
async def generate_manual_commit(
    task_id: UUID,
    commit_request: CommitManualGenerateRequest,
    db: Session = Depends(get_db)
):
    """
    Gera commit manualmente com descrição fornecida pelo usuário.

    Este endpoint permite ao usuário fornecer uma descrição das mudanças
    e a IA (Gemini) gera uma commit message profissional seguindo
    Conventional Commits.

    - **task_id**: UUID da task
    - **description**: Descrição das mudanças feitas

    Returns:
        Commit gerado
    """
    from app.services.commit_generator import CommitGenerator
    import logging

    logger = logging.getLogger(__name__)

    try:
        generator = CommitGenerator()
        commit = await generator.generate_manual(
            task_id=str(task_id),
            changes_description=commit_request.description,
            db=db
        )

        return commit

    except ValueError as e:
        logger.error(f"Validation error during manual commit generation: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Failed to generate manual commit: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate manual commit: {str(e)}"
        )
