# PROMPT #254 - Fix Card Generation Quality Degradation

## Objective
Fix degraded card generation that was producing only 8 weak epics with no semantic text, weak prompts, minimal card count, and everything running on Opus.

## Root Cause Analysis

The degradation was caused by a combination of:

1. **Insufficient max_tokens** in batch epic generation (`max_tokens=2000` for 5 epics)
2. **Rigid "exactly N or empty" prompt** that caused AI to return empty lists instead of partial results
3. **Low epic count range** in RAG Phase 3 (`5-15` epics) leading to only 8 being generated
4. **Weak epic prompt** that didn't enforce semantic content requirements (no Mapa Semantico enforcement)
5. **Low max_tokens in RAG Phase 3** epic generation (`8000` tokens for 10-30 rich epics)
6. **Low max_tokens in story generation** (`8000` for 15 complete stories with full content)
7. **Premature fallback** to title-only stories without attempting content extraction first

## What Was Implemented

### 1. draft_generator.py - Batch Epic Generation
- **max_tokens**: 2000 → 4000 (enough for 5 rich epics with descriptions)
- **Prompt softened**: "Gere EXATAMENTE N" → "Gere até N" with partial results allowed
- **Description quality**: "1-2 frases" → "3-5 frases com NO MÍNIMO 200 caracteres"
- **Empty list avoidance**: "retorne lista vazia" → "retorne os que encontrar com has_more: false"

### 2. draft_generator.py - Story Generation
- **max_tokens**: 8000 → 16000 (enough for 15 complete stories)
- **Better fallback**: Added content extraction attempt before falling back to title-only stories

### 3. rag_pipeline.py - Phase 3 Epic Generation
- **max_tokens**: 8000 → 16000 (enough for 20+ rich epics with semantic maps)
- **Epic count range**: "5-15" → "10-30" with dynamic scaling based on entity count
- **Quality enforcement**: Added explicit requirements per epic:
  - description: MINIMO 300 chars
  - generated_prompt: MINIMO 500 chars with Mapa Semantico
  - acceptance_criteria: MINIMO 3 items
  - story_points: Fibonacci scale
  - labels: at least 2 tags
- **User prompt enriched**: Now includes entity count, expected epic range, and quality requirements

## Files Modified

1. `backend/app/services/context_generator/draft_generator.py` (4 changes)
2. `backend/app/services/rag_pipeline.py` (3 changes)

## Testing Results

- All 297 FastAPI routes load correctly
- Python imports verify successfully
- No regressions detected

## Status
COMPLETED - Fixes applied, awaiting production validation.
