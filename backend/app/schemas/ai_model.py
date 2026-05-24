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
        default="claudius",
        min_length=1,
        max_length=50,
        description="AI provider (v2.5: always 'claudius')"
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
    # Rate Limiting (PROMPT #152)
    rate_limit_requests: Optional[int] = Field(
        None,
        description="Maximum requests allowed per time window (None = no limit)"
    )
    rate_limit_window_seconds: Optional[int] = Field(
        None,
        description="Time window size in seconds (None = no limit)"
    )
    # Timeout (PROMPT #207)
    timeout_seconds: Optional[int] = Field(
        None,
        description="API timeout in seconds for this model (None = use system default)"
    )
    # Concurrency (PROMPT #228)
    max_concurrent_requests: Optional[int] = Field(
        None,
        description="Max parallel API calls to this model (None = unlimited)"
    )


class AIModelCreate(AIModelBase):
    """Schema for creating a new AIModel"""
    api_key: str = Field(default="not-needed", max_length=255, description="API key (claudius proxy doesn't require one)")

    @field_validator('provider')
    @classmethod
    def validate_provider(cls, v: str) -> str:
        """v2.5: claudius-only lockdown. Only 'claudius' accepted."""
        if v.lower() != 'claudius':
            raise ValueError("Provider must be 'claudius' (v2.5 claudius-only lockdown)")
        return 'claudius'


class AIModelUpdate(BaseModel):
    """Schema for updating an existing AIModel"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    provider: Optional[str] = Field(None, min_length=1, max_length=50)
    # Allow empty string for local providers like Ollama that don't require API keys
    api_key: Optional[str] = Field(None, max_length=255)
    usage_type: Optional[AIModelUsageType] = None
    is_active: Optional[bool] = None
    config: Optional[Dict[str, Any]] = None
    # Rate Limiting (PROMPT #152)
    rate_limit_requests: Optional[int] = None
    rate_limit_window_seconds: Optional[int] = None
    # Timeout (PROMPT #207)
    timeout_seconds: Optional[int] = None
    # Concurrency (PROMPT #228)
    max_concurrent_requests: Optional[int] = None


class AIModelResponse(AIModelBase):
    """Schema for AIModel response (API key masked for security)"""
    id: UUID
    api_key: str  # Masked in response - PROMPT #234 SEC-1
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
        use_enum_values = True

    @field_validator('api_key', mode='before')
    @classmethod
    def mask_api_key(cls, v: str) -> str:
        """Mask API key - show only last 4 characters for security"""
        if not v or len(v) <= 4:
            return '***'
        return f'***...{v[-4:]}'


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
