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

    # Stack configuration (PROMPT #46 - Phase 1, PROMPT #67 - Mobile)
    stack_backend: Optional[str] = Field(None, description="Backend framework (laravel, django, fastapi, etc)")
    stack_database: Optional[str] = Field(None, description="Database (postgresql, mysql, mongodb, etc)")
    stack_frontend: Optional[str] = Field(None, description="Frontend framework (nextjs, react, vue, etc)")
    stack_css: Optional[str] = Field(None, description="CSS framework (tailwind, bootstrap, etc)")
    stack_mobile: Optional[str] = Field(None, description="Mobile framework (react-native, flutter, expo, etc) - PROMPT #67")

    # Project folder path
    project_folder: Optional[str] = Field(None, description="Sanitized project folder name")

    # Pattern Discovery (PROMPT #62 - Week 1)
    code_path: Optional[str] = Field(None, description="Path to project code in Docker container (required for pattern discovery)")


class ProjectCreate(ProjectBase):
    """Schema for creating a new Project"""
    pass


class ProjectUpdate(BaseModel):
    """Schema for updating an existing Project"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    git_repository_info: Optional[dict] = None

    # Stack configuration (PROMPT #46 - Phase 1, PROMPT #67 - Mobile)
    stack_backend: Optional[str] = None
    stack_database: Optional[str] = None
    stack_frontend: Optional[str] = None
    stack_css: Optional[str] = None
    stack_mobile: Optional[str] = None  # PROMPT #67

    # Pattern Discovery (PROMPT #62 - Week 1)
    code_path: Optional[str] = None


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
