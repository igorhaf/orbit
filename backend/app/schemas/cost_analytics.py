"""
Cost Analytics Schemas
Schemas for cost analytics endpoints and responses

PROMPT #54.2 - Phase 2: Cost Analytics Dashboard
"""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime


class CostByProvider(BaseModel):
    """Cost breakdown by AI provider"""
    provider: str
    total_cost: float
    input_tokens: int
    output_tokens: int
    total_tokens: int
    execution_count: int


class CostByUsageType(BaseModel):
    """Cost breakdown by usage type"""
    usage_type: str
    total_cost: float
    input_tokens: int
    output_tokens: int
    total_tokens: int
    execution_count: int
    avg_cost_per_execution: float


class DailyCost(BaseModel):
    """Cost breakdown by day"""
    date: str  # YYYY-MM-DD format
    total_cost: float
    input_tokens: int
    output_tokens: int
    total_tokens: int
    execution_count: int


class CostSummary(BaseModel):
    """Overall cost summary"""
    total_cost: float
    total_input_tokens: int
    total_output_tokens: int
    total_tokens: int
    total_executions: int
    avg_cost_per_execution: float
    date_range_start: Optional[datetime]
    date_range_end: Optional[datetime]


class CostAnalyticsResponse(BaseModel):
    """
    Complete cost analytics response

    PROMPT #54.2 - Phase 2: Aggregated cost data for dashboard
    """
    summary: CostSummary
    by_provider: List[CostByProvider]
    by_usage_type: List[CostByUsageType]
    daily_costs: List[DailyCost]


class AIExecutionWithCost(BaseModel):
    """
    AI Execution with calculated cost

    PROMPT #54.2 - Phase 2: Add cost to execution response
    """
    id: str
    usage_type: str
    provider: str
    model_name: Optional[str]
    input_tokens: int
    output_tokens: int
    total_tokens: int
    execution_time_ms: Optional[int]
    status: str
    created_at: datetime

    # Calculated fields
    cost: float = Field(..., description="Calculated cost in USD")
    input_cost: float = Field(..., description="Cost of input tokens")
    output_cost: float = Field(..., description="Cost of output tokens")

    class Config:
        from_attributes = True


class CostAnalyticsFilters(BaseModel):
    """
    Filters for cost analytics queries

    PROMPT #54.2 - Phase 2: Filter cost data by various criteria
    """
    start_date: Optional[datetime] = Field(None, description="Start date for filtering")
    end_date: Optional[datetime] = Field(None, description="End date for filtering")
    provider: Optional[str] = Field(None, description="Filter by provider (anthropic, openai, google)")
    usage_type: Optional[str] = Field(None, description="Filter by usage type")
    model_name: Optional[str] = Field(None, description="Filter by specific model")
