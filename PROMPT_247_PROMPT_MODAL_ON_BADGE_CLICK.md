# PROMPT #247 - Prompt Modal on AIModelBadge Click
## View the AI prompt that generated card content by clicking the model icon

**Date:** February 12, 2026
**Status:** COMPLETED
**Priority:** MEDIUM
**Type:** Feature Implementation
**Impact:** Users can click any AI model icon to view the full prompt that generated the card content

---

## Objective

When clicking the AI model icon (AIModelBadge), open a modal showing the full prompt text (`generated_prompt`) that was used to generate the card content.

**Key Requirements:**
1. Add `promptText` prop to AIModelBadge
2. When promptText is available, clicking the icon opens a Dialog with the prompt
3. Tooltip still works on hover, modal opens on click
4. Copy button inside the modal for convenience
5. Pass `generated_prompt` from all existing call sites

---

## What Was Implemented

### 1. AIModelBadge Component Changes
- Added `promptText?: string | null` prop
- When `promptText` is provided: cursor changes to `pointer`, title becomes "Click to view prompt"
- Click handler opens a Dialog modal with the full prompt text
- Tooltip is dismissed when modal opens (no overlap)
- `e.stopPropagation()` prevents parent click handlers from firing

### 2. Prompt Modal
- Uses existing `Dialog` component (size `lg`)
- Header shows model name and usage type
- Content: `<pre>` block with monospace font, gray background, scrollable (max 60vh)
- Copy button in top-right corner

### 3. Call Sites Updated (5 locations)
All places that show an AIModelBadge with `created_by_ai_model` now also pass `generated_prompt`:
- `backlog/TaskCard.tsx` - Card view in backlog
- `backlog/BacklogListView.tsx` - List view in backlog
- `backlog/ItemDetailPanel.tsx` (2 locations) - Overview tab + Atomic Prompt tab
- `kanban/TaskCard.tsx` - Kanban board cards

Decorative badges (projects page, MessageBubble) were not changed since they have no prompt data.

---

## Files Modified

1. **frontend/src/components/ui/AIModelBadge.tsx** - Added `promptText` prop, click handler, Dialog modal
2. **frontend/src/components/backlog/TaskCard.tsx** - Pass `task.generated_prompt` to badge
3. **frontend/src/components/backlog/BacklogListView.tsx** - Pass `item.generated_prompt` to badge
4. **frontend/src/components/backlog/ItemDetailPanel.tsx** - Pass `item.generated_prompt` to badge (2 locations)
5. **frontend/src/components/kanban/TaskCard.tsx** - Pass `task.generated_prompt` to badge

---

## Status: COMPLETE

**Key Achievements:**
- AI model icon is now interactive: hover for tooltip, click for full prompt
- Prompt text displayed in readable monospace format with copy button
- All 5 call sites with prompt data updated
- Backward compatible: badges without promptText behave exactly as before

---
