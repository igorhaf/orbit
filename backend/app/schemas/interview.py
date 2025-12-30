"""
Interview Pydantic Schemas
Request/Response models for Interview endpoints
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field

from app.models.interview import InterviewStatus


class ConversationMessage(BaseModel):
    """Schema for a single conversation message"""
    role: str = Field(..., pattern="^(user|assistant)$", description="Message role")
    content: str = Field(..., min_length=1, description="Message content")
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class InterviewBase(BaseModel):
    """Base schema for Interview"""
    ai_model_used: str = Field(..., min_length=1, max_length=100, description="AI model name")
    conversation_data: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Array of conversation messages"
    )
    status: InterviewStatus = Field(default=InterviewStatus.ACTIVE)


class InterviewCreate(BaseModel):
    """Schema for creating a new Interview"""
    project_id: UUID
    ai_model_used: str = Field(..., min_length=1, max_length=100)
    conversation_data: Optional[List[Dict[str, Any]]] = Field(default_factory=list)


class InterviewUpdate(BaseModel):
    """Schema for updating an existing Interview"""
    conversation_data: Optional[List[Dict[str, Any]]] = None
    status: Optional[InterviewStatus] = None


class InterviewAddMessage(BaseModel):
    """Schema for adding a message to an interview"""
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., min_length=1)


class InterviewMessageCreate(BaseModel):
    """Schema for sending a message in interview chat"""
    content: str = Field(..., min_length=1, description="Message content")


class InterviewResponse(InterviewBase):
    """Schema for Interview response"""
    id: UUID
    project_id: UUID
    created_at: datetime

    class Config:
        from_attributes = True
        use_enum_values = True


class StackConfiguration(BaseModel):
    """Schema for project stack configuration (PROMPT #46 - Phase 1)"""
    backend: str = Field(..., description="Backend framework (laravel, django, fastapi, express, other)")
    database: str = Field(..., description="Database (postgresql, mysql, mongodb, sqlite)")
    frontend: str = Field(..., description="Frontend framework (nextjs, react, vue, angular, none)")
    css: str = Field(..., description="CSS framework (tailwind, bootstrap, materialui, custom)")


class ProjectInfoUpdate(BaseModel):
    """Schema for updating project title and description during interview"""
    title: Optional[str] = Field(None, description="Updated project title")
    description: Optional[str] = Field(None, description="Updated project description")
