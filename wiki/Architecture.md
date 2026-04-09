# Architecture

## Overview

ORBIT follows a service-oriented architecture with clear separation between API routes, business logic services, and data models.

```
orbit/
├── backend/
│   ├── app/
│   │   ├── api/routes/          # FastAPI route handlers
│   │   ├── models/              # SQLAlchemy ORM models
│   │   ├── schemas/             # Pydantic request/response schemas
│   │   ├── services/            # Business logic layer
│   │   ├── prompts/             # Hardcoded Python prompt constants
│   │   └── contracts/           # Hardcoded Python contract constants
│   ├── alembic/                 # Database migrations
│   └── scripts/                 # Utility scripts (seed data, etc.)
├── frontend/
│   └── src/
│       ├── app/                 # Next.js App Router pages
│       ├── components/          # React components by domain
│       ├── lib/api/             # Typed API client
│       ├── hooks/               # Custom React hooks
│       └── contexts/            # React context providers
├── scripts/                     # System management (start/stop)
└── wiki/                        # Project documentation
```

## Request Flow

```
Browser → Next.js (port 3000) → FastAPI (port 8000) → Service Layer → Database/AI Provider
                                                                     ↘ Redis Cache
                                                                     ↘ WebSocket (real-time)
```

## Key Design Patterns

### 1. AI Orchestrator
All AI calls go through `AIOrchestrator` which handles:
- Provider selection based on `usage_type` configuration
- Automatic Redis caching (3 levels: exact, semantic, template)
- Token tracking and cost calculation
- Rate limiting per model

### 2. Pipeline Architecture
The deep pipeline runs 7 sequential phases, each producing artifacts stored in the database:
- Phase outputs feed into subsequent phases
- Checkpoint saved after each phase for resume capability
- Configurable via pipeline profiles (model, tokens, concurrency per phase)

### 3. Prompt System
Prompts are hardcoded as Python constants (not YAML/DB):
- `backend/app/prompts/` — 73 prompts organized by domain
- `backend/app/contracts/` — 88 contracts with configuration data
- Jinja2 templates with variable substitution
- Reusable components injected via `{{ components.* }}`

### 4. Job Queue
Background processing uses a priority-based async executor:
- Jobs tracked in `async_jobs` table with progress/status
- WebSocket broadcasts for real-time UI updates
- Child job relationships for complex workflows
- Graceful shutdown with checkpoint saving

## Services Architecture

| Service | Purpose |
|---------|---------|
| `ai_orchestrator/` | Multi-provider AI execution with caching |
| `deep_pipeline/` | 7-phase codebase analysis |
| `rag_pipeline/` | 4-phase RAG indexing |
| `context_generator/` | Card activation and content generation |
| `codebase_memory/` | File analysis, git analysis, pattern extraction |
| `task_execution/` | Task execution with budget management |
| `continuous_rag_service` | Continuous knowledge evolution |
| `wiki_service` | Wiki page management |
| `job_executor` | Priority async job execution |
| `claudio_pipeline` | HTTP client for Claudio AI proxy |

## Infrastructure

| Component | Details |
|-----------|---------|
| PostgreSQL | Primary database with pgvector extension |
| Redis | Response caching, pipeline live state |
| Ollama | Local AI model execution (optional) |
| Claudio | AI proxy service on port 8001 |
