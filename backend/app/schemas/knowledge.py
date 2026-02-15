"""
Knowledge Base Pydantic Schemas
PROMPT #147 - Incremental RAG Feeding for Business Rules

Request/Response models for Knowledge Base endpoints.
Manages business rules, documents, and other knowledge items in the RAG.
"""

from datetime import datetime
from typing import Optional, List, Literal
from uuid import UUID
from pydantic import BaseModel, Field


# ============================================================================
# CATEGORY TYPES
# ============================================================================

BusinessRuleCategory = Literal[
    'validation',    # Email unique, CPF valid, min password
    'workflow',      # Manager approval, order flow
    'calculation',   # Max discount, freight calculation
    'permission',    # Admin only, owner only
    'integration'    # External API, webhook
]

KnowledgeSource = Literal[
    'manual',        # Added by user manually
    'code_scan',     # Extracted from codebase memory scan
    'interview',     # Captured during interview
    'document',      # Extracted from uploaded document
    'commit'         # Extracted from git commits (future)
]


# ============================================================================
# BUSINESS RULE SCHEMAS
# ============================================================================

class BusinessRuleBase(BaseModel):
    """Base schema for business rule"""
    title: str = Field(..., min_length=1, max_length=255, description="Rule title")
    description: str = Field(..., min_length=1, description="Rule description")
    category: BusinessRuleCategory = Field(..., description="Rule category")


class BusinessRuleCreate(BusinessRuleBase):
    """Schema for creating a business rule"""
    pass


class BusinessRuleUpdate(BaseModel):
    """Schema for updating a business rule"""
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = Field(None, min_length=1)
    category: Optional[BusinessRuleCategory] = None


class BusinessRuleResponse(BaseModel):
    """Schema for business rule response"""
    id: str
    title: str
    description: str
    category: str
    source: str
    created_at: str
    similarity: Optional[float] = None  # For search results

    class Config:
        from_attributes = True


# ============================================================================
# DOCUMENT UPLOAD SCHEMAS
# ============================================================================

class DocumentUploadResponse(BaseModel):
    """Response for document upload"""
    filename: str
    chunks_indexed: int
    total_chars: int


class DocumentInfo(BaseModel):
    """Info about an uploaded document"""
    filename: str
    chunks: int
    uploaded_at: str
    content_type: str


# ============================================================================
# KNOWLEDGE STATS SCHEMAS
# ============================================================================

class KnowledgeStats(BaseModel):
    """Statistics about project knowledge"""
    total_documents: int
    business_rules_count: int
    interview_answers_count: int
    code_files_count: int
    documents_count: int
    by_category: dict = Field(default_factory=dict)
    by_source: dict = Field(default_factory=dict)


# ============================================================================
# LIST/SEARCH SCHEMAS
# ============================================================================

class KnowledgeListParams(BaseModel):
    """Parameters for listing knowledge items"""
    content_type: Optional[str] = None
    category: Optional[BusinessRuleCategory] = None
    source: Optional[KnowledgeSource] = None
    search: Optional[str] = None
    limit: int = Field(default=100, ge=1, le=500)
    offset: int = Field(default=0, ge=0)
