# PROMPT #249 - Fix Context Not Appearing After Project Creation
## RAG metadata key mismatch + missing auto-refresh during pipeline

**Date:** February 12, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** Project description/context now populates correctly during and after project creation pipeline

---

## Objective

Fix the bug where project context/description only appeared after generating epics, instead of being populated during the initial project creation pipeline.

**Root Cause Analysis:**

Two separate issues combined to create this bug:

### Issue 1: RAG Metadata Key Mismatch (Critical)

The `_enrich_context_from_rag()` function queries RAG documents with:
```sql
metadata->>'content_type' = 'business_rule'
```

But ALL storage functions use a different key:
```python
metadata={"type": "business_rule", ...}  # key is "type", NOT "content_type"
```

This mismatch meant:
- `scan_and_memorize()` stored rules with `type` key
- `continuous_rag_service.py` stored rules with `type` key
- `_enrich_context_from_rag()` queried for `content_type` key -> **always found 0 rules**
- Wiki enrichment was silently skipped every time

The only case where `content_type` was used was manual rule creation in `knowledge.py`.

### Issue 2: No Auto-Refresh During Pipeline

When a user navigated to the project page while the pipeline was still running (`status = 'processing'`), the project data was loaded once and never refreshed. The user saw the pre-enrichment state until they manually refreshed the page.

---

## What Was Implemented

### 1. Fixed RAG Query Mismatch (5 locations)

Updated all queries to check both metadata keys using `OR`:

**Files fixed:**
- `backend/app/api/routes/projects.py` (line 901) - `_enrich_context_from_rag`
- `backend/app/services/watchdog.py` (line 444) - `_auto_discover_cards`
- `backend/app/api/routes/knowledge.py` (lines 252, 446, 876) - stats + business rules endpoints

**Query pattern:**
```sql
-- Before (broken):
AND metadata->>'content_type' = 'business_rule'

-- After (works with both old and new data):
AND (metadata->>'content_type' = 'business_rule' OR metadata->>'type' = 'business_rule')
```

### 2. Auto-Refresh During Pipeline Processing

Added polling effect to the project detail page that auto-refreshes every 5 seconds while the project status is `processing`. Once the pipeline completes and status transitions to `active`, a full data reload is triggered.

---

## Files Modified

1. **backend/app/api/routes/projects.py** - Fixed `_enrich_context_from_rag` query
2. **backend/app/services/watchdog.py** - Fixed `_auto_discover_cards` query
3. **backend/app/api/routes/knowledge.py** - Fixed 3 business_rule queries
4. **frontend/src/app/projects/[id]/page.tsx** - Added auto-refresh while processing

---

## Status: COMPLETE

**Key Achievements:**
- RAG business rules are now correctly found by wiki enrichment and card auto-discovery
- Project page auto-refreshes during pipeline processing
- Backward compatible: works with both `type` and `content_type` metadata keys
- No migration needed - query-side fix handles both formats

---
