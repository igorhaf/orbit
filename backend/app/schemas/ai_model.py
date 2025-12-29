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
    api_key: str = Field(..., min_length=1, max_length=255, description="API key")

    @field_validator('provider')
    @classmethod
    def validate_provider(cls, v: str) -> str:
        """Validate provider is supported"""
        supported = ['anthropic', 'openai', 'google', 'local', 'custom']
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
    """Schema for AIModel response (without API key)"""
    id: UUID
    created_at: datetime
    updated_at: datetime
    # api_key is intentionally excluded for security

    class Config:
        from_attributes = True
        use_enum_values = True


class AIModelDetailResponse(AIModelResponse):
    """Schema for detailed AIModel response (includes masked API key)"""
    api_key_preview: Optional[str] = None

    @classmethod
    def from_model(cls, model: Any) -> "AIModelDetailResponse":
        """Create response with masked API key"""
        data = {
            "id": model.id,
            "name": model.name,
            "provider": model.provider,
            "usage_type": model.usage_type,
            "is_active": model.is_active,
            "config": model.config,
            "created_at": model.created_at,
            "updated_at": model.updated_at,
        }

        # Mask API key - show only first 8 and last 4 characters
        if model.api_key and len(model.api_key) > 12:
            data["api_key_preview"] = f"{model.api_key[:8]}...{model.api_key[-4:]}"
        else:
            data["api_key_preview"] = "***"

        return cls(**data)
