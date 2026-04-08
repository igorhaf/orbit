# PROMPT #255 - Maximize max_tokens + Switch Opus to Sonnet

## Objective
Maximize AI output capacity to the API maximum (16384 tokens) across ALL card generation locations, and switch content_generation/rag_extraction from Opus to Sonnet for richer semantic text generation.

## Root Cause
Opus is too conservative/literal for semantic text generation. It produces shorter, more precise outputs but weaker Mapa Semantico, descriptions, and acceptance_criteria. Sonnet 4.6 is more creative and expansive, producing richer content while maintaining structural quality.

## What Was Implemented

### 1. Maximized max_tokens everywhere

| File | Locations | Previous Values | New Value |
|---|---|---|---|
| rag_pipeline.py | 5 | 8000-16000 | 16384 |
| draft_generator.py | 6 | 3000-16000 | 8192-16384 |
| epic_activator.py | 2 | 4000 | 8192-16384 |
| story_activator.py | 1 | 6000 | 16384 |
| task_activator.py | 2 | 6000 | 16384 |

### 2. Switched content_generation and rag_extraction: Opus -> Sonnet

- **Before:** Claudio Opus 4.6 (claude-opus-4-6, max_tokens=8192)
- **After:** Claudio Sonnet 4.6 (claude-sonnet-4-6, max_tokens=16384)
- Memory model: kept Opus 4.6 but increased max_tokens to 16384
- Old Opus models are deactivated when seed script runs

### 3. Updated seed script

- New models: "Claudio Sonnet 4.6 (Content)" and "Claudio Sonnet 4.6 (RAG Extraction)"
- Old "Claudio Opus 4.6" models are deactivated automatically
- Chain references updated to point to new Sonnet models

## Files Modified

1. `backend/app/services/rag_pipeline.py` — 5 max_tokens changes
2. `backend/app/services/context_generator/draft_generator.py` — 6 max_tokens changes
3. `backend/app/services/context_generator/epic_activator.py` — 2 max_tokens changes
4. `backend/app/services/context_generator/story_activator.py` — 1 max_tokens change
5. `backend/app/services/context_generator/task_activator.py` — 2 max_tokens changes
6. `backend/scripts/seed_ai_flow_chains.py` — Opus->Sonnet + max_tokens=16384

## Testing Results

- All Python imports verified
- All 297 FastAPI routes load correctly
- Seed script needs to be re-run after deployment: `python scripts/seed_ai_flow_chains.py`

## Status
COMPLETED
