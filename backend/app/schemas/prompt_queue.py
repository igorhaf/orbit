"""
PromptQueue Pydantic Schemas
PROMPT #215 - Prompt Orchestration Priority Queue
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID
from pydantic import BaseModel, Field


class PromptQueueItemBase(BaseModel):
    """Base fields for a queue item."""
    task_id: UUID
    position: int = 0


class PromptQueueItemCreate(BaseModel):
    """Create a single queue item."""
    task_id: UUID


class PromptQueueBulkCreate(BaseModel):
    """Add multiple cards to queue at once."""
    task_ids: List[UUID]


class PromptQueueReorder(BaseModel):
    """Reorder items in the queue."""
    ordered_ids: List[UUID] = Field(description="Queue item IDs in desired order (position 1, 2, 3...)")


class PromptQueueItemResponse(BaseModel):
    """Response for a single queue item with task info."""
    id: UUID
    project_id: UUID
    task_id: UUID
    position: int
    status: str
    priority_score: int
    hierarchy_score: int
    age_score: int
    dependency_score: int
    manual_override: bool
    execution_job_id: Optional[UUID] = None
    execution_notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    executed_at: Optional[datetime] = None

    # Joined task info
    task_title: Optional[str] = None
    task_item_type: Optional[str] = None
    task_priority: Optional[str] = None
    task_workflow_state: Optional[str] = None
    task_parent_id: Optional[UUID] = None
    task_created_at: Optional[datetime] = None
    task_labels: Optional[List[str]] = None

    class Config:
        from_attributes = True


class PromptQueueResponse(BaseModel):
    """Full queue response with items and stats."""
    project_id: UUID
    items: List[PromptQueueItemResponse]
    total: int
    pending_count: int
    ready_count: int
    executing_count: int
    completed_count: int


class PromptQueueAutoSortRequest(BaseModel):
    """Request to auto-sort the queue using scoring algorithm."""
    strategy: str = Field(
        default="balanced",
        description="Sort strategy: hierarchy_first, priority_first, age_first, dependency_first, balanced"
    )


class PromptQueueAutoSortResponse(BaseModel):
    """Response after auto-sorting."""
    items_reordered: int
    strategy: str
    message: str


class PromptQueueExecuteNextResponse(BaseModel):
    """Response from executing the next item in queue."""
    queue_item_id: UUID
    task_id: UUID
    task_title: str
    job_id: UUID
    status: str
    message: str


class PromptQueueStatsResponse(BaseModel):
    """Queue statistics."""
    total: int
    pending: int
    ready: int
    executing: int
    completed: int
    failed: int
    skipped: int
    blocked: int
    avg_wait_time_hours: Optional[float] = None
    estimated_completion_hours: Optional[float] = None
