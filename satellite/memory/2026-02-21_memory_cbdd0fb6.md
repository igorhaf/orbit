# memory — 2026-02-21

**Model:** ollama/qwen3:8b
**Status:** success
**Tokens:** 856 in / 878 out | Cost: $0.0052

## System Prompt

Voce e um analista de negocios. Extraia APENAS regras de NEGOCIO FUNCIONAIS do codigo. FOQUE em: o que o USUARIO pode fazer, permissoes, fluxos, limites, calculos de negocio. IGNORE completamente: tipos de campo, configs de framework, drivers, sessoes, CSS, logs, booleanos, chaves estrangeiras, detalhes tecnicos de infraestrutura. Escreva cada regra como se explicasse para um GERENTE DE PRODUTO, nao para um programador. Responda APENAS com JSON valido, em portugues brasileiro: {"business_rules":[{"rule_text":"...","rule_type":"validation|workflow|constraint|domain","confidence":"high|medium"}]}

## User Prompt

backend/app/schemas/cost_analytics.py (python):
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


## Response

{
  "business_rules": [
    {
      "rule_text": "O usuário pode filtrar dados de custo por provedor de IA (ex: Anthropic, OpenAI, Google).",
      "rule_type": "constraint",
      "confidence": "medium"
    },
    {
      "rule_text": "O usuário pode filtrar dados de custo por tipo de uso (ex: inferência, treinamento).",
      "rule_type": "constraint",
      "confidence": "medium"
    },
    {
      "rule_text": "O usuário pode filtrar dados de custo por intervalo de datas (data de início e fim).",
      "rule_type": "constraint",
      "confidence": "medium"
    },
    {
      "rule_text": "O sistema calcula o custo total por execução com base em tokens de entrada e saída, seguindo taxas definidas por provedor.",
      "rule_type": "calculation",
      "confidence": "high"
    },
    {
      "rule_text": "O dashboard agrupa dados de custo em resumo geral, por provedor, por tipo de uso e diariamente, exibindo métricas agregadas.",
      "rule_type": "workflow",
      "confidence": "high"
    },
    {
      "rule_text": "Cada execução de IA inclui custos calculados separadamente para tokens de entrada e saída, com total de custo por execução.",
      "rule_type": "calculation",
      "confidence": "high"
    }
  ]
}
