# PROMPT #262 - Deep Pipeline Dynamic Configuration

## Objective
Make the Deep Pipeline v2 dynamically configurable without breaking the working core. Add execution profiles (economy/balanced/quality), per-phase scoring, run history with comparison, and quality-driven reinforcement.

## What Was Implemented

### 1. Pipeline Profiles (Configurable Execution Tiers)
- **New model**: `PipelineProfile` with phase_configs (JSONB), quality_threshold, is_default
- **3 pre-seeded profiles**:
  - `economy`: Haiku/Sonnet everywhere (~30% cost of quality)
  - `balanced`: Opus for epics only, Sonnet for rest (~60% cost, **default**)
  - `quality`: Opus maximum, identical to v2 hardcoded values (100% baseline)
- Each profile controls model, max_tokens, concurrency, and contract per phase

### 2. Pipeline Run History (Versioned Execution Tracking)
- **New model**: `PipelineRun` with full metrics per execution
- Tracks: profile snapshot, per-phase scores/durations, aggregate stats (files, rules, domains, cards, wiki), cost (tokens, USD), reinforcement applied
- Enables comparison between runs and quality trend analysis

### 3. Phase-Level Scoring (Heuristic, No Extra AI)
- Automatic quality scoring for each phase (0-100):
  - Phase 0: Files found
  - Phase 1: Parse success rate
  - Phase 2: Rule density (rules per domain)
  - Phase 3: Architecture completeness (fields filled)
  - Phase 4: Hierarchy ratio (stories/epics, tasks/stories)
  - Phase 5: Wiki richness (pages count + avg chars)
  - Phase 6: Overall score (AI-driven, existing)
- Scores displayed in progress messages

### 4. Quality-Driven Reinforcement
- Automatic adjustments based on previous run's weak phases:
  - Phase 1 score < 70: double max_tokens for deeper analysis
  - Phase 2 score < 60: lower multi-turn threshold + more tokens
  - Phase 4a score < 50: increase epic generation budget
  - Phase 5b score < 60: increase wiki generation budget
- Applied transparently, logged in PipelineRun.reinforcement_applied

### 5. Deep Pipeline Fully Profile-Driven
All 12 phase methods now read model/max_tokens/concurrency from profile config:
- Phase 1 (file analysis), Phase 2 (rule synthesis), Phase 3 (arch map)
- Phase 4a (epics), 4b (stories), 4c (tasks), 4d (subtasks)
- Phase 5a (wiki structure), 5b (overview), 5c (domain pages), 5d (flow pages)
- Phase 6 (QA) — including thinking_budget from profile

### 6. API Endpoints
- `GET /pipeline/profiles` — list available profiles
- `POST /{project_id}/rag/deep-pipeline?profile=economy` — trigger with profile
- `GET /{project_id}/rag/deep-pipeline/runs` — run history
- `GET /{project_id}/rag/deep-pipeline/runs/{run_id}` — run detail
- `GET /{project_id}/rag/deep-pipeline/compare?run1=X&run2=Y` — side-by-side comparison

## Files Modified/Created

| File | Action |
|------|--------|
| `backend/app/models/pipeline_profile.py` | **CREATED** — PipelineProfile model |
| `backend/app/models/pipeline_run.py` | **CREATED** — PipelineRun model |
| `backend/app/models/__init__.py` | MODIFIED — import new models |
| `backend/alembic/versions/p262_pipeline_profiles_runs.py` | **CREATED** — migration |
| `backend/scripts/seed_pipeline_profiles.py` | **CREATED** — seed 3 profiles |
| `backend/app/services/deep_pipeline.py` | MODIFIED — profile-driven phases, scoring, reinforcement, run tracking |
| `backend/app/api/routes/continuous_rag.py` | MODIFIED — profile param + new endpoints |

## Database Changes
- New table: `pipeline_profiles` (name, description, phase_configs, quality_threshold, is_default)
- New table: `pipeline_runs` (project_id, profile_id, profile_snapshot, phase_scores, phase_durations, stats, cost, etc.)
- 3 profiles seeded: economy, balanced, quality

## Architecture Decisions
- **Profile as overlay**: Profile configs override hardcoded defaults — if no profile exists, original v2 defaults still work
- **Heuristic scoring**: Phase scores computed without extra AI calls (no additional cost)
- **Immutable snapshots**: PipelineRun stores a copy of phase_configs at execution time
- **Reinforcement is additive**: Only strengthens (increases tokens/lowers thresholds), never weakens

## Status
COMPLETE - All 6 components implemented and integrated.
