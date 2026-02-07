# PROMPT #176 - Persistent Loading State for Generate Children Buttons
## Loading spinner on hierarchy generation buttons (Gerar Stories/Tasks/Subtasks)

**Date:** February 7, 2026
**Status:** ✅ COMPLETED
**Priority:** MEDIUM
**Type:** Enhancement
**Impact:** UX consistency - all generation buttons now show persistent loading state during background processing

---

## 🎯 Objective

Apply the same persistent loading pattern from the Approve button (PROMPT #173) to all "Generate Children" buttons in the item detail panel hierarchy section. When a user clicks "Gerar Stories", "Gerar Tasks", or "Gerar Subtasks", the button should show a loading spinner and be disabled until the background job completes, even if the user navigates away and returns.

**Key Requirements:**
1. Derive `isGeneratingChildren` from `activeJobs` (same pattern as `isApproving`)
2. Pass `item.id` as `taskId` in the `addJob` call so the job can be matched back to the item
3. Show loading spinner with "Gerando..." text while generating
4. Disable the button during generation to prevent duplicate requests

---

## 🔍 Pattern Analysis

### Existing Pattern: PROMPT #173 Approve Button

The approve button already uses a persistent loading pattern:
```typescript
const isApproving = activeJobs.some(
  j => activationTypes.includes(j.job_type) && j.task_id === item.id && (j.status === 'pending' || j.status === 'running')
);
```

The generate children button was NOT following this pattern - it closed the dialog immediately after the API call with no loading indicator on the button itself.

---

## ✅ What Was Implemented

### 1. Persistent `isGeneratingChildren` State (line 72-75)
Added a computed state derived from `activeJobs`, matching jobs of type `children_generation` for the current item:
```typescript
const isGeneratingChildren = activeJobs.some(
  j => j.job_type === 'children_generation' && j.task_id === item.id && (j.status === 'pending' || j.status === 'running')
);
```

### 2. Task ID Tracking in `addJob` (line 347-354)
Updated the `handleGenerateChildren` handler to pass `item.id` as the `taskId` parameter:
```typescript
addJob(
  result.job_id,
  'children_generation',
  `Gerando ${count} ${childType} para: ${item.title.substring(0, 30)}...`,
  item.title,
  false,
  item.id // Track which task is generating children for persistent loading
);
```

### 3. Button Loading UI (lines 1000-1029)
Updated the generate button to show a spinner and "Gerando..." text when active, disabled during generation:
- Spinner: `animate-spin rounded-full h-4 w-4 border-b-2 border-white`
- Text: "Gerando..." (replaces "Gerar Stories/Tasks/Subtasks")
- `disabled={isGeneratingChildren}` prevents duplicate requests
- Persists across navigation (user can leave and return, still sees loading)

---

## 📁 Files Modified

### Modified:
1. **frontend/src/components/backlog/ItemDetailPanel.tsx** - 3 changes
   - Line 72-75: Added `isGeneratingChildren` derived state
   - Line 347-354: Added `item.id` as `taskId` in `addJob` call
   - Lines 1000-1029: Updated button with loading spinner, disabled state, and conditional text

---

## 🧪 Testing Results

### Verification:
```
✅ isGeneratingChildren correctly derived from activeJobs
✅ task_id passed to addJob for children_generation jobs
✅ Button shows spinner + "Gerando..." during generation
✅ Button disabled during generation (prevents double-click)
✅ Loading state persists across navigation
✅ Applies to all item types: Epic→Stories, Story→Tasks, Task→Subtasks
```

---

## 🎯 Success Metrics

✅ **UX Consistency:** Generate buttons now follow the same loading pattern as Approve buttons
✅ **Persistent State:** Loading persists even if user navigates away and returns to the item
✅ **Duplicate Prevention:** Button is disabled during generation, preventing accidental double-triggers

---

## 🎉 Status: COMPLETE

All generate children buttons ("Gerar Stories", "Gerar Tasks", "Gerar Subtasks") now show persistent loading state during background generation, following the same pattern established by the Approve button in PROMPT #173.

**Key Achievements:**
- ✅ Persistent loading derived from `activeJobs` (survives navigation)
- ✅ Spinner + "Gerando..." text during generation
- ✅ Button disabled to prevent duplicate requests
- ✅ Works for all hierarchy levels (Epic/Story/Task)

**Impact:**
- Users get clear visual feedback that generation is in progress
- No more confusion about whether the button click was registered
- Consistent UX across all action buttons in the item detail panel

---
