# PROMPT #287 - Business Rules Index Enhancement
## Generic domain classification and richer index page for wiki business rules

**Date:** 2026-02-15
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Enhancement
**Impact:** Business Rules Index page now works with any project structure, shows richer content with summary table and rule previews

---

## Objective

The Business Rules Index page ("Regras de Negocio - Indice") is essential for navigating business rules in the wiki. The previous implementation had two issues:
1. Domain classification was hardcoded for one specific project (Brazilian education platform)
2. Index content was too basic (just a bullet list of domains)
3. Rule count used raw row count instead of deduplicated count

**Key Requirements:**
1. Generic domain classification that works with any project structure
2. Richer index page with summary table, source file counts, and rule previews
3. Correct rule counts (deduplicated)
4. English translation of all wiki page templates

---

## What Was Implemented

### 1. Generic Domain Classification
**File:** `backend/app/api/routes/wiki.py`

Replaced the hardcoded `_DOMAIN_MAP` (44 entries for a specific project) with a generic algorithm that:
- Splits source file path into directory parts
- Skips boilerplate directories (app, src, lib, utils, config, migrations, etc.)
- Uses the first meaningful directory as the domain name
- Converts directory names to Title Case for display
- Falls back to filename (without extension) if no directories
- Falls back to "General" as last resort

This means ANY project will get meaningful domain grouping based on its actual folder structure.

### 2. Enhanced Index Page Content
The index page now includes:
- **Summary table** with columns: Domain, Rules count, Source Files count
- **Domain list** with rule previews (first 3 rule titles shown)
- **Correct totals** using deduplicated rule counts
- **Source file statistics** (how many files each domain spans)

### 3. English Translation
Translated all wiki page templates from Portuguese to English:
- Parent page: "Business Rules" (was "Regras de Negocio")
- Index page: "Business Rules - Index by Domain" (was "Regras de Negocio - Indice por Dominio")
- Domain pages: "Business Rules - {Domain}" (was "Regras de Negocio - {Domain}")
- Rule pages: "Domain", "Source File", "Description", "Context" (was Portuguese)
- Raw catalog: "Reference Catalog - Raw Rules" (was "Catalogo de Referencia - Regras Brutas")
- Updated both `wiki.py` and `projects.py` raw catalog text

---

## Files Modified

### Modified:
1. **`backend/app/api/routes/wiki.py`** - Generic domain classification, enhanced index, English text
   - Replaced `_DOMAIN_MAP` + `_classify_domain()` with generic path-based algorithm
   - Enhanced index page with summary table and rule previews
   - Translated parent page, index page, domain pages, rule pages, raw catalog
2. **`backend/app/api/routes/projects.py`** - Translated raw catalog text to English

---

## Testing Results

```
OK  wiki.py compiles successfully
OK  projects.py compiles successfully
OK  Domain classification works with generic paths
OK  Index page includes summary table
OK  Rule counts use deduplicated values
OK  All templates translated to English
```

---

## Key Insights

### 1. Generic vs Hardcoded Classification
The hardcoded `_DOMAIN_MAP` only worked for one specific project. The generic approach extracts meaningful directory names from paths, skipping framework boilerplate dirs. This makes the wiki useful for ANY project without code changes.

### 2. _SKIP_DIRS Strategy
The set of directories to skip (`app`, `src`, `lib`, `utils`, etc.) covers common patterns across Python, JavaScript, Go, Java, PHP, and Ruby projects. The algorithm finds the first directory that ISN'T in this skip list.

---

## Status: COMPLETE

**Key Achievements:**
- Generic domain classification that works with any project
- Richer index page with summary table and rule previews
- Correct deduplicated rule counts
- All wiki templates translated to English

**Impact:**
- Business Rules Index now properly organizes rules for any project structure
- Users see a professional, informative index page with at-a-glance statistics
- Consistent English UI across the entire wiki system
