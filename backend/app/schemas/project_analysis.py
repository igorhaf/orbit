"""
ProjectAnalysis Schemas
Pydantic models for API requests/responses
"""

from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field
from datetime import datetime
from uuid import UUID


class ProjectAnalysisCreate(BaseModel):
    """Schema for creating a project analysis (upload)"""

    project_id: Optional[UUID] = Field(
        None,
        description="Optional: Link analysis to existing project"
    )


class ProjectAnalysisResponse(BaseModel):
    """Basic response schema for project analysis"""

    id: UUID
    project_id: Optional[UUID]
    original_filename: str
    file_size_bytes: int
    status: str
    detected_stack: Optional[str]
    confidence_score: Optional[int]
    orchestrator_generated: bool
    orchestrator_key: Optional[str]
    error_message: Optional[str]
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime]

    class Config:
        from_attributes = True


class ProjectAnalysisDetailResponse(ProjectAnalysisResponse):
    """Detailed response with JSON fields"""

    file_structure: Optional[Dict[str, Any]]
    conventions: Optional[Dict[str, Any]]
    patterns: Optional[Dict[str, str]]
    dependencies: Optional[Dict[str, Any]]

    class Config:
        from_attributes = True


class GenerateOrchestratorRequest(BaseModel):
    """Request to generate orchestrator from analysis"""

    orchestrator_key: Optional[str] = Field(
        None,
        description="Custom key for orchestrator (auto-generated if not provided)"
    )


class GenerateOrchestratorResponse(BaseModel):
    """Response after generating orchestrator"""

    success: bool
    orchestrator_key: str
    orchestrator_code: str
    class_name: str
    message: str


class RegisterOrchestratorResponse(BaseModel):
    """Response after registering orchestrator"""

    success: bool
    orchestrator_key: str
    message: str


class AnalysisStatsResponse(BaseModel):
    """Statistics about analyses"""

    total_analyses: int
    completed: int
    analyzing: int
    failed: int
    orchestrators_generated: int
    stacks_detected: Dict[str, int]


class OrchestratorCodeResponse(BaseModel):
    """Response with orchestrator code"""

    orchestrator_key: str
    orchestrator_code: str
    class_name: str
    generated_at: datetime
