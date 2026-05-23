"""
Project Pydantic Schemas
Request/Response models for Project endpoints
"""

from datetime import datetime
from typing import Optional, Literal
from uuid import UUID
from pydantic import BaseModel, Field


class ProjectBase(BaseModel):
    """Base schema for Project"""
    name: str = Field(..., min_length=1, max_length=255, description="Project name")
    # PROMPT #89 - Description is now OPTIONAL (filled after context interview)
    # PROMPT #101 - Increased max_length from 5000 to 50000 (context can be very long)
    description: Optional[str] = Field(None, max_length=50000, description="Project description (auto-filled from context)")
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
    # PROMPT #111 - code_path agora é OPCIONAL em ProjectBase pois será obrigatório apenas em ProjectCreate
    code_path: Optional[str] = Field(None, description="Path to project code folder")


class ProjectCreate(ProjectBase):
    """Schema for creating a new Project"""
    # PROMPT #111 - code_path é OBRIGATÓRIO na criação (não pode ser editado depois)
    # O ORBIT foca em análise de código existente, não em provisionamento
    code_path: str = Field(..., min_length=1, max_length=500, description="Path to project code folder (required, immutable after creation)")

    # PROMPT #118 - Initial memory context from codebase scan (JSON dict)
    # Contains: suggested_title, stack_info, business_rules, key_features, interview_context
    initial_memory_context: Optional[dict] = Field(None, description="Context from codebase memory scan")


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

    # PROMPT #111 - code_path REMOVIDO de ProjectUpdate (imutável após criação)
    # code_path só pode ser definido na criação do projeto

    # PROMPT #118 - Initial memory context from codebase scan (can be set after creation)
    initial_memory_context: Optional[dict] = Field(None, description="Context from codebase memory scan")

    # PROMPT #241 - User-editable ignore paths per project
    ignore_paths: Optional[list] = Field(None, description="Paths to exclude from scanning")

    # User-editable file/dir blocklist (mirror of global_blocklist shape)
    custom_ignore_patterns: Optional[dict] = Field(None, description="{directories:[], file_patterns:[]} per-project")

    # PROMPT #243 - Pinned fragments (persisted text selections)
    pinned_fragments: Optional[list] = Field(None, description="Text fragments pinned by user for AI preservation")


class ProjectResponse(ProjectBase):
    """Schema for Project response"""
    id: UUID
    created_at: datetime
    updated_at: datetime

    # Context fields (PROMPT #89 - Context Interview)
    context_semantic: Optional[str] = Field(None, description="Structured semantic text for AI")
    context_human: Optional[str] = Field(None, description="Human-readable project context")
    context_locked: bool = Field(False, description="Whether context is locked (immutable after first epic)")
    context_locked_at: Optional[datetime] = Field(None, description="When context was locked")

    # PROMPT #118 - Initial memory context from codebase scan
    initial_memory_context: Optional[dict] = Field(None, description="Context from codebase memory scan")

    # PROMPT #241 - User-editable ignore paths per project
    ignore_paths: Optional[list] = Field(None, description="Paths to exclude from scanning")

    # User-editable file/dir blocklist (mirror of global_blocklist shape)
    custom_ignore_patterns: Optional[dict] = Field(None, description="{directories:[], file_patterns:[]} per-project")

    # PROMPT #243 - Pinned fragments (persisted text selections)
    pinned_fragments: Optional[list] = Field(None, description="Text fragments pinned by user for AI preservation")

    # PROMPT #282 - Track which AI model generated the description
    description_ai_model: Optional[str] = Field(None, description="AI model that generated the description")

    # PROMPT #236 - Deletion protection
    protected: bool = Field(False, description="Whether this project is protected against deletion")

    # PROMPT #126 - Project lifecycle status
    # PROMPT #189 - Added "processing" to match ProjectStatus enum (was causing processing projects to be invisible)
    status: Literal["draft", "processing", "active"] = Field("draft", description="Project status: draft, processing (pipeline running), or active (ready to use)")

    class Config:
        from_attributes = True


class ProjectWithRelations(ProjectResponse):
    """Schema for Project with related entities"""
    interviews_count: Optional[int] = 0
    tasks_count: Optional[int] = 0
    prompts_count: Optional[int] = 0

    class Config:
        from_attributes = True
