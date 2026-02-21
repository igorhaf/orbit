# PROMPT #198 - Proportional Hierarchy Context in Interviews
## Interview questions now weighted by hierarchy relevance instead of flat equal context

**Date:** February 8, 2026
**Status:** COMPLETED
**Priority:** MEDIUM
**Type:** Feature (AI Context Optimization)
**Impact:** Interview questions are now more focused and relevant to the specific card level being worked on

---

## Objective

Implement proportional hierarchy weighting in card-focused interview prompts. Instead of giving equal context weight to all hierarchy levels (Epic, Story, Task, Project), the AI now receives more detail about the immediate parent (~40%) and progressively less about higher ancestors (~30%, ~20%, ~10%).

**Key Requirements:**
1. Immediate parent card gets full detail (description, criteria, labels, story points, generated prompt)
2. Grandparent card gets summarized detail (description[:300], criteria count, story points)
3. Great-grandparent card gets minimal detail (description[:150], type)
4. Project context scales inversely with hierarchy depth
5. AI instructions explicitly prioritize closer context

---

## What Was Implemented

### 1. Proportional `build_hierarchy_context()`
Modified the hierarchy context builder to weight information by distance from current card:
- **Distance 1 (immediate parent)**: `[CONTEXTO PRINCIPAL]` - full description, all acceptance criteria listed, story points, labels, generated prompt excerpt
- **Distance 2 (grandparent)**: `[CONTEXTO SECUNDÁRIO]` - description[:300], criteria count, story points
- **Distance 3 (great-grandparent)**: `[REFERÊNCIA]` - description[:150], type only
- **Distance 4+**: Title only

Updated AI instructions from generic "Considere os objetivos do Epic" to explicit priority guidance: "FOQUE PRINCIPALMENTE no card marcado [CONTEXTO PRINCIPAL]"

### 2. Proportional Project Context
Modified `build_card_focused_prompt()` to scale project context based on hierarchy depth:
- **3+ levels** (Subtask): Project name only (~10%)
- **2 levels** (Task): Project name + description[:150] (~30%)
- **1 level** (Story): Full project info with stack (~60%)
- **0 levels** (Epic): Full project info with stack (~100%)

### 3. Rich Card Context in Unified Handler
Added `current_card=parent_task` to the `build_card_focused_prompt()` call in `unified_open_handler.py`, enabling the prompt to include acceptance criteria, story points, and other rich card data.

---

## Files Modified

1. **backend/app/api/routes/interviews/card_focused_prompts.py** - Proportional hierarchy weighting
   - `build_hierarchy_context()`: Distance-based weight system (high/medium/low/minimal)
   - `build_card_focused_prompt()`: Proportional project_context based on hierarchy depth

2. **backend/app/api/routes/interviews/unified_open_handler.py** - Pass current_card
   - Added `current_card=parent_task` parameter to `build_card_focused_prompt()` call

---

## Weight Distribution Table

| Interviewing | Immediate Parent | Grandparent | Great-grandparent | Project |
|---|---|---|---|---|
| **Subtask** | Task: 40% (full) | Story: 30% (summary) | Epic: 20% (minimal) | 10% (name) |
| **Task** | Story: 40% (full) | Epic: 30% (summary) | — | 30% (name+desc) |
| **Story** | Epic: 40% (full) | — | — | 60% (full+stack) |
| **Epic** | — | — | — | 100% (full+stack) |

---

## Testing Results

```bash
 Python syntax: card_focused_prompts.py OK
 Python syntax: unified_open_handler.py OK
 Proportional weighting applied to hierarchy context
 Project context scales with hierarchy depth
 Rich card data passed via current_card parameter
```

---

## Status: COMPLETE

Interview question context now uses proportional hierarchy weighting. The AI receives more detail about the immediate parent card and progressively less about higher ancestors, resulting in more focused and relevant questions.
