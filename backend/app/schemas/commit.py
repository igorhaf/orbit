"""
Commit Pydantic Schemas
Request/Response models for Commit endpoints
"""

from datetime import datetime
from typing import Optional, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field

from app.models.commit import CommitType


class CommitBase(BaseModel):
    """Base schema for Commit"""
    type: CommitType = Field(..., description="Type of commit (feat, fix, etc.)")
    message: str = Field(..., min_length=1, description="Commit message")
    changes: Optional[Dict[str, Any]] = Field(
        default_factory=dict,
        description="Details of changes"
    )
    created_by_ai_model: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="AI model that generated the commit"
    )
    author: str = Field(
        default="AI System",
        max_length=100,
        description="Commit author"
    )


class CommitCreate(CommitBase):
    """Schema for creating a new Commit"""
    task_id: UUID
    project_id: UUID


class CommitUpdate(BaseModel):
    """Schema for updating an existing Commit (limited fields)"""
    message: Optional[str] = Field(None, min_length=1)
    changes: Optional[Dict[str, Any]] = None


class CommitResponse(CommitBase):
    """Schema for Commit response"""
    id: UUID
    task_id: UUID
    project_id: UUID
    timestamp: datetime

    class Config:
        from_attributes = True
        use_enum_values = True


class CommitGenerateRequest(BaseModel):
    """Schema for requesting AI to generate a commit"""
    task_id: UUID
    project_id: UUID
    changes_context: Optional[str] = Field(
        None,
        description="Context about what changed"
    )


class CommitManualGenerateRequest(BaseModel):
    """Schema for manual commit generation with description"""
    description: str = Field(..., description="Description of changes made")
