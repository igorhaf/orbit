# Backend API

All endpoints are prefixed with `/api/v1`.

## Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/projects` | List all projects |
| POST | `/projects` | Create project |
| GET | `/projects/{id}` | Get project details |
| PATCH | `/projects/{id}` | Update project |
| DELETE | `/projects/{id}` | Delete project (cascade) |
| POST | `/projects/{id}/scan` | Trigger codebase scan |
| GET | `/projects/{id}/rag/enrichment-status` | Pipeline and RAG status |
| POST | `/projects/{id}/rag/deep-pipeline` | Start deep pipeline |
| GET | `/projects/{id}/rag/pipeline-live` | Real-time pipeline state |
| POST | `/projects/expand-description` | AI expand description |
| POST | `/projects/summarize-description` | AI summarize description |
| POST | `/projects/rephrase-description` | AI rephrase description |

## Tasks / Cards

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tasks` | List tasks (filter by project_id, status, etc.) |
| POST | `/tasks` | Create task |
| GET | `/tasks/{id}` | Get task detail |
| PATCH | `/tasks/{id}` | Update task |
| DELETE | `/tasks/{id}` | Delete task |
| PATCH | `/tasks/{id}/status` | Change status |
| POST | `/tasks/{id}/comments` | Add comment |
| POST | `/tasks/{id}/generate-description` | AI generate description |
| POST | `/tasks/{id}/expand-description` | AI expand description |
| POST | `/tasks/{id}/summarize-description` | AI summarize description |
| POST | `/tasks/{id}/rephrase-description` | AI rephrase description |
| POST | `/tasks/suggest-title` | AI suggest better title |
| POST | `/tasks/{id}/generate-semantic-prompt` | Generate execution prompt |

## Interviews

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/interviews` | List interviews |
| POST | `/interviews` | Create interview |
| GET | `/interviews/{id}` | Get interview detail |
| POST | `/interviews/{id}/messages` | Send message / get AI response |
| POST | `/interviews/{id}/generate-hierarchy` | Generate cards from interview |

## Wiki

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/projects/{id}/wiki` | List wiki pages |
| POST | `/projects/{id}/wiki` | Create wiki page |
| GET | `/projects/{id}/wiki/{page_id}` | Get wiki page |
| PATCH | `/projects/{id}/wiki/{page_id}` | Update wiki page |
| DELETE | `/projects/{id}/wiki/{page_id}` | Delete wiki page |
| POST | `/projects/{id}/wiki/{page_id}/expand` | AI expand content |
| POST | `/projects/{id}/wiki/{page_id}/summarize` | AI summarize content |
| POST | `/projects/{id}/wiki/{page_id}/rephrase` | AI rephrase content |

## AI Models

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/ai-models` | List configured models |
| POST | `/ai-models` | Create model config |
| PATCH | `/ai-models/{id}` | Update model (API key, etc.) |
| POST | `/ai-models/{id}/test` | Test API connection |

## Knowledge / RAG

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/knowledge/search` | Semantic search |
| GET | `/knowledge/documents` | List indexed documents |
| GET | `/knowledge/global-stats` | Global RAG statistics |
| GET | `/knowledge/projects-stats` | Per-project RAG stats |

## Jobs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/jobs` | List jobs (with filters) |
| GET | `/jobs/{id}` | Job detail with progress |
| GET | `/jobs/{id}/logs` | Job execution logs |
| POST | `/jobs/{id}/cancel` | Cancel running job |

## Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/cost/analytics` | Cost summary by provider/type |
| GET | `/cost/rag-stats` | RAG usage statistics |
| GET | `/cost/executions-with-cost` | Recent executions with costs |
| GET | `/ai-executions/stats` | Execution statistics |
| GET | `/cache/stats` | Cache hit/miss rates |

## WebSocket

| Endpoint | Purpose |
|----------|---------|
| `/ws/console` | Real-time console logs |
| `/ws/notifications` | Job completion notifications |
| `/ws/projects/{id}` | Project-specific task updates |
| `/ws/ai-flow` | AI flow execution visualization |
