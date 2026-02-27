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

Arquivo: backend/app/models/project.py
Linguagem: python

```
"""
Project Model
Represents a project in the AI Orchestrator system
"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, Text, DateTime, JSON, Boolean, Enum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import enum

from app.database import Base


class ProjectStatus(str, enum.Enum):
    """
    Project status enum.

    PROMPT #126 - Project Lifecycle Status
    PROMPT #121 - Added processing status

    - draft: Project created but pipeline failed or not started
    - processing: Background pipeline running (scan + context + title)
    - active: Pipeline complete, project ready to use
    """
    draft = "draft"
    processing = "processing"
    active = "active"


class Project(Base):
    """
    Project model - Main entity representing an AI orchestration project

    Attributes:
        id: Unique identifier
        name: Project name
        description: Detailed project description
        git_repository_info: JSON containing git repository information
        context_semantic: Structured semantic text for AI (PROMPT #89)
        context_human: Human-readable project context (PROMPT #89)
        context_locked: Whether context is locked (PROMPT #89)
        context_locked_at: When context was locked (PROMPT #89)
        created_at: Timestamp of creation
        updated_at: Timestamp of last update
    """

    __tablename__ = "projects"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4, index=True)

    # Basic fields
    name = Column(String(255), nullable=False, index=True)
    description = Column(Text, nullable=True)
    git_repository_info = Column(JSON, nullable=True)

    # Stack configuration (PROMPT #46 - Phase 1, PROMPT #67 - Mobile)
    stack_backend = Column(String(50), nullable=True)      # 'laravel', 'django', 'fastapi', etc
    stack_database = Column(String(50), nullable=True)     # 'postgresql', 'mysql', 'mongodb', etc
    stack_frontend = Column(String(50), nullable=True)     # 'nextjs', 'react', 'vue', etc
    stack_css = Column(String(50), nullable=True)          # 'tailwind', 'bootstrap', 'materialui', etc
    stack_mobile = Column(String(50), nullable=True)       # 'react-native', 'flutter', 'expo', etc (PROMPT #67)

    # Project folder path (stores the sanitized folder name)
    project_folder = Column(String(255), nullable=True)    # 'my-project-name' (sanitized)

    # PROMPT #111 - code_path é OBRIGATÓRIO e IMUTÁVEL
    # ORBIT foca em análise de código existente, não em provisionamento
    code_path = Column(String(500), nullable=False, index=True)  # Path to project code folder
    # Example: "/home/user/my-project"
    # REQUIRED: Project must be tied to an existing code folder

    # Context fields (PROMPT #89 - Context Interview)
    context_semantic = Column(Text, nullable=True)       # Structured semantic text for AI consumption
    context_human = Column(Text, nullable=True)          # Human-readable project description
    context_locked = Column(Boolean, default=False, nullable=False)  # Lock after first epic
    context_locked_at = Column(DateTime, nullable=True)  # When context was locked

    # PROMPT #126 - Project lifecycle status
    # draft: Context created, suggested epics exist, but none approved yet
    # active: At least one epic has been approved/created
    status = Column(
        Enum(ProjectStatus),
        default=ProjectStatus.draft,
        nullable=False,
        server_default="draft"
    )

    # PROMPT #118 - Initial memory context from codebase scan (JSON dict)
    # This is set when project is created after a memory scan
    # Contains: suggested_title, stack_info, business_rules, key_features, interview_context
    # If present, context interview uses this rich context for better questions
    initial_memory_context = Column(JSON, nullable=True)

    # PROMPT #222 - Continuous RAG must wait for initial scan to complete
    # Set to True when the initial memory scan (MEMORY_SCAN job) finishes successfully.
    # The Continuous RAG scheduler only processes projects where this flag is True.
    initial_scan_complete = Column(Boolean, default=False, nullable=False, server_default="false")

    # PROMPT #245 - Store scan depth for batch processing across restarts
    scan_depth = Column(String(10), nullable=True)

    # PROMPT #223 - AI-detected ignore patterns for this project
    # Populated by AI pre-scan analysis before initial memory scan
    # JSON: {"directories": [...], "rationale": {...}, "detected_by_ai": true}
    custom_ignore_patterns = Column(JSON, nullable=True)

    # PROMPT #241 - User-editable ignore paths per project
    # JSON array of relative paths to exclude from scanning
    # Example: ["projects/", "vendor/", "node_modules/custom/"]
    ignore_paths = Column(JSON, nullable=True)

    # PROMPT #236 - Protection against accidental deletion
    # When True, project cannot be deleted unless system setting
    # "allow_protected_project_deletion" is set to "true"
    protected = Column(Boolean, default=False, nullable=False, server_default="false")

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )

    # Relationships
    interviews = relationship(
        "Interview",
        back_populates="project",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    prompts = relationship(
        "Prompt",
        back_populates="project",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    tasks = relationship(
        "Task",
        back_populates="project",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    commits = relationship(
        "Commit",
        back_populates="project",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    analyses = relationship(
        "ProjectAnalysis",
        back_populates="project",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    prompt_templates = relationship(
        "PromptTemplate",
        back_populates="project",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    discovered_specs = relationship(
        "Spec",
        back_populates="project",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    chats = relationship(
        "ProjectChat",
        back_populates="project",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    @property
    def stack(self) -> dict:
        """
        Returns stack configuration as a dictionary.
        Built dynamically from stack_* fields.
        Returns None if no stack is configured.

        PROMPT #60 - Automatic Provisioning Integration
        PROMPT #67 - Mobile Support (stack_mobile optional)
        """
        if not self.stack_backend and not self.stack_database and not self.stack_frontend and not self.stack_css:
            return None

        return {
            "backend": self.stack_backend,
            "database": self.stack_database,
            "frontend": self.stack_frontend,
            "css": self.stack_css,
            "mobile": self.stack_mobile  # PROMPT #67 - Optional mobile framework
        }

    def __repr__(self) -> str:
        return f"<Project(id={self.id}, name='{self.name}')>"

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
      "rule_text": "Todo projeto deve obrigatoriamente estar vinculado a uma pasta de código existente no sistema. Não é possível criar um projeto sem informar o caminho do código-fonte.",
      "rule_type": "constraint",
      "confidence": "high",
      "source_context": "code_path = Column(String(500), nullable=False) # REQUIRED: Project must be tied"
    },
    {
      "rule_text": "Um projeto nasce no status 'Rascunho' (draft) e só avança para 'Ativo' após pelo menos um épico ser aprovado ou criado pelo usuário.",
      "rule_type": "workflow",
      "confidence": "high",
      "source_context": "draft: Context created, suggested epics exist, but none approved yet / active: At least one epic"
    },
    {
      "rule_text": "Existe um status intermediário 'Em Processamento' (processing) enquanto o sistema realiza varredura automática do código, geração de contexto e sugestão de título — o projeto não está disponível para uso durante esse período.",
      "rule_type": "workflow",
      "confidence": "high",
      "source_context": "processing: Background pipeline running (scan + context + title)"
    },
    {
      "rule_text": "O contexto do projeto é bloqueado automaticamente após o primeiro épico ser aprovado, impedindo alterações posteriores no contexto. O sistema registra a data e hora exatas do bloqueio.",
      "rule_type": "constraint",
      "confidence": "high",
      "source_context": "context_locked: Lock after first epic / context_locked_at: When context was locked"
    },
    {
      "rule_text": "O mecanismo de atualização contínua de conhecimento (RAG Contínuo) só é ativado para um projeto após a conclusão bem-sucedida da varredura inicial do código. Projetos com varredura incompleta são ignorados pelo agendador.",
      "rule_type": "workflow",
      "confidence": "high",
      "source_context": "Continuous RAG scheduler only processes projects where initial_scan_complete is True"
    },
    {
      "rule_text": "Projetos marcados como 'protegidos' não podem ser excluídos pelo usuário de forma comum. A exclusão só é permitida se uma configuração específica do sistema ('allow_protected_project_deletion') estiver habilitada pelo administrador.",
      "rule_type": "permission",
      "confidence": "high",
      "source_context": "When True, project cannot be deleted unless system setting 'allow_protected_project_deletion' is true"
    },
    {
      "rule_text": "O sistema suporta configuração de stack tecnológica completa por projeto, abrangendo back-end, banco de dados, front-end, CSS e mobile. A stack de mobile é opcional; as demais são opcionais mas tratadas como conjunto.",
      "rule_type": "domain",
      "confidence": "medium",
      "source_context": "stack_mobile optional / if not stack_backend and not stack_database and not stack_frontend..."
    },
    {
      "rule_text": "Antes da varredura inicial do código, a IA realiza uma análise prévia para detectar automaticamente padrões de pastas e arquivos que devem ser ignorados (ex: vendor, node_modules), otimizando o processamento do projeto.",
      "rule_type": "workflow",
      "confidence": "high",
      "source_context": "Populated by AI pre-scan analysis before initial memory scan / detected_by_ai: true"
    },
    {
      "rule_text": "O usuário pode definir manualmente caminhos adicionais a serem excluídos da varredura do seu projeto, complementando os padrões detectados automaticamente pela IA.",
      "rule_type": "permission",
      "confidence": "high",
      "source_context": "User-editable ignore paths per project / JSON array of relative paths to exclude from scanning"
    },
    {
      "rule_text": "O foco do sistema é análise de código existente: projetos devem sempre ser vinculados a um código-fonte já existente. O sistema não é responsável por provisionar ou criar projetos do zero.",
      "rule_type": "domain",
      "confidence": "high",
      "source_context": "ORBIT foca em análise de código existente, não em provisionamento"
    },
    {
      "rule_text": "Ao excluir um projeto, todos os dados relacionados são removidos automaticamente: entrevistas, prompts, tarefas, commits, análises, templates, especificações e chats são apagados em cascata.",
      "rule_type": "constraint",
      "confidence": "high",
      "source_context": "cascade='all, delete-orphan' (interviews, prompts, tasks, commits, analyses, chats...)"
    },
    {
      "rule_text": "A profundidade de varredura do código é armazenada por projeto para permitir que o processamento em lote seja retomado do ponto correto mesmo após reinicializações do sistema.",
      "rule_type": "workflow",
      "confidence": "medium",
      "source_context": "Store scan depth for batch processing across restarts / scan_depth = Column(String(10))"
    }
  ],
  "entities_found": [
    "Projeto",
    "Épico",
    "Entrevista",
    "Prompt",
    "Tarefa",
    "Commit",
    "Análise de Projeto",
    "Template de Prompt",
    "Especificação",
    "Chat do Projeto",
    "Contexto Semântico",
    "Stack Tecnológica"
  ],
  "file_purpose": "Define a entidade central 'Projeto' do sistema de orquestração de IA, incluindo seu ciclo de vida, regras de contexto, proteção e relacionamentos com todas as demais entidades do negócio.",
  "file_layer": "schema"
}
```
