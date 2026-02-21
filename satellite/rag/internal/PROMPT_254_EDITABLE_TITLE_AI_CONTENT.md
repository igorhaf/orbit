# PROMPT #254 - Editable Title & AI Content Generation in Card Detail
## Click to edit title with AI suggestion, AI button to generate rich description

**Date:** February 13, 2026
**Status:** COMPLETED
**Priority:** MEDIUM
**Type:** Feature Implementation
**Impact:** Users can edit card titles inline and generate rich descriptions with AI directly from the card detail panel

---

## Objective

Add two features to the ItemDetailPanel (card detail view):

1. **Editable Title**: Clicking the title makes it editable inline, with an AI suggest button (same as InlineCardCreator from PROMPT #253) to regenerate better alternatives.

2. **AI Content Generation**: A button in the description area that triggers the existing activate pipeline (ContextGeneratorService) to generate rich content based on the card title and proportional hierarchy context.

---

## What Was Implemented

### 1. Editable Title in ItemDetailPanel
- Click on the title switches to edit mode with an input field
- AI suggest button appears next to the input (purple star icon + "AI" label)
- Enter saves, Escape cancels
- Blur handler respects AI button clicks (no auto-save while generating)
- Title syncs with item changes via useEffect
- Uses existing `tasksApi.suggestTitle()` from PROMPT #253

### 2. AI Content Generation Button
- Purple "AI" button appears next to the Description header
- Clicking triggers the existing `POST /tasks/{id}/activate` endpoint
- Reuses the full ContextGeneratorService pipeline:
  - Fetches project context and interview data
  - Gets business rules from RAG
  - Uses PromptContextCompressor for proportional hierarchy context
  - Generates full description, generated_prompt, acceptance_criteria
- Job tracked via notification system (bell icon)
- Button shows spinner during generation (disabled when isApproving)
- No new endpoints or YAML prompts needed

---

## Files Modified

1. **frontend/src/components/backlog/ItemDetailPanel.tsx** - Editable title + AI content generation button
2. **frontend/src/lib/api.ts** - Added `tasksApi.suggestTitle()` usage (from PROMPT #253)

---

## Status: COMPLETE

**Key Achievements:**
- Title is now editable by clicking on it in the card detail panel
- AI suggest button available during title editing for better alternatives
- AI content generation button reuses existing activate pipeline (no new endpoints)
- Background job tracked via notification system
- Both features follow existing UI patterns (purple AI buttons, consistent UX)

---
