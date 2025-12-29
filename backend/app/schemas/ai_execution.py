"""
AIExecution Pydantic Schemas
Request/Response models for AIExecution endpoints
PROMPT #54 - AI Execution Logging System
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field


class AIExecutionBase(BaseModel):
    """Base schema for AIExecution"""
    usage_type: str = Field(..., description="Type of usage (interview, prompt_generation, etc.)")
    provider: str = Field(..., description="Provider (anthropic, openai, google)")
    model_name: str = Field(..., description="Model name (claude-3-5-sonnet, gpt-4, etc.)")


class AIExecutionCreate(BaseModel):
    """Schema for creating a new AIExecution (internal use only)"""
    ai_model_id: Optional[UUID] = None
    usage_type: str
    input_messages: List[Dict[str, Any]]
    system_prompt: Optional[str] = None
    response_content: Optional[str] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    provider: str
    model_name: str
    temperature: Optional[str] = None
    max_tokens: Optional[int] = None
    execution_metadata: Optional[Dict[str, Any]] = None  # Renamed from 'metadata' to avoid SQLAlchemy conflict
    error_message: Optional[str] = None
    execution_time_ms: Optional[int] = None


class AIExecutionResponse(AIExecutionBase):
    """Schema for AIExecution response"""
    id: UUID
    ai_model_id: Optional[UUID]
    input_messages: List[Dict[str, Any]]
    system_prompt: Optional[str]
    response_content: Optional[str]
    input_tokens: Optional[int]
    output_tokens: Optional[int]
    total_tokens: Optional[int]
    temperature: Optional[str]
    max_tokens: Optional[int]
    execution_metadata: Optional[Dict[str, Any]]
    error_message: Optional[str]
    execution_time_ms: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True


class AIExecutionListItem(BaseModel):
    """Schema for AIExecution list item (summary view)"""
    id: UUID
    usage_type: str
    provider: str
    model_name: str
    input_tokens: Optional[int]
    output_tokens: Optional[int]
    total_tokens: Optional[int]
    error_message: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class AIExecutionStats(BaseModel):
    """Schema for execution statistics"""
    total_executions: int
    total_input_tokens: int
    total_output_tokens: int
    total_tokens: int
    executions_by_provider: Dict[str, int]
    executions_by_usage_type: Dict[str, int]
    avg_execution_time_ms: Optional[float]
