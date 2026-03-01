# PROMPT #236 — Phase 4a Batching + Data Isolation per Pipeline Run

## Objective
1. Fix Phase 4a epic generation that fails on large projects (355+ domains) by batching domain processing
2. Add pipeline_run_id traceability to tasks and wiki pages
3. Implement pre-run cleanup to prevent data accumulation between pipeline runs
4. Clean up AI-generated wiki files on project deletion

## What Was Implemented

### 1. Phase 4a Domain Batching
- **Problem**: Phase 4a sent ALL 355 domains + 4856 rules in a single API call (~50K+ tokens). Failed on both Claude (32K max_tokens truncation) and Ollama (32K context limit).
- **Solution**: Split domains into batches of 20. Each batch generates epics independently. Deduplication removes similar titles (>80% prefix match).
- **Impact**: Works with ANY provider (Claude, Ollama, future). Projects <20 domains = 1 batch (retrocompatible).

### 2. pipeline_run_id Traceability
- Added `pipeline_run_id` FK (nullable, ON DELETE SET NULL) to `tasks` and `wiki_pages` tables
- All 4 Task creation points (Epic, Story, Task, Subtask) now set `pipeline_run_id=run_id`
- Wiki page creation (`_write_wiki_page`) now creates/updates WikiPage records in database with `pipeline_run_id`
- REGRA #0 enforced: human-edited pages (source: manual/enrichment) are never overwritten

### 3. Pre-run Cleanup
- New method `_cleanup_previous_runs()` runs before Phase 0
- Deletes: old pipeline tasks (not human-edited), old AI wiki pages, old artifacts, old pipeline runs
- REGRA #0: tasks with `description_edited_by='human'` are preserved and logged

### 4. Project Delete Wiki Cleanup
- On project deletion, AI-generated `.md` files in `satellite/knowledge/wiki/` are removed
- REGRA #0: files with `source: manual` or `source: enrichment` in YAML front matter are preserved

### 5. Bug Fix: _model_label for Ollama
- Fixed `model.split('-')[1]` crash with Ollama model names (e.g., `qwen3:14b`)
- New `_model_label()` static method handles both Claude (`claude-sonnet-4-6` → `Sonnet`) and Ollama (`qwen3:14b` → `Qwen3`)

### 6. OLLAMA_HOST env var fix
- `ollama_pipeline.py` now reads `OLLAMA_HOST` from `.env` (priority over `OLLAMA_BASE_URL`)
- `OLLAMA_TIMEOUT` also read from `.env`

## Files Modified/Created

| File | Action | Description |
|------|--------|-------------|
| `backend/app/services/deep_pipeline.py` | MODIFIED | Phase 4a batching, pipeline_run_id, cleanup, _model_label, WikiPage import |
| `backend/app/models/task.py` | MODIFIED | Added pipeline_run_id FK |
| `backend/app/models/wiki_page.py` | MODIFIED | Added pipeline_run_id FK |
| `backend/alembic/versions/p264_add_pipeline_run_id.py` | CREATED | Migration for pipeline_run_id columns |
| `backend/app/api/routes/projects.py` | MODIFIED | Wiki .md cleanup on project delete |
| `backend/app/services/ollama_pipeline.py` | MODIFIED | OLLAMA_HOST env var fix |

## Testing Results

- All imports OK (Task, WikiPage, DeepPipelineService)
- pipeline_run_id field exists on both models
- DB columns and FK constraints verified
- Provider dispatch: economy-v3 → claudio, local-ollama → ollama
- _model_label works for Claude and Ollama formats
- Batching: 355 domains → 18 batches, 5 domains → 1 batch (retrocompatible)
- Dedup: 4 similar epics → 2 unique
- API responding after changes (--reload)

## Status
**COMPLETED** — All changes applied and tested.
