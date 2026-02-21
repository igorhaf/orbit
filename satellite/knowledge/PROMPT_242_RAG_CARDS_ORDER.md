# PROMPT #242 - Enforce RAG → Cards Order (AI Classification)

**Date:** 2026-02-21
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Card generation now strictly requires RAG indexing to complete first. AI classification used for all projects (no hardcoded domain maps). Frontend shows clear indexing/ready states.

---

## Objective

Enforce strict ordering: RAG indexing must complete before card generation can begin. The "Gerar Cards" button only appears after `initial_scan_complete = True`. AI classifies business rules into domain groups for ALL projects — nothing is hardcoded for ORBIT.

**Key Requirements:**
1. Guards changed from `initial_memory_context` to `initial_scan_complete`
2. AI classification remains the primary path (no DOMAIN_MAP hardcoding)
3. source_file context included in RAG queries for better AI classification
4. Frontend shows yellow "indexing" banner before scan completes, green "Gerar Cards" after
5. Safety net in background job handler

---

## What Was Implemented

### 1. Enhanced RAG Query with source_file Context

`business_rules.py`: RAG query now selects `metadata->>'source_file'` alongside `content`. Rules are formatted as `[source_file] content` before being sent to AI, giving the classifier better context for domain grouping.

### 2. Endpoint Guards Updated

Both `/generate-cards` and `/generate-hierarchy` endpoints now check `project.initial_scan_complete` instead of `project.initial_memory_context`. This ensures RAG data is fully indexed before card generation.

### 3. Background Job Safety Net

`project_service.py`: Added `initial_scan_complete` check in `_process_full_hierarchy_async()` before starting card generation. If RAG isn't complete, the job fails immediately with clear message.

### 4. Enrichment Status Flag

`continuous_rag.py`: Added `initial_scan_complete` field to the `enrichment-status` response, allowing the frontend to track scan state independently from `rag_completed`.

### 5. Frontend UI Updates

- New `initialScanComplete` state tracked from enrichment polling
- Yellow banner: "Indexando codebase..." shown when `!initialScanComplete && !hasEpics`
- Green banner: "Gerar Cards" button shown when `initialScanComplete && !hasEpics`
- Replaced `alert()` with `showError()` for error handling

---

## Files Modified

### Modified:
1. **backend/app/services/context_generator/business_rules.py** - Enhanced RAG query with source_file, formatted rules with path context
2. **backend/app/api/routes/projects.py** - Changed guards from `initial_memory_context` to `initial_scan_complete` on both endpoints
3. **backend/app/services/project_service.py** - Added `initial_scan_complete` safety net in background job
4. **backend/app/api/routes/continuous_rag.py** - Exposed `initial_scan_complete` in enrichment-status response
5. **frontend/src/app/projects/[id]/page.tsx** - Added `initialScanComplete` state, yellow indexing banner, updated green banner condition, replaced alert with showError

---

## Testing Results

```
Frontend build: SUCCESS (no errors)
Backend syntax check: All 4 files parse correctly

Logic verification:
  initial_scan_complete = False → yellow banner, no "Gerar Cards" button
  initial_scan_complete = True  → green banner with "Gerar Cards" button
  POST /generate-hierarchy before scan → 400 error
  Background job before scan → job fails with clear message
  AI classification used for all projects (no hardcoded DOMAIN_MAP)
```

---

## Key Insights

### 1. AI vs Hardcoded Classification
User explicitly chose AI classification over DOMAIN_MAP for ALL projects. ORBIT must be treated like any other project — no special cases. The AI validation is important for correctness.

### 2. source_file as Classification Context
By including `[source_file]` prefix in rules sent to AI, the classifier gets strong signals about domain grouping from file paths (e.g., `app/models/user.py` → Authentication domain).

### 3. initial_scan_complete vs initial_memory_context
`initial_memory_context` is set during initial scan but doesn't guarantee RAG indexing is complete. `initial_scan_complete` is the correct flag — it's set when MEMORY_SCAN job finishes and RAG data is available.

---

## Status: COMPLETE

**Key Achievements:**
- Strict RAG → Cards ordering enforced at 3 levels (endpoint, service, frontend)
- AI classification maintained as primary path for all projects
- source_file context improves AI domain classification
- Clear UI feedback (yellow indexing → green ready)
- No hardcoded domain maps or ORBIT-specific logic
