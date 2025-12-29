"""
Task Pydantic Schemas
Request/Response models for Task endpoints
"""

from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field

from app.models.task import TaskStatus


class TaskBase(BaseModel):
    """Base schema for Task"""
    title: str = Field(..., min_length=1, max_length=255, description="Task title")
    description: Optional[str] = Field(None, description="Task description")
    status: TaskStatus = Field(default=TaskStatus.BACKLOG, description="Task status")
    column: str = Field(default="backlog", max_length=50, description="Kanban column")
    order: int = Field(default=0, ge=0, description="Order within column")


class TaskCreate(TaskBase):
    """Schema for creating a new Task"""
    project_id: UUID
    prompt_id: Optional[UUID] = None


class TaskUpdate(BaseModel):
    """Schema for updating an existing Task"""
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    status: Optional[TaskStatus] = None
    column: Optional[str] = Field(None, max_length=50)
    order: Optional[int] = Field(None, ge=0)
    prompt_id: Optional[UUID] = None


class TaskMove(BaseModel):
    """Schema for moving a task in the Kanban board"""
    new_status: TaskStatus
    new_column: str = Field(..., max_length=50)
    new_order: int = Field(..., ge=0)


class TaskResponse(TaskBase):
    """Schema for Task response"""
    id: UUID
    project_id: UUID
    prompt_id: Optional[UUID]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
        use_enum_values = True


class TaskWithRelations(TaskResponse):
    """Schema for Task with related entities"""
    chat_sessions_count: Optional[int] = 0
    commits_count: Optional[int] = 0

    class Config:
        from_attributes = True


# Task Execution Schemas

class TaskExecuteRequest(BaseModel):
    """Schema for executing a task"""
    max_attempts: int = Field(default=3, ge=1, le=5, description="Maximum retry attempts if validation fails")


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
    validation_issues: list[str] = Field(default_factory=list)
    attempts: int
    created_at: datetime

    class Config:
        from_attributes = True


class BatchExecuteRequest(BaseModel):
    """Schema for executing multiple tasks"""
    task_ids: list[UUID] = Field(..., min_length=1, description="List of task IDs to execute")


class BatchExecuteResponse(BaseModel):
    """Schema for batch execution response"""
    total: int = Field(..., description="Total number of tasks")
    succeeded: int = Field(..., description="Number of tasks that succeeded")
    failed: int = Field(..., description="Number of tasks that failed")
    results: list[TaskResultResponse] = Field(default_factory=list)
