"""
AIModel Pydantic Schemas
Request/Response models for AIModel endpoints
"""

from datetime import datetime
from typing import Optional, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field, field_validator

from app.models.ai_model import AIModelUsageType


class AIModelBase(BaseModel):
    """Base schema for AIModel"""
    name: str = Field(..., min_length=1, max_length=100, description="Model name")
    provider: str = Field(
        ...,
        min_length=1,
        max_length=50,
        description="AI provider (anthropic, openai, etc.)"
    )
    usage_type: AIModelUsageType = Field(
        default=AIModelUsageType.GENERAL,
        description="Type of usage for this model"
    )
    is_active: bool = Field(default=True, description="Whether model is active")
    config: Optional[Dict[str, Any]] = Field(
        default_factory=dict,
        description="Additional configuration"
    )


class AIModelCreate(AIModelBase):
    """Schema for creating a new AIModel"""
    api_key: str = Field(..., max_length=255, description="API key (can be empty for local providers like Ollama)")

    @field_validator('provider')
    @classmethod
    def validate_provider(cls, v: str) -> str:
        """Validate provider is supported"""
        supported = ['anthropic', 'openai', 'google', 'ollama', 'local', 'custom']
        if v.lower() not in supported:
            raise ValueError(f"Provider must be one of: {', '.join(supported)}")
        return v.lower()


class AIModelUpdate(BaseModel):
    """Schema for updating an existing AIModel"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    provider: Optional[str] = Field(None, min_length=1, max_length=50)
    api_key: Optional[str] = Field(None, min_length=1, max_length=255)
    usage_type: Optional[AIModelUsageType] = None
    is_active: Optional[bool] = None
    config: Optional[Dict[str, Any]] = None


class AIModelResponse(AIModelBase):
    """Schema for AIModel response (includes API key for development)"""
    id: UUID
    api_key: str  # Included for development/debugging
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
        use_enum_values = True


class AIModelDetailResponse(AIModelBase):
    """Schema for detailed AIModel response (includes masked API key preview)"""
    id: UUID
    api_key_preview: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
        use_enum_values = True

    @classmethod
    def from_model(cls, model: Any) -> "AIModelDetailResponse":
        """Create response with masked API key"""
        # Mask API key - show only first 8 and last 4 characters
        if model.api_key and len(model.api_key) > 12:
            api_key_preview = f"{model.api_key[:8]}...{model.api_key[-4:]}"
        else:
            api_key_preview = "***"

        return cls(
            id=model.id,
            name=model.name,
            provider=model.provider,
            usage_type=model.usage_type,
            is_active=model.is_active,
            config=model.config,
            created_at=model.created_at,
            updated_at=model.updated_at,
            api_key_preview=api_key_preview
        )
