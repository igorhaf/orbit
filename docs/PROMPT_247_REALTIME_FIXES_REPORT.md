# PROMPT #247 - Real-Time Pipeline Fixes: Completion Event, tok/s, Backlog Refresh

## Objective

Fix multiple real-time update issues in the Pipeline Monitor and related pages:
1. Pipeline Monitor status stays "RUNNING" after completion (only changes on refresh)
2. tok/s display zeroing out during pipeline execution
3. Backlog page not updating when deep pipeline creates new cards
4. Phase scores not parsing correctly from REST polling

## What Was Implemented

### 1. Backend: Pipeline Completion WebSocket Event

**File:** `backend/app/services/deep_pipeline.py`

Added `log_pipeline_activity()` call after pipeline completes, broadcasting a `pipeline_completed` event via the console WebSocket channel. Previously, the pipeline only wrote "completed" status to Redis but never sent a WebSocket notification to the frontend.

### 2. Frontend: Completion Event Handler

**File:** `frontend/src/hooks/usePipelineTelemetry.ts`

Added detection of `pipeline_status: 'completed'` or `'failed'` in WebSocket events. When detected:
- Sets `status: 'completed'` (was hardcoded to `'running'`)
- Calculates final average tok/s from cumulative data
- Stops the running state immediately

### 3. Frontend: tok/s Display Fix

**File:** `frontend/src/hooks/usePipelineTelemetry.ts`

Three fixes for the tok/s zeroing issue:
- **`lastValidTpsRef`**: Caches the last non-zero tok/s value. When rolling window has insufficient data, returns cached value instead of 0.
- **REST polling threshold**: Lowered from `elapsed > 5` to `elapsed > 1` second.
- **REST vs WebSocket priority**: REST polling now prefers `lastValidTpsRef.current` over recalculated average, preventing it from overwriting active WebSocket values with stale averages.

### 4. Frontend: Phase Scores JSON Parsing

**File:** `frontend/src/hooks/usePipelineTelemetry.ts`

Added JSON string parsing for `phase_scores` from REST polling. Redis returns it as a JSON string, but the state expects an object.

### 5. Frontend: Backlog Refresh on Pipeline Completion

**Files:**
- `frontend/src/components/backlog/BacklogListView.tsx`: Added `'deep_pipeline'` to `activationTypes` array so backlog refreshes when deep pipeline completes.
- `frontend/src/app/projects/[id]/page.tsx`: Added `setBacklogRefreshKey` trigger when a deep_pipeline notification arrives for the current project.

## Root Cause Analysis

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Status stays RUNNING | Backend only wrote to Redis, never broadcast via WebSocket | Added `log_pipeline_activity` with `pipeline_status: 'completed'` |
| tok/s zeroing | Rolling window collapsed to <2 entries during gaps; REST overwrite with 0 when elapsed < 5s | Cache last valid tps, lower threshold, prioritize cached value |
| Backlog not refreshing | `activationTypes` only included epic/story/task activation, not deep_pipeline | Added `'deep_pipeline'` to the list |
| Phase scores as string | REST returns JSON string from Redis, frontend expected object | Added JSON.parse for string values |

## Files Modified

| # | File | Change |
|---|------|--------|
| 1 | `backend/app/services/deep_pipeline.py` | Emit `pipeline_completed` event via console_logger |
| 2 | `frontend/src/hooks/usePipelineTelemetry.ts` | Handle completion event, fix tok/s zeroing, fix phase_scores parsing |
| 3 | `frontend/src/components/backlog/BacklogListView.tsx` | Add `deep_pipeline` to activation types |
| 4 | `frontend/src/app/projects/[id]/page.tsx` | Trigger backlog refresh on deep_pipeline completion |

## Testing

- Python syntax check: PASS
- TypeScript compilation: PASS (no new errors)
- Backend restart: PASS

## Status

**COMPLETED**
