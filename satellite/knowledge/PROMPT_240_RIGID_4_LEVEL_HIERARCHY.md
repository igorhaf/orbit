# PROMPT #240 - Align Card Generation with Rigid 4-Level Hierarchy
## Application flow now matches generate_cards_from_rag.py script quality

**Date:** 2026-02-21
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Card generation via "Gerar Cards" button now produces rigid 4-level hierarchy (Epic > Story > Task > Subtask) with full dual output, semantic maps, acceptance criteria, and REGRA #0 compliance - matching the quality of the script.

---

## Objective

Align the application's card generation flow (buttons "Gerar Cards" / "Gerar Epicos") to produce the EXACT SAME rigid 4-level hierarchy structure as the script `generate_cards_from_rag.py` (PROMPT #239).

**Gap Identified:**

| Aspect | Script (ideal) | Application (before) |
|--------|---------------|---------------------|
| Levels | 4 (Epic>Story>Task>Subtask) | 2 (Epic>Story) |
| Status | BACKLOG, workflow=open | DONE, workflow=closed |
| Description | Markdown humano rico | Texto simples da regra |
| Generated Prompt | Markdown semantico com N1/P1 | Copia da description |
| Acceptance Criteria | Lista de criterios testaveis | Vazio |
| Semantic Map | Com heranca hierarquica | Inexistente |
| edited_by | ai/ai | Nao setado |

---

## What Was Implemented

### 1. Rigid Card Rendering Functions (business_rules.py)

Added three module-level functions matching the script's approach:

- **`_render_description(title, context, rules, level)`**: Generates human-readable markdown with context, applicable rules, and level indicator.
- **`_render_prompt(title, semantic_map, rules, level)`**: Generates semantic markdown with Mapa Semantico (N1/P1/E1 identifiers) and numbered rules.
- **`_make_acceptance_criteria(rules)`**: Converts business rules into testable acceptance criteria (max 6 per card).

### 2. Refactored `_create_hierarchy_cards()` for 4 Levels

AI provides Epic(domain) > Story(functional area, rules[]).
Code decomposes into 4 levels:

- **Epic**: Business domain (from AI classification)
- **Story**: Functional area within domain (from AI, with rules[])
- **Task**: Groups of 3 rules from the Story (code-generated, RULES_PER_TASK=3)
- **Subtask**: 1 per individual rule (code-generated)

Every card has:
- `description`: Human-readable markdown
- `generated_prompt`: Semantic markdown with inherited map
- `acceptance_criteria`: Testable criteria from rules
- `semantic_map`: Inherited and extended from parent (N1>S1>T1>ST1)
- `description_edited_by='ai'`, `prompt_edited_by='ai'` (REGRA #0)
- `workflow_state='open'`, `status=BACKLOG`
- `labels=["from_rag"]`, `reporter="system"`

### 3. Refactored `_create_flat_business_rule_cards()` for 4 Levels

Flat fallback (when AI classification fails) also creates 4 levels:
- 1 Epic > N Stories (batches of 10 rules) > Tasks (groups of 3) > Subtasks (1 per rule)

### 4. Updated YAML Contract (v2)

`business_rules_hierarchy.yaml` updated to version 2:
- AI now groups rules by domain (Epic) and functional area (Story)
- Each Story MUST have a `rules: [...]` array with complete rule texts
- Each Story groups 3-8 related rules
- Code uses these rules to create Tasks and Subtasks

### 5. Updated project_service.py

- Comments updated to reflect new 4-level open/BACKLOG structure
- Notification title now shows all 4 levels: `{E}E {S}S {T}T {ST}ST`
- Log messages show complete counts

### 6. Semantic Map Inheritance

Each child extends the parent's semantic map:
- Epic: `{N1, P1}`
- Story: `{...epic, S1: "story title"}`
- Task: `{...story, T1: "task title"}`
- Subtask: `{...task, ST1: "rule text"}`

---

## Files Modified

### Modified:
1. **backend/app/services/context_generator/business_rules.py** - Main refactoring
   - Added `_render_description()`, `_render_prompt()`, `_make_acceptance_criteria()` module functions
   - Added imports: `asyncio`, `math`
   - Rewrote `_create_hierarchy_cards()` for 4-level rigid structure
   - Rewrote `_create_flat_business_rule_cards()` for 4-level flat fallback

2. **backend/app/contracts/memory/business_rules_hierarchy.yaml** - YAML contract v2
   - Changed from "each rule = 1 Story" to "functional area = 1 Story with rules[]"
   - Updated JSON format to include `rules: [...]` array per Story

3. **backend/app/services/project_service.py** - Background job handler
   - Updated comments for `_process_full_hierarchy_async()`
   - Enhanced notification title with 4-level counts
   - Enhanced log message with total count

---

## Testing Results

### Hierarchical Path (simulated AI output):
```
Input: 2 Epics, 3 Stories (5+3+4 rules)
Output: 2 Epics, 3 Stories, 5 Tasks, 12 Subtasks = 22 total cards

Verification:
- All 22 cards have workflow_state='open'
- All 22 cards have description_edited_by='ai'
- All 22 cards have generated_prompt (non-empty)
- All 22 cards have acceptance_criteria
- Semantic maps inherit correctly: N1>S1>T1>ST1
- derived_from chains: Subtask->Task->Story->Epic
```

### Flat Fallback Path:
```
Input: 10 business rules (flat list)
Output: 1 Epic, 1 Story, 4 Tasks, 10 Subtasks = 16 total cards
All structural requirements met.
```

---

## Key Insights

### 1. AI classifies, code decomposes
The AI only needs to classify rules into 2 levels (domain > area). The code handles the mechanical decomposition into Tasks (groups of 3) and Subtasks (1 per rule). This avoids expensive additional AI calls for levels 3-4.

### 2. rules[] field is the bridge
Adding `rules: [...]` to each Story in the YAML contract is what enables the code to create Tasks and Subtasks. Without this, the AI only returned title/description per Story.

### 3. Rigid structure prevents inconsistency
Using the same rendering functions for ALL card types ensures consistent field structure. No card is missing fields.

---

## Status: COMPLETE

**Key Achievements:**
- Application card generation now matches script quality (4 levels, dual output, semantic maps)
- YAML contract v2 enables rule decomposition into Tasks/Subtasks
- Both hierarchical and flat paths produce rigid 4-level structure
- REGRA #0 compliant (all fields marked as AI-generated)
- Notification titles show complete hierarchy counts

**Impact:**
- "Gerar Cards" button now produces complete backlog hierarchy from RAG business rules
- Every business rule becomes a trackable subtask with full context chain
- Semantic maps enable traceability from Subtask up to Epic domain

---
