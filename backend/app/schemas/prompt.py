"""
Prompt Pydantic Schemas
Request/Response models for Prompt endpoints
"""

from datetime import datetime
from typing import Optional, List
from uuid import UUID
from pydantic import BaseModel, Field


class PromptBase(BaseModel):
    """Base schema for Prompt"""
    content: str = Field(..., min_length=1, description="Prompt content")
    type: str = Field(
        default="user",
        max_length=50,
        description="Prompt type (system, user, template, etc.)"
    )
    is_reusable: bool = Field(default=False, description="Whether prompt is reusable")
    components: Optional[List[str]] = Field(
        default_factory=list,
        description="List of reusable components"
    )


class PromptCreate(PromptBase):
    """Schema for creating a new Prompt"""
    project_id: UUID
    created_from_interview_id: Optional[UUID] = None
    parent_id: Optional[UUID] = None


class PromptUpdate(BaseModel):
    """Schema for updating an existing Prompt"""
    content: Optional[str] = Field(None, min_length=1)
    type: Optional[str] = Field(None, max_length=50)
    is_reusable: Optional[bool] = None
    components: Optional[List[str]] = None


class PromptResponse(PromptBase):
    """Schema for Prompt response"""
    id: UUID
    project_id: UUID
    created_from_interview_id: Optional[UUID]
    parent_id: Optional[UUID]
    version: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PromptGenerateRequest(BaseModel):
    """Schema for generating prompts from interview"""
    interview_id: UUID
    project_id: UUID
