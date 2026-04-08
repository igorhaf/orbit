# PROMPT #266 - Project Enrichment with Rich Context Sources

## Objective

Improve the post-pipeline project description and context_semantic generation by gathering context from ALL available sources — not just the architectural map and domains, but also wiki pages, RAG business rules, git commits, and done cards.

## Problem

The `_enrich_project_fields` method only used pipeline artifacts (arch_map, domains_summary, file_count, rules_count) to generate project description. This produced descriptions that were generic and disconnected from the actual project functionality. The AI had no access to:
- Wiki documentation explaining features
- Business rules extracted from the codebase
- Git commit history showing what was implemented
- Completed cards showing validated work

## What Was Implemented

### 1. New Context Gathering Method

**File:** `backend/app/services/deep_pipeline.py`

New method `_gather_enrichment_context(project)` that collects:

1. **Wiki Pages** (up to 10): Titles + first 200 chars of content from the project's wiki
2. **RAG Business Rules** (up to 15): Semantic search by project name using RAGService
3. **Git Commits** (up to 30): Recent meaningful commits (noise-filtered) from the project's code_path
4. **Done Cards** (up to 30): Titles and types of completed cards

### 2. Updated `_enrich_project_fields`

**File:** `backend/app/services/deep_pipeline.py`

- Calls `_gather_enrichment_context()` before generating
- Passes all gathered context (wiki, rules, commits, done cards) to the contract variables
- Appends rich context sections to the user prompt
- Progress message updated to indicate context collection phase

### 3. Updated YAML Contract (v2)

**File:** `backend/app/contracts/pipeline/deep_project_enrichment.yaml`

- Added 4 new optional variables: `wiki_content`, `business_rules`, `git_commits`, `done_cards`
- Updated system_prompt to list all available data sources
- Added instructions to use commits and done cards to understand what the project REALLY does
- Added user_prompt sections with Jinja2 conditionals for each new context source

## Files Modified

| # | File | Change |
|---|------|--------|
| 1 | `backend/app/services/deep_pipeline.py` | New `_gather_enrichment_context()` + updated `_enrich_project_fields()` |
| 2 | `backend/app/contracts/pipeline/deep_project_enrichment.yaml` | v2 with wiki, rules, commits, cards context |

## Context Sources Summary

| Source | Max Items | Max Chars | Purpose |
|--------|-----------|-----------|---------|
| Wiki Pages | 10 | 3000 | Feature documentation |
| RAG Business Rules | 15 | 3000 | Code-extracted rules |
| Git Commits | 30 | unlimited | Implementation history |
| Done Cards | 30 | 2000 | Validated work |
| Arch Map | 1 | 6000 | Structural analysis |
| Domains | all | 3000 | Domain breakdown |

## Testing

- Python syntax check: PASS
- YAML validation: PASS
- Import check: PASS
- All context sources wrapped in try/except — non-fatal if any source fails

## Status

**COMPLETED**
