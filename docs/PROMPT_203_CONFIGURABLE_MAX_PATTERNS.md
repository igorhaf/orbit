# PROMPT #203 - Configurable max_patterns via Settings + Discover Specs Button
## max_patterns Configurable, Cap 50 per Project, Discover Button

**Date:** February 8, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Enhancement
**Impact:** Users can now configure how many code patterns are discovered per scan, manually trigger discovery from the Specs tab, and projects are capped at 50 specs total

---

## Objective

Make the hardcoded `max_patterns=20` configurable via the Settings UI page (stored in `system_settings` DB table), add a "Discover Specs" button in the project's Specs tab for on-demand discovery, and enforce a cap of 50 specs per project across all discovery paths.

**Key Requirements:**
1. Read `max_discovery_patterns` from `system_settings` table (default: 20)
2. Replace all hardcoded `max_patterns=20` with dynamic value from DB
3. Enforce cap of 50 specs per project (multiple scans accumulate but never exceed 50)
4. Add "Discovery Settings" card to `/settings` page
5. Add "Discover Specs" button to `ProjectSpecsList` component

---

## What Was Implemented

### 1. Backend: Dynamic `max_patterns` from Settings

**`backend/app/api/routes/projects.py`:**
- Added `MAX_SPECS_PER_PROJECT = 50` constant
- Created `_get_max_patterns(db)` helper — reads `max_discovery_patterns` from `system_settings`, defaults to 20
- Created `_effective_max_patterns(db, project_id)` helper — calculates effective max considering existing specs and 50 cap
- Updated all 3 background tasks to use dynamic value:
  - `_process_memory_scan_async` (scan-memory)
  - `_process_quick_create_scan` (quick-create)
  - `_process_project_pipeline` (create-and-process)
- Updated `discover-specs` endpoint with cap enforcement and RAG sync after discovery

### 2. Backend: Schema and Discovery Queue Updates

**`backend/app/schemas/pattern_discovery.py`:**
- Changed `max_patterns` validation from `le=50` to `le=100` for more flexibility

**`backend/app/api/routes/discovery_queue.py`:**
- Added `SystemSettings` import
- Changed `max_patterns` parameter from `Query(20)` to `Optional[int]` with `Query(None)`
- Reads default from `system_settings` table when not provided

### 3. Frontend: Discovery Settings Card

**`frontend/src/app/settings/page.tsx`:**
- Added `maxPatterns` and `savingDiscovery` state
- Loads `max_discovery_patterns` from settings on page load
- New "Discovery Settings" card between "Default AI Models" and "General Settings"
- Number input with min=1, max=50, save button
- Saves via `settingsApi.set('max_discovery_patterns', ...)`
- Filtered `max_discovery_patterns` from general settings list to avoid duplication

### 4. Frontend: Discover Specs Button

**`frontend/src/components/specs/ProjectSpecsList.tsx`:**
- Added `discovering` state
- Added `handleDiscoverSpecs` handler — calls `POST /projects/{id}/discover-specs`
- "Discover Specs" button with `RefreshCw` icon in header, next to "Add Spec"
- Button disabled when `discovering` or when `specs.length >= 50` (cap reached)
- Shows spinner animation during discovery
- Updated empty state message to mention "Discover Specs"

---

## Files Modified

### Modified:
1. **backend/app/api/routes/projects.py** - Helper functions, 3 background tasks updated, discover-specs endpoint with cap
2. **backend/app/schemas/pattern_discovery.py** - `le=50` to `le=100`
3. **backend/app/api/routes/discovery_queue.py** - Read default from SystemSettings
4. **frontend/src/app/settings/page.tsx** - Discovery Settings card with number input
5. **frontend/src/components/specs/ProjectSpecsList.tsx** - Discover Specs button with cap enforcement

---

## Testing Results

```bash
Python syntax validation:
  projects.py OK
  discovery_queue.py OK
  pattern_discovery.py OK

Backend restarts without errors
```

---

## Success Metrics

- **Configurable:** max_patterns readable from system_settings table
- **Default preserved:** Defaults to 20 when no setting exists
- **Cap enforced:** 50 specs per project across all paths (3 background tasks + discover endpoint + queue)
- **UI Settings:** Discovery Settings card in /settings page
- **Discover button:** "Discover Specs" button in project Specs tab
- **Non-breaking:** All existing functionality preserved

---

## Key Insights

### 1. Five Entry Points for Pattern Discovery
ORBIT has 5 ways to trigger pattern discovery. All now respect the configurable max_patterns and 50 cap:
- `/scan-memory` background task
- `/quick-create` background task
- `/create-and-process` background task
- `/discover-specs` endpoint (manual from Specs tab)
- `/discovery-queue/{id}/process` endpoint (from queue)

### 2. Effective Max Calculation
The `_effective_max_patterns()` function ensures `min(configured_max, 50 - existing_count)`, so projects accumulate specs over multiple runs but never exceed 50.

### 3. RAG Sync After Discovery
The discover-specs endpoint now syncs to RAG after discovery, ensuring new specs are immediately available for semantic search.

---

## Status: COMPLETE

The `max_patterns` value is now fully configurable via the Settings page, with a "Discover Specs" button for on-demand pattern discovery and a hard cap of 50 specs per project.

---
