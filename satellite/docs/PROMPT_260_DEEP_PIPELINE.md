# PROMPT #260 - Deep Pipeline (7-Phase Claudio Pipeline)

## Objective

Redesign the ORBIT data collection and project structuring pipeline from a fragile 4-phase system into a comprehensive 7-phase pipeline that leverages Claude models via Claudio (Haiku, Sonnet, Opus) with model specialization, multi-turn sessions, extended thinking, and quality feedback loops.

## What Was Implemented

### Architecture: 7-Phase Deep Pipeline

```
Phase 0: STRUCTURAL SCAN ─────── No AI (filesystem pure)
Phase 1: FILE ANALYSIS ────────── Haiku (fast, parallel, 10x concurrency)
Phase 2: CROSS-FILE SYNTHESIS ─── Sonnet (multi-turn sessions)
Phase 3: ARCHITECTURAL MAP ────── Sonnet + Extended Thinking
Phase 4: CARD GENERATION ──────── Opus (epics/stories) + Sonnet (tasks) + Haiku (subtasks)
Phase 5: WIKI GENERATION ──────── Opus (multi-turn per domain)
Phase 6: QUALITY ASSURANCE ────── Sonnet + Extended Thinking (validation)
Phase 7: GAP FILLING ──────────── Conditional (re-executes phases with problems)
```

### Claudio Modifications (5 changes)

**File:** `/home/igorhaf/claudio/backend/main.py`

1. **session_key parameter**: Added `session_key: str | None = None` to MessagesRequest for deterministic session control
2. **--max-tokens pass-through**: Added `--max-tokens {resolved}` to CLI command builder
3. **Thinking budget mapping**: `budget_tokens < 5000` → `--effort medium`, `>= 5000` → `--effort high`
4. **Session management in handlers**: Both sync and stream handlers use session_key when provided
5. **Session management endpoints**: `GET /v1/sessions`, `DELETE /v1/sessions/{key}`, `DELETE /v1/sessions`

### ORBIT Backend - New Files

1. **`backend/app/services/claudio_pipeline.py`** (~355 lines)
   - Direct httpx client for Claudio, bypassing AIOrchestrator
   - Methods: `call()`, `call_followup()`, `call_batch()`, `delete_session()`, `list_sessions()`, `health_check()`, `extract_json()`
   - Per-model timeouts (Haiku: 120s, Sonnet: 300s, Opus: 600s) and retry policies

2. **`backend/app/services/deep_pipeline.py`** (~1158 lines)
   - Main orchestrator with all 7 phases
   - Phase 0: Filesystem walk with 5-layer ignore, import graph, complexity heuristic, file type classification
   - Phase 1: Per-file Haiku analysis in parallel (10x concurrency, no batching)
   - Phase 2: Domain-grouped Sonnet synthesis with multi-turn follow-up for large domains (30+ files)
   - Phase 3: Single Sonnet call with extended thinking (budget_tokens=10000) for architectural map
   - Phase 4: 4 sub-phases - Opus epics → Opus stories (3x) → Sonnet tasks (5x) → Haiku subtasks (10x)
   - Phase 5: 4 sub-phases - Sonnet structure → Opus overview → Opus domain pages (3x) → Sonnet flows
   - Phase 6: Sonnet + thinking for cross-validation with quality scoring (0-100)
   - Phase 7: Conditional gap filling when score < 60

3. **`backend/app/models/pipeline_artifact.py`**
   - PipelineArtifact model with ArtifactType enum
   - Stores intermediate artifacts per phase for resumability and feedback loops
   - Composite indexes: (project_id, phase) and (run_id, artifact_type)

4. **`backend/alembic/versions/p260_deep_pipeline.py`**
   - Creates pipeline_artifacts table
   - Adds project_architecture (JSON), pipeline_quality_score (String), pipeline_version (String) to projects

5. **11 YAML Contract Files** in `backend/app/contracts/pipeline/`:
   - `deep_file_analysis.yaml` (Phase 1)
   - `deep_rule_synthesis.yaml` (Phase 2)
   - `deep_architectural_map.yaml` (Phase 3)
   - `deep_epic_generation.yaml` (Phase 4a)
   - `deep_story_decomposition.yaml` (Phase 4b)
   - `deep_task_decomposition.yaml` (Phase 4c)
   - `deep_subtask_decomposition.yaml` (Phase 4d)
   - `deep_wiki_structure.yaml` (Phase 5a)
   - `deep_wiki_overview.yaml` (Phase 5b)
   - `deep_wiki_domain.yaml` (Phase 5c)
   - `deep_quality_review.yaml` (Phase 6)

### ORBIT Backend - Modified Files

6. **`backend/app/models/project.py`**: Added 3 columns (project_architecture, pipeline_quality_score, pipeline_version)
7. **`backend/app/models/__init__.py`**: Registered PipelineArtifact and ArtifactType
8. **`backend/app/models/async_job.py`**: Added DEEP_PIPELINE JobType
9. **`backend/app/api/routes/continuous_rag.py`**: Added 2 endpoints:
   - `POST /{project_id}/rag/deep-pipeline` - Start 7-phase pipeline
   - `GET /{project_id}/rag/deep-pipeline/status` - Detailed status per phase
   - Updated enrichment-status to include deep pipeline state

