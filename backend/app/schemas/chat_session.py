"""
ChatSession Pydantic Schemas
Request/Response models for ChatSession endpoints
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field

from app.models.chat_session import ChatSessionStatus


class ChatMessage(BaseModel):
    """Schema for a single chat message"""
    role: str = Field(..., pattern="^(user|assistant|system)$", description="Message role")
    content: str = Field(..., min_length=1, description="Message content")
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class ChatSessionBase(BaseModel):
    """Base schema for ChatSession"""
    ai_model_used: str = Field(..., min_length=1, max_length=100, description="AI model name")
    messages: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Array of chat messages"
    )
    status: ChatSessionStatus = Field(default=ChatSessionStatus.ACTIVE)


class ChatSessionCreate(BaseModel):
    """Schema for creating a new ChatSession"""
    task_id: UUID
    ai_model_used: str = Field(..., min_length=1, max_length=100)
    messages: Optional[List[Dict[str, Any]]] = Field(default_factory=list)


class ChatSessionUpdate(BaseModel):
    """Schema for updating an existing ChatSession"""
    messages: Optional[List[Dict[str, Any]]] = None
    status: Optional[ChatSessionStatus] = None


class ChatSessionAddMessage(BaseModel):
    """Schema for adding a message to a chat session"""
    role: str = Field(..., pattern="^(user|assistant|system)$")
    content: str = Field(..., min_length=1)


class ChatSessionResponse(ChatSessionBase):
    """Schema for ChatSession response"""
    id: UUID
    task_id: UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
        use_enum_values = True
