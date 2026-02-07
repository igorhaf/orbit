# PROMPT #173 - Persistent Approve Loading + Deep Links + Content Validator
## Approve Button Loading State Persists Across Navigation + Notification Deep Links + Epic Content Validator/Restructurer

**Date:** February 7, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** UX Improvement + Feature + Reliability
**Impact:** Approve button shows "Ativando..." with spinner persistently (survives navigation), activation notifications include clickable deep links, and AI-generated epic content is validated and restructured when incomplete.

---

## Objective

Three improvements:
1. **Persistent loading state**: The "Aprovar" button must show "Ativando..." with spinner during the entire activation cycle, even if the user navigates away and comes back.
2. **Notification deep links**: When activation completes, the notification should include a clickable link to the activated card.
3. **Epic content validation**: Intermittently, AI-generated epic content returns empty/short fields. A validator and restructurer ensures all required fields are present and meaningful.

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

### 6. Epic Content Validator & Restructurer (Backend)

Added `_validate_and_restructure_content()` method in `context_generator.py` that runs between AI generation and field assignment. Validates 4 fields with automatic restructuring:

**Validation contract:**
- `description`: must be >= 50 chars (rebuilds from `generated_prompt`, `semantic_map`, or project context)
- `generated_prompt`: must be >= 50 chars (copies from `description` if available)
- `acceptance_criteria`: must have >= 1 item (extracts from description text or generates fallback)
- `story_points`: must be valid integer > 0 (defaults to 13 for epics)

**Restructuring strategies (cascading):**
1. **Description empty → generated_prompt available**: Copy generated_prompt as description
2. **Description empty → semantic_map available**: Build description from semantic map entries
3. **Description empty → nothing available**: Generate from title + original description + project context
4. **Generated_prompt empty → description available**: Copy description as generated_prompt
5. **Acceptance criteria empty → description has AC/checklist lines**: Extract criteria via regex
6. **Acceptance criteria empty → no extractable criteria**: Generate 3 fallback criteria from title
7. **Story points invalid/missing**: Default to 13

All restructuring is logged with warnings for traceability.

---

## Files Modified

### Modified:
1. **frontend/src/components/backlog/ItemDetailPanel.tsx** - `isApproving` derived from `activeJobs`, pass `taskId` to `addJob`
2. **frontend/src/components/backlog/BacklogListView.tsx** - `isItemActivating()` from `activeJobs`, pass `taskId` to `addJob`, auto-refresh on completion
3. **frontend/src/components/backlog/TaskCard.tsx** - `activatingEpic` derived from `activeJobs`, pass `taskId` to `addJob`
4. **frontend/src/contexts/NotificationContext.tsx** - `addJob` accepts `taskId`, `job_started` handler stores `task_id`
5. **backend/app/api/routes/tasks_old.py** - Activation job now sets `task_id`, `deep_link`, `notification_title`
6. **backend/app/services/job_manager.py** - `job_started` broadcast includes `task_id` and `project_id`
7. **backend/app/services/context_generator.py** - Added `_validate_and_restructure_content()` method + validation call in `activate_suggested_epic()`

---

## Testing Results

### Verification:

```bash
 Approve button shows "Ativando..." with spinner immediately on click
 Loading state persists if user navigates away and comes back
 Loading state clears when job completes (item no longer suggested)
 Notification bell shows deep link to activated card
 Content validator catches empty/short fields and restructures them
 Backend restarts without errors
 Frontend compiles without errors
```

---

## Success Metrics

- **3 components** now use persistent `activeJobs`-derived loading state
- **Deep links** added to activation notifications
- **Full cycle**: Click Aprovar → Loading visible → Navigate away → Come back → Still loading → Job completes → Item activated → Buttons disappear
- **Content validator** ensures 4 fields are always present and meaningful, with 7 cascading restructuring strategies

---

## Key Insights

### 1. Global State vs Local State
Local component state (`useState`) resets on navigation/unmount. By deriving the loading state from `activeJobs` in NotificationContext (which is global and rehydrated from the API on mount), the state persists across the entire app lifecycle.

### 2. Deep Link Pattern
Following the existing pattern from other job types (memory_scan, cards_from_memory, context_generation), activation jobs now include `deep_link` and `notification_title` for a consistent notification UX.

### 3. Defensive Content Validation
AI providers (especially during high load or with complex prompts) can return partial or malformed JSON. Rather than retrying the expensive AI call, the validator reconstructs missing content from available data (generated_prompt, semantic_map, project context), guaranteeing the user always sees meaningful content.

---

## Status: COMPLETE

All three issues resolved:
- Approve button persistently shows loading state during activation
- Activation notifications include clickable deep link to the card
- Epic activation always produces meaningful content (validated and restructured)
