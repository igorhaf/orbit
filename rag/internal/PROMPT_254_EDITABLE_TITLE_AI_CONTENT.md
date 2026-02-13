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

2. **AI Content Generation**: A button in the description area that generates rich Markdown description content using AI, based on the card title and proportional hierarchy context.

---

## What Was Implemented

### 1. Editable Title in ItemDetailPanel
- Click on the title switches to edit mode with an input field
- AI suggest button appears next to the input (purple star icon + "AI" label)
- Enter saves, Escape cancels
- Blur handler respects AI button clicks (no auto-save while generating)
- Title syncs with item changes via useEffect

### 2. AI Content Generation Button
- Purple "AI" button appears next to the Description header
- Clicking generates rich Markdown description based on:
  - Card title and item_type
  - Project name and description
  - Parent card context
  - Sibling titles
  - Proportional hierarchy context from PromptContextCompressor
- Generated content opens the description editor pre-filled
- Button shows spinner during generation

### 3. Backend Endpoint `POST /tasks/generate-content`
- Receives: `task_id`, `project_id`
- Gathers context: project, parent, siblings, hierarchy compressor
- Uses PromptContextCompressor for proportional hierarchy context
- Calls AI via AIOrchestrator with externalized YAML prompt
- Saves generated description to the task
- Returns `description` in response

### 4. YAML Prompt `backlog/generate_content.yaml`
- System prompt instructs AI to return Markdown description
- Adapts detail level by item_type (Epic=overview, Story=user-facing, Task=actionable, Subtask=technical)
- Includes acceptance criteria section
- Writes in same language as card title

---

## Files Created

1. **backend/app/prompts/backlog/generate_content.yaml** - AI prompt template for content generation

## Files Modified

1. **frontend/src/components/backlog/ItemDetailPanel.tsx** - Editable title + AI content generation button
2. **frontend/src/lib/api.ts** - Added `tasksApi.generateContent()` method
3. **backend/app/api/routes/tasks_old.py** - New endpoint `POST /generate-content`

---

## Status: COMPLETE

**Key Achievements:**
- Title is now editable by clicking on it in the card detail panel
- AI suggest button available during title editing for better alternatives
- AI content generation button in description area generates rich Markdown
- Proportional hierarchy context system used for context-aware generation
- Both features follow existing UI patterns (purple AI buttons, consistent UX)

---
