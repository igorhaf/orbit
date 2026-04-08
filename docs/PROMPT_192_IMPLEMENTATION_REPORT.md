# PROMPT #192 - Fix Context Markdown Rendering & Hierarchy Tab Refresh
## Two Bug Fixes: JSON Parsing for AI Responses + Hierarchy Tab Auto-Refresh

**Date:** February 8, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** Project context now displays as formatted Markdown; hierarchy tab updates immediately after generating children

---

## Objective

Fix two separate bugs reported by the user:

1. **Context not rendered as Markdown**: The `context_human` field stored raw JSON instead of the extracted Markdown text, making the Project Description and Project Context tabs show unformatted JSON text.

2. **Hierarchy tab not refreshing**: After generating children (tasks/subtasks) within a card's hierarchy tab, the new items didn't appear until the user navigated away and back.

---

## Bug 1: Context JSON Parsing Failure

### Root Cause

The `generate_rich_context_from_memory()` method in `context_generator.py` asks the AI to return a JSON object with `context_semantic` and `context_human` keys. However, the AI returns pretty-printed JSON where the string values contain **unescaped newlines** (real `\n` characters inside JSON strings), which `json.loads()` cannot parse.

When `json.loads()` failed, the fallback code (line 5686-5688) saved the **entire JSON response** (including `{"context_semantic": "...", "context_human": "..."}`) as the value of both `context_semantic` and `context_human` fields in the database.

This meant the UI displayed raw JSON text like:
```
{ "context_semantic": "N1: ...\n\nP1: ...", "context_human": "# Title\n\n## Section..." }
```

### Fix

1. **Robust JSON parsing** (backend): Added regex-based extraction as fallback when `json.loads()` fails. Extracts `context_semantic` and `context_human` values directly from the malformed JSON using pattern matching.

2. **Data migration**: Ran a one-time fix to extract and save the correct values from the corrupted data in the database for existing projects.

---

## Bug 2: Hierarchy Tab Not Refreshing

### Root Cause

In `ItemDetailPanel.tsx`, `fetchItemDetails()` (which fetches children) is triggered by a `useEffect` with `[item.id]` dependency (line 117-120). When children are generated for a card, the `item.id` doesn't change (it's the same parent card), so the effect doesn't re-run.

The existing PROMPT #177 refresh mechanism (lines 122-138) detects job completion and calls `onUpdate()`, which triggers the parent to re-fetch the backlog. But the backlog refresh doesn't re-trigger `fetchItemDetails()` because `item.id` remains the same.

### Fix

Added `fetchItemDetails()` call directly in the job completion effect, so children are re-fetched immediately when the generation job completes, without depending on `item.id` changing.

---

## Files Modified

### Modified:
1. **backend/app/services/context_generator.py** - Robust JSON parsing with regex fallback for unescaped newlines in AI responses
   - Lines changed: ~20 (replaced JSON parsing block in `generate_rich_context_from_memory`)

2. **frontend/src/components/backlog/ItemDetailPanel.tsx** - Added `fetchItemDetails()` call on job completion
   - Lines changed: 2 (added `fetchItemDetails()` before `onUpdate()` calls)

---

## Testing Results

### Verification:

```bash
Build: Compiled successfully
Backend restart: Uvicorn running on http://0.0.0.0:8000
Data fix: Fixed 1 project - context_human now starts with "# Plataforma Inteligente..."
```

---

## Success Metrics

- Project Description/Context tabs now display formatted Markdown with headers, lists, bold text
- Hierarchy tab auto-refreshes after generating children (no manual navigation needed)
- Future projects will have correct context parsing from AI responses

---

## Status: COMPLETE

**Key Achievements:**
- Fixed AI response JSON parsing with robust regex fallback
- Corrected corrupt data in existing database
- Hierarchy tab now refreshes immediately after child generation

**Impact:**
- Better user experience viewing project context as rich Markdown
- Seamless workflow when generating child cards in hierarchy view
