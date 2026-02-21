# PROMPT #252 - Fix Continuous Wiki Enrichment Pipeline
## Description field now evolves continuously via RAG, not just during epic generation

**Date:** February 13, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** Project description now enriches continuously from RAG discoveries instead of only during epic generation

---

## Objective

Fix the continuous wiki enrichment pipeline that was silently failing after context was locked. The project description should evolve continuously with new discoveries from code scanning, while context_semantic and context_human remain immutable.

**Root Causes Found:**
1. `_enrich_context_from_rag()` had a `context_locked` guard that blocked ALL enrichment after the first epic
2. `wiki_enriched` flag was set to `True` even when enrichment silently returned without doing anything
3. Stale running jobs (>30min old) blocked new cycles from being queued

---

## What Was Implemented

### 1. Removed `context_locked` Guard from `_enrich_context_from_rag`
- Function now ALWAYS enriches `project.description` from RAG rules
- `context_semantic` and `context_human` remain immutable (managed by epic flow only)
- Function now returns `bool` (True if enrichment happened, False otherwise)
- Added explicit log message when enrichment response is too short

### 2. Propagated Boolean Return to All Callers
- `continuous_rag_service.py`: Uses return value instead of assuming success
- `watchdog.py` Step 4: Uses return value for accurate logging

### 3. Stale Job Cleanup
- `bootstrap_watchdog()`: Cleans up stale jobs (>30min) on startup before queuing new cycles
- `submit_watchdog_cycle()`: Cleans up stale jobs before duplicate check
- `submit_batch_processing_cycle()`: Same stale cleanup logic
- Prevents zombie jobs from permanently blocking the pipeline

---

## Files Modified

1. **backend/app/api/routes/projects.py** - `_enrich_context_from_rag`: removed `context_locked` guard, returns bool
2. **backend/app/services/continuous_rag_service.py** - Uses boolean return value
3. **backend/app/services/watchdog.py** - Boolean return in Step 4, stale job cleanup in bootstrap + both submit functions

---

## Status: COMPLETE

**Key Achievements:**
- Wiki enrichment runs continuously regardless of context_locked state
- Accurate tracking of whether enrichment actually happened
- Stale jobs automatically cleaned up, preventing pipeline blockage
- context_semantic/context_human remain properly immutable

---
