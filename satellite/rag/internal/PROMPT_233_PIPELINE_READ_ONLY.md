# PROMPT #233 - Pipeline Read-Only: Remove All Auto-Generation
## Simplification of pipeline to only extract rules to RAG

**Date:** 2026-02-18
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Refactor / Architecture Simplification
**Impact:** Pipeline no longer generates wiki, cards, description, or enrichment automatically. All generation is manual via buttons.

---

## Objective

Transform the ORBIT pipeline from an aggressive auto-generation system into a read-only RAG extraction system. The pipeline should ONLY:
1. Scan files for changes
2. Extract business rules to RAG
3. Sync git commits
4. Discover patterns

Everything else (wiki, cards, description, title, enrichment, suggestions) becomes manual via buttons when the RAG is complete.

**Key Requirements:**
1. Remove ALL auto-generation from `batch_processing_cycle()` (context, wiki, cards, enrichment)
2. Remove ALL auto-generation from `watchdog_cycle()` (wiki, cards, enrichment)
3. Remove auto-enrichment from `continuous_rag_service.py` (wiki enrichment after rule extraction)
4. Preserve all services for manual button use
5. Also includes PROMPT #232 fix: wiki domain classification by business entity instead of directory name

---

## What Was Implemented

### 1. Simplified `batch_processing_cycle()` (watchdog.py)

**Before:** 5 steps per batch - RAG extraction → context update → wiki update → wiki enrichment → card creation → card enrichment
**After:** 1 step - RAG extraction only

Removed:
- Step 1.5: `IncrementalContextService.update_context_from_batch()` (auto-description)
- Step 2: `IncrementalWikiService.update_wiki_from_batch()` (auto-wiki)
- Step 2.5: `submit_wiki_enrichment()` (full wiki enrichment)
- Step 3: `HierarchicalCardService.extend_cards_from_batch()` (auto-cards)
- Step 4: `_auto_enrich_stub_cards()` (auto-expansion)

### 2. Simplified `watchdog_cycle()` (watchdog.py)

**Before:** 6 steps - RAG scan → git sync → patterns → wiki enrichment → auto-discover cards → auto-enrich cards
**After:** 3 steps - RAG scan → git sync → patterns

Removed:
- Step 4: `submit_wiki_enrichment()` (auto-wiki)
- Step 5: `_auto_discover_cards()` (auto-cards)
- Step 6: `_auto_enrich_stub_cards()` (auto-expansion)

### 3. Removed auto-enrichment from `continuous_rag_service.py`

Removed the `_enrich_context_from_rag()` call that ran after every batch of rules extracted. RAG service now only extracts rules, no generation.

### 4. Fixed wiki domain classification (pipeline_wiki.py) — PROMPT #232 continuation

Rewrote `_classify_domain()` with hybrid approach:
- Step 1: Try meaningful subdirectory (e.g., Controllers/Trilhas/ → "Trilhas")
- Step 2: If all dirs are boilerplate, extract entity from filename (e.g., CourseController.php → "Course")

Added constants: `_ENTITY_SUFFIXES` (40 class suffixes), `_GENERIC_FILENAMES` (30 generic names), expanded `_SKIP_DIRS` (50+ framework structural directories), `_INFRA_RE` pattern.

33/34 test cases passing with actual Suinda file paths.

---

## Files Modified

### Modified:
1. **backend/app/services/watchdog.py** - Removed all auto-generation steps from both cycles
   - `batch_processing_cycle()`: 5 steps → 1 step
   - `watchdog_cycle()`: 6 steps → 3 steps

2. **backend/app/services/continuous_rag_service.py** - Removed `_enrich_context_from_rag()` call
   - `run_full_cycle()`: No longer auto-enriches wiki after extraction

3. **backend/app/services/pipeline_wiki.py** - Fixed domain classification (PROMPT #232)
   - `_classify_domain()`: Hybrid approach (subdirectory + filename entity extraction)
   - Added `_ENTITY_SUFFIXES`, `_GENERIC_FILENAMES`, `_INFRA_RE` constants
   - Expanded `_SKIP_DIRS` with 30+ framework structural directories

---

## Services Preserved (for manual button use)

| Service | Manual Trigger |
|---|---|
| `pipeline_wiki.py` | "Gerar Wiki" button |
| `pipeline_context.py` | "Gerar Descrição" button |
| `pipeline_cards.py` | "Gerar Cards" button |
| `context_generator.py` | "Expandir Card" button |
| Wiki routes | `/wiki/generate-from-context` endpoint |
| Project routes | `/enrich-wiki`, `/generate-cards` endpoints |

---

## Testing Results

### Verification:
```
 watchdog.py syntax valid
 continuous_rag_service.py syntax valid
 pipeline_wiki.py syntax valid
 Domain classification: 33/34 test cases passing
 All auto-generation removed from pipeline
 Services preserved for manual use
```

---

## Key Insights

### 1. RAG-First Architecture
Waiting for complete RAG before generating content produces better results because the AI has full project context, not partial batch fragments.

### 2. Pipeline Simplification Benefits
- Zero AI calls during pipeline execution (only rule extraction uses AI)
- No more 30-minute timeout issues from wiki/card generation during batches
- No duplicate cards from overlapping batch generations
- User has full control over what gets generated and when

### 3. Domain Classification Fix
The hybrid approach (subdirectory first, then filename) correctly handles both Laravel's nested structure (Controllers/Trilhas/) and flat structure (Models/Course.php).

---

## Status: COMPLETE

**Key Achievements:**
- Pipeline reduced from 5-6 steps to 1-3 steps (RAG extraction only)
- Zero automatic AI generation during pipeline execution
- All generation services preserved for manual button use
- Wiki domain classification fixed for business entity names

**Impact:**
- Faster pipeline execution (no AI calls for wiki/cards/description)
- No more job timeouts from heavy generation
- User controls all content generation
- Better quality output (AI sees complete project context)