### ORBIT Frontend - Modified Files

10. **`frontend/src/lib/api/knowledge.ts`**: Added `deepPipeline()` and `deepPipelineStatus()` methods to ragApi
11. **`frontend/src/app/projects/[id]/page.tsx`**:
    - Added deep pipeline state variables (running, completed, progress, score)
    - Updated enrichment polling to capture deep pipeline state
    - Added "Deep Pipeline v2" button with progress indicator and quality score badge

## Key Differences vs Legacy Pipeline (v1)

| Aspect | v1 (Legacy) | v2 (Deep Pipeline) |
|--------|-------------|-------------------|
| Model selection | Single model for all phases | Haiku/Sonnet/Opus per phase |
| File analysis | Batch of 50 files per call | Each file gets dedicated call |
| Cross-file rules | Single-pass, no cross-file synthesis | Sonnet multi-turn per domain |
| Architectural map | None | Sonnet + Extended Thinking |
| Card hierarchy | Flat generation | Opus epics → Sonnet tasks → Haiku subtasks |
| Wiki | Generated alongside cards | Dedicated Opus multi-turn per domain |
| Quality validation | None | Sonnet + Thinking with 0-100 scoring |
| Feedback loops | None | Phase 7 re-executes failing phases |
| Sessions | Not used | Multi-turn sessions per domain |
| Extended thinking | Not used | Phases 3, 6 use budget_tokens=10000 |
| API client | AIOrchestrator (multi-provider) | ClaudioPipelineService (direct httpx) |
| Estimated time (500 files) | ~15 min | ~30 min (3-5x more output) |

## Files Created

- `/home/igorhaf/orbit/backend/app/services/claudio_pipeline.py`
- `/home/igorhaf/orbit/backend/app/services/deep_pipeline.py`
- `/home/igorhaf/orbit/backend/app/models/pipeline_artifact.py`
- `/home/igorhaf/orbit/backend/alembic/versions/p260_deep_pipeline.py`
- `/home/igorhaf/orbit/backend/app/contracts/pipeline/deep_file_analysis.yaml`
- `/home/igorhaf/orbit/backend/app/contracts/pipeline/deep_rule_synthesis.yaml`
- `/home/igorhaf/orbit/backend/app/contracts/pipeline/deep_architectural_map.yaml`
- `/home/igorhaf/orbit/backend/app/contracts/pipeline/deep_epic_generation.yaml`
- `/home/igorhaf/orbit/backend/app/contracts/pipeline/deep_story_decomposition.yaml`
- `/home/igorhaf/orbit/backend/app/contracts/pipeline/deep_task_decomposition.yaml`
- `/home/igorhaf/orbit/backend/app/contracts/pipeline/deep_subtask_decomposition.yaml`
- `/home/igorhaf/orbit/backend/app/contracts/pipeline/deep_wiki_structure.yaml`
- `/home/igorhaf/orbit/backend/app/contracts/pipeline/deep_wiki_overview.yaml`
- `/home/igorhaf/orbit/backend/app/contracts/pipeline/deep_wiki_domain.yaml`
- `/home/igorhaf/orbit/backend/app/contracts/pipeline/deep_quality_review.yaml`

## Files Modified

- `/home/igorhaf/claudio/backend/main.py`
- `/home/igorhaf/orbit/backend/app/models/project.py`
- `/home/igorhaf/orbit/backend/app/models/__init__.py`
- `/home/igorhaf/orbit/backend/app/models/async_job.py`
- `/home/igorhaf/orbit/backend/app/api/routes/continuous_rag.py`
- `/home/igorhaf/orbit/frontend/src/lib/api/knowledge.ts`
- `/home/igorhaf/orbit/frontend/src/app/projects/[id]/page.tsx`

## Testing

### Prerequisites
1. Run migration: `alembic upgrade head`
2. Seed contracts: `python scripts/seed_contracts.py`
3. Start Claudio: `cd /home/igorhaf/claudio && python backend/main.py`

### Manual Test
1. Open project detail page
2. Click "Deep Pipeline v2" button
3. Monitor progress in the UI (polls every 5s)
4. Verify: cards created, wiki pages generated, quality score shown

## Status

**IMPLEMENTED** - Full 7-phase deep pipeline with backend services, API endpoints, contracts, migration, and frontend integration.

## Notes

- The deep pipeline uses ClaudioPipelineService (direct httpx) instead of AIOrchestrator because:
  - No provider selection needed (all calls go through Claudio proxy)
  - No Redis cache needed (subscription model, no per-call cost)
  - Explicit model control per phase
  - Multi-turn session management
- REGRA #0 respected: Wiki pages with `source: manual` or `source: enrichment` are never overwritten
- The existing 4-phase pipeline (v1) is preserved as fallback; `pipeline_version` field tracks which version was used
