"""
Task Model
Represents a task/item in the backlog (Epic, Story, Task, Subtask, Bug)
Extended for JIRA-like functionality with hierarchy, relationships, and AI orchestration
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, Text, Integer, DateTime, ForeignKey, Enum as SQLEnum, JSON, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import enum

from app.database import Base


class TaskStatus(str, enum.Enum):
    """Task status enum - represents columns in Kanban board"""
    BACKLOG = "backlog"
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    REVIEW = "review"
    DONE = "done"
    BLOCKED = "blocked"  # PROMPT #94 FASE 4 - Pending modification approval


class ItemType(str, enum.Enum):
    """Item type enum - JIRA-like hierarchy"""
    EPIC = "epic"
    STORY = "story"
    TASK = "task"
    SUBTASK = "subtask"
    BUG = "bug"


class PriorityLevel(str, enum.Enum):
    """Priority level enum"""
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    TRIVIAL = "trivial"


class SeverityLevel(str, enum.Enum):
    """Severity level enum (for bugs)"""
    BLOCKER = "blocker"
    CRITICAL = "critical"
    MAJOR = "major"
    MINOR = "minor"
    TRIVIAL = "trivial"


class ResolutionType(str, enum.Enum):
    """Resolution type enum"""
    FIXED = "fixed"
    WONT_FIX = "wont_fix"
    DUPLICATE = "duplicate"
    WORKS_AS_DESIGNED = "works_as_designed"
    CANNOT_REPRODUCE = "cannot_reproduce"


class Task(Base):
    """
    Task model - Represents a task in the Kanban board

    Attributes:
        id: Unique identifier
        title: Task title
        description: Detailed task description
        prompt_id: Reference to associated prompt
        project_id: Reference to the project
        status: Current task status (Kanban column)
        column: Kanban column name
        order: Order within the column
        created_at: Timestamp of creation
        updated_at: Timestamp of last update
    """

    __tablename__ = "tasks"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)

    # Foreign keys
    prompt_id = Column(
        UUID(as_uuid=True),
        ForeignKey("prompts.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )

    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    created_from_interview_id = Column(
        UUID(as_uuid=True),
        ForeignKey("interviews.id", ondelete="CASCADE"),  # PROMPT #88 - Cascade delete interviews when task is deleted
        nullable=True,
        index=True
    )

    # Basic fields
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(
        SQLEnum(TaskStatus, name="task_status", values_callable=lambda x: [e.value for e in x]),
        default=TaskStatus.BACKLOG,
        nullable=False,
        index=True
    )
    column = Column(String(50), default="backlog", nullable=False)
    order = Column(Integer, default=0, nullable=False)
    comments = Column(JSON, nullable=True, default=list)

    # Task execution fields
    type = Column(String(100), nullable=True)  # "model", "controller", "repository", etc.
    entity = Column(String(100), nullable=True)  # "Book", "User", etc.
    file_path = Column(String(500), nullable=True)  # "src/Models/Book.php"
    complexity = Column(Integer, default=1, nullable=False)  # 1-5 (affects model selection)
    depends_on = Column(JSON, nullable=True, default=list)  # List of task IDs this depends on

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )

    # ===== JIRA TRANSFORMATION FIELDS =====

    # Classification & Hierarchy
    item_type = Column(
        SQLEnum(ItemType, name="item_type", values_callable=lambda x: [e.value for e in x]),
        default=ItemType.TASK,
        nullable=False,
        index=True
    )
    parent_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )

    # Priority & Planning
    priority = Column(
        SQLEnum(PriorityLevel, name="priority_level", values_callable=lambda x: [e.value for e in x]),
        default=PriorityLevel.MEDIUM,
        nullable=False,
        index=True
    )
    severity = Column(
        SQLEnum(SeverityLevel, name="severity_level", values_callable=lambda x: [e.value for e in x]),
        nullable=True  # Only for bugs
    )
    story_points = Column(Integer, nullable=True)  # Fibonacci: 1, 2, 3, 5, 8, 13, 21
    sprint_id = Column(UUID(as_uuid=True), nullable=True)  # Future feature

    # Ownership (strings for now, FK to users later)
    reporter = Column(String(100), nullable=True, default="system")
    assignee = Column(String(100), nullable=True)

    # Categorization (JSON arrays)
    labels = Column(JSON, nullable=True, default=list)  # ["frontend", "urgent", "api"]
    components = Column(JSON, nullable=True, default=list)  # ["Authentication", "API"]

    # Workflow
    workflow_state = Column(String(50), default="open", nullable=False)  # open/in_progress/resolved/closed
    resolution = Column(
        SQLEnum(ResolutionType, name="resolution_type", values_callable=lambda x: [e.value for e in x]),
        nullable=True
    )
    resolution_comment = Column(Text, nullable=True)
    status_history = Column(JSON, nullable=True, default=list)  # [{from, to, at, by}]

    # AI Orchestration
    prompt_template_id = Column(
        UUID(as_uuid=True),
        ForeignKey("prompt_templates.id", ondelete="SET NULL"),
        nullable=True
    )
    target_ai_model_id = Column(
        UUID(as_uuid=True),
        ForeignKey("ai_models.id", ondelete="SET NULL"),
        nullable=True
    )
    generation_context = Column(JSON, nullable=True, default=dict)
    acceptance_criteria = Column(JSON, nullable=True, default=list)  # [{text, completed}]
    token_budget = Column(Integer, nullable=True)
    actual_tokens_used = Column(Integer, nullable=True)

    # Interview Traceability
    interview_question_ids = Column(JSON, nullable=True, default=list)  # ["q1", "q5", "q7"]
    interview_insights = Column(JSON, nullable=True, default=dict)

    # PROMPT #68 - Dual-Mode Interview System: AI-suggested subtasks
    subtask_suggestions = Column(
        JSON,
        nullable=True,
        default=list  # [{"title": "...", "description": "...", "story_points": 2}]
    )

    # Generated Prompt - Atomic prompts for task/subtask execution
    # Stores the final assembled prompt generated from all task fields, context, and specs
    generated_prompt = Column(Text, nullable=True)

    # PROMPT #94 FASE 4 - Blocking System for Modification Detection
    # When AI suggests modifying existing task (>90% semantic similarity):
    # - Task gets BLOCKED status
    # - Modification saved in pending_modification field
    # - User must approve/reject via UI
    blocked_reason = Column(String(500), nullable=True)  # Why task is blocked
    pending_modification = Column(JSON, nullable=True, default=None)  # Proposed changes

    # ===== END JIRA TRANSFORMATION FIELDS =====

    # Relationships
    prompt = relationship("Prompt", back_populates="tasks")
    project = relationship("Project", back_populates="tasks")

    # JIRA Transformation: Hierarchy
    parent = relationship(
        "Task",
        remote_side=[id],
        back_populates="children",
        uselist=False
    )
    children = relationship(
        "Task",
        back_populates="parent",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    # JIRA Transformation: Relationships
    relationships_as_source = relationship(
        "TaskRelationship",
        foreign_keys="TaskRelationship.source_task_id",
        back_populates="source_task",
        cascade="all, delete-orphan"
    )
    relationships_as_target = relationship(
        "TaskRelationship",
        foreign_keys="TaskRelationship.target_task_id",
        back_populates="target_task",
        cascade="all, delete-orphan"
    )

    # JIRA Transformation: Structured Comments
    task_comments = relationship(
        "TaskComment",
        back_populates="task",
        cascade="all, delete-orphan",
        order_by="TaskComment.created_at.desc()"
    )

    # JIRA Transformation: Status Transitions
    transitions = relationship(
        "StatusTransition",
        back_populates="task",
        cascade="all, delete-orphan",
        order_by="StatusTransition.created_at.desc()"
    )

    # JIRA Transformation: AI Model & Template
    prompt_template = relationship("PromptTemplate", back_populates="tasks")
    target_ai_model = relationship("AIModel", foreign_keys=[target_ai_model_id])

    chat_sessions = relationship(
        "ChatSession",
        back_populates="task",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    commits = relationship(
        "Commit",
        back_populates="task",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    result = relationship(
        "TaskResult",
        back_populates="task",
        uselist=False,
        cascade="all, delete-orphan"
    )

    # PROMPT #68 - Dual-Mode Interview System: Sub-interviews for task exploration
    exploration_interviews = relationship(
        "Interview",
        foreign_keys="Interview.parent_task_id",
        back_populates="parent_task",
        cascade="all, delete-orphan"
    )

    # Composite indexes for performance (JIRA Transformation)
    __table_args__ = (
        Index('ix_tasks_item_type_project', 'item_type', 'project_id'),
        Index('ix_tasks_parent_project', 'parent_id', 'project_id'),
        Index('ix_tasks_priority_status', 'priority', 'status'),
    )

    def to_dict(self) -> dict:
        """Converte task para dict (usado pelo orquestrador)"""
        return {
            "id": str(self.id),
            "type": self.type,
            "title": self.title,
            "description": self.description,
            "complexity": self.complexity,
            "depends_on": self.depends_on or [],
            "file_spec": {
                "path": self.file_path,
                "type": self.type,
                "entity": self.entity
            }
        }

    def __repr__(self) -> str:
        return f"<Task(id={self.id}, title='{self.title}', status={self.status})>"
