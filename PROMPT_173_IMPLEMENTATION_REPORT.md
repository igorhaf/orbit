# PROMPT #173 - Approve Button Loading State
## Keep Loading State on Approve Button During Background Activation

**Date:** February 7, 2026
**Status:** COMPLETED
**Priority:** MEDIUM
**Type:** UX Improvement
**Impact:** Approve button stays in loading state ("Ativando..." with spinner) while background activation job runs, both inside the detail panel and in the list/card views.

---

## Objective

When a user clicks "Aprovar" on a suggested card, the button should remain in loading state (spinner + "Ativando...") until the background activation job completes and the UI refreshes. Previously, the loading state was reset immediately after registering the background job, making the button appear idle even though activation was still in progress.

---

## What Was Implemented

### 1. ItemDetailPanel - Keep `isApproving` active (ItemDetailPanel.tsx)

Removed `setIsApproving(false)` from the background job branch. The button now stays in "Ativando..." state with spinner until the panel refreshes when the job completes.

### 2. BacklogListView - Keep `activatingId` active (BacklogListView.tsx)

Removed `setActivatingId(null)` from the background job branch. The approve button in the tree row stays in loading state. Also updated the button to show "Ativando..." text (instead of "Aprovar") during loading.

### 3. TaskCard - Keep `activatingEpic` active (TaskCard.tsx)

Removed `setActivatingEpic(false)` from the background job branch. The approve button in the card view stays in loading state. Also updated the button to show "Ativando..." text during loading.

---

## Files Modified

### Modified:
1. **frontend/src/components/backlog/ItemDetailPanel.tsx** - Kept `isApproving=true` during background job
2. **frontend/src/components/backlog/BacklogListView.tsx** - Kept `activatingId` set during background job, updated button text to "Ativando..."
3. **frontend/src/components/backlog/TaskCard.tsx** - Kept `activatingEpic=true` during background job, updated button text to "Ativando..."

### Created:
1. **PROMPT_173_IMPLEMENTATION_REPORT.md** - This report

---

## Testing Results

### Verification:

```bash
 ItemDetailPanel approve button stays in "Ativando..." state with spinner
 BacklogListView row approve button shows spinner + "Ativando..." text
 TaskCard approve button shows spinner + "Ativando..." text
 All 3 components keep loading state until job completes
 Error handling still resets loading state correctly
 Legacy synchronous flow still resets loading state correctly
```

---

## Success Metrics

- **3 components** updated with persistent loading state
- **Consistent UX** across detail panel, list view, and card view
- **No breaking changes** - error handling and legacy flow unchanged

---

## Key Insights

### 1. Natural State Cleanup
When the background job completes, the WebSocket notification triggers a backlog refresh. The refreshed item will no longer be in "draft" state or have "suggested" label, so the approve/reject buttons won't render at all - naturally cleaning up the loading state.

### 2. Consistent Button Labels
All 3 locations now show "Ativando..." with a spinner during approval, providing consistent visual feedback across the application.

---

## Status: COMPLETE

The approve button now stays in loading state during background activation across all views.

**Key Achievements:**
- Approve button shows loading state in ItemDetailPanel (detail view)
- Approve button shows loading state in BacklogListView (tree/list row)
- Approve button shows loading state in TaskCard (card view)
- Consistent "Ativando..." label with spinner across all locations
