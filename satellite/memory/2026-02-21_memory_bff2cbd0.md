# memory — 2026-02-21

**Model:** ollama/qwen3:8b
**Status:** success
**Tokens:** 627 in / 859 out | Cost: $0.0049

## System Prompt

Voce e um analista de negocios. Extraia APENAS regras de NEGOCIO FUNCIONAIS do codigo. FOQUE em: o que o USUARIO pode fazer, permissoes, fluxos, limites, calculos de negocio. IGNORE completamente: tipos de campo, configs de framework, drivers, sessoes, CSS, logs, booleanos, chaves estrangeiras, detalhes tecnicos de infraestrutura. Escreva cada regra como se explicasse para um GERENTE DE PRODUTO, nao para um programador. Responda APENAS com JSON valido, em portugues brasileiro: {"business_rules":[{"rule_text":"...","rule_type":"validation|workflow|constraint|domain","confidence":"high|medium"}]}

## User Prompt

backend/app/models/ai_flow_chain.py (python):
"""
AIFlowChain Model
Stores per-usage_type ordered fallback chains of AI model IDs.
PROMPT #122 - AI Flow: Visual Fallback Chain Configuration
PROMPT #204 - Utility Nodes (Cache, RAG, Transformer, Router, Retry, Validator, Cost Guard, Rate Limiter)
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, Boolean, DateTime, JSON, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base
from app.models.ai_model import AIModelUsageType


class AIFlowChain(Base):
    """
    AIFlowChain model - Stores fallback chain configuration per usage_type.

    Only ONE chain per usage_type (unique constraint).
    The chain field is a JSON array of AI Model UUIDs in fallback order.
    The utility_nodes field stores configuration for non-model nodes
    (Cache, RAG Context, Prompt Transformer, Router, Retry, Validator, Cost Guard, Rate Limiter).
    """

    __tablename__ = "ai_flow_chains"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)
    usage_type = Column(
        SQLEnum(
            AIModelUsageType,
            name="ai_model_usage_type",
            values_callable=lambda x: [e.value for e in x],
            create_type=False,
        ),
        nullable=False,
        unique=True,
        index=True,
    )
    chain = Column(JSON, nullable=False, default=list)
    node_positions = Column(JSON, nullable=True, default=None)
    utility_nodes = Column(JSON, nullable=True, default=None)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<AIFlowChain(id={self.id}, usage_type='{self.usage_type}', chain_length={len(self.chain or [])})>"


## Response

{
  "business_rules": [
    {
      "rule_text": "Cada tipo de uso (usage_type) deve ter exatamente uma cadeia de fallback configurada, não sendo possível criar mais de uma cadeia para o mesmo tipo de uso.",
      "rule_type": "constraint",
      "confidence": "high"
    },
    {
      "rule_text": "A cadeia de fallback (chain) deve conter pelo menos um modelo AI, garantindo que haja sempre uma opção de fallback disponível.",
      "rule_type": "validation",
      "confidence": "high"
    },
    {
      "rule_text": "Usuários podem configurar nós utilitários (como Cache, RAG, Transformador, Roteador, etc.) para complementar a cadeia de fallback, definindo a ordem e as configurações desses nós.",
      "rule_type": "workflow",
      "confidence": "medium"
    },
    {
      "rule_text": "É possível ativar ou desativar uma cadeia de fallback, controlando se ela é usada em tempo real ou não.",
      "rule_type": "permission",
      "confidence": "medium"
    },
    {
      "rule_text": "A ordem dos modelos na cadeia define a prioridade de fallback, sendo o primeiro modelo a ser executado e os subsequentes apenas se o anterior falhar.",
      "rule_type": "workflow",
      "confidence": "high"
    }
  ]
}
