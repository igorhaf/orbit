"""
Spec Pydantic Schemas (PROMPT #47 - Phase 2)
Request/Response models for Spec endpoints
"""

from datetime import datetime
from typing import Optional, List
from uuid import UUID
from pydantic import BaseModel, Field


class SpecBase(BaseModel):
    """Base schema for Spec"""
    category: str = Field(..., description="Category (backend, frontend, database, css)")
    name: str = Field(..., description="Framework name (laravel, nextjs, postgresql, tailwind)")
    spec_type: str = Field(..., description="Spec type (controller, model, page, etc)")

    title: str = Field(..., description="Human-readable title")
    description: Optional[str] = Field(None, description="Detailed description")
    content: str = Field(..., description="Specification content/template")

    language: Optional[str] = Field(None, description="Programming language")
    framework_version: Optional[str] = Field(None, description="Framework version")

    ignore_patterns: Optional[List[str]] = Field(None, description="File/folder patterns to ignore")
    file_extensions: Optional[List[str]] = Field(None, description="Relevant file extensions")

    is_active: bool = Field(True, description="Whether spec is active")


class SpecCreate(SpecBase):
    """Schema for creating a new Spec"""
    pass


class SpecUpdate(BaseModel):
    """Schema for updating an existing Spec"""
    category: Optional[str] = None
    name: Optional[str] = None
    spec_type: Optional[str] = None

    title: Optional[str] = None
    description: Optional[str] = None
    content: Optional[str] = None

    language: Optional[str] = None
    framework_version: Optional[str] = None

    ignore_patterns: Optional[List[str]] = None
    file_extensions: Optional[List[str]] = None

    is_active: Optional[bool] = None


class SpecResponse(SpecBase):
    """Schema for Spec response"""
    id: UUID
    usage_count: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class InterviewOption(BaseModel):
    """Schema for interview option (dynamic from specs)"""
    id: str = Field(..., description="Framework identifier (e.g., 'laravel')")
    label: str = Field(..., description="Display label (e.g., 'Laravel (PHP)')")
    description: Optional[str] = Field(None, description="Framework description")
    specs_count: int = Field(..., description="Number of specs available")


class InterviewOptions(BaseModel):
    """Schema for all interview options grouped by category"""
    backend: List[InterviewOption] = Field(default_factory=list)
    database: List[InterviewOption] = Field(default_factory=list)
    frontend: List[InterviewOption] = Field(default_factory=list)
    css: List[InterviewOption] = Field(default_factory=list)
