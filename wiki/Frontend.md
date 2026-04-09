# Frontend

Next.js 14 App Router with React, TypeScript, and Tailwind CSS.

## Pages

| Route | Page | Description |
|-------|------|-------------|
| `/` | Dashboard | Project listing, active jobs, pipeline status |
| `/projects/[id]` | Project Detail | Overview, pipeline controls, AI buttons |
| `/projects/[id]/setup-context` | Context Setup | Configure project context |
| `/projects/[id]/wiki` | Wiki | Multi-page project documentation |
| `/projects/[id]/wiki/[slug]` | Wiki Page | Individual wiki page view/edit |
| `/projects/[id]/knowledge` | Knowledge Base | RAG documents and search |
| `/analytics/tokens` | Token Analytics | Token consumption, cache stats, RAG metrics |
| `/analytics/costs` | Cost Analytics | Financial costs, projections, daily trends |
| `/prompts` | Prompts | Prompt template management |
| `/ai-flow` | AI Studio | Flow chain editor, pipeline config, run history |
| `/jobs` | Jobs | Background job tracking and logs |
| `/console` | Console | Real-time system logs |
| `/settings` | Settings | System configuration |

## Component Groups

| Group | Purpose |
|-------|---------|
| `backlog/` | Card list, detail panel, generation wizard, hierarchy, filters |
| `interview/` | Chat interface, message display, interview tree |
| `kanban/` | Drag-and-drop board, columns, task cards |
| `wiki/` | Wiki panel with page navigation |
| `ai-studio/` | Pipeline tab, run history, phase nodes, profile editor |
| `ai-flow/` | Flow chain visual editor with nodes and edges |
| `chat/` | Project chat panel (RAG-powered Q&A) |
| `pipeline/` | Pipeline monitor with real-time metrics |
| `commits/` | Git commit history viewer |
| `console/` | Real-time log display |
| `layout/` | Navigation, sidebar, breadcrumbs |
| `ui/` | Reusable components (Button, Card, Badge, Modal, etc.) |

## Key Components

### BacklogListView
Main backlog view with filtering, sorting, and card list. Supports bulk operations.

### ItemDetailPanel
Side panel for card detail. Tabs: Overview, Hierarchy, Interview, Prompt, Acceptance Criteria.
- Description renders as Markdown (read-only, AI-editable via detalhar/sintetizar/reformular)
- Title has AI suggest button
- Acceptance criteria with inline editing

### TaskCard
Card in list view with markdown description, acceptance criteria, status badges, AI model badge.

### PipelineMonitor
Real-time display of pipeline execution: progress, tokens, cost, phase scores, activity feed.

## API Client

Typed API client at `frontend/src/lib/api/`:
- `base.ts` — Base request function with error handling
- `tasks.ts` — Task CRUD + AI operations
- `analytics.ts` — Cost and token analytics
- `knowledge.ts` — RAG search and stats
- Each module exports typed functions matching backend endpoints
