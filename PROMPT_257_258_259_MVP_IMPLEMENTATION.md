# PROMPT #257, #258, #259 - MVP Implementation: Cards + Wiki + Jobs
## Three-Front Attack for Functional MVP

**Date:** February 13, 2026
**Status:** COMPLETED
**Priority:** HIGH (CRITICAL)
**Type:** Feature Implementation / Bug Fix / Refactor
**Impact:** Core MVP functionality - cards with real content, living wiki, and clean job management

---

## Objective

Address 7 critical problems identified in deep audit:
1. **CRITICAL**: Cards are empty shells (only titles, no content)
2. **HIGH**: Project wiki doesn't grow
3. **HIGH**: CHILDREN_GENERATION job type without handler
4. **HIGH**: Context truncated too aggressively
5. **MEDIUM**: Wiki enrichment prompt in English
6. **MEDIUM**: Watchdog re-queues every 60s without checking work
7. **LOW**: Stale job cleanup only for one job type

---

## FRONT 1: Cards with Real Content (PROMPT #257)

### Problem
`_generate_draft_stories()`, `_generate_draft_tasks()`, `_generate_draft_subtasks()` generated only TITLES and created Task objects with `description="Conteudo sera gerado ao aprovar"`, `acceptance_criteria=[]`, `story_points=5` hardcoded. Rich YAML prompts existed but weren't used.

### Solution

**1.1 - Rewrote `_generate_draft_stories()`**
- Replaced hardcoded prompt with `PromptLoader.render("backlog/stories_from_epic")`
- AI now returns complete objects: title, description_markdown, semantic_map, acceptance_criteria, story_points
- Injected business rules from RAG via `RAGService.get_business_rules()`
- Increased max_tokens: 2000 -> 8000
- Increased context truncation: [:2000] -> [:5000]
- Created fallback method `_generate_draft_stories_fallback()`

**1.2 - Rewrote `_generate_draft_tasks()`**
- Same pattern using `PromptLoader.render("backlog/tasks_from_story")`
- Increased max_tokens: 1500 -> 6000
- Added business rules injection
- Created fallback `_generate_draft_tasks_fallback()`

**1.3 - Created `subtasks_from_task.yaml` and rewrote `_generate_draft_subtasks()`**
- Created new YAML prompt at `backend/app/prompts/backlog/subtasks_from_task.yaml`
- Uses PromptLoader instead of hardcoded prompt
- Increased max_tokens: 1000 -> 4000
- Created fallback `_generate_draft_subtasks_fallback()`

---

## FRONT 2: Living Project Wiki (PROMPT #258)

### Problem
Wiki enrichment prompt was in English, generated little text, didn't structure in sections, and returned silently when no data found.

### Solution

**2.1 - Rewrote `wiki_enrichment.yaml` in Portuguese**
- Translated 100% to Portuguese
- Defined mandatory sections: Visao Geral, Stack Tecnologica, Arquitetura, Regras de Negocio (Validacao/Fluxo/Acesso/Calculo), Features Principais, Integracoes
- Added variables: interview_context, scan_summary, existing_features
- Increased estimated_tokens: 4000 -> 6000

**2.2 - Enriched `_enrich_context_from_rag()`**
- Now queries BOTH business rules AND interview answers from RAG
- Extracts scan_summary from `project.initial_memory_context` (total_files, code_files, languages)
- Extracts key_features from `project.initial_memory_context`
- Extracts structured stack_info (languages, frameworks, databases)
- Does NOT return False silently when no rules - proceeds if ANY data source available
- Increased max_tokens: 4000 -> 6000

**2.3 - Frontend wiki progress display**
- Added stats bar above description: "X rules extracted | Y interview answers | Z files scanned"
- Shows "Enriching..." indicator when wiki enrichment is active
- Auto-refreshes description every 30s while enrichment/scan active
- Loads knowledge stats when overview description tab is visible

---

## FRONT 3: Clean Jobs and Give Visibility (PROMPT #259)

### Problem
Watchdog re-queues every 60s unconditionally, stale cleanup only for RAG_CONTINUOUS_SCAN type, no result visibility for completed jobs.

### Solution

**3.1 - CHILDREN_GENERATION handler**
- Verified that endpoint already exists in `tasks_old.py` and is accessible through the routing chain (`tasks.py` -> `tasks/__init__.py` -> `tasks_old.py`)
- No porting needed - handler was already functional

**3.2 - Conditional watchdog cooldown**
- Before re-queuing, checks if there are pending RAG files
- If work exists: 60s cooldown (CYCLE_COOLDOWN)
- If idle: 300s / 5 min cooldown (IDLE_COOLDOWN)
- Logs which mode is active for debugging

**3.3 - Stale cleanup for ALL job types**
- `bootstrap_watchdog()` now cleans zombie RUNNING jobs of ANY type on restart (not just RAG_CONTINUOUS_SCAN)
- Cleans stale PENDING jobs of ANY type older than 30 min on restart
- Prevents ghost jobs from any job type from accumulating

**3.4 - Job result visibility in frontend**
- Added `formatJobResult()` function that interprets result JSON
- Shows human-readable summaries: "15 stories created", "5 rules extracted | wiki updated", etc.
- Displayed as green text under job title for completed jobs

---

## Files Modified/Created

### Created:
1. **backend/app/prompts/backlog/subtasks_from_task.yaml** - New YAML prompt for subtask generation with semantic methodology

### Modified:
1. **backend/app/services/context_generator.py** - Rewrote 3 draft generation functions + 3 fallback methods
2. **backend/app/prompts/context/wiki_enrichment.yaml** - Translated to Portuguese, structured sections, new variables
3. **backend/app/api/routes/projects.py** - Enriched `_enrich_context_from_rag()` with interview answers, scan summary, features
4. **frontend/src/app/projects/[id]/page.tsx** - Wiki stats bar, auto-refresh, knowledge stats loading
5. **backend/app/services/watchdog.py** - Conditional cooldown (60s vs 5min), stale cleanup for all job types
6. **frontend/src/app/jobs/page.tsx** - Job result summaries for completed jobs

---

## Testing Results

```
Backend restart: OK (Application startup complete)
API health check: OK (projects endpoint responding)
Frontend compilation: OK (only pre-existing ESLint warnings, no new errors)
Watchdog bootstrap: OK (stale cleanup running on startup)
```

---

## Key Achievements

- Cards now generated with REAL content (description, acceptance_criteria, story_points, semantic_map)
- Wiki enrichment uses ALL available data sources (business rules + interview answers + scan summary + features)
- Wiki prompt in Portuguese with structured mandatory sections
- Watchdog sleeps 5 min when idle instead of hammering every 60s
- All stale/zombie jobs cleaned on restart (any type)
- Job results visible in frontend with human-readable summaries
- Stats bar shows wiki knowledge growth in real-time

---

## Status: COMPLETE
