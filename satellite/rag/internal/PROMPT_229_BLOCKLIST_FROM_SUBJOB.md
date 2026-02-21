# PROMPT #229 - Blocklist from Sub-Job Row
## Block Files Directly from RAG Scan Job View

**Date:** 2026-02-17
**Status:** COMPLETED
**Priority:** MEDIUM
**Type:** Feature Implementation
**Impact:** Users can block files from future RAG indexing directly from the jobs page

---

## Objective

Add a "Bloquear" (Block) button to each sub-job row in the jobs page, allowing users to add specific files to the global blocklist while watching the RAG continuous scan progress.

**Key Requirements:**
1. Button in the Actions column of each sub-job row (previously empty)
2. One-click blocking - adds file to global blocklist
3. Visual feedback: loading spinner during request, "Bloqueado" badge after success

---

## What Was Implemented

### 1. Backend: `POST /api/v1/settings/blocklist/add-file`

New endpoint that receives a `file_path` and adds it to the global blocklist's `file_patterns` array. Reuses existing `_get_blocklist()` / `_save_blocklist()` helpers.

### 2. Frontend: Block Button in Sub-Job Rows

- Added `Ban` icon from lucide-react
- Imported `settingsApi` for blocklist API call
- Added `blockingFiles` and `blockedFiles` state sets for UI tracking
- `handleBlockFile()` extracts `file_path` from `input_data` and calls API
- Button shows spinner while blocking, "Bloqueado" badge after success
- Added `input_data` field to `JobResponse` interface (already sent by backend)

---

## Files Modified

### Modified:
1. **backend/app/api/routes/system_settings.py** - New `POST /blocklist/add-file` endpoint
2. **frontend/src/app/jobs/page.tsx** - Block button in sub-job Actions column
3. **frontend/src/lib/api.ts** - `addFileToBlocklist()` API function + `input_data` in JobResponse

---

## Status: COMPLETE

**Key Achievements:**
- One-click file blocking from job view
- Reuses existing global blocklist infrastructure
- Blocked files automatically excluded from future RAG scans
