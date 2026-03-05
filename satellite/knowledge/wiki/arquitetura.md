---
title: "Arquitetura do Sistema"
slug: "arquitetura"
source: bootstrap
order: 1
created_at: "2026-03-05T07:12:22.270106+00:00"
---

# Arquitetura do Sistema

## Visão de Alto Nível

```
┌─────────────┐    ┌─────────────┐    ┌──────────────┐
│  Frontend   │───▶│  Backend    │───▶│  AI Providers│
│  Next.js 14 │    │  FastAPI    │    │  Claude/GPT/ │
│  React/TS   │    │  SQLAlchemy │    │  Gemini      │
└─────────────┘    └──────┬──────┘    └──────────────┘
                          │
                   ┌──────┴──────┐
                   │             │
              ┌────▼────┐  ┌────▼────┐
              │PostgreSQL│  │  Redis  │
              │+pgvector │  │  Cache  │
              └─────────┘  └─────────┘
```

## Backend (FastAPI)

### Camadas

1. **Routes** (`backend/app/api/routes/`): Endpoints REST da API
2. **Services** (`backend/app/services/`): Lógica de negócio
3. **Models** (`backend/app/models/`): Modelos SQLAlchemy
4. **Schemas** (`backend/app/schemas/`): Schemas Pydantic (validação)
5. **Prompts** (`backend/app/prompts/`): Prompts YAML externalizados

### Serviços Principais

- **AIOrchestrator**: Orquestração centralizada de chamadas de IA
- **RAGService**: Armazenamento e busca semântica
- **BacklogGeneratorService**: Geração de hierarquia Epic/Story/Task
- **InterviewService**: Engine de entrevistas contextuais
- **PromptLoader**: Carregamento de prompts YAML com Jinja2

## Frontend (Next.js 14)

### Estrutura de Páginas

- `/` — Lista de projetos
- `/projects/[id]` — Detalhes do projeto (tabs)
- `/analytics/tokens` — Tokens & Desempenho
- `/analytics/costs` — Custos
- `/prompts` — Gerenciamento de prompts
- `/ai-flow` — AI Studio (pipeline visual)
- `/jobs` — Jobs assíncronos
- `/settings` — Configurações
- `/ai-models` — Gestão de modelos de IA

### Componentes Chave

- **Navbar**: Navegação top-bar com links e ações
- **KanbanBoard**: Board com drag-and-drop (DnD Kit)
- **ChatInterface**: Interface de chat para entrevistas
- **MarkdownEditor**: Editor rich-text com toolbar
