# PROMPT #284 - Chain Prompting Business Rules Extraction Fix
## Fix chain prompting to extract structured rules and fix re-scan pipeline

**Date:** 2026-02-14
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** Memory scan with local models (Ollama) now correctly extracts business rules, features, and entities; re-scan writes results back to project and triggers card generation

---

## Objective

Fix two critical bugs preventing business rule cards from being generated during memory scan:

1. **Chain prompting returned empty rules**: `_chain_analyze_single_file` returned only plain text summaries (1-line per file), making it impossible for the consolidation step to extract structured business rules
2. **Re-scan pipeline didn't update project**: `_process_memory_scan_async` never wrote scan results back to `project.initial_memory_context`, so even when rules were in RAG, they couldn't be used for card generation

**Key Requirements:**
1. File-level analysis must return structured JSON with business_rules, features, entities
2. Consolidation must pre-aggregate data from all files before final AI merge
3. Re-scan pipeline must update `initial_memory_context` and trigger card generation

---

## What Was Implemented

### 1. Structured JSON Output from File Analysis
**File:** `backend/app/services/codebase_memory.py`

Changed `_chain_analyze_single_file` to:
- Request JSON response with structured fields: `purpose`, `business_rules`, `features`, `entities`, `system_hint`
- Increased max_tokens from 200 to 400
- Parse JSON response using `UtilityNodeExecutor._try_parse_json(auto_repair=True)`
- Return structured dict with extracted data (fallback to plain text if JSON parsing fails)

**Before:**
```python
# Returned only: {"filename": "X", "analysis": "one line text"}
# No structured data extraction at all
```

**After:**
```python
# Returns: {"filename": "X", "analysis": "purpose text",
#           "business_rules": ["rule1", "rule2"],
#           "features": ["feat1"], "entities": ["entity1"],
#           "system_hint": ""}
```

### 2. Pre-aggregation in Consolidation
**File:** `backend/app/services/codebase_memory.py`

Changed `_chain_consolidate_insights` to:
- Pre-aggregate all rules, features, entities from individual file analyses (with case-insensitive deduplication)
- Build rich consolidation prompt that includes ALL pre-extracted data
- Increased max_tokens from 500 to 2000
- Merge AI consolidation result with pre-aggregated data (never lose extracted rules)
- Better fallback that uses pre-aggregated data directly if AI fails

### 3. Re-scan Pipeline Fix
**File:** `backend/app/api/routes/projects.py`

Added to `_process_memory_scan_async` (which was missing these steps):
- Write `project.initial_memory_context = result` after scan completes
- Set `project.initial_scan_complete = True`
- Set `project.scan_depth = scan_depth`
- Trigger `CARDS_FROM_MEMORY` job to generate business rule cards
- Log number of rules and features stored

This matches what the quick-create pipeline (`_process_project_pipeline_async`) already does.

---

## Files Modified

### Modified:
1. **`backend/app/services/codebase_memory.py`** - Structured JSON extraction in chain prompting + pre-aggregation in consolidation
2. **`backend/app/api/routes/projects.py`** - Re-scan pipeline now writes initial_memory_context and triggers card generation

---

## Testing Results

### Before Fix:
```
Chain aggregation: 0 rules, 0 features, 0 entities
initial_memory_context.business_rules: 0 items
business_rule cards: 0
```

### After Fix:
```
Chain aggregation: 15 rules, 11 features, 6 entities from 21 files
Chain Prompting complete - Title: Sistema de Gestao de Cursos e Comunidade, Rules: 20, Features: 17
Stored 20 business rules in RAG
initial_memory_context.business_rules: 20 items
business_rule cards: 23 (4 Epics, 6 Stories, 9 Tasks, 4 Subtasks)
All business_rule cards: workflow_state = "closed"
```

### Verification:
```
OK  Chain prompting extracts structured JSON per file
OK  Pre-aggregation collects 15 unique rules from 21 files
OK  Consolidation merges to 20 final rules
OK  RAG stores 20 business_rule documents
OK  initial_memory_context populated with 20 rules
OK  23 hierarchical business_rule cards generated (all closed)
OK  4 Epics: Controle de Acesso, Gerenciamento de Cursos, Regras Gerais, Validacao de Dados
OK  Hierarchy: Epic -> Story -> Task -> Subtask (proper parent-child)
OK  Re-scan pipeline now writes initial_memory_context (was missing)
OK  Re-scan pipeline triggers card generation (was missing)
```

---

## Key Insights

### 1. Root Cause: Unstructured File Analysis
The chain prompting flow analyzed files individually but returned only 1-line text summaries. The consolidation step received 10+ minimal summaries and couldn't extract structured rules from them, returning empty arrays.

### 2. Pre-aggregation Pattern
By extracting structured data at the file level AND aggregating before consolidation, we ensure no data is lost even if the AI consolidation fails. The consolidation step receives the pre-aggregated data and only needs to organize/deduplicate it.

### 3. Missing Pipeline Step in Re-scan
The re-scan pipeline (`_process_memory_scan_async`) was a simpler version of the creation pipeline. It called `scan_and_memorize()` but never wrote results back to the project record. This meant re-scans stored data in RAG but couldn't trigger card generation because `initial_memory_context` remained empty.

---

## Status: COMPLETE

**Key Achievements:**
- Chain prompting now extracts structured business rules, features, and entities per file
- Pre-aggregation ensures no data loss during consolidation
- Re-scan pipeline matches creation pipeline behavior (writes to project, triggers cards)
- 20 business rules extracted and stored in RAG
- 23 hierarchical business rule cards generated (all closed/verified)

**Impact:**
- Projects using local models (Ollama) now get full business rule extraction
- Re-scanning a project properly updates its knowledge and generates cards
- Wiki Knowledge page shows correct rule count (725 rules from continuous RAG + 20 from scan)
