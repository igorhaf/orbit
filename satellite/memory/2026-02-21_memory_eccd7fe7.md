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

Arquivo: backend/app/models/prompt_queue.py
Linguagem: python

```
"""
PromptQueue Model - PROMPT #215
Orchestration priority queue for prompt/card execution ordering.

Cards/prompts are ordered in a per-project queue that determines
execution priority. The queue considers:
- Hierarchy (epics before stories before tasks before subtasks)
- Dependencies (depends_on resolved first)
- Card priority (critical > high > medium > low > trivial)
- Age (older cards as tiebreaker)
- Manual overrides (user drag-to-reorder)
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Enum as SQLEnum, Boolean, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import enum

from app.database import Base


class QueueItemStatus(str, enum.Enum):
    """Status of an item in the prompt queue."""
    PENDING = "pending"          # Waiting to be executed
    READY = "ready"              # Dependencies met, ready to execute
    EXECUTING = "executing"      # Currently being executed
    COMPLETED = "completed"      # Execution finished successfully
    FAILED = "failed"            # Execution failed
    SKIPPED = "skipped"          # Manually skipped by user
    BLOCKED = "blocked"          # Blocked by unresolved dependency


class PromptQueue(Base):
    """
    PromptQueue model - Per-project ordered queue of cards/prompts.

    Each entry links to a Task (card) and has a position that determines
    execution priority. Position 1 = highest priority (executes first).
    """

    __tablename__ = "prompt_queue"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)

    # Foreign keys
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    task_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # Queue ordering
    position = Column(Integer, nullable=False, default=0, index=True)

    # Status tracking
    status = Column(
        SQLEnum(QueueItemStatus, name="queue_item_status", values_callable=lambda x: [e.value for e in x]),
        default=QueueItemStatus.PENDING,
        nullable=False,
        index=True
    )

    # Scoring factors (computed, stored for display)
    priority_score = Column(Integer, default=0, nullable=False)  # Computed from card priority
    hierarchy_score = Column(Integer, default=0, nullable=False)  # Computed from item_type depth
    age_score = Column(Integer, default=0, nullable=False)  # Computed from card age in days
    dependency_score = Column(Integer, default=0, nullable=False)  # Computed from dependency chain length
    manual_override = Column(Boolean, default=False, nullable=False)  # True if user manually reordered

    # Execution tracking
    execution_job_id = Column(UUID(as_uuid=True), nullable=True)  # Link to async_job
    execution_notes = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )
    executed_at = Column(DateTime, nullable=True)

    # Relationships
    task = relationship("Task", foreign_keys=[task_id])

    def __repr__(self) -> str:
        return f"<PromptQueue(id={self.id}, position={self.position}, status='{self.status}')>"

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
      "rule_text": "Cada projeto possui sua própria fila de execução independente. Os cards/prompts de um projeto não interferem na fila de outro projeto.",
      "rule_type": "domain",
      "confidence": "high",
      "source_context": "Per-project ordered queue of cards/prompts. project_id FK"
    },
    {
      "rule_text": "A posição 1 na fila representa a maior prioridade de execução — o item na posição 1 é o próximo a ser executado.",
      "rule_type": "constraint",
      "confidence": "high",
      "source_context": "Position 1 = highest priority (executes first)"
    },
    {
      "rule_text": "A fila respeita hierarquia de tipo de item: Épicos são executados antes de Histórias, Histórias antes de Tarefas, e Tarefas antes de Subtarefas.",
      "rule_type": "workflow",
      "confidence": "high",
      "source_context": "Hierarchy (epics before stories before tasks before subtasks)"
    },
    {
      "rule_text": "Um item só pode entrar em execução após todos os seus pré-requisitos (dependências) terem sido resolvidos. Caso contrário, ele fica bloqueado na fila.",
      "rule_type": "workflow",
      "confidence": "high",
      "source_context": "Dependencies (depends_on resolved first) / BLOCKED = Blocked by unresolved dependency"
    },
    {
      "rule_text": "A prioridade do card determina sua posição na fila, seguindo a ordem decrescente: Crítico > Alto > Médio > Baixo > Trivial.",
      "rule_type": "calculation",
      "confidence": "high",
      "source_context": "Card priority (critical > high > medium > low > trivial)"
    },
    {
      "rule_text": "Quando dois cards possuem a mesma prioridade e hierarquia, o card mais antigo (criado há mais tempo) é executado primeiro como critério de desempate.",
      "rule_type": "calculation",
      "confidence": "high",
      "source_context": "Age (older cards as tiebreaker)"
    },
    {
      "rule_text": "O usuário pode reordenar manualmente os cards na fila (ex: arrastar para nova posição), sobrepondo a ordenação automática do sistema.",
      "rule_type": "permission",
      "confidence": "high",
      "source_context": "Manual overrides (user drag-to-reorder) / manual_override flag"
    },
    {
      "rule_text": "Um item da fila percorre os seguintes estados: Pendente → Pronto → Em Execução → Concluído (ou Falhou / Pulado / Bloqueado). Itens só passam para 'Pronto' quando suas dependências estão satisfeitas.",
      "rule_type": "workflow",
      "confidence": "high",
      "source_context": "PENDING→READY→EXECUTING→COMPLETED/FAILED/SKIPPED/BLOCKED"
    },
    {
      "rule_text": "O usuário pode pular manualmente um item da fila sem executá-lo, atribuindo-lhe o status 'Pulado'.",
      "rule_type": "permission",
      "confidence": "high",
      "source_context": "SKIPPED = Manually skipped by user"
    },
    {
      "rule_text": "O sistema armazena a pontuação calculada de cada fator de ordenação (prioridade, hierarquia, idade e cadeia de dependências) para fins de exibição ao usuário, permitindo transparência sobre por que um card está em determinada posição.",
      "rule_type": "domain",
      "confidence": "medium",
      "source_context": "Scoring factors (computed, stored for display): priority_score, hierarchy_score, age_score, dependency_score"
    },
    {
      "rule_text": "Cada execução de item na fila pode ser rastreada por meio de um job assíncrono vinculado, permitindo acompanhar o progresso e registrar notas sobre a execução realizada.",
      "rule_type": "domain",
      "confidence": "medium",
      "source_context": "execution_job_id = Link to async_job / execution_notes"
    }
  ],
  "entities_found": [
    "PromptQueue",
    "Projeto",
    "Card (Tarefa)",
    "Épico",
    "História",
    "Subtarefa",
    "Dependência",
    "Job de Execução"
  ],
  "file_purpose": "Define a fila de prioridade por projeto que determina a ordem de execução dos cards/prompts, considerando hierarquia, dependências, prioridade, idade e reordenação manual pelo usuário.",
  "file_layer": "schema"
}
```
