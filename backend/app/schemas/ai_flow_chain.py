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


# ============================================================================
# PROMPT #124 - Model Metrics, Chain Analytics, Smart Reorder, Templates
# ============================================================================

class ModelMetrics(BaseModel):
    model_id: str
    model_name: str
    provider: str
    total_executions: int = 0
    successful_executions: int = 0
    failed_executions: int = 0
    success_rate: float = 0.0
    health: str = "green"
    avg_latency_ms: float = 0.0
    avg_cost_per_call: float = 0.0
    last_execution_at: Optional[datetime] = None
    fallback_count: int = 0


class ModelMetricsResponse(BaseModel):
    metrics: List[ModelMetrics] = Field(default_factory=list)
    lookback_days: int = 7


class ChainModelStats(BaseModel):
    model_id: str
    model_name: str
    provider: str
    total_attempts: int = 0
    failures: int = 0
    failure_rate: float = 0.0
    avg_cost: float = 0.0
    avg_latency_ms: float = 0.0
    times_as_primary: int = 0
    times_as_fallback: int = 0


class ChainAnalyticsItem(BaseModel):
    usage_type: str
    total_executions: int = 0
    total_cost: float = 0.0
    fallback_rate: float = 0.0
    avg_chain_depth: float = 0.0
    primary_success_rate: float = 0.0
    models: List[ChainModelStats] = Field(default_factory=list)
    cost_savings: float = 0.0


class ChainAnalyticsResponse(BaseModel):
    analytics: List[ChainAnalyticsItem] = Field(default_factory=list)
    most_failing_model: Optional[ChainModelStats] = None
    total_cost_all_chains: float = 0.0
    total_fallback_savings: float = 0.0
    lookback_days: int = 30


class OptimizeChainRequest(BaseModel):
    strategy: str = Field(default="balanced", description="reliability, cost, quality, or balanced")
    days: int = Field(default=30, description="Lookback window for analysis")


class OptimizeModelScore(BaseModel):
    model_id: str
    model_name: str
    provider: str
    score: float = 0.0
    reasoning: str = ""


class OptimizeChainResponse(BaseModel):
    current_order: List[str] = Field(default_factory=list)
    recommended_order: List[str] = Field(default_factory=list)
    strategy: str = "balanced"
    models: List[OptimizeModelScore] = Field(default_factory=list)
    estimated_improvement: Dict[str, str] = Field(default_factory=dict)


class ChainTemplate(BaseModel):
    id: str
    name: str
    description: str
    chain: List[str] = Field(default_factory=list)
    models: List[Dict[str, Any]] = Field(default_factory=list)


class ChainTemplatesResponse(BaseModel):
    templates: List[ChainTemplate] = Field(default_factory=list)
