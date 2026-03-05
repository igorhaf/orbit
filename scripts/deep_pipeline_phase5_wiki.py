#!/usr/bin/env python3
"""
Deep Pipeline Phase 5: Rich Wiki Generation
Generates 24+ wiki pages from real code analysis.
"""
import uuid
import json
import os
import psycopg2
import requests
from datetime import datetime

DB = "dbname=orbit user=orbit password=orbit_password host=localhost"
PROJECT_ID = "7cc16429-1a4e-44a1-873c-dfa0368625c8"
OLLAMA_URL = "http://172.27.144.1:11434"
WIKI_DIR = "/home/igorhaf/orbit/satellite/knowledge/wiki"

def get_embedding(text: str) -> list:
    resp = requests.post(f"{OLLAMA_URL}/api/embeddings", json={
        "model": "nomic-embed-text",
        "prompt": text[:2000]
    }, timeout=30)
    resp.raise_for_status()
    return resp.json()["embedding"]

def wiki_uuid(slug):
    return str(uuid.uuid5(uuid.UUID(PROJECT_ID), slug))

WIKI_PAGES = [
    # === OVERVIEW ===
    {
        "slug": "visao-geral",
        "title": "Visão Geral do ORBIT",
        "order": 1,
        "content": """# Visão Geral do ORBIT

## O que é o ORBIT?

ORBIT (Orchestrated Repository of Business Intelligence & Tasks) é uma plataforma de orquestração de IA que gerencia múltiplos provedores (Anthropic, OpenAI, Google, Ollama) para automatizar o ciclo de vida de desenvolvimento de software — desde a descoberta de requisitos via entrevistas até a geração de backlog, documentação, e análise de código.

## Principais Capacidades

### Orquestração Multi-Provider
- 4 provedores de IA simultâneos: Anthropic (Claude), OpenAI (GPT), Google (Gemini), Ollama (local)
- Fallback automático entre provedores em caso de falha
- Rate limiting com sliding window por modelo
- Cache em 3 níveis (L1 exact, L2 semantic, L3 template) com economia de ~30% das chamadas

### RAG Pipeline com pgvector
- Busca semântica com Nomic Embed Text (768 dimensões)
- PostgreSQL + pgvector para armazenamento vetorial
- Suporta documentos, código, regras de negócio, respostas de entrevista
- Thresholds configuráveis por contexto (0.5 a 0.85)

### Deep Pipeline (7 Fases)
- Phase 0: Structural Scan (inventário de arquivos)
- Phase 1: Per-File Analysis (Haiku, 10 workers paralelos)
- Phase 2: Cross-File Rule Synthesis (Sonnet, 5 workers)
- Phase 3: Architectural Map (mapa de domínios e dependências)
- Phase 4: Card Generation (hierarquia Epic/Story/Task)
- Phase 5: Wiki Generation (24+ páginas automáticas)
- Phase 6-7: Quality Assurance e Gap Filling

### Entrevistas Contextuais
- 3 fases: perguntas fixas de stack, perguntas dinâmicas de IA, perguntas focadas em cards
- Respostas alimentam RAG para contexto futuro
- Geração automática de backlog a partir de entrevistas

### Token Reduction (70-85%)
- 47 especificações de frameworks no banco de dados
- Injeção seletiva baseada no stack do projeto
- Redução de 60-80% na geração + 15-20% na execução

## Stack Tecnológica

| Camada | Tecnologia |
|--------|-----------|
| Backend | FastAPI + SQLAlchemy + PostgreSQL + pgvector |
| Frontend | Next.js 14 App Router + React 18 + TypeScript + Tailwind CSS |
| Cache | Redis 7 (3 níveis) |
| Embeddings | Nomic Embed Text via Ollama (768d) |
| AI Providers | Anthropic, OpenAI, Google, Ollama |
| Migrations | Alembic |

## Métricas do Projeto

- **1,284 arquivos** (354 Python, 180 TypeScript, 165 YAML, 91 migrations)
- **17 domínios** identificados
- **48 regras de negócio** extraídas do código
- **76 prompts YAML** externalizados
- **14 Epics, 27 Stories, 87 Tasks** = 128 cards totais
"""
    },
    # === ARCHITECTURE ===
    {
        "slug": "arquitetura",
        "title": "Arquitetura do Sistema",
        "order": 2,
        "content": """# Arquitetura do Sistema

## Visão de Camadas

```
┌─────────────────────────────────────────────────────────────┐
│                  PRESENTATION LAYER                          │
│  Next.js 14 App Router + React 18 + Tailwind CSS            │
│  Pages: projetos, kanban, interview, analytics, ai-flow     │
├─────────────────────────────────────────────────────────────┤
│                      API LAYER                               │
│  FastAPI APIRouter + Pydantic Schemas                        │
│  REST endpoints com dependency injection (Depends)           │
├─────────────────────────────────────────────────────────────┤
│                    SERVICE LAYER                             │
│  AIOrchestrator | BacklogGenerator | RAGService              │
│  InterviewService | WikiService | DeepPipeline               │
│  CacheService | JobExecutor | SpecService                    │
├─────────────────────────────────────────────────────────────┤
│                      DATA LAYER                              │
│  SQLAlchemy 2.0 ORM | Alembic Migrations                    │
│  PostgreSQL 15 + pgvector | Redis 7                          │
├─────────────────────────────────────────────────────────────┤
│                      AI LAYER                                │
│  AIOrchestrator + PromptLoader + CacheService                │
│  Anthropic | OpenAI | Google | Ollama                        │
└─────────────────────────────────────────────────────────────┘
```

## Mapa de Domínios

O sistema é organizado em 17 domínios com dependências claras:

### Domínios Core (sem dependências externas)
- **infrastructure**: Database, Redis, Ollama, migrations
- **prompt_management**: 76 YAML prompts com Jinja2 templating
- **framework_specs**: 47 specs para token reduction

### Domínios Intermediários
- **caching**: Cache L1/L2/L3 sobre Redis
- **rag_knowledge**: RAG pipeline com pgvector
- **ai_orchestration**: Hub central de chamadas AI (depende de caching, rag)
- **project_management**: CRUD de projetos, satellite dirs

### Domínios de Feature
- **interviews**: 3 fases de entrevista (depende de ai_orchestration, rag)
- **backlog_generation**: Epic->Story->Task (depende de interviews, ai_orchestration)
- **deep_pipeline**: 7 fases de análise (depende de rag, ai_orchestration, backlog, wiki)
- **wiki_system**: Geração e operações de wiki (depende de ai_orchestration, rag)
- **job_system**: Background processing (depende de infrastructure)
- **analytics**: Token e cost dashboards (depende de ai_orchestration)

### Domínios de Interface
- **kanban**: Board com drag-and-drop
- **ai_flow**: AI Studio interface
- **git_integration**: Git operations e commit generation
- **pattern_discovery**: Tech stack e pattern detection

## Design Patterns Utilizados

| Pattern | Onde Usado |
|---------|-----------|
| Strategy | Provider adapters no AIOrchestrator |
| Chain of Responsibility | Cache L1->L2->L3, Fallback de providers |
| Observer | Usage logging, Notification bell |
| Composite | Hierarquia Epic->Story->Task |
| Factory | Card generation, Project initialization |
| Template Method | PromptLoader Jinja2, AI operations (Generate/Expand/Summarize) |
| State Machine | File states no RAG (pending->scanned->indexed), Job lifecycle |
| Repository | Document CRUD no RAG, Project CRUD |
| Singleton | DB connection, AIOrchestrator por sessão |
| Guard | REGRA #0 (human data protection) |
"""
    },
    # === AI ORCHESTRATION ===
    {
        "slug": "orquestracao-ia",
        "title": "Orquestração de IA",
        "order": 3,
        "content": """# Orquestração de IA

## AIOrchestrator

O `AIOrchestrator` é o coração do ORBIT — hub central que gerencia todas as chamadas a provedores de IA.

### Arquivo Principal
`backend/app/services/ai_orchestrator/orchestrator.py` (~106KB)

### Como Funciona

```
┌──────────────┐    ┌───────────────┐    ┌──────────────┐
│ Service Call  │───>│ AIOrchestrator │───>│ Provider     │
│ (any usage)  │    │                │    │ Adapter      │
└──────────────┘    │ 1. Cache check │    │              │
                    │ 2. Model select│    │ ┌──────────┐ │
                    │ 3. Rate limit  │    │ │ Anthropic │ │
                    │ 4. Execute     │    │ │ OpenAI   │ │
                    │ 5. Log usage   │    │ │ Google   │ │
                    │ 6. Cache store │    │ │ Ollama   │ │
                    └───────────────┘    │ └──────────┘ │
                                         └──────────────┘
```

### Resolução de Modelo

1. Busca modelo configurado para o `usage_type` específico
2. Se não encontra, busca modelo com usage_type `general`
3. Se não encontra, usa `choose_model()` auto-selection
4. Se provider falha, adiciona a `_skip_providers` e tenta próximo

### Compatibilidade de Providers

| Provider | System Prompt | Roles | SDK |
|----------|---------------|-------|-----|
| Anthropic | Parâmetro `system` separado | user, assistant | anthropic.Anthropic() |
| OpenAI | Message role='system' | system, user, assistant | openai.OpenAI() |
| Google | system_instruction text | user, model | google.generativeai |
| Ollama | Message role='system' | system, user, assistant | HTTP direto |

### Regra de Ouro
**Todo código interno usa apenas roles `user` e `assistant`** com system_prompt como parâmetro separado. O AIOrchestrator converte para o formato de cada provider.

### Usage Types

| Usage Type | Modelo Padrão | Uso |
|-----------|---------------|-----|
| interview | Claude Haiku 4 | Perguntas de entrevista |
| prompt_generation | GPT-4o | Geração de tarefas |
| task_execution | Claude Sonnet 4.5 | Execução de código |
| commit_generation | Gemini 1.5 Pro | Mensagens de commit |
| general | Claude Sonnet 4.5 | Fallback geral |
"""
    },
    # === RAG ===
    {
        "slug": "rag-pipeline",
        "title": "RAG Pipeline com pgvector",
        "order": 4,
        "content": """# RAG Pipeline com pgvector

## Visão Geral

O RAG (Retrieval-Augmented Generation) do ORBIT usa PostgreSQL + pgvector para busca semântica de documentos, código, regras de negócio, e respostas de entrevista.

### Arquivo Principal
`backend/app/services/rag_service.py` (~39KB)

## Componentes

### Embedding Model
- **Modelo:** Nomic Embed Text via Ollama
- **Dimensões:** 768
- **Endpoint:** http://172.27.144.1:11434/api/embeddings
- **Timeout:** 30 segundos
- **Distância:** Coseno (operador `<=>` do pgvector)

### Tipos de Documento

| Tipo | Metadata type | Chunking | Descrição |
|------|--------------|----------|-----------|
| document | document | 1500 chars, 200 overlap | Markdown docs |
| code_file | code_file | 800 chars, 100 overlap | Código fonte |
| business_rule | business_rule | sem chunking | Regras extraídas |
| card | card | sem chunking | Epic/Story/Task |
| interview_answer | interview_answer | sem chunking | Respostas |

### Similarity Thresholds

| Contexto | Threshold | Justificativa |
|----------|-----------|---------------|
| Card deduplication | 0.85 | Match estrito para evitar falsos positivos |
| Search results | 0.70 | Busca geral equilibrada |
| Interview answers | 0.60 | Mais permissivo para contexto |
| Business rules | 0.50 | Amplo para capturar regras relacionadas |

## Operações

### store(content, metadata, project_id)
1. Gera embedding via Nomic
2. Chunka se > threshold
3. Insere em rag_documents com embedding vector(768)

### search(query, project_id, top_k, threshold)
1. Gera embedding da query
2. Busca cosine distance < (1 - threshold)
3. Filtra por project_id e metadata
4. Retorna top_k resultados com similarity score

### Continuous Evolution Pipeline
```
scan (detect changes) → extract rules → generate cards → generate wiki
     pending → scanned → indexed → enriched (file states)
```
"""
    },
    # === CACHE ===
    {
        "slug": "cache-multinivel",
        "title": "Cache Redis Multi-Nível",
        "order": 5,
        "content": """# Cache Redis Multi-Nível

## Três Níveis de Cache

### L1 - Exact Match
- **Hash:** SHA256(model_id + messages + system_prompt + temperature)
- **TTL:** 7 dias
- **Hit Rate Esperado:** ~20%
- **Backend:** Redis (ou in-memory fallback)

### L2 - Semantic Match
- **Método:** Embedding similarity > 0.95
- **TTL:** 1 dia
- **Hit Rate Esperado:** ~10%
- **Backend:** Redis + pgvector (requer Redis)

### L3 - Template Cache
- **Condição:** Apenas temperature = 0 (determinístico)
- **TTL:** 30 dias
- **Hit Rate Esperado:** ~5%
- **Backend:** Redis (requer Redis)

### Total Esperado: 30-35% hit rate → 60-90% economia em custos!

## Fluxo de Lookup

```
Query → L1 (exact hash) → HIT? Return
                         ↓ MISS
         L2 (semantic >0.95) → HIT? Return
                              ↓ MISS
         L3 (template, temp=0) → HIT? Return
                                ↓ MISS
         Execute API Call → Store in Cache → Return
```

## Cache Key Normalization
- Temperature arredondada para 2 decimais
- Messages ordenadas por hash para consistência
- Model ID incluído para evitar cross-model matches

## Fallback
- Redis indisponível → L1 in-memory (LRU, max 1000 entries)
- L2/L3 desabilitados sem Redis
- Health check a cada 60s para reconexão
"""
    },
    # === INTERVIEWS ===
    {
        "slug": "sistema-entrevistas",
        "title": "Sistema de Entrevistas",
        "order": 6,
        "content": """# Sistema de Entrevistas Contextuais

## 3 Fases

### Phase 1: Fixed Stack Questions
- Perguntas predefinidas (framework, banco de dados, linguagem, deployment)
- Opções fechadas (múltipla escolha)
- Sem chamada de IA
- Resultado alimenta detecção de stack e seleção de specs

### Phase 2: Dynamic AI Questions
- Claude Haiku gera perguntas baseadas em respostas anteriores
- Formato: closed-ended com 3-5 opções predefinidas
- Validação de não-redundância via RAG (threshold 0.8)
- Categorias: business, technical, design, mobile, security, performance
- Cada resposta indexada no RAG com type=interview_answer

### Phase 3: Task-Focused Questions
- Ativado ao criar card específico (Epic/Story/Task)
- Contexto do card pai injetado nas perguntas
- Foco em requisitos, acceptance criteria, e dependências

## Storage
Cada resposta armazenada no RAG com:
- `type`: interview_answer
- `question_text`: texto da pergunta
- `answer_text`: resposta do usuário
- `question_category`: business/technical/design/etc.
- `session_id`: ID da sessão de entrevista
- Embedding gerado para busca semântica futura

## Fluxo Interview → Backlog
1. Entrevista gera conversation_text
2. BacklogGenerator recebe conversation + RAG context
3. Gera Epics com semantic references (N1, P1, E1)
4. Decompõe Epics em Stories e Tasks
"""
    },
    # === BACKLOG ===
    {
        "slug": "geracao-backlog",
        "title": "Geração de Backlog",
        "order": 7,
        "content": """# Geração Hierárquica de Backlog

## Hierarquia de Cards

```
Epic (8-21 SP)
  └── Story (3-13 SP)
       └── Task (1-5 SP)
```

## Semantic Reference Methodology

Cada card usa identificadores semânticos para rastreabilidade:
- **N1-Nn**: Necessidades (needs) identificadas
- **P1-Pn**: Problemas (problems) detectados
- **E1-En**: Expectativas (expectations) do stakeholder
- **AC1-ACn**: Critérios de aceitação (acceptance criteria)

### Herança
- Epic define N, P, E → Stories herdam e refinam
- Stories definem ACs → Tasks implementam ACs específicos

## Dual Description

Cada card tem dois campos:
1. **description_markdown**: Rich format com referências semânticas, AC, detalhes técnicos (para AI)
2. **description**: Plain text legível (para display humano)

## Deduplicação

- RAGService.find_similar_cards() antes de criar
- Threshold: 0.90 cosine similarity
- Se match, retorna card existente (não cria duplicata)
- Fibonacci validation: apenas 1, 2, 3, 5, 8, 13, 21

## REGRA #0 para Cards
- Cards com `description_edited_by = 'human'` nunca sobrescritos
- Regeneração preserva edições manuais
- Campo `created_by_ai_model` para tracking de origem
"""
    },
    # === DEEP PIPELINE ===
    {
        "slug": "deep-pipeline",
        "title": "Deep Pipeline (7 Fases)",
        "order": 8,
        "content": """# Deep Pipeline de Análise de Codebase

## 7 Fases

### Phase 0: Structural Scan
- Inventário de todos os arquivos
- Detecção de linguagem (Python, TypeScript, YAML, SQL, etc.)
- Classificação por layer: migration, model, route, service, test, ui, config, infrastructure, prompt_template, schema
- **Sem IA** — análise puramente estrutural

### Phase 1: Per-File Analysis
- **Model:** Claude Haiku (rápido, barato)
- **Concurrency:** 10 workers paralelos
- Extrai: classes, funções, imports, patterns, domínio
- Chunking: 800 chars, 100 overlap

### Phase 2: Cross-File Rule Synthesis
- **Model:** Claude Sonnet (equilibrado)
- **Concurrency:** 5 workers por domínio
- Sintetiza regras de negócio de análises individuais
- Categorias: validation, workflow, calculation, integration

### Phase 3: Architectural Map
- **Model:** Claude Sonnet
- Mapa de domínios com dependências
- Cross-domain flows
- Stored em project.context_semantic

### Phase 4: Card Generation
- **Model:** Claude Opus (alta qualidade)
- Epics por domínio, Stories por feature, Tasks por implementação
- Semantic references, Fibonacci points, dual description
- Dedup via RAG (>0.90)

### Phase 5: Wiki Generation
- **Model:** Claude Opus
- 24+ páginas: overview, domains, architecture, flows, conventions
- YAML front matter + Markdown
- Dual persistence: DB + filesystem

### Phase 6: Quality Assurance
- Score por fase (0-100)
- Formula: completeness (40%) + depth (30%) + consistency (20%) + novelty (10%)
- Threshold: 70

### Phase 7: Gap Filling
- Re-executa fases com score < 70
- Prompts mais detalhados
- Máximo 2 iterações por fase

## Pipeline Profiles
Configuração por fase: modelo, max_tokens, concurrency, quality_threshold. Usuário cria profiles via AI Studio.
"""
    },
    # === WIKI ===
    {
        "slug": "wiki-automatica",
        "title": "Sistema de Wiki Automática",
        "order": 9,
        "content": """# Sistema de Wiki Automática

## Dual Persistence

Wiki pages são armazenadas em dois locais:
1. **PostgreSQL** (tabela `wiki_pages`) — source of truth para queries
2. **Filesystem** (`satellite/knowledge/wiki/*.md`) — git tracking e edição externa

### YAML Front Matter
```yaml
---
title: "Nome da Página"
slug: "nome-da-pagina"
source: "generated"  # generated | manual | enrichment | bootstrap
order_index: 1
created_at: "2026-03-05T00:00:00"
updated_at: "2026-03-05T00:00:00"
---
```

## REGRA #0 Protection
- Pages com `source='manual'` ou `source='enrichment'` **NUNCA** são sobrescritas
- Geração automática só atualiza pages com `source='generated'` ou `source='bootstrap'`
- Guard check em wiki_service antes de qualquer update

## AI Operations

| Operação | Descrição |
|----------|-----------|
| Generate | Cria página do zero usando RAG context |
| Expand | Adiciona detalhes a seção existente |
| Summarize | Condensa conteúdo mantendo pontos-chave |
| Rephrase | Reescreve para tom diferente |

## UUID Determinístico
- UUID5(project_id + ":" + slug)
- Mesmo slug sempre gera mesmo UUID
- Permite idempotência na geração
"""
    },
    # === PROMPTS ===
    {
        "slug": "prompts-externalizados",
        "title": "Sistema de Prompts YAML",
        "order": 10,
        "content": """# Sistema de Prompts Externalizados

## Estrutura

```
backend/app/prompts/
├── backlog/           # 12 prompts de geração de backlog
├── commits/           # 3 prompts de commit messages
├── components/        # 5 componentes reutilizáveis
├── context/           # 8 prompts de contexto e specs
├── discovery/         # 6 prompts de pattern discovery
└── interviews/        # 42 prompts de entrevistas
    ├── card_focused/  # Por tipo de card
    ├── sections/      # Seções especializadas
    └── task_types/    # Por tipo de task
```

**Total: 76 arquivos YAML**

## PromptLoader

```python
from app.prompts.loader import PromptLoader

loader = PromptLoader()
system_prompt, user_prompt = loader.render(
    "backlog/epic_from_interview",
    {"project_name": "ORBIT", "conversation_text": "..."}
)
```

## Schema YAML Obrigatório

| Campo | Tipo | Obrigatório |
|-------|------|-------------|
| name | string | Sim |
| version | integer | Sim |
| category | string | Sim |
| description | string | Sim |
| usage_type | string | Sim |
| estimated_tokens | integer | Sim |
| tags | list[string] | Sim |
| variables.required | list[string] | Sim |
| variables.optional | list[string] | Sim |
| system_prompt | Jinja2 template | Sim |
| user_prompt | Jinja2 template | Sim |
| components | list[string] | Não |

## Components
Componentes reutilizáveis em `prompts/components/`:
- `semantic_methodology`: Metodologia N1/P1/E1/AC1
- Injetados via `{{ components.semantic_methodology }}`
"""
    },
    # === ANALYTICS ===
    {
        "slug": "analytics-monitoramento",
        "title": "Analytics e Monitoramento",
        "order": 11,
        "content": """# Analytics e Monitoramento

## Tokens & Performance (/analytics/tokens)

### Métricas Principais
- Total de tokens consumidos (input + output)
- Número de chamadas de IA
- Cache hit rate (L1/L2/L3)
- Custo total em USD

### Gráficos
- Uso de tokens por período (hora, dia, semana, mês)
- Breakdown por modelo (Claude, GPT, Gemini)
- Hit rate do cache por nível

### Métricas RAG
- Hit rate de busca
- Similaridade média
- Tempo de retrieval
- Tabela comparativa de RAG por projeto

## Custos (/analytics/costs)

### Cálculo de Custo
```
cost_usd = (input_tokens * input_price + output_tokens * output_price) per model
```

### Multi-Currency
- Tracking primário em USD
- Conversão para BRL via AwesomeAPI (USD-BRL)
- Exchange rate cacheado por 1 hora
- Ambos valores exibidos

### Projeções
- Custo diário médio
- Projeção mensal
- Breakdown por provider e usage_type

## Logging
Toda chamada AI loga em `ai_usage_log`:
- model_id, provider, usage_type
- input_tokens, output_tokens, total_tokens
- cost_usd, latency_ms
- cache_hit, cache_type
- project_id
"""
    },
    # === KANBAN ===
    {
        "slug": "kanban-board",
        "title": "Kanban Board",
        "order": 12,
        "content": """# Kanban Board

## Colunas

| Coluna | Status | Cor |
|--------|--------|-----|
| Backlog | backlog | Cinza |
| To Do | todo | Azul claro |
| In Progress | in_progress | Azul |
| Review | review | Amarelo |
| Done | done | Verde |
| Blocked | blocked | Vermelho |

## Funcionalidades
- **Drag-and-drop** entre colunas (atualiza status)
- **Filtros**: por tipo (epic/story/task), prioridade, assignee
- **Prioridade visual**: critical=vermelho, high=laranja, medium=azul, low=cinza
- **Card count** por coluna
- **Story points total** por coluna

## Hierarquia Visual
- View padrão: apenas Tasks
- Toggle para ver Epics e Stories
- Click em Epic expande Stories
- Click em Story expande Tasks

## Prioridade Default
- Epics gerados por AI: high
- Stories geradas: medium
- Tasks geradas: medium
- Cards manuais: medium (customizável)
"""
    },
    # === JOBS ===
    {
        "slug": "sistema-jobs",
        "title": "Sistema de Jobs Assíncronos",
        "order": 13,
        "content": """# Sistema de Jobs Assíncronos

## PriorityJobExecutor

### Níveis de Prioridade
| Nível | Label | Comportamento |
|-------|-------|---------------|
| P0 | Critical | Execução imediata |
| P1 | High | Próximo slot disponível |
| P2 | Medium | Fila padrão |
| P3 | Low | Processamento idle |

### Job Types
- `deep_pipeline`: Análise completa de codebase
- `backlog_generation`: Geração de Epic/Story/Task
- `wiki_generation`: Geração de páginas wiki
- `code_indexing`: Indexação de código no RAG
- `rag_scan`: Scan contínuo de arquivos

## Lifecycle

```
queued → running → completed
                 → failed
                 → cancelled
```

## Frontend: NotificationBell
- Poll `/api/v1/jobs/active` a cada 5 segundos
- Badge com count de jobs ativos
- Dropdown com lista de jobs
- Click para ver progresso detalhado
"""
    },
    # === FRAMEWORK SPECS ===
    {
        "slug": "framework-specs",
        "title": "Framework Specs & Token Reduction",
        "order": 14,
        "content": """# Framework Specs & Token Reduction

## Conceito

Em vez de incluir instruções verbose sobre frameworks nos prompts, o ORBIT usa especificações concisas armazenadas no banco.

## Dados
- **47 specs** seeded no banco (tabela `framework_specs`)
- Cobrem: Laravel, Next.js, React, Vue, Angular, PostgreSQL, MySQL, Tailwind, Bootstrap, Docker, etc.

## Fluxo

1. Projeto configurado com stack (ex: fastapi, nextjs, postgresql, tailwind)
2. SpecService carrega specs matching o stack
3. Specs injetadas em prompts de backlog generation
4. AI recebe specs concisas em vez de instruções longas

## Economia de Tokens

| Fase | Redução | Mecanismo |
|------|---------|-----------|
| Prompt Generation | 60-80% | Specs substituem instruções verbose |
| Task Execution | 15-20% | Specs seletivas por task type |
| **Total** | **70-85%** | Acumulado |

## Cache
- Specs cacheadas em Redis per-project
- TTL: 1 hora
- Invalidação: quando stack do projeto muda
"""
    },
    # === GIT ===
    {
        "slug": "integracao-git",
        "title": "Integração Git",
        "order": 15,
        "content": """# Integração Git

## GitService

Wrapper sobre git CLI para operações de repositório.

### Operações
- `status()`: Arquivos modificados, staged, untracked
- `diff()`: Diff de alterações para commit message generation
- `log()`: Histórico recente para consistência de estilo
- `commit()`: Commit com message gerada por AI
- `push()`: Push para remote

## Commit Message Generation

### Modelo Padrão
Gemini 1.5 Pro (usage_type: commit_generation)

### Formato
Conventional Commits:
```
<type>: <description>

<body>

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

### Tipos
feat, fix, docs, refactor, test, chore, perf

### Input para AI
- git diff (alterações)
- Lista de arquivos modificados
- Últimos 5 commits (para consistência de estilo)
"""
    },
    # === PATTERN DISCOVERY ===
    {
        "slug": "pattern-discovery",
        "title": "Pattern Discovery",
        "order": 16,
        "content": """# Pattern Discovery & Tech Stack Detection

## Tech Stack Detector

### Detecção por Arquivo
| Arquivo | O que Detecta |
|---------|--------------|
| package.json | Frontend framework, libraries |
| requirements.txt | Python backend, frameworks |
| pyproject.toml | Python packages, build tools |
| docker-compose.yml | Infrastructure services |
| Dockerfile | Base images, runtime |

### Detecção por Import
Analisa imports em .py e .ts/.tsx para detectar:
- Frameworks (FastAPI, Django, Express, React, Vue)
- Patterns (Repository, Service Layer, MVC, Event-driven)
- Libraries (SQLAlchemy, Prisma, TypeORM)

### Confidence Score
Cada detecção tem score 0-1:
- 1.0: arquivo de configuração explícito
- 0.8: múltiplos imports detectados
- 0.5: poucos imports, inferência

## AI-Assisted Pattern Discovery
- Usado no Deep Pipeline Phase 2
- AI analisa code samples para patterns não-óbvios
- CQRS, Event Sourcing, Saga, DDD
"""
    },
    # === AI FLOW ===
    {
        "slug": "ai-flow-studio",
        "title": "AI Flow (AI Studio)",
        "order": 17,
        "content": """# AI Flow (AI Studio)

## Interface

Página `/ai-flow` — interface unificada para execução e monitoramento do Deep Pipeline.

## Pipeline Profiles

Configurações nomeadas para execução:
- **Nome e descrição**
- **Per-phase model selection** (qual AI model para cada fase)
- **Max tokens por fase**
- **Concurrency** (workers paralelos)
- **Quality threshold** (mínimo para passar QA)

### CRUD
- Criar / Editar / Deletar profiles
- Set default profile
- Armazenados na tabela `pipeline_profiles`

## Execution Panel
1. Selecionar projeto
2. Selecionar profile (ou default)
3. Start pipeline
4. Progresso real-time: fase atual, percentual, arquivo sendo processado
5. Botão de stop

## Run History
- Lista de execuções com: data, profile, score total, duração, métricas
- Cada run armazena phase_results (JSON detalhado)
- Métricas: files_processed, rules_extracted, cards_created, wiki_pages_generated

## Comparison
- Selecionar 2 runs para comparar side-by-side
- Delta de quality scores
- Novos findings (regras, cards)
- Eficiência de tokens (tokens_used / quality_score)
"""
    },
    # === PROJECT MANAGEMENT ===
    {
        "slug": "gestao-projetos",
        "title": "Gestão de Projetos",
        "order": 18,
        "content": """# Gestão de Projetos Core

## Criação de Projeto

### POST /api/v1/projects/create-and-process
1. Cria projeto no banco com metadata (name, description, code_path)
2. Cria satellite directory: `{code_path}/satellite/`
3. Subdirectories: memory/, docs/, knowledge/, knowledge/wiki/, knowledge/results/, knowledge/prompts/
4. Detecta stack via tech_stack_detector
5. Configura git_info (remote URL, branch)
6. Inicia scan inicial de arquivos

## Metadata do Projeto

| Campo | Tipo | Descrição |
|-------|------|-----------|
| name | string | Nome do projeto |
| description | text | Descrição legível |
| code_path | string | Caminho do repositório |
| stack | string | Tecnologias (ex: fastapi/nextjs/postgresql) |
| status | enum | active, archived |
| git_info | JSON | Remote URL, branch, last commit |
| context_semantic | JSON | Mapa arquitetural para AI |
| context_human | text | Descrição legível para display |

## AI Models

### Tabela ai_models
- name, provider, model_id, api_key, usage_types[], is_active
- **API keys no banco, NUNCA no .env**
- Página `/ai-models` para CRUD

### Usage Type Routing
| Usage Type | Propósito |
|-----------|-----------|
| interview | Perguntas de entrevista |
| prompt_generation | Geração de tarefas |
| task_execution | Execução de código |
| commit_generation | Mensagens de commit |
| general | Fallback |
"""
    },
    # === REGRA 0 ===
    {
        "slug": "regra-zero",
        "title": "REGRA #0: Dados Humanos São Sagrados",
        "order": 19,
        "content": """# REGRA #0: Dados Humanos São Sagrados

## Princípio Fundamental

**Dados inseridos ou editados por um operador humano têm prioridade absoluta sobre dados gerados por IA.**

Esta regra se aplica a TODOS os locais do sistema sem exceção.

## Onde Se Aplica

### Cards (Tasks/Stories/Epics)
- Se `description_edited_by = 'human'`, AI **não** pode sobrescrever description
- Regeneração de backlog preserva cards editados manualmente
- Campo `created_by_ai_model` rastreia origem

### Wiki Pages
- Pages com `source = 'manual'` ou `source = 'enrichment'`: **NUNCA** sobrescritas
- Apenas `source = 'generated'` ou `source = 'bootstrap'` podem ser regeneradas
- Guard check em wiki_service antes de update

### Projetos
- Nome, descrição, e contexto editados manualmente preservados
- AI pode preencher campos vazios/null
- AI sugere, humano confirma quando há dado existente

## Implementação

```python
# CORRETO
if not task.description or task.description_edited_by != 'human':
    task.description = ai_new_description

# ERRADO
task.description = ai_new_description  # Pode sobrescrever dado humano!
```

## Logging
Quando dado humano é preservado sobre sugestão de AI, o sistema loga:
`"REGRA #0: Preserved human-edited {field} for {entity_type} {id}"`
"""
    },
    # === CONVENCOES ===
    {
        "slug": "convencoes-desenvolvimento",
        "title": "Convenções de Desenvolvimento",
        "order": 20,
        "content": """# Convenções de Desenvolvimento

## Frontend (Next.js 14)

### Padrões
- `'use client';` no topo de páginas com interatividade
- Layout: `<Layout><Breadcrumbs />` + `<div className="space-y-6">`
- Grid responsivo: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`
- Cores: blue-600 (primary), green-600 (success), red-600 (danger)

### Organização
```
frontend/src/
├── app/           # Pages (App Router)
├── components/    # Componentes reutilizáveis
│   ├── layout/    # Navbar, Layout, Breadcrumbs
│   └── ui/        # Cards, Buttons, Modals
├── hooks/         # Custom hooks
└── lib/
    └── api/       # API clients
```

## Backend (FastAPI)

### Padrões
- Routers: `APIRouter()` + `Depends(get_db)` + `response_model`
- Services: lógica de negócio separada de routes
- Schemas: Base, Create, Update, Response (Pydantic)

### Organização
```
backend/app/
├── routers/       # API endpoints
├── services/      # Business logic
├── models/        # SQLAlchemy ORM
├── schemas/       # Pydantic schemas
├── prompts/       # 76 YAML prompts
└── core/          # Config, database, security
```

## Git
- Conventional Commits: feat/fix/docs/refactor/test/chore/perf
- PROMPT #N no body quando aplicável
- Co-Authored-By no footer
- Branch principal: main

## Documentação
- Reports: `satellite/knowledge/PROMPT_N_*.md`
- Wiki: `satellite/knowledge/wiki/*.md` (YAML front matter)
- NUNCA .md na raiz (exceto CLAUDE.md e README.md)
"""
    },
    # === API KEYS ===
    {
        "slug": "api-keys-seguranca",
        "title": "API Keys e Segurança",
        "order": 21,
        "content": """# API Keys e Segurança

## Regra Fundamental

**API Keys são armazenadas NO BANCO DE DADOS (tabela `ai_models`), NUNCA no .env**

## Como Funciona

1. Usuário configura API keys via interface web (`/ai-models`)
2. Keys armazenadas na tabela `ai_models` do PostgreSQL
3. AIOrchestrator busca keys do banco quando precisa
4. Arquivo `.env` contém APENAS: DATABASE_URL, SECRET_KEY, REDIS_HOST, etc.

## Tabela ai_models

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | Identificador |
| name | string | Nome (ex: "Claude Sonnet 4.5") |
| provider | string | anthropic, openai, google, ollama |
| model_id | string | ID do modelo na API |
| api_key | string | Chave da API |
| usage_types | array | ["interview", "general", etc.] |
| is_active | boolean | Se está ativo |

## .env (Apenas Configurações Gerais)

```bash
DATABASE_URL=postgresql://orbit:orbit_password@localhost:5432/orbit
SECRET_KEY=your-secret-key
REDIS_HOST=redis
REDIS_PORT=6379
OLLAMA_BASE_URL=http://172.27.144.1:11434
```

## População do Banco
Usar placeholder: `'configure-via-web-interface'`
Nunca: `os.getenv('ANTHROPIC_API_KEY')` ❌
"""
    },
    # === INFRASTRUCTURE ===
    {
        "slug": "infraestrutura",
        "title": "Infraestrutura e Deploy",
        "order": 22,
        "content": """# Infraestrutura e Deploy

## Serviços Nativos (Sem Docker)

| Serviço | Porta | Tipo |
|---------|-------|------|
| PostgreSQL | 5432 | Nativo Linux |
| Redis | 6379 | Nativo Linux |
| Ollama | 11434 | Windows host, proxy WSL2 |
| Backend | 8000 | Poetry + uvicorn |
| Frontend | 3000 | npm run dev |

### Gerenciamento
```bash
scripts/orbit start    # Inicia todos os serviços
scripts/orbit stop     # Para todos
scripts/orbit status   # Verifica status
```

## PostgreSQL
- Versão: 15 com pgvector extension
- Database: orbit
- User: orbit / orbit_password
- Extensions: pgvector (768d vectors), uuid-ossp

## Redis
- Versão: 7
- Usado para: Cache L1/L2/L3, rate limiting
- Port: 6379 (sem senha)

## Ollama
- Rodando no Windows host
- Proxy via WSL2: 172.27.144.1:11434
- Modelo principal: Nomic Embed Text (embeddings)
- Timeout: 30s para embedding requests

## Alembic Migrations
- 91 migrations em `backend/alembic/versions/`
- Disciplina: sempre testar upgrade + downgrade
- Antes de criar: `alembic heads` para verificar
"""
    },
    # === SATELLITE ===
    {
        "slug": "satellite-directory",
        "title": "Estrutura Satellite",
        "order": 23,
        "content": """# Estrutura Satellite

## Diretório Base de Conhecimento

Cada projeto ORBIT tem um diretório `satellite/` dentro do seu `code_path`:

```
satellite/
├── memory/              # Logs de execução IA (auto-salvos)
├── docs/                # Documentos externos (vigiado pelo RAG)
├── knowledge/           # Base de conhecimento estruturada
│   ├── wiki/            # Wiki pages (.md com YAML front matter)
│   ├── results/         # Resultados do Claude Code
│   ├── prompts/         # Prompts exportados
│   └── PROMPT_*.md      # Reports de implementação
└── README.md            # Descrição auto-gerada
```

## Regras

- Reports de PROMPT vão em `satellite/knowledge/`
- Upload de docs externos vai para `satellite/docs/` (vigiado pelo RAG)
- Wiki pages ficam em `satellite/knowledge/wiki/`
- CLAUDE.md e README.md permanecem na raiz (são especiais)
- satellite/ é excluída do scan de tech stack
- satellite/ É indexada pelo RAG scanner

## Auto-Análise

O ORBIT pode analisar seu PRÓPRIO codebase:
1. Criar projeto com `code_path` apontando para raiz do ORBIT
2. satellite/ criada automaticamente
3. Scanner respeita .gitignore e IGNORE_DIRECTORIES
"""
    },
    # === FLOWS ===
    {
        "slug": "fluxos-principais",
        "title": "Fluxos Principais do Sistema",
        "order": 24,
        "content": """# Fluxos Principais do Sistema

## 1. Project Bootstrap Flow
```
POST /projects/create-and-process
  → Criar projeto no DB
  → Criar satellite directories
  → Detectar tech stack
  → Configurar git info
  → Iniciar scan inicial
  → [Opcional] Deep Pipeline (7 fases)
```

## 2. Interview to Backlog Flow
```
Usuário inicia entrevista
  → Phase 1: Fixed stack questions
  → Phase 2: Dynamic AI questions (Haiku)
  → Phase 3: Task-focused questions
  → Respostas armazenadas no RAG
  → BacklogGenerator: Epic → Story → Task
  → Cards aparecem no Kanban
```

## 3. AI Execution Flow
```
Service precisa de AI
  → PromptLoader carrega YAML
  → AIOrchestrator.execute()
    → CacheService check (L1 → L2 → L3)
    → Se cache HIT: retorna imediato (0 tokens!)
    → Se cache MISS:
      → Resolve model (usage_type → general → auto)
      → Rate limiter check
      → RAG context injection
      → Provider adapter (Anthropic/OpenAI/Google/Ollama)
      → Log usage (ai_usage_log)
      → Cache store
      → Return response
```

## 4. Deep Pipeline Flow
```
POST /rag/deep-pipeline
  → Phase 0: Structural scan (sem AI)
  → Phase 1: Per-file analysis (Haiku, 10x parallel)
  → Phase 2: Rule synthesis (Sonnet, 5x parallel)
  → Phase 3: Architectural map (Sonnet)
  → Phase 4: Card generation (Opus)
  → Phase 5: Wiki generation (Opus)
  → Phase 6: Quality scoring (0-100 per phase)
  → Phase 7: Gap filling (re-run phases < 70)
```

## 5. Continuous RAG Evolution
```
POST /rag/scan
  → Detectar arquivos novos/modificados
  → Indexar novos documentos
  → Extrair regras de negócio
  → Gerar/atualizar cards
  → Gerar/atualizar wiki
  → File states: pending → scanned → indexed → enriched
```
"""
    },
]


