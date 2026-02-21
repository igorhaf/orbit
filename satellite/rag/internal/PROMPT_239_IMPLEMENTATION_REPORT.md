# PROMPT #239 - Streamlined Pipeline + Living Wiki Context
## Faster Project Creation + Continuous Context Enrichment

**Date:** February 12, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Architecture Refactor
**Impact:** Project creation is faster; context evolves as a living wiki from continuous RAG processing

---

## Objective

Redesign the project creation pipeline to be faster and establish a "living wiki" pattern where the project description is continuously enriched from RAG findings.

**Key Requirements:**
1. Remove pattern discovery from initial pipeline (defer to background)
2. Auto-trigger background enrichment after pipeline completes
3. Enrich project description from RAG business rules (living wiki)
4. Show enrichment progress on project page
5. Simplify wizard stages

---

## What Was Implemented

### 1. Simplified Pipeline (Phase 1)
Removed Step A.1 (PatternDiscoveryService + SpecRAGSync) from `_process_project_pipeline()`. The pipeline now goes directly from memory scan (0-40%) to rich context generation (40-90%) to finalize (90-100%).

### 2. Auto-Triggered Background Enrichment (Phase 2)
After the pipeline completes and sets `status=active`, a new background job is automatically submitted at LOW priority. This job (`_run_post_pipeline_enrichment`) combines three tasks:
- Continuous RAG scan (`run_full_cycle`)
- Pattern discovery + spec sync (deferred from pipeline)
- Wiki enrichment (new, Phase 3)

Reuses existing `RAG_CONTINUOUS_SCAN` job type -- no new migrations needed.

### 3. Living Wiki Enrichment (Phase 3)
New function `_enrich_context_from_rag()` that:
- Checks `context_locked` -- respects immutability (skips if locked)
- Queries business rules from RAG for the project
- Uses AI via `wiki_enrichment.yaml` prompt to merge findings into `project.description`
- Produces enriched Markdown description that preserves existing content

Also hooked into the periodic RAG scheduler in `main.py` so every 5-min RAG cycle also enriches the wiki.

### 4. Frontend Enrichment Indicator (Phase 4)
- New endpoint `GET /projects/{id}/rag/enrichment-status` returns enrichment state
- Project page polls every 10s while enriching
- Subtle gray banner below tabs: "Background enrichment in progress..."
- Auto-refreshes project data when enrichment completes (description updates automatically)

### 5. Simplified Wizard Stages (Phase 5)
Reduced from 4 stages to 3:
- Scanning codebase (0-40%)
- Generating rich context (40-90%)
- Finalizing project (90-100%)

Removed "Setting project title" stage (title comes from the scan itself).

---

## Files Modified/Created

### Created:
1. **backend/app/prompts/context/wiki_enrichment.yaml** - YAML prompt for AI-driven context enrichment from RAG rules

### Modified:
1. **backend/app/api/routes/projects.py** - Removed Step A.1, added auto-trigger (Step D), added `_run_post_pipeline_enrichment()` and `_enrich_context_from_rag()` functions
2. **backend/app/main.py** - Hooked wiki enrichment into RAG scheduler loop (~4 lines)
3. **backend/app/api/routes/continuous_rag.py** - Added `GET /{project_id}/rag/enrichment-status` endpoint
4. **frontend/src/app/projects/[id]/page.tsx** - Added enrichment polling, state, banner, and auto-refresh
5. **frontend/src/app/projects/new/page.tsx** - Simplified stages from 4 to 3
6. **frontend/src/lib/api.ts** - Added `ragApi.enrichmentStatus()` function

---

## Testing Results

```bash
1. Pattern discovery removed from pipeline: confirmed
2. Auto-trigger enrichment job: code added after Step C
3. Wiki enrichment function: checks context_locked, queries RAG, uses AI
4. Enrichment status endpoint: returns is_enriching + active jobs
5. Frontend polling: 10s interval with auto-refresh on completion
6. Wizard stages: 3 stages (was 4)
7. Backend restart: clean (no errors)
```

---

## Status: COMPLETE

**Key Achievements:**
- Project creation faster (pattern discovery deferred)
- Living wiki pattern established (description enriched from RAG)
- Background enrichment auto-triggered after pipeline
- Frontend shows enrichment progress with auto-refresh
- No new database migrations needed
- Respects `context_locked` -- no enrichment on locked projects

---
