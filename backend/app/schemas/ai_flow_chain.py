"""
AIFlowChain Pydantic Schemas
PROMPT #122 - AI Flow: Visual Fallback Chain Configuration
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID
from pydantic import BaseModel, Field

from app.models.ai_model import AIModelUsageType


class AIFlowChainBase(BaseModel):
    chain: List[str] = Field(
        default_factory=list,
        description="Ordered list of AI Model UUIDs representing the fallback sequence",
    )
    node_positions: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Saved node positions for the flow diagram {nodeId: {x, y}}",
    )
    is_active: bool = Field(default=True)


class AIFlowChainCreate(AIFlowChainBase):
    usage_type: AIModelUsageType


class AIFlowChainUpdate(BaseModel):
    chain: Optional[List[str]] = None
    node_positions: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None


class AIFlowChainResponse(AIFlowChainBase):
    id: UUID
    usage_type: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
        use_enum_values = True


class AIFlowChainModelInfo(BaseModel):
    id: str
    name: str
    provider: str
    usage_type: str
    is_active: bool
    config: dict = Field(default_factory=dict)
    rate_limit_requests: Optional[int] = None
    rate_limit_window_seconds: Optional[int] = None


class AIFlowChainWithModels(AIFlowChainResponse):
    models: List[AIFlowChainModelInfo] = Field(default_factory=list)
