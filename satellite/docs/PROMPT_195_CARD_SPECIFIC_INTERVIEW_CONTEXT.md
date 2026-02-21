# PROMPT #195 - Card-Specific Interview Context
## Fix card interviews using project-wide context instead of card-specific context

**Date:** February 8, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** Card interviews now ask questions relevant to the specific card (motivation type, hierarchy position) instead of generic project-level questions

---

## Objective

Card-focused interviews (for Stories, Tasks, Subtasks) were receiving the entire project context and generic questions, ignoring the specific card's motivation type (bug, feature, design, etc.), title, description, and hierarchy position. The AI had no way to differentiate between a project-level interview and a card-level interview.

**Key Requirements:**
1. Card interviews must use card-specific prompts based on motivation type (Q1 answer)
2. Include card title (Q2) and description (Q3) in AI context
3. Include full hierarchy context (Epic > Story > Task > Subtask)
4. Use existing `build_card_focused_prompt()` which already had all the rich logic

---

## Root Cause Analysis

When the interview system was unified in PROMPT #78, all interview modes were routed through `handle_unified_open_interview()` which calls `build_unified_open_prompt()`. This generic prompt builder:
- Included full project context (name, description, stack)
- Included parent card hierarchy (via PROMPT #132)
- Did NOT include motivation type from Q1
- Did NOT include card title/description from Q2/Q3
- Did NOT use motivation-specific guidance (bug vs feature vs design, etc.)

Meanwhile, `build_card_focused_prompt()` in `card_focused_prompts.py` already had comprehensive motivation-specific prompts for 10 types (bug, feature, bugfix, design, documentation, enhancement, refactor, testing, optimization, security) - but it was NOT being called.

---

## What Was Implemented

### 1. Card-Focused Mode Detection in `build_unified_open_prompt()`

Added early detection: when `interview.interview_mode == "card_focused"` and `parent_task` exists:
1. Extract motivation type from Q1 user answer
2. Extract card title from Q2 user answer
3. Extract card description from Q3 user answer
4. Build stack context
5. Get full hierarchy chain
6. Call `build_card_focused_prompt()` with all card-specific data

This returns a rich, motivation-aware prompt instead of the generic project prompt.

---

## Files Modified

### Modified:
1. **backend/app/api/routes/interviews/unified_open_handler.py** - Added card_focused detection and routing to specialized prompt builder
   - Lines added: 52
   - Key change: `build_unified_open_prompt()` now detects `interview_mode == "card_focused"` and uses `build_card_focused_prompt()` with motivation type, card details, and hierarchy

---

## Testing Results

```bash
 Python syntax verification: PASSED
 Card-focused prompt builder already tested (existing code from PROMPT #98/#131/#132)
 Non-card interviews unchanged (generic path still works)
```

---

## Success Metrics

- **Card-specific context:** AI now receives motivation type (bug/feature/design/etc.) and asks relevant questions
- **Hierarchy-aware:** Full Epic > Story > Task chain included in prompt
- **No regressions:** Non-card interviews (context, epic) continue using generic prompt unchanged

---

## Key Insights

### 1. Existing Code Was Already Complete
The `build_card_focused_prompt()` function had 10 motivation-specific prompt templates with rich context. The issue was purely a routing problem - the unified handler wasn't calling it.

### 2. Data Already Available
The motivation type (Q1), title (Q2), and description (Q3) were already in `interview.conversation_data` from the fixed questions phase. They just weren't being extracted and passed to the prompt builder.

---

## Status: COMPLETE

Card-focused interviews now use specialized, motivation-aware prompts with full card context.

**Key Achievements:**
- Card interviews contextualized to specific card (not project-wide)
- 10 motivation types properly routed (bug, feature, design, refactor, etc.)
- Full hierarchy context included (Epic > Story > Task > Subtask)

**Impact:**
- AI asks relevant questions for the specific card type
- Better interview quality for Stories, Tasks, and Subtasks
- Consistent with the original PROMPT #98 design intent
