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

Arquivo: backend/app/models/task_relationship.py
Linguagem: python

```
"""
TaskRelationship Model
Represents relationships between tasks (blocks, depends_on, relates_to, duplicates)
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, DateTime, ForeignKey, Enum as SQLEnum, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import enum

from app.database import Base


class RelationshipType(str, enum.Enum):
    """Relationship types between tasks"""
    BLOCKS = "blocks"              # Source blocks Target
    BLOCKED_BY = "blocked_by"      # Source blocked by Target (inverse of blocks)
    DEPENDS_ON = "depends_on"      # Source depends on Target
    RELATES_TO = "relates_to"      # General relationship
    DUPLICATES = "duplicates"      # Source duplicates Target
    CLONES = "clones"              # Source is clone of Target


class TaskRelationship(Base):
    """
    TaskRelationship model - Represents directed relationships between tasks

    Attributes:
        id: Unique identifier
        source_task_id: Task initiating the relationship
        target_task_id: Task being related to
        relationship_type: Type of relationship
        created_at: When relationship was created
    """

    __tablename__ = "task_relationships"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)

    # Foreign keys
    source_task_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    target_task_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # Relationship metadata
    relationship_type = Column(
        SQLEnum(RelationshipType, name="relationship_type", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        index=True
    )

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    source_task = relationship(
        "Task",
        foreign_keys=[source_task_id],
        back_populates="relationships_as_source"
    )
    target_task = relationship(
        "Task",
        foreign_keys=[target_task_id],
        back_populates="relationships_as_target"
    )

    # Composite indexes for performance
    # PROMPT #233 - DB-4 fix: prevent duplicate relationships
    __table_args__ = (
        Index('ix_task_rel_source_target', 'source_task_id', 'target_task_id'),
        Index('ix_task_rel_type_source', 'relationship_type', 'source_task_id'),
        UniqueConstraint('source_task_id', 'target_task_id', 'relationship_type',
                         name='uq_task_relationship_tuple'),
    )

    def __repr__(self) -> str:
        return f"<TaskRelationship({self.source_task_id} {self.relationship_type.value} {self.target_task_id})>"

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

```json
{
  "business_rules": [
    {
      "rule_text": "Uma tarefa pode bloquear outra tarefa, impedindo seu progresso até que a tarefa bloqueadora seja resolvida",
      "rule_type": "workflow",
      "confidence": "high",
      "source_context": "BLOCKS = \"blocks\" # Source blocks Target"
    },
    {
      "rule_text": "Uma tarefa pode depender de outra tarefa, indicando que sua execução requer a conclusão da tarefa anterior",
      "rule_type": "workflow",
      "confidence": "high",
      "source_context": "DEPENDS_ON = \"depends_on\" # Source depends on Target"
    },
    {
      "rule_text": "Uma tarefa pode ser marcada como duplicata de outra tarefa, sinalizando conteúdo redundante no sistema",
      "rule_type": "domain",
      "confidence": "high",
      "source_context": "DUPLICATES = \"duplicates\" # Source duplicates Target"
    },
    {
      "rule_text": "Uma tarefa pode ser registrada como clone de outra tarefa, indicando que foi originada a partir de uma tarefa existente",
      "rule_type": "domain",
      "confidence": "high",
      "source_context": "CLONES = \"clones\" # Source is clone of Target"
    },
    {
      "rule_text": "Não é permitido criar relacionamentos duplicados entre as mesmas duas tarefas com o mesmo tipo de relacionamento — cada combinação de tarefa de origem, tarefa de destino e tipo de relacionamento deve ser única",
      "rule_type": "constraint",
      "confidence": "high",
      "source_context": "UniqueConstraint('source_task_id', 'target_task_id', 'relationship_type', name='uq_task_relationship_tuple')"
    },
    {
      "rule_text": "Os relacionamentos entre tarefas são direcionais: existe sempre uma tarefa de origem (quem inicia a relação) e uma tarefa de destino (quem recebe a relação), e essa direção tem significado de negócio diferente",
      "rule_type": "domain",
      "confidence": "high",
      "source_context": "source_task_id: Task initiating the relationship / target_task_id: Task being related to"
    },
    {
      "rule_text": "Quando uma tarefa é excluída do sistema, todos os seus relacionamentos (como origem ou destino) são automaticamente removidos, evitando referências inválidas",
      "rule_type": "constraint",
      "confidence": "high",
      "source_context": "ForeignKey(\"tasks.id\", ondelete=\"CASCADE\")"
    },
    {
      "rule_text": "O sistema reconhece o bloqueio bidirecional: tanto 'A bloqueia B' (BLOCKS) quanto 'A está bloqueado por B' (BLOCKED_BY) são tipos de relacionamento distintos e explícitos",
      "rule_type": "workflow",
      "confidence": "high",
      "source_context": "BLOCKS = \"blocks\" / BLOCKED_BY = \"blocked_by\" # inverse of blocks"
    },
    {
      "rule_text": "O sistema suporta relacionamentos genéricos de associação entre tarefas (RELATES_TO), permitindo vincular tarefas que têm alguma relação contextual sem necessidade de especificar dependência ou bloqueio",
      "rule_type": "domain",
      "confidence": "high",
      "source_context": "RELATES_TO = \"relates_to\" # General relationship"
    }
  ],
  "entities_found": ["Tarefa", "Relacionamento entre Tarefas", "Tipo de Relacionamento"],
  "file_purpose": "Define os tipos de relacionamentos possíveis entre tarefas (bloqueio, dependência, duplicata, clone, associação) e garante que não existam relacionamentos duplicados no sistema.",
  "file_layer": "schema"
}
```
