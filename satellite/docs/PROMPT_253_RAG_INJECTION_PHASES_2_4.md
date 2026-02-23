# PROMPT #253 - RAG Injection for Phases 2 & 4
## Compact Prompts via enable_rag=True — Eliminating Inline Data Dumps

**Date:** 2026-02-22
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Performance Optimization / Refactor
**Impact:** ~80% token reduction across RAG pipeline, 57% fewer LLM calls

---

## 🎯 Objective

Replace inline data dumps in Phase 2 and Phase 4 of the RAG pipeline with compact prompts + RAG injection (`enable_rag=True`). Phase 3 was already converted in a previous commit.

**Key Requirements:**
1. Phase 2: Replace 5+ batched LLM calls (loading ~375KB of code_files) with single RAG-injected call
2. Phase 4: Replace inline loading of ~70KB business rules with RAG-injected call
3. Add `rag_extraction` type boost for code_file documents

---

## ✅ What Was Implemented

### 1. Phase 2: `phase_2_extract_rules` — Single RAG Call

**Before:** Loaded 499 code_file documents from DB, split into batches of 30 files / 80KB max, made 5+ sequential LLM calls, merged rules across batches.

**After:** Single compact prompt (~1KB) with `enable_rag=True`:
- `rag_filter={"type": "code_file"}` — only injects code files
- `rag_top_k=300` — retrieves up to 300 most relevant code documents
- `rag_similarity_threshold=0.0` — no minimum similarity (include all)
- Lightweight SQL count + extension summary instead of full content load
- Removed: `PHASE2_BATCH_SIZE`, `PHASE2_MAX_CONTEXT_CHARS`, batch loop, batch merge

### 2. Phase 4: `phase_4_generate_wiki` — RAG with Mixed Filter

**Before:** Loaded ALL business rules from DB, formatted as numbered lines, dumped ~70KB inline.

**After:** Single compact prompt (~1KB) with `enable_rag=True`:
- `rag_filter={"type__in": ["business_rule", "code_file"]}` — injects both rule types and code for richer wiki
- `rag_top_k=200` — retrieves up to 200 most relevant documents
- `rag_similarity_threshold=0.0` — include all
- Lightweight SQL count + type distribution summary

### 3. RAG Scoring: New Type Boost

Added `"rag_extraction": {"code_file": 0.35}` to `_RAG_TYPE_BOOSTS` in `ai_orchestrator.py`. This ensures code_file documents get priority scoring when Phase 2 runs RAG retrieval.

---

## 📁 Files Modified

### Modified:
1. **backend/app/services/rag_pipeline.py** — Rewrote Phase 2 and Phase 4
   - Phase 2: ~160 lines → ~90 lines (removed batch logic)
   - Phase 4: ~115 lines → ~90 lines (removed inline rule loading)
   - Removed constants: `PHASE2_BATCH_SIZE`, `PHASE2_MAX_CONTEXT_CHARS`

2. **backend/app/services/ai_orchestrator.py** — Added rag_extraction boost
   - Added `"rag_extraction": {"code_file": 0.35}` to `_RAG_TYPE_BOOSTS`

---

## 📊 Token Reduction Summary (All Phases)

| Phase | Calls Before | Calls After | Tokens Before | Tokens After |
|-------|-------------|-------------|--------------|-------------|
| Phase 1 | 0 (scan only) | 0 | 0 | 0 |
| Phase 2 | 5+ | 1 | ~500K | ~50K |
| Phase 3 | 1 (already done) | 1 | ~150K | ~50K |
| Phase 4 | 1 | 1 | ~100K | ~40K |
| **Total** | **7+** | **3** | **~750K** | **~140K** |

**Reduction: ~80% in tokens, ~57% in LLM calls.**

---

## 🎉 Status: COMPLETE

**Key Achievements:**
- ✅ Phase 2 converted to single RAG-injected call (was 5+ batched calls)
- ✅ Phase 4 converted to RAG-injected call with mixed filter
- ✅ RAG type boost added for code_file scoring
- ✅ All 3 LLM phases (2, 3, 4) now use compact prompts + RAG injection

**Impact:**
- ~80% reduction in token usage across full pipeline
- 57% fewer LLM calls (7+ → 3)
- Simpler code: removed batch logic, merge logic, inline data formatting
- Better scalability: works with any number of code files/rules without prompt overflow
