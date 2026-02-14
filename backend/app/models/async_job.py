"""
Async Job Model for tracking long-running background tasks.

PROMPT #65 - Async Job System
Tracks status of asynchronous operations like AI calls, provisioning, backlog generation.
"""

from sqlalchemy import Column, String, Text, Enum as SQLEnum, DateTime, JSON, Float, Integer
from sqlalchemy.dialects.postgresql import UUID
from datetime import datetime
from uuid import uuid4
import enum

from app.database import Base


class JobStatus(str, enum.Enum):
    """Status of an async job."""
    PENDING = "pending"      # Job created, not started yet
    RUNNING = "running"      # Job is currently executing
    COMPLETED = "completed"  # Job finished successfully
    FAILED = "failed"        # Job failed with error
    CANCELLED = "cancelled"  # Job was cancelled by user


class JobPriority(int, enum.Enum):
    """Priority level for job execution ordering.
    Higher value = higher priority = runs first."""
    CRITICAL = 10   # User actively waiting (interview chat)
    HIGH = 7        # User in wizard, waiting for result
    NORMAL = 5      # User triggered, can wait
    LOW = 3         # Background generation


class JobType(str, enum.Enum):
    """Type of async job."""
    # Existing types
    INTERVIEW_MESSAGE = "interview_message"        # AI response for interview
    BACKLOG_GENERATION = "backlog_generation"      # Epic → Stories → Tasks generation
    TASK_GENERATION = "task_generation"            # PROMPT #68: Direct task from task-focused interview
    PROJECT_PROVISIONING = "project_provisioning"  # Project scaffolding

    # PROMPT #108: Background queue for all prompt executions (except interviews)
    EPIC_ACTIVATION = "epic_activation"            # Activate suggested epic → generate stories
    STORY_ACTIVATION = "story_activation"          # Activate suggested story → generate tasks
    TASK_ACTIVATION = "task_activation"            # Activate suggested task → generate subtasks
    SUBTASK_ACTIVATION = "subtask_activation"      # Activate suggested subtask → generate content
    TASK_EXECUTION = "task_execution"              # Execute single task (code generation)
    BATCH_EXECUTION = "batch_execution"            # Execute multiple tasks in batch
    COMMIT_GENERATION = "commit_generation"        # Generate commit message

    # PROMPT #133: Background jobs for ALL AI operations
    INTERVIEW_QUESTION = "interview_question"      # Geração de pergunta de entrevista
    MEMORY_SCAN = "memory_scan"                    # Análise de codebase (scan memory)
    PROJECT_TITLE = "project_title"                # Geração de título do projeto
    CONTEXT_GENERATION = "context_generation"      # Geração de contexto do projeto
    SUGGESTED_EPICS = "suggested_epics"            # Geração de épicos sugeridos

    # PROMPT #153: Background card generation from memory scan
    CARDS_FROM_MEMORY = "cards_from_memory"        # Geração de cards (épicos + regras) a partir do memory scan

    # PROMPT #127: On-demand children generation
    CHILDREN_GENERATION = "children_generation"      # Generate draft children (stories/tasks/subtasks)

    # PROMPT #121: Full project creation pipeline (scan + context + title)
    PROJECT_PIPELINE = "project_pipeline"

    # PROMPT #218: Continuous RAG Evolution - periodic codebase re-scan
    RAG_CONTINUOUS_SCAN = "rag_continuous_scan"

    # PROMPT #270: Enrich individual business rule wiki pages with AI
    WIKI_RULE_ENRICHMENT = "wiki_rule_enrichment"

    # PROMPT #282: RAG Chat message (user asks, AI answers from RAG)
    CHAT_MESSAGE = "chat_message"


