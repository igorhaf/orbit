# PROMPT #175 - AI Content Validation Across All Contracts
## Unified Content Validator for All Item Types + Context Generation

**Date:** February 7, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Reliability Improvement
**Impact:** All AI-generated content (stories, tasks, subtasks, context) is now validated and restructured before saving to database, preventing intermittent empty/invalid content.

---

## Objective

Extend the content validation/restructuring system (PROMPT #173, epic-only) to ALL AI-generated content contracts that populate database fields. Analysis identified 7 unvalidated save points in `context_generator.py` that could produce empty/invalid content intermittently.

---

## What Was Implemented

### 1. Generalized `_validate_and_restructure_content()` with `item_type` Parameter

Added `item_type: str = "epic"` parameter with type-aware defaults:

| item_type | min_description | min_prompt | default_story_points | fallback criteria |
|-----------|----------------|------------|---------------------|------------------|
| epic      | 50             | 50         | 13                  | 3 items          |
| story     | 50             | 50         | 8                   | 3 items          |
| task      | 30             | 30         | 3                   | 2 items          |
| subtask   | 20             | 20         | None (skip)         | 1 item           |

- Replaced hardcoded constants with type-aware dict lookup
- Story points validation skipped for subtasks (`default_story_points is None`)
- Type-specific fallback acceptance criteria text
- Backward compatible: existing epic call (line 1169) unchanged (default="epic")

### 2. Validation Added to `activate_suggested_story()`

Inserted between AI call and DB assignment:
```python
story_content = self._validate_and_restructure_content(
    story_content, story.title, story.description, project, item_type="story"
)
```

### 3. Validation Added to `activate_suggested_task()`

Same pattern:
```python
task_content = self._validate_and_restructure_content(
    task_content, task.title, task.description, project, item_type="task"
)
```

### 4. Validation Added to `activate_suggested_subtask()`

Same pattern:
```python
subtask_content = self._validate_and_restructure_content(
    subtask_content, subtask.title, subtask.description, project, item_type="subtask"
)
```

### 5. New `_validate_context_content()` Method

Validates `context_semantic` and `context_human` before saving to project:
- Minimum 100 chars each
- If one is short, copies from the other
- If both short, generates fallback with project name

### 6. Context Validation Wired into `generate_context_from_interview()`

Inserted between AI call and DB save:
```python
context_result = self._validate_context_content(context_result, project.name)
```

### 7. Title Validation in `_save_epic_batch()`

- Empty/None title → fallback `"Epic {i+1} - {project.name}"`
- Truncated to 255 chars
- Description guaranteed non-None (`or ""`)

---

## Files Modified

### Modified:
1. **backend/app/services/context_generator.py** - All 7 changes (126 insertions, 23 deletions)

### Created:
1. **PROMPT_175_IMPLEMENTATION_REPORT.md** - This report

---

## Testing Results

### Verification:

```bash
 context_generator.py parses without syntax errors
 Backend restarts without errors
 _validate_and_restructure_content() generalized with item_type parameter
 activate_suggested_story() now validates before save
 activate_suggested_task() now validates before save
 activate_suggested_subtask() now validates before save
 generate_context_from_interview() now validates context content
 _save_epic_batch() now validates epic titles
 Existing epic validation (PROMPT #173) unchanged (backward compatible)
```

---

## Success Metrics

- **7 validation points** added across all content-generating functions
- **4 item types** covered (epic, story, task, subtask) with type-aware defaults
- **1 new validator** for context generation (context_semantic, context_human)
- **0 existing behavior changed** (default item_type="epic" preserves PROMPT #173 behavior)
- **100% coverage** of activation functions in context_generator.py

---

## Key Insights

### 1. Type-Aware Defaults
Different item types have different content expectations. An epic needs 50+ char descriptions, but a subtask may only need 20. Story points default varies (13 for epic, 8 for story, 3 for task, N/A for subtask).

### 2. Defensive > Retry
Rather than retrying expensive AI calls when content is empty/invalid, restructuring from available data (generated_prompt, semantic_map, project context) is faster and more reliable.

### 3. Contract Consistency
All AI → DB save paths now follow the same pattern: AI call → validate → save. This makes the system predictable and debuggable via logs.

---

## Status: COMPLETE

All 7 validation points implemented. Every AI-generated content path in context_generator.py now validates before saving to database.
