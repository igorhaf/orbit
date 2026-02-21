# PROMPT #253 - AI Title Suggestion for Backlog Cards
## Button to generate better titles when creating cards in the backlog

**Date:** February 13, 2026
**Status:** COMPLETED
**Priority:** MEDIUM
**Type:** Feature Implementation
**Impact:** Users can generate professional, polished card titles from rough input using AI

---

## Objective

Add an AI suggestion button to the inline card creator in the backlog. When creating an Epic, Story, Task, or Subtask, the user types a rough title and clicks the AI button to get a polished, professional version. The button stays available after generation so the user can regenerate alternatives.

---

## What Was Implemented

### 1. Backend Endpoint `POST /tasks/suggest-title`
- Receives: `user_input`, `item_type`, `project_id`, optional `parent_id`
- Gathers context: project name/description, parent card title, sibling titles
- Calls AI via `AIOrchestrator` with externalized YAML prompt
- Returns `suggested_title` directly (synchronous, fast ~100 tokens)

### 2. YAML Prompt `backlog/suggest_title.yaml`
- System prompt instructs AI to return ONLY the improved title
- Adapts style based on item_type (Epic=broad, Story=user-oriented, Task=actionable, Subtask=technical)
- Uses project context and sibling titles to avoid duplicates
- Writes in the same language as user input

### 3. Frontend `AISuggestButton` Component
- Purple star icon button with "AI" label
- Shows spinner during generation
- Disabled when input is empty
- Stays visible after generation for re-generation
- Uses `data-ai-suggest` attribute to prevent blur/cancel when clicking

### 4. Integration in `InlineCardCreator`
- Button appears next to the title input in both variants (`backlog-row` and `hierarchy-card`)
- Clicking the AI button replaces the input text with the suggestion
- Focus returns to input after generation
- `handleBlur` respects AI button clicks (no auto-save while generating)

---

## Files Created

1. **backend/app/prompts/backlog/suggest_title.yaml** - AI prompt template

## Files Modified

1. **backend/app/api/routes/tasks_old.py** - New endpoint `POST /suggest-title`
2. **frontend/src/lib/api.ts** - Added `tasksApi.suggestTitle()` method
3. **frontend/src/components/backlog/InlineCardCreator.tsx** - AI button in both variants

---

## Status: COMPLETE

**Key Achievements:**
- AI button appears next to title input when creating any card type
- One click generates a polished title from rough input
- Button persists after generation for alternative suggestions
- Works for all card types: Epic, Story, Task, Subtask
- Context-aware: uses project, parent, and sibling information

---