def _load_job_priorities() -> dict:
    """PROMPT #256 - Load job priorities from contract YAML."""
    try:
        from app.contracts import get_contract_loader
        data = get_contract_loader().load_data("business/job_priorities")
        priorities_raw = data.get("priorities", {})
        # Map string job type names to JobType enum → int priority
        result = {}
        for job_name, priority_val in priorities_raw.items():
            try:
                jt = JobType(job_name)
                result[jt] = int(priority_val)
            except (ValueError, KeyError):
                pass
        return result
    except Exception:
        # Fallback to inline defaults
        return {
            JobType.INTERVIEW_QUESTION: JobPriority.CRITICAL,
            JobType.INTERVIEW_MESSAGE: JobPriority.CRITICAL,
            JobType.CHAT_MESSAGE: JobPriority.CRITICAL,
            JobType.CONTEXT_GENERATION: JobPriority.HIGH,
            JobType.PROJECT_TITLE: JobPriority.HIGH,
            JobType.PROJECT_PIPELINE: JobPriority.HIGH,
            JobType.MEMORY_SCAN: JobPriority.NORMAL,
            JobType.COMMIT_GENERATION: JobPriority.NORMAL,
            JobType.TASK_EXECUTION: JobPriority.NORMAL,
            JobType.SUGGESTED_EPICS: JobPriority.NORMAL,
            JobType.CARDS_FROM_MEMORY: JobPriority.NORMAL,
            JobType.CHILDREN_GENERATION: JobPriority.LOW,
            JobType.EPIC_ACTIVATION: JobPriority.LOW,
            JobType.STORY_ACTIVATION: JobPriority.LOW,
            JobType.TASK_ACTIVATION: JobPriority.LOW,
            JobType.SUBTASK_ACTIVATION: JobPriority.LOW,
            JobType.BACKLOG_GENERATION: JobPriority.LOW,
            JobType.TASK_GENERATION: JobPriority.LOW,
            JobType.BATCH_EXECUTION: JobPriority.LOW,
            JobType.PROJECT_PROVISIONING: JobPriority.LOW,
            JobType.RAG_CONTINUOUS_SCAN: JobPriority.LOW,
            JobType.WIKI_RULE_ENRICHMENT: JobPriority.LOW,
        }


# PROMPT #256 - Loaded from contracts/business/job_priorities.yaml
JOB_TYPE_DEFAULT_PRIORITY: dict[JobType, int] = _load_job_priorities()


class AsyncJob(Base):
    """
    Tracks long-running background tasks.

    Workflow:
    1. Client creates job via API endpoint
    2. Backend returns job_id immediately
    3. BackgroundTask executes the actual work
    4. Client polls /jobs/{job_id} for status
    5. When status=completed, client gets result

    Example:
        # Create job
        job = AsyncJob(
            job_type=JobType.INTERVIEW_MESSAGE,
            status=JobStatus.PENDING,
            input_data={"interview_id": str(interview.id), "message": "..."}
        )
        db.add(job)
        db.commit()

        # Return job_id to client immediately
        return {"job_id": str(job.id), "status": "pending"}

        # Client polls: GET /jobs/{job_id}
        # Returns: {"status": "running", "progress": 50}
        # ...
        # Returns: {"status": "completed", "result": {...}}
    """
    __tablename__ = "async_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)

    # Job metadata
    job_type = Column(SQLEnum(JobType, values_callable=lambda x: [e.value for e in x], name='jobtype'), nullable=False, index=True)
    status = Column(SQLEnum(JobStatus, values_callable=lambda x: [e.value for e in x], name='jobstatus'), nullable=False, default=JobStatus.PENDING, index=True)
    priority = Column(Integer, nullable=False, default=JobPriority.NORMAL, index=True)  # PROMPT #120: Job priority

    # Input/Output
    input_data = Column(JSON, nullable=False, default=dict)  # Parameters for the job
    result = Column(JSON, nullable=True)                     # Result when completed
    error = Column(Text, nullable=True)                      # Error message if failed

    # Progress tracking
    progress_percent = Column(Float, nullable=True)          # 0-100, optional
    progress_message = Column(String(500), nullable=True)    # Human-readable progress

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    # Related entities (optional)
    project_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    interview_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    task_id = Column(UUID(as_uuid=True), nullable=True, index=True)  # PROMPT #133: For card operations

    # PROMPT #133: Deep linking for notifications
    deep_link = Column(String(500), nullable=True)  # URL to navigate when notification clicked
    notification_title = Column(String(200), nullable=True)  # Title for notification display

    def __repr__(self):
        return f"<AsyncJob {self.id} {self.job_type} {self.status}>"

    def to_dict(self):
        """Convert to dictionary for API response."""
        return {
            "id": str(self.id),
            "job_type": self.job_type.value,
            "status": self.status.value,
            "input_data": self.input_data,
            "result": self.result,
            "error": self.error,
            "progress_percent": self.progress_percent,
            "progress_message": self.progress_message,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "project_id": str(self.project_id) if self.project_id else None,
            "interview_id": str(self.interview_id) if self.interview_id else None,
            "task_id": str(self.task_id) if self.task_id else None,  # PROMPT #133
            "deep_link": self.deep_link,  # PROMPT #133
            "notification_title": self.notification_title,  # PROMPT #133
            "priority": self.priority  # PROMPT #120
        }
