"""
SystemSettings Pydantic Schemas
Request/Response models for SystemSettings endpoints
"""

from datetime import datetime
from typing import Optional, Any
from uuid import UUID
from pydantic import BaseModel, Field


class SystemSettingsBase(BaseModel):
    """Base schema for SystemSettings"""
    key: str = Field(..., min_length=1, max_length=100, description="Setting key")
    value: Optional[Any] = Field(None, description="Setting value (JSON)")
    description: Optional[str] = Field(None, description="Setting description")


class SystemSettingsCreate(SystemSettingsBase):
    """Schema for creating a new SystemSettings"""
    pass


class SystemSettingsUpdate(BaseModel):
    """Schema for updating an existing SystemSettings"""
    value: Optional[Any] = None
    description: Optional[str] = None


class SystemSettingsResponse(SystemSettingsBase):
    """Schema for SystemSettings response"""
    id: UUID
    updated_at: datetime

    class Config:
        from_attributes = True


class SystemSettingsBulkUpdate(BaseModel):
    """Schema for bulk updating system settings"""
    settings: dict[str, Any] = Field(
        ...,
        description="Dictionary of key-value pairs to update"
    )
