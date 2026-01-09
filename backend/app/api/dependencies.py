"""
Dependency injection functions for API routes.
Provides reusable dependencies for database access and entity retrieval.
"""

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session
from uuid import UUID

from app.database import get_db
from app.models.project import Project
from app.models.task import Task
from app.models.interview import Interview
from app.models.prompt import Prompt
from app.models.chat_session import ChatSession
from app.models.commit import Commit
from app.models.ai_model import AIModel
from app.models.system_settings import SystemSettings


def get_project_or_404(
    project_id: UUID,
    db: Session = Depends(get_db)
) -> Project:
    """Get project by ID or raise 404."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project {project_id} not found"
        )
    return project


def get_task_or_404(
    task_id: UUID,
    db: Session = Depends(get_db)
) -> Task:
    """Get task by ID or raise 404."""
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task {task_id} not found"
        )
    return task


def get_interview_or_404(
    interview_id: UUID,
    db: Session = Depends(get_db)
) -> Interview:
    """Get interview by ID or raise 404."""
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Interview {interview_id} not found"
        )
    return interview


def get_prompt_or_404(
    prompt_id: UUID,
    db: Session = Depends(get_db)
) -> Prompt:
    """Get prompt by ID or raise 404."""
    prompt = db.query(Prompt).filter(Prompt.id == prompt_id).first()
    if not prompt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Prompt {prompt_id} not found"
        )
    return prompt


def get_chat_session_or_404(
    session_id: UUID,
    db: Session = Depends(get_db)
) -> ChatSession:
    """Get chat session by ID or raise 404."""
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Chat session {session_id} not found"
        )
    return session


def get_commit_or_404(
    commit_id: UUID,
    db: Session = Depends(get_db)
) -> Commit:
    """Get commit by ID or raise 404."""
    commit = db.query(Commit).filter(Commit.id == commit_id).first()
    if not commit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Commit {commit_id} not found"
        )
    return commit


def get_ai_model_or_404(
    model_id: UUID,
    db: Session = Depends(get_db)
) -> AIModel:
    """Get AI model by ID or raise 404."""
    model = db.query(AIModel).filter(AIModel.id == model_id).first()
    if not model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"AI Model {model_id} not found"
        )
    return model


def get_setting_or_404(
    setting_key: str,
    db: Session = Depends(get_db)
) -> SystemSettings:
    """Get system setting by key or raise 404."""
    setting = db.query(SystemSettings).filter(SystemSettings.key == setting_key).first()
    if not setting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Setting '{setting_key}' not found"
        )
    return setting
