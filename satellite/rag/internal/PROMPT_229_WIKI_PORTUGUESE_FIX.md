# PROMPT #229 - Fix Wiki Pages Generated in English
## Force Portuguese in continuous RAG rule extraction prompt

**Date:** February 17, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** Wiki pages with business rules now generated in Portuguese instead of English

---

## Objective

Fix wiki pages that were being generated with English content despite the system being configured for Portuguese.

**Key Requirements:**
1. Identify which prompts were generating content in English
2. Fix extraction prompts to produce Portuguese output
3. Ensure all wiki content pipeline produces Portuguese

---

## Root Cause Analysis

### The Problem
Business rules extracted by `ContinuousRAGService` during continuous RAG scanning were stored in English in the `rag_documents` table. These raw English rules then appeared in wiki pages.

### Why It Happened
The `_LOCAL_SYSTEM_PROMPT` in `continuous_rag_service.py` (line 713) was entirely in English:

```python
# BEFORE (English)
_LOCAL_SYSTEM_PROMPT = (
    "Extract business rules from code. "
    "Respond ONLY with valid JSON: "
    '{"business_rules":[...]}'
)
```

Since the `memory` usage_type uses Ollama local models, this compact English prompt was always used (not the YAML version). The AI model responded in English, and rules were stored in English in RAG.

### Downstream Effect
1. `_build_business_rules_wiki_pages()` reads `rule["content"]` directly from RAG
2. Individual rule pages show the raw content without translation
3. Rule enrichment YAML (`wiki_rule_enrichment.yaml`) asks for Portuguese but receives English input
4. Wiki enrichment YAML (`wiki_enrichment.yaml`) asks for Portuguese but receives English rules

---

## What Was Fixed

### continuous_rag_service.py - `_LOCAL_SYSTEM_PROMPT`

```python
# AFTER (Portuguese)
_LOCAL_SYSTEM_PROMPT = (
    "Extraia regras de negocio do codigo. "
    "Responda APENAS com JSON valido, em portugues brasileiro: "
    '{"business_rules":[...]}'
)
```

---

## Audit of All Prompt Sources

| Source | Language | Status |
|--------|----------|--------|
| `continuous_rag_service._LOCAL_SYSTEM_PROMPT` | English -> **Portuguese** | FIXED |
| `continuous_rag_extract.yaml` (non-local) | Portuguese | OK |
| `codebase_memory.py` file analysis | Portuguese | OK |
| `codebase_memory.py` chain consolidation | Portuguese | OK |
| `codebase_memory.py` single-phase analysis | Portuguese | OK |
| `git_commit_analysis.yaml` | Portuguese | OK |
| `wiki_enrichment.yaml` (AI overview) | Portuguese | OK |
| `wiki_rule_enrichment.yaml` (rule pages) | Portuguese | OK |
| `convention_extractor.py` | English (technical JSON values) | OK - technical data |
| `pattern_discovery.py` | Static extraction (no AI text) | OK - no text content |
| Wiki page headers/labels | Portuguese (translate functions) | OK |

---

## Files Modified

### Modified:
1. **[backend/app/services/continuous_rag_service.py](backend/app/services/continuous_rag_service.py)** - Fixed `_LOCAL_SYSTEM_PROMPT`
   - Changed from English to Portuguese
   - Added "em portugues brasileiro" instruction

---

## Testing Results

```bash
OK  Import compiles correctly
OK  Prompt text shows Portuguese
OK  Backend restarts without errors
OK  All YAML prompts already in Portuguese
```

---

## Key Insights

### 1. Local vs Non-Local Prompt Paths
The `continuous_rag_service.py` has two prompt paths: `is_local=True` uses compact `_LOCAL_SYSTEM_PROMPT`, `is_local=False` uses YAML. Since the `memory` usage_type maps to Ollama local, the compact English prompt was always used.

### 2. Rules stored in RAG propagate everywhere
Business rules stored in English in `rag_documents` affect multiple wiki pages: business rules pages, domain pages, individual rule pages, the AI overview page, and rule enrichment pages.

---

## Status: COMPLETE

The root cause was a single English prompt in `_LOCAL_SYSTEM_PROMPT` that caused all extracted business rules to be stored in English. New scans will produce Portuguese rules. Existing English rules will be replaced as the continuous RAG rescans files.

**Key Achievements:**
- Fixed `_LOCAL_SYSTEM_PROMPT` to extract in Portuguese
- Audited all 10+ prompt sources - only one was in English
- New rules will be in Portuguese on next scan cycle

**Impact:**
- Wiki business rule pages will show Portuguese content
- Rule enrichment will receive Portuguese input
- Wiki overview will integrate Portuguese rules

---
