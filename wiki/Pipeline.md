# Deep Pipeline

The Deep Pipeline is a 7-phase sequential analysis system that transforms a raw codebase into structured knowledge: business rules, hierarchical cards (Epics > Stories > Tasks), wiki documentation, and quality scores.

## Phases

| Phase | Name | Model | Purpose |
|-------|------|-------|---------|
| 0 | Structural Scan | None | Filesystem inventory (no AI) |
| 1 | File Analysis | Haiku | Per-file analysis in parallel micro-batches |
| 2 | Rule Synthesis | Sonnet | Cross-file business rule extraction per domain |
| 3 | Architectural Map | Sonnet + Thinking | Global architecture understanding |
| 4a | Epic Generation | Sonnet | Create epics from architecture + rules |
| 4b | Story Decomposition | Sonnet | Break epics into stories |
| 4c | Task Decomposition | Sonnet | Break stories into tasks |
| 5a | Wiki Structure | Sonnet | Plan wiki page hierarchy |
| 5b | Wiki Overview | Sonnet | Generate overview pages |
| 5c | Wiki Domain Pages | Sonnet | Per-domain documentation |
| 6 | Quality Assurance | Sonnet + Thinking | Score and validate all outputs |
| 7 | Gap Filling | Conditional | Re-process if QA score < threshold |

## Pipeline Profiles

Profiles configure per-phase settings (stored in `pipeline_profiles` table):
- **model**: Which AI model to use
- **max_tokens**: Output token budget
- **concurrency**: Parallel workers
- **enabled**: Skip phase if false
- **thinking_budget**: Extended thinking tokens (phases 3, 6)
- **provider**: "claudio" or "ollama"

## Resume on Failure

The pipeline saves a checkpoint after each completed phase. If it fails (e.g., token limit, provider offline):

1. Status is set to `"interrupted"` with `checkpoint_state.last_completed_phase`
2. A **"Continuar Pipeline"** button appears in the UI
3. Clicking it resumes from the next uncompleted phase
4. Already-completed phases are skipped; their results are reloaded from the database

### Checkpoint Structure
```json
{
  "last_completed_phase": 3,
  "completed_files": ["path/to/file1.py", ...]
}
```

## Token Optimization

- JSON payloads use compact separators (`separators=(",",":")`) instead of pretty-print
- Domain rules capped at 15 per request (was 30)
- Phase 4c sends minimal epic context (`{title, domain}` only)
- Phase 1 default max_tokens: 2000 (was 4000)
- Health checks use lightweight `/api/health` instead of full AI calls

## Telemetry

Each phase tracks:
- Input/output tokens
- Cost in USD
- Duration in milliseconds
- Quality score (0-100)

Stored in `pipeline_runs` table and broadcast via WebSocket for real-time monitoring.

## Running the Pipeline

1. Navigate to your project page
2. Click **"Deep Pipeline"** button
3. Select a profile (default: "claudio")
4. Monitor progress in the Pipeline Monitor component
5. If interrupted, click **"Continuar Pipeline"** to resume

## API Endpoints

```
POST /api/v1/projects/{id}/rag/deep-pipeline?profile=claudio
GET  /api/v1/projects/{id}/rag/pipeline-live
GET  /api/v1/projects/{id}/rag/pipeline-runs
```
