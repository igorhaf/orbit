# PROMPT #249 - Per-Card Normalization
## Normalize each card immediately after creation instead of batch

**Date:** February 21, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Refactor
**Impact:** Cards are properly formatted from the moment of creation, preventing format inconsistencies

---

## Objective

Migrate card normalization from batch (all cards at once after pipeline completes) to per-card (normalize each card immediately after `db.add()` + `db.flush()`).

**Key Requirements:**
1. Create `normalize_single_card()` function for individual card normalization
2. Integrate in all card creation points: `pipeline_cards.py`, `business_rules.py`, `claude_full_pipeline.py`
3. Remove batch `normalize_project_cards()` calls from callers (keep function for standalone use)

---

## What Was Implemented

### 1. `normalize_single_card()` Function
Added to `scripts/normalize_cards.py`. Takes card_id, item_type, title, and optional context (domain, parent_title, rules, insights). Applies the same normalization logic as the batch function but for a single card.

### 2. Integration in `pipeline_cards.py`
- Epic creation (line ~251): normalize immediately after `db.flush()`
- Story creation (line ~359): normalize immediately after `db.flush()`
- Removed batch `normalize_project_cards()` call at end of pipeline

### 3. Integration in `business_rules.py`
- Added `_normalize_card_inline()` helper at module level
- Hierarchical method: Epic, Story, Task, Subtask — all 4 levels normalized per-card
- Flat method: Epic, Story, Task, Subtask — all 4 levels normalized per-card
- Removed `_normalize_cards()` method and its batch calls

### 4. Integration in `claude_full_pipeline.py`
- Epic, Story, Task, Subtask — all 4 levels normalized per-card after INSERT
- Removed Phase 4 batch normalization entirely

---

## Files Modified

### Modified:
1. **scripts/normalize_cards.py** — Added `normalize_single_card()` function
2. **app/services/pipeline_cards.py** — Per-card normalization for epics and stories
3. **app/services/context_generator/business_rules.py** — Per-card normalization for all 4 levels (2 methods)
4. **scripts/claude_full_pipeline.py** — Per-card normalization for all 4 levels

---

## Testing Results

```
✅ normalize_cards.py — syntax OK
✅ pipeline_cards.py — syntax OK
✅ business_rules.py — syntax OK
✅ claude_full_pipeline.py — syntax OK
✅ No batch normalize_project_cards callers remain (only definition + __main__)
```

---

## Key Insights

### Batch → Per-Card Normalization
The batch approach (normalize all after pipeline) meant cards existed in a non-normalized state between creation and normalization. Per-card approach ensures every card is properly formatted from the moment it's created, preventing UI display issues and ensuring consistent data at all times.

### Non-Critical Pattern
All normalization calls are wrapped in try/except with `logger.debug()` — normalization failure never blocks card creation. This keeps the pipeline robust while improving card quality.

---

## Status: COMPLETE

**Key Achievements:**
- Every card is normalized immediately upon creation
- Batch normalization removed from all callers
- `normalize_project_cards()` kept for standalone/migration use
- All 3 card creation services migrated
