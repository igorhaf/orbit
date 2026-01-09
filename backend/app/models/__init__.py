"""
SQLAlchemy Models
Database models for AI Orchestrator

Import all models here to ensure they are registered with Base.metadata
and detected by Alembic for migrations.
"""

from app.models.project import Project
from app.models.interview import Interview, InterviewStatus
from app.models.prompt import Prompt
from app.models.task import Task, TaskStatus, ItemType, PriorityLevel, SeverityLevel, ResolutionType
from app.models.task_result import TaskResult
from app.models.task_relationship import TaskRelationship, RelationshipType  # JIRA Transformation
from app.models.task_comment import TaskComment, CommentType  # JIRA Transformation
from app.models.status_transition import StatusTransition  # JIRA Transformation
from app.models.chat_session import ChatSession, ChatSessionStatus
from app.models.commit import Commit, CommitType
from app.models.ai_model import AIModel, AIModelUsageType
from app.models.system_settings import SystemSettings
from app.models.spec import Spec  # PROMPT #47 - Phase 2
from app.models.consistency_issue import ConsistencyIssue, IssueSeverity, IssueStatus
from app.models.project_analysis import ProjectAnalysis
from app.models.ai_execution import AIExecution  # PROMPT #54 - AI Execution Logging
from app.models.prompt_template import PromptTemplate  # Prompter Architecture - Phase 1

__all__ = [
    # Models
    "Project",
    "Interview",
    "Prompt",
    "Task",
    "TaskResult",
    "TaskRelationship",  # JIRA Transformation
    "TaskComment",  # JIRA Transformation
    "StatusTransition",  # JIRA Transformation
    "ChatSession",
    "Commit",
    "AIModel",
    "SystemSettings",
    "Spec",  # PROMPT #47 - Phase 2
    "ConsistencyIssue",
    "ProjectAnalysis",
    "AIExecution",  # PROMPT #54 - AI Execution Logging
    "PromptTemplate",  # Prompter Architecture - Phase 1
    # Enums
    "InterviewStatus",
    "TaskStatus",
    "ItemType",  # JIRA Transformation
    "PriorityLevel",  # JIRA Transformation
    "SeverityLevel",  # JIRA Transformation
    "ResolutionType",  # JIRA Transformation
    "ChatSessionStatus",
    "CommitType",
    "AIModelUsageType",
    "IssueSeverity",
    "IssueStatus",
    "RelationshipType",  # JIRA Transformation
    "CommentType",  # JIRA Transformation
]
