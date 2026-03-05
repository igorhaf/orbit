---
title: "Arquitetura do Sistema"
slug: "arquitetura"
source: "generated"
order_index: 2
created_at: "2026-03-05T04:46:24.694327"
updated_at: "2026-03-05T04:46:24.694327"
---

# Arquitetura do Sistema

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

