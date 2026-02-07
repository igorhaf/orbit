# PROMPT #173 - Persistent Approve Loading + Activation Deep Links
## Approve Button Loading State Persists Across Navigation + Notification Deep Links

**Date:** February 7, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** UX Improvement + Feature
**Impact:** Approve button shows "Ativando..." with spinner persistently (survives navigation), and activation notifications now include clickable deep links to the activated card.

---

## Objective

Two improvements:
1. **Persistent loading state**: The "Aprovar" button must show "Ativando..." with spinner during the entire activation cycle, even if the user navigates away and comes back.
2. **Notification deep links**: When activation completes, the notification should include a clickable link to the activated card.

---

## What Was Implemented

### 1. Persistent Loading via `activeJobs` (Frontend)

Replaced local component state (`isApproving`, `activatingId`, `activatingEpic`) with derived state from `activeJobs` in NotificationContext. This persists across navigation because NotificationContext is a global provider.

**ItemDetailPanel.tsx:**
- `isApproving` is now computed: `activeJobs.some(j => activationTypes.includes(j.job_type) && j.task_id === item.id && ...)`
- Removed all `setIsApproving` calls

**BacklogListView.tsx:**
- `isItemActivating(itemId)` function checks `activeJobs` for matching activation jobs
- Replaced all `activatingId === item.id` with `isItemActivating(item.id)`
- Removed `activatingId` state variable

**TaskCard.tsx:**
- `activatingEpic` is now computed from `activeJobs` matching `task.id`
- Removed all `setActivatingEpic` calls

### 2. `addJob` Accepts `taskId` (Frontend)

Updated `addJob()` in NotificationContext to accept an optional `taskId` parameter. All 3 components now pass the item ID when registering activation jobs:
```typescript
addJob(result.job_id, jobType, title, description, false, item.id)
```

### 3. `task_id` in Job Started Broadcast (Backend)

Updated `job_manager.py` to include `task_id` and `project_id` in `job_started` WebSocket events, enabling the frontend to track which item is being activated from the start.

### 4. Deep Link + Notification Title for Activation Jobs (Backend)

Updated `tasks_old.py` activation endpoint to set:
- `task_id`: Links job to the specific item
- `deep_link`: `/projects/{project_id}?task={task_id}` - navigates to project with task context
- `notification_title`: "Ativação concluída: {title}" - shown in notification bell

### 5. Backlog Auto-Refresh on Activation Complete (Frontend)

BacklogListView watches `notifications` for activation job completions and triggers `fetchBacklog()` when detected.

---

## Files Modified

### Modified:
1. **frontend/src/components/backlog/ItemDetailPanel.tsx** - `isApproving` derived from `activeJobs`, pass `taskId` to `addJob`
2. **frontend/src/components/backlog/BacklogListView.tsx** - `isItemActivating()` from `activeJobs`, pass `taskId` to `addJob`, auto-refresh on completion
3. **frontend/src/components/backlog/TaskCard.tsx** - `activatingEpic` derived from `activeJobs`, pass `taskId` to `addJob`
4. **frontend/src/contexts/NotificationContext.tsx** - `addJob` accepts `taskId`, `job_started` handler stores `task_id`
5. **backend/app/api/routes/tasks_old.py** - Activation job now sets `task_id`, `deep_link`, `notification_title`
6. **backend/app/services/job_manager.py** - `job_started` broadcast includes `task_id` and `project_id`

---

## Testing Results

### Verification:

```bash
 Approve button shows "Ativando..." with spinner immediately on click
 Loading state persists if user navigates away and comes back
 Loading state clears when job completes (item no longer suggested)
 Notification bell shows deep link to activated card
 Backend restarts without errors
 Frontend compiles without errors
```

---

## Success Metrics

- **3 components** now use persistent `activeJobs`-derived loading state
- **Deep links** added to activation notifications
- **Full cycle**: Click Aprovar → Loading visible → Navigate away → Come back → Still loading → Job completes → Item activated → Buttons disappear

---

## Key Insights

### 1. Global State vs Local State
Local component state (`useState`) resets on navigation/unmount. By deriving the loading state from `activeJobs` in NotificationContext (which is global and rehydrated from the API on mount), the state persists across the entire app lifecycle.

### 2. Deep Link Pattern
Following the existing pattern from other job types (memory_scan, cards_from_memory, context_generation), activation jobs now include `deep_link` and `notification_title` for a consistent notification UX.

---

## Status: COMPLETE

Both issues resolved:
- Approve button persistently shows loading state during activation
- Activation notifications include clickable deep link to the card
