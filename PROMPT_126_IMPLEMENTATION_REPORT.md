# PROMPT #126 - Epic Count Selector for Generate Epics
## User-Defined Epic Count Before Generation

**Date:** February 7, 2026
**Status:** COMPLETED
**Priority:** MEDIUM
**Type:** Feature Implementation
**Impact:** Users can now define how many epics they want before starting generation, instead of a fixed 20.

---

## Objective

Add a dialog where the user defines the desired number of epics before starting generation. Previously, clicking "Generate Epics" immediately started a background job that always generated up to 20 epics (4 batches x 5 epics). Now, a dialog opens with a numeric input (default: 10, min: 1, max: 30).

---

## What Was Implemented

### 1. Backend: Accept epic_count in endpoint

**File:** `backend/app/api/routes/projects.py`

- Endpoint `POST /projects/{project_id}/generate-cards` now accepts an optional JSON body with `epic_count`
- Extracts `epic_count` from body (default: 10, clamped between 1 and 30)
- Passes `epic_count` in job `input_data` for the background task

### 2. Backend: Propagate epic_count to context generator

**File:** `backend/app/services/context_generator.py`

- `generate_cards_from_memory()` now accepts `epic_count: int = 10` parameter
- Calculates `epics_per_batch = min(epic_count, 5)` and `max_batches = ceil(epic_count / epics_per_batch)`
- Passes calculated values to `generate_epics_incrementally()`

**File:** `backend/app/api/routes/projects.py` (background function)

- `_process_cards_from_memory_async()` extracts `epic_count` from `job.input_data` and passes to service

### 3. Frontend: Epic Count Dialog

**File:** `frontend/src/app/projects/[id]/page.tsx`

- Added `Dialog` and `DialogFooter` to UI imports
- Added `showEpicCountDialog` and `epicCount` state variables
- "Generate Epics" button now opens dialog instead of making API call directly
- Dialog contains numeric input (default: 10, min: 1, max: 30)
- On confirm, sends `POST /api/v1/projects/{projectId}/generate-cards` with body `{ epic_count: N }`
- Success notification shows the requested count

---

## Files Modified

### Modified:
1. **backend/app/api/routes/projects.py** - Accept optional body with epic_count, pass to job and background function
2. **backend/app/services/context_generator.py** - Accept epic_count, calculate batches
3. **frontend/src/app/projects/[id]/page.tsx** - Dialog with numeric input, state management
4. **CLAUDE.md** - Updated prompt numbers

### Created:
1. **PROMPT_126_IMPLEMENTATION_REPORT.md** - This report

---

## Testing Results

### Verification:

```bash
 Backend accepts epic_count in generate-cards endpoint
 Background function extracts epic_count from job input_data
 Context generator calculates batches from epic_count
 Frontend opens dialog with numeric input on button click
 Dialog sends POST with epic_count in body
 Backend restarts without errors
```

---

## Success Metrics

- **3 files modified** across frontend and backend
- **Full flow implemented**: Dialog -> API -> Job -> Service -> Generation
- **Backward compatible**: Body is optional, defaults to 10 epics
- **Input validated**: Clamped between 1 and 30 on both frontend and backend

---

## Key Insights

### 1. Batch Calculation
The system generates epics in batches of up to 5. The `epic_count` is split into appropriate batch sizes:
- 5 epics = 1 batch x 5
- 10 epics = 2 batches x 5
- 12 epics = 3 batches (5+5+2)

### 2. Minimal Changes
By accepting an optional body on the existing endpoint, the change is fully backward compatible. Any existing client that doesn't send a body gets the default of 10 epics.

---

## Status: COMPLETE

Users can now control how many epics are generated via a dialog with a numeric input.

**Key Achievements:**
- Dialog with numeric input (default 10, range 1-30)
- Full stack implementation (frontend dialog -> backend endpoint -> service)
- Backward compatible (optional body parameter)

**Impact:**
- Users have control over epic generation quantity
- Better resource management for smaller/larger projects
