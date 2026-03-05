---
title: "Convenções de Desenvolvimento"
slug: "convencoes-desenvolvimento"
source: bootstrap
order: 5
created_at: "2026-03-05T07:12:22.271909+00:00"
---

# Convenções de Desenvolvimento

## REGRA #0 — Dados Humanos São Sagrados

> Dados inseridos ou editados por operador humano têm PRIORIDADE ABSOLUTA sobre dados gerados por IA.

- IA pode preencher campos vazios
- IA NUNCA sobrescreve dado editado por humano
- Campos rastreados: `description_edited_by`, `prompt_edited_by` (valores: 'ai', 'human', None)

## Frontend (Next.js 14)

### Padrões

- `'use client';` no topo de páginas interativas
- Layout: `<Layout><Breadcrumbs />` + `<div className="space-y-6">`
- Grid responsivo: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`
- Cores: blue-600 (primary), green-600 (success), red-600 (danger)
- API client: `frontend/src/lib/api/` (módulos por domínio)

### Estrutura de API Client

```
frontend/src/lib/api/
├── base.ts           # request() helper, API_URL
├── projects.ts       # projectsApi
├── analytics.ts      # analyticsApi
├── knowledge.ts      # knowledgeApi, ragApi
├── tasks.ts          # tasksApi
└── index.ts          # re-exports
```

## Backend (FastAPI)

### Padrões

- Routers: `APIRouter()` + `Depends(get_db)` + `response_model`
- Schemas: Base, Create, Update, Response (Pydantic v2)
- Services em `backend/app/services/`
- Prompts em `backend/app/prompts/*.yaml`
- IA via `AIOrchestrator(db)` — NUNCA chamadas diretas

### Estrutura de Rotas

```
backend/app/api/routes/
├── projects.py          # CRUD de projetos
├── interviews.py        # Entrevistas
├── backlog_generation.py # Geração de backlog
├── tasks.py             # CRUD de tasks
├── knowledge.py         # Knowledge base
├── continuous_rag.py    # RAG pipeline
├── wiki.py              # Wiki pages
├── ai_models.py         # Gestão de modelos IA
├── cost_analytics.py    # Analytics de custos
└── jobs.py              # Jobs assíncronos
```

## Git & Documentação

### Commits
- Formato: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `perf:`)
- Body: incluir `PROMPT #[N]`
- Footer: `Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>`

### Documentação
- Cada prompt: `satellite/knowledge/PROMPT_[N]_[DESCRIÇÃO].md`
- Seções obrigatórias: Objective, Implementation, Files Modified, Testing, Status
- Referência: `satellite/knowledge/PROMPT_50_IMPLEMENTATION_REPORT.md`

## Infraestrutura

- Serviços nativos Linux/WSL2 (NÃO Docker)
- Start/stop: `/home/igorhaf/orbit/scripts/orbit start|stop|status`
- PostgreSQL: porta 5432
- Redis: porta 6379
- Ollama: host Windows 172.27.144.1:11434
- Backend: porta 8000
- Frontend: porta 3000
