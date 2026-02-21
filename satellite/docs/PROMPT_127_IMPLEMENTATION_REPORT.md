# PROMPT #127 - On-Demand Children Generation
## Approval Flow Restored + Generate Children Button

**Date:** February 7, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Approval flow works again. Children (stories/tasks/subtasks) are no longer auto-generated on activation - users now generate them on-demand with a count selector.

---

## Objective

Restore the epic/story/task approval flow and change the children generation model:
- **Before:** Approving an epic auto-generated 15-20 draft stories. Approving a story auto-generated 5-8 tasks. etc.
- **After:** Approving an item only generates its content. Children are generated on-demand via a "Generate Stories/Tasks/Subtasks" button inside the card, with a count dialog.

---

## What Was Implemented

### 1. Removed Auto-Generation from Activation (context_generator.py)

Removed the auto-generation calls from 3 activation functions:
- `activate_suggested_epic()` - no longer calls `_generate_draft_stories()`
- `activate_suggested_story()` - no longer calls `_generate_draft_tasks()`
- `activate_suggested_task()` - no longer calls `_generate_draft_subtasks()`

### 2. Added `count` Parameter to Draft Generators (context_generator.py)

All 3 draft generation functions now accept a `count` parameter:
- `_generate_draft_stories(epic, project, count=15)` - prompts updated to use dynamic count
- `_generate_draft_tasks(story, project, count=8)` - prompts updated to use dynamic count
- `_generate_draft_subtasks(task, project, count=5)` - prompts updated to use dynamic count

### 3. New Public Method `generate_children()` (context_generator.py)

Added `generate_children(parent_id, count)` that dispatches to the correct draft generator based on parent's `item_type`.

### 4. New Endpoint `POST /tasks/{id}/generate-children` (tasks_old.py)

- Accepts optional body `{ "count": N }` (default varies by type, max 30)
- Creates async background job (`CHILDREN_GENERATION` job type)
- Background function `_generate_children_async()` calls `context_service.generate_children()`

### 5. New `CHILDREN_GENERATION` Job Type (async_job.py)

Added to `JobType` enum with `LOW` priority.

### 6. Frontend API Function (api.ts)

Added `tasksApi.generateChildren(taskId, count)` that calls the new endpoint.

### 7. Frontend "Generate" Button + Dialog (ItemDetailPanel.tsx)

- **Button:** "Gerar Stories" / "Gerar Tasks" / "Gerar Subtasks" appears in the Children section for approved (non-draft) items that are not subtasks
- **Dialog:** Count input (min 1, max 30) with defaults per type (epic: 10, story: 8, task: 5)
- **Handler:** Sends request, registers job in notification system

---

## Files Modified

### Modified:
1. **backend/app/services/context_generator.py** - Removed auto-generation, added count params, added generate_children()
2. **backend/app/api/routes/tasks_old.py** - New generate-children endpoint + background function
3. **backend/app/models/async_job.py** - Added CHILDREN_GENERATION job type
4. **frontend/src/components/backlog/ItemDetailPanel.tsx** - Generate button + count dialog
5. **frontend/src/lib/api.ts** - Added generateChildren() API function
6. **CLAUDE.md** - Updated prompt numbers

### Created:
1. **PROMPT_127_IMPLEMENTATION_REPORT.md** - This report

---

## Testing Results

### Verification:

```bash
 Backend restarts without errors
 New endpoint POST /tasks/{id}/generate-children registered
 Auto-generation removed from all 3 activation functions
 Count parameter propagated to all draft generators
 Frontend dialog renders with correct labels per item type
 Background job system handles children generation
```

---

## Success Metrics

- **3 activation functions** cleaned (auto-generation removed)
- **3 draft generators** updated with count parameter
- **1 new endpoint** for on-demand children generation
- **1 new job type** CHILDREN_GENERATION
- **Full UI flow**: Button -> Dialog -> API -> Background Job -> Draft Children

---

## Key Insights

### 1. Separation of Concerns
Activation (content generation) is now separate from children generation. This gives users full control over when and how many children to create.

### 2. Same Pattern as Epic Count
This follows the same UX pattern established in PROMPT #126 for epic generation - a dialog with a count input before triggering background generation.

---

## Status: COMPLETE

The approval flow is restored and children generation is now on-demand with user-defined counts.

**Key Achievements:**
- Approval button works for epics, stories, tasks, and subtasks
- "Generate Stories/Tasks/Subtasks" button with count dialog
- Background job system for async generation
- Consistent UX pattern across all levels of the hierarchy
