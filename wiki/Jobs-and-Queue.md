# Jobs & Queue System

Background processing for long-running AI operations.

## How It Works

1. API endpoint creates an `AsyncJob` record
2. Job submitted to `PriorityJobExecutor` with priority level
3. Executor runs job in background thread
4. Progress updates via `job_manager.update_progress()`
5. WebSocket broadcasts status to frontend
6. Frontend polls or listens for completion

## Job Types

| Type | Description |
|------|-------------|
| `deep_pipeline` | Full 7-phase codebase analysis |
| `description_generation` | AI generate/expand/summarize card description |
| `hierarchy_generation` | Generate child cards from parent |
| `prompt_generation` | Generate semantic execution prompt |
| `context_generation` | Build project context |
| `interview_hierarchy` | Generate cards from interview |
| `rag_pipeline` | RAG indexing pipeline |
| `memory_scan` | Codebase memory analysis |

## Job States

```
PENDING → RUNNING → COMPLETED
                  → FAILED
                  → CANCELLED
```

## Priority Levels

Jobs are executed in priority order:
- **HIGH**: User-initiated operations (description generation)
- **NORMAL**: System operations (pipeline phases)
- **LOW**: Background maintenance (cleanup, re-indexing)

## Progress Tracking

Each job tracks:
- `progress_percent` (0-100)
- `progress_message` (human-readable status)
- `result` (JSON output on completion)
- `error` (error message on failure)

## Monitoring

- **Jobs page** (`/jobs`): List all jobs with filtering
- **Job logs**: Detailed execution logs per job
- **Notifications**: WebSocket-based completion alerts
- **Console** (`/console`): Real-time log streaming

## API Endpoints

```
GET  /api/v1/jobs                — List jobs
GET  /api/v1/jobs/{id}           — Job detail
GET  /api/v1/jobs/{id}/logs      — Execution logs
POST /api/v1/jobs/{id}/cancel    — Cancel job
```