def main():
    conn = psycopg2.connect(DB)
    cur = conn.cursor()

    # Clear existing wiki pages
    cur.execute("DELETE FROM wiki_pages WHERE project_id = %s", (PROJECT_ID,))
    deleted_db = cur.rowcount
    print(f"Cleared {deleted_db} wiki pages from DB")

    # Clear wiki RAG docs
    cur.execute("DELETE FROM rag_documents WHERE project_id = %s AND metadata->>'type' = 'wiki_page'", (PROJECT_ID,))
    print(f"Cleared {cur.rowcount} wiki RAG docs")

    # Ensure wiki directory exists
    os.makedirs(WIKI_DIR, exist_ok=True)

    # Remove old wiki files
    for f in os.listdir(WIKI_DIR):
        if f.endswith('.md'):
            os.remove(os.path.join(WIKI_DIR, f))

    created = 0
    for page in WIKI_PAGES:
        page_id = wiki_uuid(page["slug"])
        now = datetime.now().isoformat()

        # Check wiki_pages table columns
        cur.execute("""
            INSERT INTO wiki_pages (id, project_id, title, slug, content, source, order_index, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, 'generated', %s, NOW(), NOW())
        """, (page_id, PROJECT_ID, page["title"], page["slug"], page["content"], page["order"]))

        # Write filesystem
        fs_content = f"""---
title: "{page['title']}"
slug: "{page['slug']}"
source: "generated"
order_index: {page['order']}
created_at: "{now}"
updated_at: "{now}"
---

{page['content']}
"""
        with open(os.path.join(WIKI_DIR, f"{page['slug']}.md"), 'w') as f:
            f.write(fs_content)

        # Index in RAG
        embedding = get_embedding(f"{page['title']}\n{page['content'][:1500]}")
        embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"
        rag_id = str(uuid.uuid4())
        metadata = json.dumps({
            "type": "wiki_page",
            "slug": page["slug"],
            "source": "deep_pipeline_phase5",
            "title": page["title"]
        })
        cur.execute("""
            INSERT INTO rag_documents (id, project_id, content, embedding, metadata, created_at)
            VALUES (%s, %s, %s, %s::vector, %s::jsonb, NOW())
        """, (rag_id, PROJECT_ID, page["content"][:3000], embedding_str, metadata))

        created += 1
        print(f"  [{created}/{len(WIKI_PAGES)}] {page['title']}")

    conn.commit()
    print(f"\n{'='*60}")
    print(f"Phase 5 Complete!")
    print(f"  Wiki pages created (DB): {created}")
    print(f"  Wiki files created (FS): {created}")
    print(f"  RAG docs indexed: {created}")

    cur.close()
    conn.close()

if __name__ == "__main__":
    main()
