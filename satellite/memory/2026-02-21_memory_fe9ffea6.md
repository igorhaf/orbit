# memory — 2026-02-21

**Model:** ollama/qwen3:8b
**Status:** success
**Tokens:** 809 in / 1054 out | Cost: $0.0061

## System Prompt

Voce e um analista de negocios. Extraia APENAS regras de NEGOCIO FUNCIONAIS do codigo. FOQUE em: o que o USUARIO pode fazer, permissoes, fluxos, limites, calculos de negocio. IGNORE completamente: tipos de campo, configs de framework, drivers, sessoes, CSS, logs, booleanos, chaves estrangeiras, detalhes tecnicos de infraestrutura. Escreva cada regra como se explicasse para um GERENTE DE PRODUTO, nao para um programador. Responda APENAS com JSON valido, em portugues brasileiro: {"business_rules":[{"rule_text":"...","rule_type":"validation|workflow|constraint|domain","confidence":"high|medium"}]}

## User Prompt

backend/app/schemas/ai_execution.py (python):
"""
AIExecution Pydantic Schemas
Request/Response models for AIExecution endpoints
PROMPT #54 - AI Execution Logging System
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field


class AIExecutionBase(BaseModel):
    """Base schema for AIExecution"""
    usage_type: str = Field(..., description="Type of usage (interview, prompt_generation, etc.)")
    provider: str = Field(..., description="Provider (anthropic, openai, google)")
    model_name: str = Field(..., description="Model name (claude-3-5-sonnet, gpt-4, etc.)")


class AIExecutionCreate(BaseModel):
    """Schema for creating a new AIExecution (internal use only)"""
    ai_model_id: Optional[UUID] = None
    usage_type: str
    input_messages: List[Dict[str, Any]]
    system_prompt: Optional[str] = None
    response_content: Optional[str] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    provider: str
    model_name: str
    temperature: Optional[str] = None
    max_tokens: Optional[int] = None
    execution_metadata: Optional[Dict[str, Any]] = None  # Renamed from 'metadata' to avoid SQLAlchemy conflict
    error_message: Optional[str] = None
    execution_time_ms: Optional[int] = None


class AIExecutionResponse(AIExecutionBase):
    """Schema for AIExecution response"""
    id: UUID
    ai_model_id: Optional[UUID]
    input_messages: List[Dict[str, Any]]
    system_prompt: Optional[str]
    response_content: Optional[str]
    input_tokens: Optional[int]
    output_tokens: Optional[int]
    total_tokens: Optional[int]
    temperature: Optional[str]
    max_tokens: Optional[int]
    execution_metadata: Optional[Dict[str, Any]]
    error_message: Optional[str]
    execution_time_ms: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True


class AIExecutionListItem(BaseModel):
    """Schema for AIExecution list item (summary view)"""
    id: UUID
    usage_type: str
    provider: str
    model_name: str
    input_tokens: Optional[int]
    output_tokens: Optional[int]
    total_tokens: Optional[int]
    error_message: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class AIExecutionStats(BaseModel):
    """Schema for execution statistics"""
    total_executions: int
    total_input_tokens: int
    total_output_tokens: int
    total_tokens: int
    executions_by_provider: Dict[str, int]
    executions_by_usage_type: Dict[str, int]
    avg_execution_time_ms: Optional[float]


## Response

{
  "business_rules": [
    {
      "rule_text": "O usuário pode especificar o tipo de uso (ex: entrevista, geração de prompt) ao criar uma execução de IA.",
      "rule_type": "validation",
      "confidence": "high"
    },
    {
      "rule_text": "O sistema calcula e armazena o total de tokens (input + output) para cada execução de IA.",
      "rule_type": "domain",
      "confidence": "high"
    },
    {
      "rule_text": "O usuário pode visualizar detalhes completos de uma execução de IA, incluindo conteúdo da resposta e métricas de tokens.",
      "rule_type": "validation",
      "confidence": "high"
    },
    {
      "rule_text": "O sistema permite visualizar resumos de execuções de IA com métricas-chave como tokens e tempo de execução.",
      "rule_type": "workflow",
      "confidence": "high"
    },
    {
      "rule_text": "O usuário pode acessar estatísticas agregadas de execuções de IA, incluindo totais de tokens e médias de tempo.",
      "rule_type": "workflow",
      "confidence": "high"
    },
    {
      "rule_text": "A criação de registros de execução de IA é restrita a uso interno (não acessível por usuários finais).",
      "rule_type": "constraint",
      "confidence": "medium"
    },
    {
      "rule_text": "Mensagens de erro são armazenadas apenas quando ocorrerem durante a execução de IA.",
      "rule_type": "constraint",
      "confidence": "medium"
    },
    {
      "rule_text": "O sistema registra o tempo de execução em milissegundos para fins de análise de desempenho.",
      "rule_type": "domain",
      "confidence": "high"
    }
  ]
}
