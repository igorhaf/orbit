"""
SQLAlchemy Models
Database models for AI Orchestrator

Import all models here to ensure they are registered with Base.metadata
and detected by Alembic for migrations.
"""

from app.models.project import Project
from app.models.interview import Interview, InterviewStatus
from app.models.prompt import Prompt
from app.models.task import Task, TaskStatus
from app.models.chat_session import ChatSession, ChatSessionStatus
from app.models.commit import Commit, CommitType
from app.models.ai_model import AIModel, AIModelUsageType
from app.models.system_settings import SystemSettings

__all__ = [
    # Models
    "Project",
    "Interview",
    "Prompt",
    "Task",
    "ChatSession",
    "Commit",
    "AIModel",
    "SystemSettings",
    # Enums
    "InterviewStatus",
    "TaskStatus",
    "ChatSessionStatus",
    "CommitType",
    "AIModelUsageType",
]
