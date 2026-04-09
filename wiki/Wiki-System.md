# Wiki System

Auto-generated and continuously updated project documentation stored in PostgreSQL.

## How It Works

The wiki is generated during Pipeline Phase 5:
1. **Phase 5a** — AI plans wiki structure (page hierarchy)
2. **Phase 5b** — Generates overview pages (architecture, getting started)
3. **Phase 5c** — Generates per-domain pages (business logic, API, models)

## Page Types

| Type | Description |
|------|-------------|
| Overview | Project summary, architecture, tech stack |
| Domain | Per-domain documentation (e.g., "Payment System") |
| Cross-domain | Flow documentation across domains |

## Features

- **Markdown content** with full formatting support
- **AI operations**: expand, summarize, rephrase content
- **Slug-based URLs** for clean navigation
- **Hierarchical structure** with parent/child pages
- **Source tracking**: which pipeline run generated each page
- **Human edit protection**: manually edited pages are not overwritten

## Storage

Wiki pages are stored in the `wiki_pages` PostgreSQL table (not filesystem):
- `title`, `slug`, `content` (Markdown)
- `project_id` — belongs to a project
- `source` — "pipeline", "manual", "enrichment"
- `parent_id` — page hierarchy

## API Endpoints

```
GET    /api/v1/projects/{id}/wiki              — List pages
POST   /api/v1/projects/{id}/wiki              — Create page
GET    /api/v1/projects/{id}/wiki/{page_id}    — Get page
PATCH  /api/v1/projects/{id}/wiki/{page_id}    — Update page
DELETE /api/v1/projects/{id}/wiki/{page_id}    — Delete page
POST   /api/v1/projects/{id}/wiki/{page_id}/expand    — AI expand
POST   /api/v1/projects/{id}/wiki/{page_id}/summarize — AI summarize
POST   /api/v1/projects/{id}/wiki/{page_id}/rephrase  — AI rephrase
```
