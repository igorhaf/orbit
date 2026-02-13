"""
Wiki Pydantic Schemas
PROMPT #261 - Multi-page Wiki System
"""

from datetime import datetime
from typing import Optional, List
from uuid import UUID
from pydantic import BaseModel, Field


class WikiPageBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    slug: str = Field(..., min_length=1, max_length=255)
    content: str = ""
    parent_id: Optional[UUID] = None
    order_index: int = 0


class WikiPageCreate(WikiPageBase):
    source: str = "manual"


class WikiPageUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    parent_id: Optional[UUID] = None
    order_index: Optional[int] = None


class WikiPageResponse(WikiPageBase):
    id: UUID
    project_id: UUID
    source: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class WikiPageTreeItem(BaseModel):
    id: UUID
    slug: str
    title: str
    parent_id: Optional[UUID] = None
    order_index: int = 0
    source: str = "manual"
    children: List["WikiPageTreeItem"] = []

    class Config:
        from_attributes = True


WikiPageTreeItem.model_rebuild()
