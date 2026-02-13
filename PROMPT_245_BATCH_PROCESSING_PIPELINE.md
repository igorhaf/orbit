# PROMPT #245 - Batch Processing Pipeline with Incremental Context & Card Enrichment
## Incremental file processing with wiki updates and auto-card creation per batch

**Date:** February 12, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Project creation is faster (first batch creates basic context), remaining files processed incrementally with wiki updates and card creation after each batch, idle time used for card enrichment

---

## Objective

Replace the monolithic "process all files at once" pipeline with a batch-based approach where:
1. First batch creates basic context + title (fast initial result)
2. Remaining files are processed in batches via the job queue
3. After each batch: wiki is updated, new cards are created from discovered rules
4. When idle (no new rules): existing auto-discovered stub cards get enriched with rich content
5. Priority: new context/cards > card enrichment

**Key Requirements:**
1. `scan_depth` (quick=30, normal=100, deep=all) determines batch size
2. First batch activates project quickly, remaining batches run in background
3. Wiki enrichment + card auto-discovery after each batch
4. Stub card enrichment when no new rules are found
5. Restart resilience: pending files resume batch processing on restart

---

## What Was Implemented

### 1. scan_depth Column on Project Model

Added `scan_depth` column to persist the chosen scan depth for batch processing across restarts.

- **Model:** `project.py` - Added `scan_depth = Column(String(10), nullable=True)`
- **Migration:** `20260213_add_scan_depth_to_projects.py` - Adds column to projects table

### 2. _auto_enrich_stub_cards() Function

New function in `watchdog.py` that finds auto-discovered cards with minimal content and enriches them via `ContextGeneratorService.activate_suggested_*()` methods.

- Queries cards with `labels.contains(["auto-discovered"])` and `generated_prompt IS NULL`
- Orders by `created_at ASC` (oldest first)
- Enriches up to `max_cards` per call
- Routes to correct activation method based on `item_type` (epic/story/task/subtask)

### 3. batch_processing_cycle() Function

Aggressive batch processor for initial project ingestion with NORMAL priority and 5-second cooldown:

- **Step 1:** `ContinuousRAGService.process_pending_files(project_id, batch_size=N)` - Process next batch
- **Step 2:** If `rules_extracted > 0` - Enrich wiki via `_enrich_context_from_rag()`
- **Step 3:** If `rules_extracted > 0` - Auto-discover cards via `_auto_discover_cards()`
- **Step 4:** If idle (no new rules, no new cards) - Enrich 2 existing stub cards
- **Decision:** If `pending_remaining > 0` - Re-queue `batch_processing_cycle`; else transition to `submit_watchdog_cycle`

### 4. submit_batch_processing_cycle() Function

Job submitter for batch processing:
- Uses `JobPriority.NORMAL` (higher than watchdog's LOW)
- Stores `batch_size` in `input_data`
- Same deduplication check as watchdog (no duplicate pending/running jobs)

### 5. Step 6 in watchdog_cycle() - Idle Card Enrichment

After Step 5 (auto-discover cards), when no new rules and no new cards are found:
- Calls `_auto_enrich_stub_cards(db, project_id, max_cards=1)`
- Result includes `cards_enriched` count

### 6. Modified _process_project_pipeline()

- Saves `scan_depth` to project after scan results
- For quick/normal modes: registers ALL remaining files via `ContinuousRAGService.scan_for_changes()`
- Replaces `submit_watchdog_cycle()` with conditional logic:
  - `deep` mode: starts watchdog directly (same as before)
  - `quick`/`normal` modes: starts `submit_batch_processing_cycle()` with appropriate batch size

### 7. Modified bootstrap_watchdog()

On startup, checks each active project for PENDING files in `rag_file_state`:
- If pending > 0: submits `batch_processing_cycle` using project's `scan_depth`
- If pending == 0: submits `watchdog_cycle` (normal maintenance)

---

## Architecture Flow

```
User creates project (scan_depth=quick, batch_size=30)
    |
    v
_process_project_pipeline:
  - scan_and_memorize(first 30 files) -> initial context + title
  - scan_for_changes() -> registers ALL remaining files as PENDING
  - _enrich_context_from_rag() -> first wiki enrichment
  - Activate project (user sees result fast)
  - submit_batch_processing_cycle(batch_size=30)
    |
    v
batch_processing_cycle (NORMAL priority, 5s cooldown):
  - process_pending_files(batch_size=30)
  - If rules found: enrich wiki + create cards
  - If idle: enrich 2 existing stub cards
  - If pending_remaining > 0: re-queue batch_processing_cycle
  - If pending_remaining == 0: transition to watchdog_cycle
    |
    v
watchdog_cycle (LOW priority, 60s cooldown) - steady-state:
  - Same as before + Step 6: idle card enrichment (max 1 card/cycle)
```

---

## Files Modified/Created

### Created:
1. **backend/alembic/versions/20260213_add_scan_depth_to_projects.py** - Migration for scan_depth column

### Modified:
1. **backend/app/models/project.py** - Added `scan_depth` column
2. **backend/app/services/watchdog.py** - Added `batch_processing_cycle`, `submit_batch_processing_cycle`, `_auto_enrich_stub_cards`; modified `watchdog_cycle` (Step 6), `bootstrap_watchdog`
3. **backend/app/api/routes/projects.py** - Modified `_process_project_pipeline` for first-batch + register remaining + conditional batch/watchdog start

---

## Key Insights

### 1. Two-Mode System
Batch processing (NORMAL priority, 5s cooldown) for aggressive initial ingestion transitions naturally to watchdog (LOW priority, 60s cooldown) for steady-state maintenance. Priority ensures batch work always runs before watchdog.

### 2. Card Enrichment Reuse
`_auto_enrich_stub_cards()` reuses existing `ContextGeneratorService.activate_suggested_*()` methods, maintaining consistency with how manually-activated cards are enriched.

### 3. Restart Resilience
By persisting `scan_depth` on the project and checking `rag_file_state` PENDING count at startup, batch processing resumes exactly where it left off after a restart.

### 4. File Overlap is Acceptable
`scan_and_memorize()` processes first N files. `scan_for_changes()` then registers ALL files as PENDING. Some overlap in `process_pending_files()` is acceptable - it deletes old RAG docs and re-creates, producing the same results. The overhead is minimal vs tracking which files were already analyzed.

---

## Status: COMPLETE

**Key Achievements:**
- Project creation is faster: first batch creates context, project activates immediately
- Remaining files processed incrementally in background batches
- Wiki updates and card creation happen after each batch
- Idle time is used productively to enrich stub cards
- Restart resilient: pending files resume batch processing on restart
- Priority system ensures new content > card enrichment

---
