# memory — 2026-02-21

**Model:** claudio/claude-sonnet-4-6
**Status:** success
**Tokens:** 0 in / 0 out | Cost: $0.0000

## System Prompt

Você é um ANALISTA DE NEGÓCIOS experiente analisando código-fonte para extrair regras de negócio FUNCIONAIS.

Sua perspectiva é de NEGÓCIO, não de tecnologia. Imagine que você está escrevendo um documento
para o GERENTE DE PRODUTO ou DONO DO NEGÓCIO que não entende código.

EXTRAIA regras que respondam:
- O que o USUÁRIO pode ou não pode fazer?
- Quais são as PERMISSÕES e RESTRIÇÕES de acesso?
- Como funcionam os FLUXOS e PROCESSOS do sistema?
- Quais CÁLCULOS de negócio existem (preços, comissões, notas)?
- Quais LIMITES e QUOTAS o sistema impõe?
- Quais VALIDAÇÕES afetam a experiência do usuário?
- Como as ENTIDADES do negócio se relacionam?

IGNORE COMPLETAMENTE (não são regras de negócio):
- Tipos de campos (booleano, string, integer)
- Configurações de framework (drivers, sessões, guards, middleware)
- Detalhes de banco (foreign keys, NOT NULL, migrations)
- CSS, layout, estilização
- Logs, cache, filas, timeouts
- Imports, dependências, bibliotecas
- Configurações de ambiente (.env, configs)
- Código boilerplate ou padrões técnicos

FORMATO das regras (escreva como linguagem de negócio):
✅ BOM: "O aluno só pode avaliar um curso após completar pelo menos 50% das aulas"
✅ BOM: "O instrutor recebe 70% do valor de cada inscrição em seu curso"
✅ BOM: "Cupons de desconto expiram após a data limite definida pelo instrutor"
❌ RUIM: "O campo 'rating' deve ser um integer entre 1 e 5"
❌ RUIM: "A tabela enrollments tem foreign key para courses"
❌ RUIM: "O guard 'web' usa driver de sessão"

Responda APENAS em JSON válido, sem markdown, sem explicações adicionais.

## User Prompt

Arquivo: backend/app/schemas/prompt.py
Linguagem: python

```
"""
Prompt Pydantic Schemas
Request/Response models for Prompt endpoints
"""

from datetime import datetime
from typing import Optional, List
from uuid import UUID
from pydantic import BaseModel, Field


class PromptBase(BaseModel):
    """Base schema for Prompt"""
    content: str = Field(default="", description="Prompt content (legacy field, use response for AI outputs)")
    type: str = Field(
        default="user",
        max_length=50,
        description="Prompt type (system, user, template, etc.)"
    )
    is_reusable: bool = Field(default=False, description="Whether prompt is reusable")
    components: Optional[List[str]] = Field(
        default_factory=list,
        description="List of reusable components"
    )


class PromptCreate(PromptBase):
    """Schema for creating a new Prompt"""
    project_id: UUID
    created_from_interview_id: Optional[UUID] = None
    parent_id: Optional[UUID] = None


class PromptUpdate(BaseModel):
    """Schema for updating an existing Prompt"""
    content: Optional[str] = Field(None, min_length=1)
    type: Optional[str] = Field(None, max_length=50)
    is_reusable: Optional[bool] = None
    components: Optional[List[str]] = None


class PromptResponse(PromptBase):
    """Schema for Prompt response - PROMPT #58 Enhanced with audit fields"""
    id: UUID
    project_id: UUID
    created_from_interview_id: Optional[UUID]
    parent_id: Optional[UUID]
    version: int
    created_at: datetime
    updated_at: datetime

    # PROMPT #58 - AI Execution Audit Fields
    ai_model_used: Optional[str] = None
    system_prompt: Optional[str] = None
    user_prompt: Optional[str] = None
    response: Optional[str] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    total_cost_usd: Optional[float] = None
    execution_time_ms: Optional[int] = None
    execution_metadata: Optional[dict] = None
    status: Optional[str] = None
    error_message: Optional[str] = None

    class Config:
        from_attributes = True


class PromptGenerateRequest(BaseModel):
    """Schema for generating prompts from interview"""
    interview_id: UUID
    project_id: UUID

```

Extraia as regras de negócio FUNCIONAIS deste arquivo.
Escreva cada regra como se explicasse para um GERENTE DE PRODUTO.
Responda em JSON com este formato exato:

{
  "business_rules": [
    {
      "rule_text": "Descrição funcional da regra em linguagem de negócio",
      "rule_type": "domain|validation|constraint|workflow|permission|calculation",
      "confidence": "high|medium|low",
      "source_context": "trecho relevante do código (max 100 chars)"
    }
  ],
  "entities_found": ["Entidade1", "Entidade2"],
  "file_purpose": "Breve descrição do propósito do arquivo (1 frase)",
  "file_layer": "schema|routes|logic|presentation|config"
}

Se não houver regras de negócio FUNCIONAIS, retorne: {"business_rules": [], "entities_found": [], "file_purpose": "..."}
Arquivos de configuração, estilização e infraestrutura geralmente NÃO contêm regras de negócio.

## Response


