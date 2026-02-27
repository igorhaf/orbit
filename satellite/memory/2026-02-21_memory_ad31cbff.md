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

Arquivo: backend/app/models/__init__.py
Linguagem: python

```
"""
SQLAlchemy Models
Database models for AI Orchestrator

Import all models here to ensure they are registered with Base.metadata
and detected by Alembic for migrations.
"""

from app.models.project import Project
from app.models.interview import Interview, InterviewStatus
from app.models.prompt import Prompt
from app.models.task import Task, TaskStatus, ItemType, PriorityLevel, SeverityLevel, ResolutionType
from app.models.task_result import TaskResult
from app.models.task_relationship import TaskRelationship, RelationshipType  # JIRA Transformation
from app.models.task_comment import TaskComment, CommentType  # JIRA Transformation
from app.models.status_transition import StatusTransition  # JIRA Transformation
from app.models.chat_session import ChatSession, ChatSessionStatus
from app.models.commit import Commit, CommitType
from app.models.ai_model import AIModel, AIModelUsageType
from app.models.system_settings import SystemSettings
from app.models.spec import Spec  # PROMPT #47 - Phase 2
from app.models.project_analysis import ProjectAnalysis
from app.models.ai_execution import AIExecution  # PROMPT #54 - AI Execution Logging
from app.models.prompt_template import PromptTemplate  # Prompter Architecture - Phase 1
from app.models.discovery_queue import DiscoveryQueue, DiscoveryQueueStatus  # Project-Specific Specs
from app.models.ai_flow_chain import AIFlowChain  # PROMPT #122 - AI Flow Fallback Chains
from app.models.prompt_queue import PromptQueue, QueueItemStatus  # PROMPT #215 - Prompt Orchestration Queue
from app.models.wiki_page import WikiPage  # PROMPT #261 - Multi-page Wiki System
from app.models.project_chat import ProjectChat  # PROMPT #282 - RAG Chat Sessions

__all__ = [
    # Models
    "Project",
    "Interview",
    "Prompt",
    "Task",
    "TaskResult",
    "TaskRelationship",  # JIRA Transformation
    "TaskComment",  # JIRA Transformation
    "StatusTransition",  # JIRA Transformation
    "ChatSession",
    "Commit",
    "AIModel",
    "SystemSettings",
    "Spec",  # PROMPT #47 - Phase 2
    "ProjectAnalysis",
    "AIExecution",  # PROMPT #54 - AI Execution Logging
    "PromptTemplate",  # Prompter Architecture - Phase 1
    "DiscoveryQueue",  # Project-Specific Specs
    # Enums
    "InterviewStatus",
    "TaskStatus",
    "ItemType",  # JIRA Transformation
    "PriorityLevel",  # JIRA Transformation
    "SeverityLevel",  # JIRA Transformation
    "ResolutionType",  # JIRA Transformation
    "ChatSessionStatus",
    "CommitType",
    "AIModelUsageType",
    "RelationshipType",  # JIRA Transformation
    "CommentType",  # JIRA Transformation
    "DiscoveryQueueStatus",  # Project-Specific Specs
    "AIFlowChain",  # PROMPT #122 - AI Flow Fallback Chains
    "PromptQueue",  # PROMPT #215 - Prompt Orchestration Queue
    "QueueItemStatus",  # PROMPT #215
    "WikiPage",  # PROMPT #261 - Multi-page Wiki System
    "ProjectChat",  # PROMPT #282 - RAG Chat Sessions
]

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
      "rule_text": "O sistema organiza o trabalho em Projetos, que contêm Entrevistas, Tarefas, Especificações, Análises e Wikis — refletindo um fluxo de descoberta → especificação → execução → documentação",
      "rule_type": "workflow",
      "confidence": "medium",
      "source_context": "Project, Interview, Spec, Task, ProjectAnalysis, WikiPage"
    },
    {
      "rule_text": "Tarefas possuem níveis de Prioridade (PriorityLevel), Severidade (SeverityLevel) e Tipo de Item (ItemType), permitindo que o negócio classifique e priorize o trabalho de forma granular",
      "rule_type": "domain",
      "confidence": "high",
      "source_context": "TaskStatus, ItemType, PriorityLevel, SeverityLevel, ResolutionType"
    },
    {
      "rule_text": "Tarefas podem ter relacionamentos entre si (TaskRelationship), indicando dependências ou vínculos — como 'bloqueia', 'é bloqueada por', 'relacionada a' — refletindo a gestão de dependências no fluxo de trabalho",
      "rule_type": "workflow",
      "confidence": "high",
      "source_context": "TaskRelationship, RelationshipType  # JIRA Transformation"
    },
    {
      "rule_text": "Tarefas possuem um histórico de mudanças de status (StatusTransition), permitindo rastrear todo o ciclo de vida de uma tarefa desde a criação até a resolução",
      "rule_type": "workflow",
      "confidence": "high",
      "source_context": "StatusTransition  # JIRA Transformation"
    },
    {
      "rule_text": "Tarefas aceitam comentários classificados por tipo (CommentType), suportando comunicação estruturada e contextualizada sobre o trabalho em andamento",
      "rule_type": "domain",
      "confidence": "high",
      "source_context": "TaskComment, CommentType  # JIRA Transformation"
    },
    {
      "rule_text": "Tarefas possuem um tipo de resolução (ResolutionType), permitindo encerrar uma tarefa com classificações distintas como 'resolvido', 'duplicado', 'não será feito', etc.",
      "rule_type": "domain",
      "confidence": "high",
      "source_context": "ResolutionType"
    },
    {
      "rule_text": "O sistema suporta múltiplos modelos de IA (AIModel), cada um com um tipo de uso definido (AIModelUsageType), permitindo que diferentes modelos sejam designados para diferentes finalidades de negócio",
      "rule_type": "domain",
      "confidence": "high",
      "source_context": "AIModel, AIModelUsageType"
    },
    {
      "rule_text": "Execuções de IA são registradas (AIExecution), garantindo rastreabilidade e auditoria de todas as interações automatizadas realizadas pelo sistema",
      "rule_type": "constraint",
      "confidence": "high",
      "source_context": "AIExecution  # PROMPT #54 - AI Execution Logging"
    },
    {
      "rule_text": "O sistema possui uma fila de orquestração de prompts (PromptQueue) com controle de status (QueueItemStatus), gerenciando a ordem e o estado de execução das solicitações de IA",
      "rule_type": "workflow",
      "confidence": "high",
      "source_context": "PromptQueue, QueueItemStatus  # PROMPT #215 - Prompt Orchestration Queue"
    },
    {
      "rule_text": "Projetos possuem uma fila de descoberta de especificações (DiscoveryQueue) com controle de status próprio, indicando que a geração de especificações é um processo assíncrono e gerenciado por fila",
      "rule_type": "workflow",
      "confidence": "high",
      "source_context": "DiscoveryQueue, DiscoveryQueueStatus  # Project-Specific Specs"
    },
    {
      "rule_text": "O sistema suporta cadeias de fallback para fluxos de IA (AIFlowChain), garantindo continuidade do serviço quando um modelo ou fluxo principal falha",
      "rule_type": "constraint",
      "confidence": "high",
      "source_context": "AIFlowChain  # PROMPT #122 - AI Flow Fallback Chains"
    },
    {
      "rule_text": "Cada projeto pode ter um sistema de Wiki com múltiplas páginas (WikiPage), permitindo documentação estruturada e organizada por projeto",
      "rule_type": "domain",
      "confidence": "high",
      "source_context": "WikiPage  # PROMPT #261 - Multi-page Wiki System"
    },
    {
      "rule_text": "Projetos suportam sessões de chat com RAG (ProjectChat), permitindo que usuários conversem com o sistema usando como contexto o conhecimento acumulado do projeto",
      "rule_type": "domain",
      "confidence": "high",
      "source_context": "ProjectChat  # PROMPT #282 - RAG Chat Sessions"
    },
    {
      "rule_text": "Entrevistas possuem status (InterviewStatus), indicando que o processo de coleta de requisitos é estruturado e acompanhado ao longo do tempo",
      "rule_type": "workflow",
      "confidence": "medium",
      "source_context": "Interview, InterviewStatus"
    },
    {
      "rule_text": "Commits são classificados por tipo (CommitType), permitindo rastrear a natureza das mudanças de código associadas ao projeto (ex: feature, fix, docs)",
      "rule_type": "domain",
      "confidence": "medium",
      "source_context": "Commit, CommitType"
    },
    {
      "rule_text": "O sistema possui configurações globais (SystemSettings), indicando que parâmetros de comportamento do negócio podem ser ajustados de forma centralizada sem necessidade de alteração de código",
      "rule_type": "constraint",
      "confidence": "medium",
      "source_context": "SystemSettings"
    },
    {
      "rule_text": "Sessões de chat possuem status (ChatSessionStatus), indicando que conversas com a IA são entidades gerenciadas com ciclo de vida definido (ativa, encerrada, etc.)",
      "rule_type": "workflow",
      "confidence": "medium",
      "source_context": "ChatSession, ChatSessionStatus"
    }
  ],
  "entities_found": [
    "Project",
    "Interview",
    "Prompt",
    "Task",
    "TaskResult",
    "TaskRelationship",
    "TaskComment",
    "StatusTransition",
    "ChatSession",
    "Commit",
    "AIModel",
    "SystemSettings",
    "Spec",
    "ProjectAnalysis",
    "AIExecution",
    "PromptTemplate",
    "DiscoveryQueue",
    "AIFlowChain",
    "PromptQueue",
    "WikiPage",
    "ProjectChat"
  ],
  "file_purpose": "Registro central de todos os modelos de dados do sistema AI Orchestrator, definindo as entidades de negócio e suas variações de estado.",
  "file_layer": "schema"
}
```
