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
from app.models.task_result import TaskResult
from app.models.chat_session import ChatSession, ChatSessionStatus
from app.models.commit import Commit, CommitType
from app.models.ai_model import AIModel, AIModelUsageType
from app.models.system_settings import SystemSettings
from app.models.spec import Spec  # PROMPT #47 - Phase 2
from app.models.consistency_issue import ConsistencyIssue, IssueSeverity, IssueStatus
from app.models.project_analysis import ProjectAnalysis
from app.models.ai_execution import AIExecution  # PROMPT #54 - AI Execution Logging

__all__ = [
    # Models
    "Project",
    "Interview",
    "Prompt",
    "Task",
    "TaskResult",
    "ChatSession",
    "Commit",
    "AIModel",
    "SystemSettings",
    "Spec",  # PROMPT #47 - Phase 2
    "ConsistencyIssue",
    "ProjectAnalysis",
    "AIExecution",  # PROMPT #54 - AI Execution Logging
    # Enums
    "InterviewStatus",
    "TaskStatus",
    "ChatSessionStatus",
    "CommitType",
    "AIModelUsageType",
    "IssueSeverity",
    "IssueStatus",
]
