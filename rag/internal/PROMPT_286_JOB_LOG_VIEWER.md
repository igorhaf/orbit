# PROMPT #286 - Job Detail Log Viewer with Real-Time Streaming
## Click a job to see full execution log, streaming in real-time for running jobs

**Date:** 2026-02-15
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Users can now click any job row to see its complete execution history with timestamped log entries. Running jobs stream log entries in real-time via WebSocket.

---

## Objective

Add a detailed log viewer to the jobs page. When a user clicks a job row, it expands to show the full execution log with timestamped entries. For running jobs, new log entries appear in real-time via WebSocket.

**Key Requirements:**
1. Store every progress update as a historical log entry (not just overwrite `progress_message`)
2. Click job row to expand inline detail panel with terminal-style log viewer
3. Running jobs stream log entries in real-time via existing WebSocket
4. Auto-scroll to bottom for running jobs
5. Show result summary for completed jobs, error detail for failed jobs

---

## What Was Implemented

### 1. JobLogEntry Model
**File:** `backend/app/models/job_log_entry.py` (CREATED)

New SQLAlchemy model to store job execution log entries:
- `id` (UUID, primary key)
- `job_id` (UUID, FK to async_jobs with CASCADE delete)
- `timestamp` (DateTime, defaults to now)
- `level` (String: info, warning, error, success)
- `message` (Text)
- `progress_percent` (Float, nullable)
- Composite index on `(job_id, timestamp)` for ordered retrieval
- `to_dict()` method for API serialization

### 2. Database Migration
**File:** `backend/alembic/versions/20260215_create_job_log_entries.py` (CREATED)

Additive migration creating `job_log_entries` table with 2 indexes.

### 3. JobManager Log Entry Insertion
**File:** `backend/app/services/job_manager.py` (MODIFIED)

Added `JobLogEntry` insertion to 5 lifecycle methods:
- `start_job()`: level=info, "Job started", progress=0
- `update_progress()`: level=info, message from progress_message, includes progress_percent
- `complete_job()`: level=success, "Job completed successfully", progress=100
- `fail_job()`: level=error, message is the error string
- `cancel_job()`: level=warning, "Job cancelled by user"

This is the single integration point - no changes needed at the 80+ call sites.

### 4. GET /jobs/{id}/logs Endpoint
**File:** `backend/app/api/routes/jobs.py` (MODIFIED)

New endpoint returning `{ job_id, logs: [...], total }` ordered by timestamp ASC. Supports `limit` (default 500, max 2000) and `offset` query params. Returns 404 if job not found.

### 5. Frontend API Method
**File:** `frontend/src/lib/api.ts` (MODIFIED)

Added `logs: (jobId: string) => request(...)` to `jobsApi` object.

### 6. Expandable Row with Log Viewer
**File:** `frontend/src/app/jobs/page.tsx` (MODIFIED)

Major UI changes:
- **Clickable rows** with chevron indicator that rotates when expanded
- **Expandable detail panel** below each row with:
  - Job detail header (ID, type, timestamps, duration)
  - Terminal-style log area (dark bg `bg-gray-900`, monospace `font-mono text-xs`)
  - Level-colored entries: info=cyan, warning=yellow, error=red, success=green
  - Format: `[HH:MM:SS] [LEVEL] message (percent%)`
  - "Live" indicator for running jobs
  - Loading state and empty state for pre-feature jobs
  - Result summary (green box) for completed jobs
  - Error detail (red box) for failed jobs
- **Real-time streaming** via existing WebSocket:
  - `handleWebSocketEvent` extended to capture log entries for expanded job
  - Uses `setExpandedJobId` callback pattern to read current state inside closure
  - Appends entries for job_started, job_progress, job_completed, job_failed, job_cancelled
- **Auto-scroll** for running jobs via `useEffect` + `scrollIntoView`
- **stopPropagation** on action buttons (Deep Link, Cancel, Delete) to prevent row toggle

---

## Files Modified/Created

### Created:
1. **`backend/app/models/job_log_entry.py`** - SQLAlchemy model for log entries
2. **`backend/alembic/versions/20260215_create_job_log_entries.py`** - Migration

### Modified:
1. **`backend/app/services/job_manager.py`** - Insert log entries in 5 lifecycle methods
2. **`backend/app/api/routes/jobs.py`** - Added GET /{job_id}/logs endpoint
3. **`frontend/src/lib/api.ts`** - Added jobsApi.logs() method
4. **`frontend/src/app/jobs/page.tsx`** - Expandable rows, terminal log viewer, real-time WebSocket streaming, auto-scroll

---

## Testing Results

```
OK  Migration: job_log_entries table created successfully
OK  JobManager: log entries inserted in start_job, update_progress, complete_job, fail_job, cancel_job
OK  API: GET /jobs/{id}/logs returns ordered entries with pagination
OK  Frontend: Click row expands detail panel with log viewer
OK  Frontend: WebSocket events append real-time entries for expanded job
OK  Frontend: Auto-scroll works for running jobs
OK  Frontend: Action buttons don't trigger row toggle (stopPropagation)
OK  CASCADE: Deleting a job also deletes its log entries
```

---

## Key Insights

### 1. Single Integration Point
By modifying `JobManager` (the single funnel for all job state changes), all 80+ call sites automatically get log entry insertion without any code changes. This is the cleanest approach.

### 2. WebSocket Reuse
The existing WebSocket `job_progress` events already contain all needed data. No new events or connections were needed - just extending the `handleWebSocketEvent` handler to also append entries to the local log state.

### 3. State Closure Challenge
Reading `expandedJobId` inside the WebSocket handler required the `setExpandedJobId(current => { ... return current })` pattern to access the current value inside the closure, since the handler is defined once in the `useEffect`.

---

## Status: COMPLETE

**Key Achievements:**
- Every job progress update now stored as a historical log entry
- Click any job row to see full execution log with timestamps
- Running jobs stream log entries in real-time via WebSocket
- Terminal-style viewer with level-colored entries
- Auto-scroll for running jobs
- Pre-feature jobs show "No log entries available" gracefully

**Impact:**
- Users can now debug job issues by viewing the complete execution timeline
- Real-time visibility into running jobs without page refresh
- Historical log preserved even after job completes (unlike single `progress_message` field)
