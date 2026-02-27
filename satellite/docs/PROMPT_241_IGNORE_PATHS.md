# PROMPT #241 - Scan Exceptions per Project (ignore_paths)

**Date:** 2026-02-21
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Projects can now define user-editable paths to exclude from codebase scanning, RAG indexing, and card generation. ORBIT project configured with `["projects/"]` to exclude client project folders.

---

## Objective

Add a user-editable `ignore_paths` field to projects, allowing exclusion of specific directories from all scanning processes. This is separate from `custom_ignore_patterns` (AI-detected, read-only).

**Problem:** ORBIT analyzing its own codebase was including the `projects/` folder which contains client projects (e.g., Suinda - a Laravel app), resulting in 1088 irrelevant business rules mixed in with ORBIT's own rules.

---

## What Was Implemented

### 1. Backend Model & Schema

- Added `ignore_paths = Column(JSON, nullable=True)` to `Project` model
- Added `ignore_paths` to `ProjectUpdate` and `ProjectResponse` schemas

### 2. Alembic Migration

- Created `p241_add_ignore_paths.py` migration
- Adds `ignore_paths` JSON column to `projects` table

### 3. Scanner Integration

**`codebase_memory.py`:** After loading AI-detected custom_ignore_patterns, also loads user `ignore_paths` into `_effective_ignore_dirs`.

**`continuous_rag_service.py`:** Same pattern - loads `ignore_paths` after custom_ignore_patterns.

**`business_rules.py`:** RAG query dynamically excludes rules whose `source_file` starts with any ignored path using parameterized SQL.

**`generate_all_cards_from_rag.py`:** Reads `ignore_paths` from project and filters rules before domain classification.

### 4. Frontend UI

- Added `ignore_paths` to `Project` and `ProjectUpdate` TypeScript interfaces
- Added "Configuracoes" subtab to OverviewTab with:
  - Editable list of user-defined ignore paths (add/remove)
  - Read-only display of AI-detected patterns
  - Save button that calls `projectsApi.update()`
  - Project info section (code_path, status, context_locked)

### 5. ORBIT Project Configuration

- Set `ignore_paths = ["projects/"]` on ORBIT project via SQL
- Regenerated cards: 6659 -> 5571 rules (1088 filtered), 8912 -> 7865 cards

---

## Files Modified

### Created:
1. **backend/alembic/versions/p241_add_ignore_paths.py** - Migration

### Modified:
1. **backend/app/models/project.py** - Added `ignore_paths` column
2. **backend/app/schemas/project.py** - Added to `ProjectUpdate` and `ProjectResponse`
3. **backend/app/services/codebase_memory.py** - Load user ignore_paths into effective dirs
4. **backend/app/services/continuous_rag_service.py** - Load user ignore_paths into effective dirs
5. **backend/app/services/context_generator/business_rules.py** - Filter RAG query by ignore_paths
6. **backend/app/scripts/generate_all_cards_from_rag.py** - Filter rules before classification
7. **frontend/src/lib/types.ts** - Added `ignore_paths` to interfaces
8. **frontend/src/app/projects/[id]/OverviewTab.tsx** - Added "Configuracoes" subtab
9. **frontend/src/app/projects/[id]/page.tsx** - Updated OverviewSubTab type, added onProjectUpdate prop

---

## Testing Results

```
Before filtering: 6659 rules, 8912 cards, 44 domains
After filtering:  5571 rules, 7865 cards, 37 domains
Filtered: 1088 rules from projects/ folder

DB Verification:
  epic     37     37 open    37 ai_ed   37 prompt
  story   389    389 open   389 ai_ed  389 prompt
  task   1868   1868 open  1868 ai_ed 1868 prompt
  subtask 5571  5571 open  5571 ai_ed 5571 prompt

Frontend build: SUCCESS (no errors)
```

---

## Key Insights

### 1. Separation of concerns: user vs AI
`custom_ignore_patterns` remains AI-managed and read-only. `ignore_paths` is user-editable. Both feed into the same `_effective_ignore_dirs` set.

### 2. Multi-layer filtering
The ignore_paths filtering is applied at 4 different levels:
- Initial memory scan (codebase_memory.py)
- Continuous RAG scan (continuous_rag_service.py)
- Business rules query (business_rules.py)
- Standalone script (generate_all_cards_from_rag.py)

---

## Status: COMPLETE

**Key Achievements:**
- User-editable `ignore_paths` field per project
- UI in "Configuracoes" subtab for managing paths
- All scanners respect ignore_paths
- ORBIT project pre-configured with `["projects/"]`
- 1088 irrelevant Suinda rules eliminated from card generation
