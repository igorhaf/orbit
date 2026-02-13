# PROMPT #156 - Fix Epic Generation Skip + Polling Fallback
## Three bugs fixed: epic skip, context blocking, interview notifications

**Date:** February 3, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** Épicos sugeridos agora são gerados corretamente; contexto e notificações não travam mais

---

## Bugs Fixed

### Bug 1: Suggested Epics Never Generated

**Root Cause:** `generate_cards_from_memory()` had a skip condition that counted ALL tasks in the project. Business rule cards (generated in Step 2) were counted, causing the skip to trigger before epic generation (Step 3) ever ran.

**Fix:** Changed skip condition to only count existing suggested epics (`labels=["suggested"]` + `item_type=EPIC`). Business rule cards no longer block epic generation.

**File:** `backend/app/services/context_generator.py`

### Bug 2: "Generating project context..." Blocks Forever

**Root Cause:** `useJobPolling` hook relied 100% on WebSocket for job completion events. If the WebSocket event was lost (reconnection, timing), `generatingContext` state stayed `true` forever — no fallback existed.

**Fix:** Added a 5-second polling interval fallback in `useJobPolling`. While a job is in `running` state, the hook polls the API every 5s. If the API returns `completed`/`failed`/`cancelled`, the appropriate callback fires immediately — regardless of WebSocket delivery.

**File:** `frontend/src/hooks/useJobPolling.ts`

### Bug 3: Interview Question Notifications Stop

**Root Cause:** Same as Bug 2. The interview question jobs complete on the backend and broadcast via WebSocket. If the frontend misses the event (disconnected WebSocket), the notification bell never updates.

**Fix:** Same polling fallback as Bug 2. Any job tracked by `useJobPolling` now has automatic recovery.

**File:** `frontend/src/hooks/useJobPolling.ts`

---

## Files Modified

| File | Change |
|------|--------|
| `backend/app/services/context_generator.py` | Skip condition checks only suggested epics, not all tasks |
| `frontend/src/hooks/useJobPolling.ts` | Added 5s polling fallback when WebSocket doesn't deliver |

---

## Technical Details

### Epic Skip Condition (before → after)

**Before:**
```python
existing_cards = self.db.query(Task).filter(
    Task.project_id == project_id
).count()

if existing_cards > 0:
    return {"skipped": True, ...}  # Blocks EVERYTHING
```

**After:**
```python
existing_suggested_epics = self.db.query(Task).filter(
    Task.project_id == project_id,
    Task.labels.contains(["suggested"]),
    Task.item_type == ItemType.EPIC
).count()

if existing_suggested_epics > 0:
    result["skipped_epics"] = True  # Only skips epic step
# Business rules + other steps still run
```

### Polling Fallback

```typescript
// Every 5s while job is running, fetch status from API
useEffect(() => {
  if (!jobId || !enabled || !isPolling) return;

  const interval = setInterval(async () => {
    const data = await jobsApi.get(jobId);
    if (data.status === 'completed') {
      onComplete?.(data.result);  // Fires callback even if WS missed it
    }
    // ... failed / cancelled
  }, 5000);

  return () => clearInterval(interval);
}, [jobId, enabled, isPolling, onComplete, onError, onCancelled]);
```

---

## Status: COMPLETE
