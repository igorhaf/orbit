# memory — 2026-02-21

**Model:** ollama/qwen3:8b
**Status:** success
**Tokens:** 604 in / 1041 out | Cost: $0.0058

## System Prompt

Voce e um analista de negocios. Extraia APENAS regras de NEGOCIO FUNCIONAIS do codigo. FOQUE em: o que o USUARIO pode fazer, permissoes, fluxos, limites, calculos de negocio. IGNORE completamente: tipos de campo, configs de framework, drivers, sessoes, CSS, logs, booleanos, chaves estrangeiras, detalhes tecnicos de infraestrutura. Escreva cada regra como se explicasse para um GERENTE DE PRODUTO, nao para um programador. Responda APENAS com JSON valido, em portugues brasileiro: {"business_rules":[{"rule_text":"...","rule_type":"validation|workflow|constraint|domain","confidence":"high|medium"}]}

## User Prompt

backend/app/schemas/commit.py (python):
"""
Commit Pydantic Schemas
Request/Response models for Commit endpoints
"""

from datetime import datetime
from typing import Optional, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field

from app.models.commit import CommitType


class CommitBase(BaseModel):
    """Base schema for Commit"""
    type: CommitType = Field(..., description="Type of commit (feat, fix, etc.)")
    message: str = Field(..., min_length=1, description="Commit message")
    changes: Optional[Dict[str, Any]] = Field(
        default_factory=dict,
        description="Details of changes"
    )
    created_by_ai_model: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="AI model that generated the commit"
    )
    author: str = Field(
        default="AI System",
        max_length=100,
        description="Commit author"
    )


class CommitCreate(CommitBase):
    """Schema for creating a new Commit"""
    task_id: UUID
    project_id: UUID


class CommitUpdate(BaseModel):
    """Schema for updating an existing Commit (limited fields)"""
    message: Optional[str] = Field(None, min_length=1)
    changes: Optional[Dict[str, Any]] = None


class CommitResponse(CommitBase):
    """Schema for Commit response"""
    id: UUID
    task_id: UUID
    project_id: UUID
    timestamp: datetime

    class Config:
        from_attributes = True
        use_enum_values = True


class CommitGenerateRequest(BaseModel):
    """Schema for requesting AI to generate a commit"""
    task_id: UUID
    project_id: UUID
    changes_context: Optional[str] = Field(
        None,
        description="Context about what changed"
    )


class CommitManualGenerateRequest(BaseModel):
    """Schema for manual commit generation with description"""
    description: str = Field(..., description="Description of changes made")


## Response

{
  "business_rules": [
    {
      "rule_text": "O usuário pode criar um commit fornecendo um task_id e project_id obrigatórios, além do tipo e mensagem do commit.",
      "rule_type": "workflow",
      "confidence": "high"
    },
    {
      "rule_text": "O usuário pode atualizar apenas a mensagem ou detalhes de alterações de um commit existente, com a mensagem exigindo no mínimo 1 caractere.",
      "rule_type": "workflow",
      "confidence": "high"
    },
    {
      "rule_text": "O usuário pode solicitar a geração de um commit via IA fornecendo task_id, project_id e contexto de alterações (opcional).",
      "rule_type": "workflow",
      "confidence": "high"
    },
    {
      "rule_text": "O usuário pode criar um commit manualmente fornecendo uma descrição detalhada das alterações realizadas.",
      "rule_type": "workflow",
      "confidence": "high"
    },
    {
      "rule_text": "A mensagem do commit deve ter no mínimo 1 caractere e o nome do modelo de IA gerador deve ter entre 1 e 100 caracteres.",
      "rule_type": "validation",
      "confidence": "high"
    },
    {
      "rule_text": "O autor de um commit gerado por IA é automaticamente definido como 'AI System', mas pode ser sobrescrito por um valor fornecido pelo usuário.",
      "rule_type": "constraint",
      "confidence": "high"
    },
    {
      "rule_text": "O sistema gera automaticamente um ID único e um timestamp para cada commit criado.",
      "rule_type": "workflow",
      "confidence": "high"
    }
  ]
}
