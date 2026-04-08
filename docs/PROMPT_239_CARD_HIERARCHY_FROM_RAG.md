# PROMPT #239 - Card Hierarchy Generator from RAG Business Rules
## Generate complete Epic → Story → Task → Subtask hierarchy from RAG knowledge base

**Date:** 2026-02-21
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** 257 cards generated (8 Epics, 19 Stories, 57 Tasks, 173 Subtasks) covering all ORBIT business domains, with rigid consistent structure derived from RAG business rules

---

## Objective

Generate a complete hierarchical card structure (Epics → Stories → Tasks → Subtasks) using business rules already stored in the RAG system. Cards are created directly via Claude Code (not through the system's AI models), with a rigid and consistent structure for every card.

**Key Requirements:**
1. Use ONLY data from RAG business rules - no AI model calls
2. Rigid identical structure for ALL cards regardless of level
3. Full hierarchy: Epic → Story → Task → Subtask
4. Dual output: description (human-readable) + generated_prompt (semantic references)
5. Store directly in PostgreSQL tasks table
6. Respect REGRA #0: description_edited_by and prompt_edited_by set to 'ai'

---

## What Was Implemented

### 1. Rigid Card Template (make_card)

Every card - regardless of type (epic/story/task/subtask) - has the exact same fields:

| Field | Type | Purpose |
|-------|------|---------|
| id | UUID | Auto-generated uuid4 |
| project_id | UUID | ORBIT project |
| parent_id | UUID/null | Hierarchical parent |
| item_type | str | epic/story/task/subtask |
| title | str | Card title |
| description | str | Human-readable markdown |
| generated_prompt | str | Semantic markdown with N1/P1/E1 references |
| acceptance_criteria | JSON | Testable criteria list |
| story_points | int | Fibonacci (1-21) |
| priority | str | critical/high/medium |
| labels | JSON | Category tags |
| workflow_state | str | Always "open" |
| interview_insights | JSON | semantic_map + derived_from + source |
| description_edited_by | str | Always "ai" (REGRA #0 compliance) |
| prompt_edited_by | str | Always "ai" (REGRA #0 compliance) |

### 2. Dual Output Functions

- **render_description()**: Human-readable markdown with context, rules, and level
- **render_prompt()**: Semantic markdown with Mapa Semantico (N1/P1/E1 identifiers) and numbered rules

### 3. 8 Business Domain Epics

Based on ORBIT_BUSINESS_ANALYST_REPORT.md analysis:

| # | Epic | Priority | SP | Stories | Tasks | Subtasks |
|---|------|----------|-----|---------|-------|----------|
| 1 | Gestao de Projetos e Codigo-Fonte | critical | 21 | 3 | 10 | 30 |
| 2 | Entrevista de Contexto e Geracao de Backlog | critical | 21 | 3 | 11 | 33 |
| 3 | Orquestracao de IA Multi-Provider | high | 13 | 3 | 9 | 28 |
| 4 | Base de Conhecimento RAG | high | 13 | 3 | 9 | 27 |
| 5 | Kanban e Gestao Visual | high | 13 | 2 | 6 | 18 |
| 6 | Satellite - Base de Conhecimento por Projeto | medium | 8 | 2 | 5 | 14 |
| 7 | Fila de Trabalho e Jobs em Background | medium | 8 | 1 | 3 | 9 |
| 8 | Dashboard e Monitoramento | medium | 8 | 2 | 4 | 14 |
| **TOTAL** | | | **105** | **19** | **57** | **173** |

### 4. Hierarchical Decomposition

- **Epic**: Business domain module (8 total)
- **Story**: Feature area within domain (2-3 per epic)
- **Task**: Specific implementation unit (2-4 per story)
- **Subtask**: Single rule implementation (1 per business rule, 2-4 per task)

### 5. Semantic Map Inheritance

Each child inherits and extends the parent's semantic map:
- Epic: `{N1, N2, P1, P2, E1, D1}`
- Story: `{...epic, S1: "story title"}`
- Task: `{...story, T1: "task title"}`
- Subtask: `{...task, ST1: "rule text"}`

---

## Files Created

### Created:
1. **backend/app/scripts/generate_cards_from_rag.py** - Main generator script
   - Lines: 762
   - Functions: `make_card()`, `render_description()`, `render_prompt()`, `make_acceptance_criteria()`, `insert_card()`, `main()`
   - Data: `HIERARCHY` constant with 8 epics, 19 stories, 57 tasks defined
   - Reusable for any ORBIT project (change PROJECT_ID)

---

## Execution Results

### Before Generation:
| Type | Count |
|------|-------|
| tasks (all types) | 0 |

### After Generation:
| Type | Count | Total SP |
|------|-------|----------|
| epic | 8 | 105 |
| story | 19 | 113 |
| task | 57 | 171 |
| subtask | 173 | 173 |
| **TOTAL** | **257** | **562** |

### Card Structure Verification:
- All cards have `description_edited_by = 'ai'` (REGRA #0 compliant)
- All cards have `prompt_edited_by = 'ai'`
- All cards have `reporter = 'system'`
- All cards have `workflow_state = 'open'`
- All cards have description (168-609 chars)
- All cards have generated_prompt (583-955 chars)
- All cards have acceptance_criteria (JSON array)
- All cards have interview_insights with semantic_map

---

## Testing Results

```bash
# Card counts by type
SELECT item_type, COUNT(*), SUM(story_points) FROM tasks
WHERE project_id = '0c9afa06-...' GROUP BY item_type;
# epic: 8 (105 SP), story: 19 (113 SP), task: 57 (171 SP), subtask: 173 (173 SP)

# Hierarchy verification - all epics have children
SELECT title, (SELECT COUNT(*) FROM tasks c WHERE c.parent_id = t.id) as children
FROM tasks t WHERE item_type = 'epic';
# All 8 epics have 1-3 story children

# Structure consistency
SELECT description_edited_by, prompt_edited_by, COUNT(*)
FROM tasks WHERE project_id = '0c9afa06-...' GROUP BY 1, 2;
# ai, ai: 257 (100% consistent)
```

---

## Key Insights

### 1. Rigid structure prevents inconsistency
Using a single `make_card()` function for ALL card types ensures every card in the database has the exact same field structure. No card is missing fields.

### 2. Business rules as subtasks provides traceability
Each subtask maps to exactly one business rule from RAG. This creates a direct link between project documentation and actionable work items.

### 3. Semantic map inheritance enables context
Child cards inherit the parent's semantic identifiers and add their own. This means a subtask carries the full context chain: Epic → Story → Task → Rule.

### 4. Script is reusable
Changing only `PROJECT_ID` and the `HIERARCHY` constant allows generating cards for any ORBIT project. The structure functions (make_card, render_*, insert_card) are project-agnostic.

---

## Reuse Guide

1. Edit `HIERARCHY` constant with the target project's business domains
2. Update `PROJECT_ID` to the target project's UUID
3. Run: `cd backend && poetry run python -m app.scripts.generate_cards_from_rag`
4. Verify: Check cards in the backlog view or via SQL

---

## Status: COMPLETE

**Key Achievements:**
- 257 cards generated with rigid consistent structure
- 8 business domains covered as Epics
- Full 4-level hierarchy: Epic → Story → Task → Subtask
- Every card has dual output (description + generated_prompt)
- REGRA #0 compliant (all marked as AI-generated)
- Script stored permanently in `backend/app/scripts/`

**Impact:**
- Complete project backlog generated from RAG knowledge
- Every business rule from documentation is now a trackable work item
- Hierarchy enables top-down planning and bottom-up execution
- Foundation for project management with full traceability to requirements

---
