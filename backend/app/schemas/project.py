"""
Project Pydantic Schemas
Request/Response models for Project endpoints
"""

from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field


class ProjectBase(BaseModel):
    """Base schema for Project"""
    name: str = Field(..., min_length=1, max_length=255, description="Project name")
    description: Optional[str] = Field(None, description="Project description")
    git_repository_info: Optional[dict] = Field(None, description="Git repository information")


class ProjectCreate(ProjectBase):
    """Schema for creating a new Project"""
    pass


class ProjectUpdate(BaseModel):
    """Schema for updating an existing Project"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    git_repository_info: Optional[dict] = None


class ProjectResponse(ProjectBase):
    """Schema for Project response"""
    id: UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ProjectWithRelations(ProjectResponse):
    """Schema for Project with related entities"""
    interviews_count: Optional[int] = 0
    tasks_count: Optional[int] = 0
    prompts_count: Optional[int] = 0

    class Config:
        from_attributes = True
