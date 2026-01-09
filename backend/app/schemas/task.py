"""
Task Pydantic Schemas
Request/Response models for Task endpoints
JIRA Transformation - Phase 2: Extended with 28+ new fields
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field

from app.models.task import (
    TaskStatus,
    ItemType,
    PriorityLevel,
    SeverityLevel,
    ResolutionType
)
from app.models.task_relationship import RelationshipType
from app.models.task_comment import CommentType


# ============================================================================
# TASK SCHEMAS
# ============================================================================

class TaskBase(BaseModel):
    """Base schema for Task with all JIRA fields"""
    title: str = Field(..., min_length=1, max_length=255, description="Task title")
    description: Optional[str] = Field(None, description="Task description")

    # Classification & Hierarchy
    item_type: ItemType = Field(default=ItemType.TASK, description="Item type (Epic, Story, Task, Subtask, Bug)")
    parent_id: Optional[UUID] = Field(None, description="Parent task ID (for hierarchy)")

    # Planning
    priority: PriorityLevel = Field(default=PriorityLevel.MEDIUM, description="Priority level")
    severity: Optional[SeverityLevel] = Field(None, description="Bug severity (for bugs only)")
    story_points: Optional[int] = Field(None, ge=1, le=21, description="Story points (Fibonacci: 1-21)")
    sprint_id: Optional[UUID] = Field(None, description="Sprint ID (future feature)")

    # Ownership
    reporter: Optional[str] = Field(None, max_length=100, description="Reporter username")
    assignee: Optional[str] = Field(None, max_length=100, description="Assignee username")

    # Categorization
    labels: List[str] = Field(default_factory=list, description="Labels/tags")
    components: List[str] = Field(default_factory=list, description="Components")

    # Workflow
    workflow_state: str = Field(default="backlog", max_length=50, description="Workflow state")
    resolution: Optional[ResolutionType] = Field(None, description="Resolution type")
    resolution_comment: Optional[str] = Field(None, description="Resolution comment")

    # AI Orchestration
    prompt_template_id: Optional[UUID] = Field(None, description="Prompt template ID")
    target_ai_model_id: Optional[UUID] = Field(None, description="Target AI model ID (override)")
    token_budget: Optional[int] = Field(None, ge=100, description="Token budget for execution")
    acceptance_criteria: List[str] = Field(default_factory=list, description="Acceptance criteria")
    generation_context: Dict[str, Any] = Field(default_factory=dict, description="AI generation context")

    # Interview Traceability
    interview_question_ids: List[int] = Field(default_factory=list, description="Interview question indexes")
    interview_insights: Dict[str, Any] = Field(default_factory=dict, description="Interview insights")

    # Generated Prompt (Meta Prompt Feature)
    generated_prompt: Optional[str] = Field(None, description="Assembled atomic prompt for task execution")

    # Legacy Kanban fields (for backward compatibility)
    status: TaskStatus = Field(default=TaskStatus.BACKLOG, description="Legacy Kanban status")
    column: str = Field(default="backlog", max_length=50, description="Legacy Kanban column")
    order: int = Field(default=0, ge=0, description="Order within column/parent")


class TaskCreate(TaskBase):
    """Schema for creating a new Task"""
    project_id: UUID
    prompt_id: Optional[UUID] = None


class TaskUpdate(BaseModel):
    """Schema for updating an existing Task (all fields optional)"""
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None

    # Classification & Hierarchy
    item_type: Optional[ItemType] = None
    parent_id: Optional[UUID] = None

    # Planning
    priority: Optional[PriorityLevel] = None
    severity: Optional[SeverityLevel] = None
    story_points: Optional[int] = Field(None, ge=1, le=21)
    sprint_id: Optional[UUID] = None

    # Ownership
    reporter: Optional[str] = Field(None, max_length=100)
    assignee: Optional[str] = Field(None, max_length=100)

    # Categorization
    labels: Optional[List[str]] = None
    components: Optional[List[str]] = None

    # Workflow
    workflow_state: Optional[str] = Field(None, max_length=50)
    resolution: Optional[ResolutionType] = None
    resolution_comment: Optional[str] = None

    # AI Orchestration
    prompt_template_id: Optional[UUID] = None
    target_ai_model_id: Optional[UUID] = None
    token_budget: Optional[int] = Field(None, ge=100)
    acceptance_criteria: Optional[List[str]] = None
    generation_context: Optional[Dict[str, Any]] = None

    # Interview Traceability
    interview_question_ids: Optional[List[int]] = None
    interview_insights: Optional[Dict[str, Any]] = None

    # Generated Prompt (Meta Prompt Feature)
    generated_prompt: Optional[str] = None

    # Legacy Kanban
    status: Optional[TaskStatus] = None
    column: Optional[str] = Field(None, max_length=50)
    order: Optional[int] = Field(None, ge=0)
    prompt_id: Optional[UUID] = None


class TaskMove(BaseModel):
    """Schema for moving a task (hierarchy or Kanban)"""
    # For hierarchy moves
    new_parent_id: Optional[UUID] = Field(None, description="New parent ID (None = make root)")

    # For Kanban moves (backward compatibility)
    new_status: Optional[TaskStatus] = None
    new_column: Optional[str] = Field(None, max_length=50)
    new_order: Optional[int] = Field(None, ge=0)


class TaskResponse(TaskBase):
    """Schema for Task response"""
    id: UUID
    project_id: UUID
    prompt_id: Optional[UUID]
    actual_tokens_used: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
        use_enum_values = True


# ============================================================================
# RELATIONSHIP SCHEMAS
# ============================================================================

class RelationshipCreate(BaseModel):
    """Schema for creating a task relationship"""
    source_task_id: UUID = Field(..., description="Source task ID")
    target_task_id: UUID = Field(..., description="Target task ID")
    relationship_type: RelationshipType = Field(..., description="Relationship type")


class RelationshipResponse(BaseModel):
    """Schema for relationship response"""
    id: UUID
    source_task_id: UUID
    target_task_id: UUID
    relationship_type: RelationshipType
    created_at: datetime

    class Config:
        from_attributes = True
        use_enum_values = True


# ============================================================================
# COMMENT SCHEMAS
# ============================================================================

class CommentCreate(BaseModel):
    """Schema for creating a comment"""
    task_id: UUID = Field(..., description="Task ID")
    author: str = Field(..., max_length=100, description="Author username")
    content: str = Field(..., min_length=1, description="Comment content")
    comment_type: CommentType = Field(default=CommentType.COMMENT, description="Comment type")
    comment_metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")


class CommentUpdate(BaseModel):
    """Schema for updating a comment"""
    content: Optional[str] = Field(None, min_length=1)
    comment_metadata: Optional[Dict[str, Any]] = None


class CommentResponse(BaseModel):
    """Schema for comment response"""
    id: UUID
    task_id: UUID
    author: str
    content: str
    comment_type: CommentType
    comment_metadata: Optional[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
        use_enum_values = True


# ============================================================================
# STATUS TRANSITION SCHEMAS
# ============================================================================

class StatusTransitionResponse(BaseModel):
    """Schema for status transition response"""
    id: UUID
    task_id: UUID
    from_status: str
    to_status: str
    transitioned_by: Optional[str]
    transition_reason: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class StatusTransitionCreate(BaseModel):
    """Schema for creating a status transition"""
    to_status: str = Field(..., max_length=50, description="Target status")
    transitioned_by: Optional[str] = Field(None, max_length=100, description="Username")
    transition_reason: Optional[str] = Field(None, description="Reason for transition")


# ============================================================================
# EXTENDED RESPONSE SCHEMAS
# ============================================================================

class TaskWithRelations(TaskResponse):
    """Schema for Task with all related entities"""
    # Hierarchy
    children: List['TaskResponse'] = Field(default_factory=list, description="Child tasks")

    # Relationships
    relationships_as_source: List[RelationshipResponse] = Field(default_factory=list, description="Outgoing relationships")
    relationships_as_target: List[RelationshipResponse] = Field(default_factory=list, description="Incoming relationships")

    # Comments
    comments: List[CommentResponse] = Field(default_factory=list, description="Task comments")

    # Status Transitions
    transitions: List[StatusTransitionResponse] = Field(default_factory=list, description="Status transition history")

    # Legacy counts (backward compatibility)
    chat_sessions_count: Optional[int] = 0
    commits_count: Optional[int] = 0

    class Config:
        from_attributes = True
        use_enum_values = True


# ============================================================================
# BACKLOG GENERATION SCHEMAS
# ============================================================================

class EpicSuggestion(BaseModel):
    """Schema for Epic suggestion from AI"""
    title: str
    description: str
    story_points: int
    priority: str
    acceptance_criteria: List[str]
    interview_insights: Dict[str, Any]
    interview_question_ids: List[int]


class StorySuggestion(BaseModel):
    """Schema for Story suggestion from AI"""
    title: str
    description: str
    story_points: int
    priority: str
    acceptance_criteria: List[str]
    interview_insights: Dict[str, Any]


class TaskSuggestion(BaseModel):
    """Schema for Task suggestion from AI"""
    title: str
    description: str
    story_points: int
    priority: str
    acceptance_criteria: List[str]


class BacklogGenerationResponse(BaseModel):
    """Schema for backlog generation response"""
    suggestions: List[Dict[str, Any]] = Field(..., description="AI-generated suggestions")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Generation metadata")


# ============================================================================
# TASK EXECUTION SCHEMAS (Legacy, maintained for compatibility)
# ============================================================================

class TaskExecuteRequest(BaseModel):
    """Schema for executing a task"""
    max_attempts: int = Field(default=3, ge=1, le=5, description="Maximum retry attempts")


class TaskResultResponse(BaseModel):
    """Schema for task execution result"""
    id: UUID
    task_id: UUID
    output_code: str
    file_path: Optional[str] = None
    model_used: str
    input_tokens: int
    output_tokens: int
    cost: float
    execution_time: float
    validation_passed: bool
    validation_issues: List[str] = Field(default_factory=list)
    attempts: int
    created_at: datetime

    class Config:
        from_attributes = True


class BatchExecuteRequest(BaseModel):
    """Schema for executing multiple tasks"""
    task_ids: List[UUID] = Field(..., min_length=1, description="Task IDs to execute")


class BatchExecuteResponse(BaseModel):
    """Schema for batch execution response"""
    total: int
    succeeded: int
    failed: int
    results: List[TaskResultResponse] = Field(default_factory=list)


# ============================================================================
# HIERARCHY SCHEMAS
# ============================================================================

class HierarchyMoveRequest(BaseModel):
    """Schema for moving task in hierarchy"""
    new_parent_id: Optional[UUID] = Field(None, description="New parent (None = root)")
    validate_rules: bool = Field(default=True, description="Validate hierarchy rules")


class HierarchyValidationResponse(BaseModel):
    """Schema for hierarchy validation response"""
    valid: bool
    message: str
    allowed_children: List[str] = Field(default_factory=list)


# Enable forward references for recursive TaskResponse in children
TaskWithRelations.model_rebuild()
