# PROMPT #187 - Manual Card Creation with Ghost Card Pattern
## Add Epic/Story/Task/Subtask buttons with inline title creation

**Date:** February 7, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Users can now manually create cards at every hierarchy level with instant inline editing

---

## Objective

Implement manual card creation buttons throughout the project hierarchy:

1. **Project Backlog Page**: "Add Epic" button to create new epics
2. **Epic Hierarchy Tab**: "Add Story" button to create stories under an epic
3. **Story Hierarchy Tab**: "Add Task" button to create tasks under a story
4. **Task Hierarchy Tab**: "Add Subtask" button to create subtasks under a task

**Key Behavior (Ghost Card Pattern):**
- Clicking "Add" shows an empty inline card with auto-focused title input
- Typing a title + pressing Enter persists the card to the database
- Empty title + blur/Escape automatically discards the ghost card (no DB write)
- Loading state shown while saving

---

## What Was Implemented

### 1. InlineCardCreator Component (New)

Reusable component that renders a "ghost card" with inline title input. Used in both the backlog view and the hierarchy tab.

**Props:**
- `itemType`: Epic, Story, Task, or Subtask
- `projectId`: Required for API call
- `parentId`: Links child to parent in hierarchy
- `onCreated`: Callback after successful DB persistence
- `onCancel`: Callback when user discards (empty title)
- `variant`: `backlog-row` (horizontal tree row) or `hierarchy-card` (bordered card)

**UX:**
- Auto-focuses input on mount
- Enter saves, Escape cancels, blur with empty cancels, blur with text saves
- Loading spinner shown during API call
- Error message displayed on failure (input preserved for retry)
- Dashed blue border distinguishes ghost card from real cards
- Color-coded badge per item type (purple=Epic, blue=Story, green=Task, gray=Subtask)

### 2. BacklogListView - "Add Epic" Button

- Blue "Add Epic" button in the header bar next to the item count
- When clicked, InlineCardCreator appears at the top of the backlog (above all items)
- Works in both Tree and Card view modes
- Also added to the empty backlog state ("No backlog items" screen)
- After creation, automatically refreshes the backlog list

### 3. ItemDetailPanel Hierarchy Tab - "Add [Child]" Buttons

- "Add Story" button for Epics (next to "Gerar Stories")
- "Add Task" button for Stories (next to "Gerar Tasks")
- "Add Subtask" button for Tasks (next to "Gerar Subtasks")
- No button for Subtasks (leaf nodes)
- InlineCardCreator appears at the bottom of the children list
- After creation, refreshes both the children list and the parent backlog
- Button hidden for suggested/draft items (same logic as "Generate" button)
- State resets when navigating to a different item

---

## Files Modified/Created

### Created:
1. **frontend/src/components/backlog/InlineCardCreator.tsx** - Reusable ghost card component
   - Lines: ~200
   - Features: auto-focus, Enter/Escape/blur handling, loading state, error handling, two visual variants

### Modified:
1. **frontend/src/components/backlog/BacklogListView.tsx**
   - Added `isAddingEpic` state
   - Added "Add Epic" button in header
   - Added InlineCardCreator rendering at top of tree/card views
   - Added "Add Epic" button + inline creator in empty backlog state
   - Imported InlineCardCreator

2. **frontend/src/components/backlog/ItemDetailPanel.tsx**
   - Added `isAddingChild` state
   - Added `childTypeMap` and `childTypeLabelMap` for type resolution
   - Added "Add [ChildType]" button next to "Generate" button in Hierarchy tab
   - Added InlineCardCreator at bottom of children list
   - Reset `isAddingChild` when item changes
   - Imported InlineCardCreator

3. **frontend/src/components/backlog/index.ts** - Added InlineCardCreator export

---

## Testing Results

```
Build: Compiled successfully (no new TypeScript errors)
TypeScript: No new errors from our changes (all errors are pre-existing)
Component: InlineCardCreator renders correctly in both variants
API: Uses existing tasksApi.create() endpoint (POST /api/v1/tasks/)
```

---

## Success Metrics

- **Manual card creation** at every hierarchy level (Epic, Story, Task, Subtask)
- **Ghost card pattern**: cards only saved to DB when title is provided
- **Auto-discard**: empty title on blur/Escape removes ghost card
- **Reusable component**: single InlineCardCreator used in 2 locations
- **Consistent UX**: same interaction pattern everywhere
- **No backend changes needed**: uses existing `POST /api/v1/tasks/` endpoint

---

## Key Insights

### 1. Ghost Card Pattern
The ghost card pattern (render first, persist on confirm) gives instant feedback without polluting the database with empty records. The `isSubmitting` ref prevents double-submission on rapid Enter+blur events.

### 2. Blur Handling
A 200ms delay on blur allows click events to fire first (important when user clicks a button inside the ghost card). Without this delay, blur would fire before the button click.

### 3. Child Type Resolution
Simple lookup maps (`childTypeMap`, `childTypeLabelMap`) determine the correct child type based on parent. Subtasks have no entry, so the button naturally doesn't appear for them.

---

## Status: COMPLETE

Manual card creation is now available at every level of the project hierarchy. Users can instantly add Epics from the backlog, and Stories/Tasks/Subtasks from the Hierarchy tab of any parent card.

**Key Achievements:**
- Reusable InlineCardCreator component with two visual variants
- "Add Epic" button in backlog header and empty state
- "Add Story/Task/Subtask" buttons in ItemDetailPanel Hierarchy tab
- Ghost card pattern: create on title confirm, discard on empty

---
