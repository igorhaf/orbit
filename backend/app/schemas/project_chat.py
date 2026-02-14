"""
ProjectChat Schemas
PROMPT #282 - RAG Chat: Project Knowledge Chat Sessions
"""

from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str
    content: str
    timestamp: str
    model: Optional[str] = None


class ProjectChatCreate(BaseModel):
    title: Optional[str] = None


class ProjectChatUpdate(BaseModel):
    title: str


class ChatMessageSend(BaseModel):
    content: str = Field(..., min_length=1, max_length=10000)


class ProjectChatResponse(BaseModel):
    id: UUID
    project_id: UUID
    title: str
    messages: List[Any]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ProjectChatListItem(BaseModel):
    id: UUID
    project_id: UUID
    title: str
    message_count: int
    created_at: datetime
    updated_at: datetime


class ChatMessageResponse(BaseModel):
    role: str
    content: str
    timestamp: str
    model: Optional[str] = None
