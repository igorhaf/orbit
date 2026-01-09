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
    content: str = Field(default="", description="Prompt content (legacy field, use response for AI outputs)")
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
    """Schema for Prompt response - PROMPT #58 Enhanced with audit fields"""
    id: UUID
    project_id: UUID
    created_from_interview_id: Optional[UUID]
    parent_id: Optional[UUID]
    version: int
    created_at: datetime
    updated_at: datetime

    # PROMPT #58 - AI Execution Audit Fields
    ai_model_used: Optional[str] = None
    system_prompt: Optional[str] = None
    user_prompt: Optional[str] = None
    response: Optional[str] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    total_cost_usd: Optional[float] = None
    execution_time_ms: Optional[int] = None
    execution_metadata: Optional[dict] = None
    status: Optional[str] = None
    error_message: Optional[str] = None

    class Config:
        from_attributes = True


class PromptGenerateRequest(BaseModel):
    """Schema for generating prompts from interview"""
    interview_id: UUID
    project_id: UUID
