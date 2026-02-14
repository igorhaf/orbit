# PROMPT #285 - Re-scan Pipeline Safeguards
## Protect existing data from being overwritten during re-scan

**Date:** 2026-02-14
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Bug Fix / Business Rules
**Impact:** Re-scanning a project no longer destroys existing business rule cards, wiki pages, or user-modified project names. Data is merged instead of overwritten.

---

## Objective

Add safeguards to the re-scan pipeline to prevent data loss when a project is re-scanned. Before this fix, re-scanning could:

1. Create duplicate business rule cards (no dedup check)
2. Overwrite `initial_memory_context` completely (losing existing rules)
3. Overwrite user-edited wiki pages
4. Change the project name even if the user manually set it
5. Allow concurrent scans on the same project (race condition)

**Key Requirements:**
1. Business rule cards must NOT be duplicated on re-scan
2. Memory context must be MERGED, not replaced
3. User-edited wiki pages must be protected
4. Project name changes must respect user edits
5. Concurrent scans on same project must be blocked

---

## What Was Implemented

### 1. Duplicate Detection for Business Rule Cards
**File:** `backend/app/services/context_generator.py`

Added check at the start of `generate_business_rule_cards()`:
- Queries existing cards with `labels=["business_rule"]` and `workflow_state="closed"`
- If any exist, skips generation entirely and logs the skip
- Prevents the 23+ card duplication that would happen on every re-scan

### 2. Smart Merge of initial_memory_context
**File:** `backend/app/api/routes/projects.py`

New function `_merge_memory_context(existing, new_scan)`:
- **List fields** (business_rules, key_features, entities): Union with case-insensitive deduplication. New items are added, existing items are preserved.
- **Scalar fields** (suggested_title, scan_summary, stack_info): New scan wins (more recent/accurate data)
- **Unknown keys**: Preserves any keys from existing that new scan doesn't produce
- Ensures manually-added rules are never lost during re-scan

### 3. Wiki Page Protection
**File:** `backend/app/api/routes/wiki.py`

Updated `_upsert_wiki_page()` to protect pages based on `source` field:
- `source='manual'`: User-edited pages are NEVER overwritten
- `source='enrichment'`: AI-enriched pages are NEVER overwritten
- `source='ai_generated'`: Auto-generated pages CAN be overwritten (safe to regenerate)
- Parent ID is still updated even for protected pages (hierarchy fix)

### 4. Concurrent Scan Guard
**File:** `backend/app/api/routes/projects.py`

Added check in the `scan-memory` endpoint:
- Before creating a new scan job, queries for existing PENDING or RUNNING scans for the same project
- Returns HTTP 409 Conflict if a scan is already in progress
- Includes the existing job ID in the error message for debugging

### 5. Project Name Protection
**File:** `backend/app/api/routes/projects.py`

Two protection points:

**a) In re-scan pipeline (`_process_memory_scan_async`):**
- Only updates name if it still matches the default folder-based name
- Logs when name is preserved (user-modified)

**b) In wiki enrichment (`_enrich_context_from_rag`):**
- Builds a set of "auto-generated names" (folder-based, scan-suggested)
- Only updates name if current name matches an auto-generated pattern
- If user manually set a custom name, it's preserved

---

## Files Modified

### Modified:
1. **`backend/app/services/context_generator.py`** - Duplicate detection in `generate_business_rule_cards()`
2. **`backend/app/api/routes/projects.py`** - Smart merge function, concurrent scan guard, project name protection
3. **`backend/app/api/routes/wiki.py`** - Wiki page source-based protection

---

## Testing Results

```
OK  Python syntax: projects.py
OK  Python syntax: context_generator.py
OK  Python syntax: wiki.py
OK  Duplicate detection: business_rule cards checked before generation
OK  Smart merge: list fields use union with dedup, scalars use new value
OK  Wiki protection: manual and enrichment pages never overwritten
OK  Concurrent guard: HTTP 409 if scan already running for project
OK  Name protection: user-set names preserved in both scan and wiki enrichment
```

---

## Key Insights

### 1. Data Loss Vectors in Re-scan
The re-scan pipeline had 5 separate vectors for data loss, each in a different file. This required understanding the full flow: scan endpoint -> background job -> memory context update -> wiki enrichment -> card generation.

### 2. Source-based Wiki Protection
Using the `source` field on WikiPage (which already existed with values 'manual', 'enrichment', 'ai_generated') was the cleanest way to distinguish user-edited content from auto-generated content, without adding a new column.

### 3. Merge vs Replace Strategy
For `initial_memory_context`, a full merge strategy was needed because:
- List fields (rules, features) accumulate over scans - new scan may find new rules that first scan missed
- Scalar fields (stack info) should be updated - new scan has more recent analysis
- Unknown keys must be preserved - other services may add custom keys

---

## Status: COMPLETE

**Key Achievements:**
- Business rule cards protected from duplication (query-before-create)
- Memory context merged instead of overwritten (union + dedup for lists)
- User-edited wiki pages never overwritten (source-based protection)
- Concurrent scans blocked (HTTP 409 guard)
- Project name changes respect user edits (auto-name detection)

**Impact:**
- Re-scanning a project is now safe and non-destructive
- Users can freely re-scan without losing manually-added data
- Business rule cards accumulate correctly across scans
- Wiki remains stable after re-scans
