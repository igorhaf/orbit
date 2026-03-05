# PROMPT #253 - Local Dedup: Fix RAG Timing Gap for Card Generation

## Objective
Fix duplicate card generation when generating cards in rapid succession. The RAG-based `find_similar_cards()` check has a timing gap — newly created cards may not be indexed in RAG yet, so a second generation run produces duplicates.

## Problem
When generating 10 cards then 5 more immediately after on the same parent card:
1. First batch creates 10 cards (committed to DB)
2. RAG indexing may not have processed them yet
3. Second batch runs `find_similar_cards()` via RAG → no hits (cards not indexed)
4. Result: duplicate cards generated

The existing `_build_existing_children_text()` helps at the **prompt level** (tells AI not to duplicate), but the **code-level** RAG check was the weak link.

## What Was Implemented

### Local Dedup Functions (`draft_generator.py`)

Three new module-level functions added:

1. **`_normalize_title(title)`**: Normalizes titles for comparison — lowercase, strip accents, remove punctuation, collapse whitespace.

2. **`_title_similarity(a, b)`**: Computes word-overlap similarity (Jaccard index) between two titles. Returns 0.0 to 1.0. Words shorter than 3 chars are excluded to avoid noise.

3. **`_is_title_duplicate(new_title, parent_id, db, batch_titles, threshold=0.70)`**: Two-layer local dedup check:
   - **Layer 1 - DB siblings**: Queries existing sibling titles directly from PostgreSQL (always current, no RAG lag)
   - **Layer 2 - Current batch**: Checks against titles already created in the current generation loop
   - Uses word-overlap similarity with 70% threshold

### Integration Points

Both `_generate_draft_stories()` and `_generate_draft_tasks()` now:
1. Maintain a `batch_titles: List[str]` to track titles created in the current batch
2. Run `_is_title_duplicate()` BEFORE the RAG check (faster, no external dependency)
3. If local dedup passes, still run RAG check for cross-parent similarity
4. Append each created title to `batch_titles` after creation

### Dedup Flow (New)
```
New title → _is_title_duplicate(DB + batch) → if duplicate → SKIP
                                             → if not → find_similar_cards(RAG) → if similar → SKIP
                                                                                → if not → CREATE card
                                                                                           → append to batch_titles
```

## Similarity Examples
| Title A | Title B | Similarity | Dedup? |
|---------|---------|-----------|--------|
| "Implementar tratamento de erros" | "Implementar tratamento de erros e fallback" | 0.75 | Yes (>0.70) |
| "CRUD de usuarios" | "Criar tela de login" | 0.00 | No |
| "Implementar cache Redis" | "Implementar cache Redis para sessoes" | 0.60 | No (<0.70) |

## Files Modified

| File | Change |
|------|--------|
| `backend/app/services/context_generator/draft_generator.py` | Added `_normalize_title()`, `_title_similarity()`, `_is_title_duplicate()` functions; integrated local dedup in both stories and tasks generation loops with `batch_titles` tracking |

## Why 70% Threshold?
- 85% (RAG threshold) is too strict for word-overlap — misses paraphrases
- 50% would be too aggressive — might block legitimately different cards
- 70% catches: same title with minor additions, reordered words, different phrasing of same concept
- The RAG check (85% embedding similarity) still runs after for semantic cross-parent dedup

## Testing Results
- Import and function tests pass
- Similarity scores match expected behavior
- No breaking changes to existing flow

## Status
COMPLETED - Card generation now has dual-layer dedup: local (DB+batch) + RAG (semantic).
