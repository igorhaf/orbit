# PROMPT #170 - Business Rules High-Priority RAG Injection

**Date:** 2026-02-05
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Business rules from codebase memory scan now influence ALL card generation (Context, Epics, Stories, Tasks, Subtasks)

---

## Objective

Implement high-priority injection of business rules extracted from codebase memory scan into all card generation prompts. This ensures that:

1. Interface-derived rules (from templates, views) have HIGHEST priority
2. Validation rules have HIGH priority
3. Model/entity rules have NORMAL priority
4. All cards (Epics, Stories, Tasks, Subtasks) respect these rules

---

## What Was Implemented

### 1. RAG Service Enhancements (`rag_service.py`)

Added new methods for business rules retrieval:

- **`get_business_rules(project_id, query, top_k, similarity_threshold)`**
  - Retrieves business rules from RAG with priority ordering
  - Interface rules → Validation rules → Model rules → Other rules
  - Supports semantic search or full retrieval

- **`get_interface_rules(project_id, top_k)`**
  - Gets rules specifically from interface/template files
  - Highest priority rules (system names, domains, form validations)

- **`format_business_rules_for_prompt(rules, max_chars)`**
  - Formats rules for prompt injection with clear headers
  - Groups by source: Interface, Validation, Model, Other
  - Respects token limits with truncation

- **`store_business_rule(content, project_id, source, source_file, rule_type, priority)`**
  - Enhanced storage with rich metadata
  - Supports source classification (interface, validation, model, code)

### 2. Backlog Generator Updates (`backlog_generator.py`)

Added helper function and injection points:

- **`_get_business_rules_context(db, project_id, max_rules)`**
  - Helper to retrieve and format business rules
  - Logs retrieval for debugging

- **Epic Generation:** Business rules injected at start of user prompt
- **Story Decomposition:** Business rules injected before Epic details
- **Task Decomposition:** Business rules injected before Story details

### 3. YAML Prompt Updates

Modified all backlog prompts to accept `business_rules_text` variable:

- **`backlog/epic_from_interview.yaml`**
  - Added `business_rules_text` to optional variables
  - Conditional injection with instructions to incorporate rules

- **`backlog/stories_from_epic.yaml`**
  - Added `business_rules_text` to optional variables
  - Instructions to apply rules to Story acceptance criteria

- **`backlog/tasks_from_story.yaml`**
  - Added `business_rules_text` to optional variables
  - Instructions to validate rules in Task criteria

- **`context/draft_subtasks.yaml`**
  - Added `business_rules_text` to optional variables
  - Subtasks should implement applicable rules

- **`context/subtask_specification.yaml`**
  - Added `business_rules_text` to optional variables
  - Code must implement validations for rules

### 4. Context Generator Updates (`context_generator.py`)

- Now retrieves business rules from BOTH:
  - `project.initial_memory_context` (original source)
  - RAG storage (may have additional rules from later analysis)
- Deduplicates rules before injection
- Logs RAG rule count for debugging

### 5. Codebase Memory Updates (`codebase_memory.py`)

Enhanced business rule storage:

- Classifies rules by source type:
  - `interface` - Rules from templates/views with system names, domains
  - `validation` - Rules about validation, min/max, required fields
  - `model` - Rules about entities, tables, columns
  - `code` - Default for other rules
- Stores priority: `high` for interface, `normal` for others
- Logs storage count for debugging

---

## Files Modified

### Created:
1. **`PROMPT_170_BUSINESS_RULES_RAG_INJECTION.md`** - This documentation

### Modified:
1. **`backend/app/services/rag_service.py`**
   - Added 4 new methods for business rules handling
   - ~200 lines added

2. **`backend/app/services/backlog_generator.py`**
   - Added helper function `_get_business_rules_context()`
   - Injected business rules in 3 generation functions
   - ~50 lines added

3. **`backend/app/services/context_generator.py`**
   - Added RAG retrieval alongside memory context
   - ~25 lines added

4. **`backend/app/services/codebase_memory.py`**
   - Enhanced `_store_business_rules()` with source classification
   - ~20 lines added

5. **`backend/app/prompts/backlog/epic_from_interview.yaml`**
   - Added `business_rules_text` variable and injection

6. **`backend/app/prompts/backlog/stories_from_epic.yaml`**
   - Added `business_rules_text` variable and injection

7. **`backend/app/prompts/backlog/tasks_from_story.yaml`**
   - Added `business_rules_text` variable and injection

8. **`backend/app/prompts/context/draft_subtasks.yaml`**
   - Added `business_rules_text` variable and injection

9. **`backend/app/prompts/context/subtask_specification.yaml`**
   - Added `business_rules_text` variable and injection

---

## How It Works

### Flow Diagram

```
[Memory Scan] → Extract Business Rules → Store in RAG
                                              ↓
                                        (type: business_rule)
                                        (source: interface|validation|model|code)
                                        (priority: high|normal)
                                              ↓
[Epic Generation] ← Retrieve Rules ← RAG ─────┤
       ↓                                       │
[Story Generation] ← Retrieve Rules ←──────────┤
       ↓                                       │
[Task Generation] ← Retrieve Rules ←───────────┤
       ↓                                       │
[Subtask Generation] ← Retrieve Rules ←────────┘
```

### Example Prompt Injection

When generating an Epic, the prompt now includes:

```
## REGRAS DE NEGÓCIO DO PROJETO (ALTA PRIORIDADE)

As seguintes regras de negócio foram extraídas do código existente.
TODAS as entregas (épicos, stories, tasks) DEVEM respeitar estas regras:

### Regras de Interface (Prioridade Máxima)
1. SISTEMA: SEI Contas - Gestão LDAP do Governo de Pernambuco
2. DOMÍNIO: sei.pe.gov.br
3. Autenticação via LDAP é obrigatória

### Regras de Validação
4. Senha deve ter mínimo 8 caracteres
5. Email deve ser único por usuário
...

ATENÇÃO: O Epic gerado DEVE respeitar TODAS as regras de negócio listadas acima.
Incorpore as regras relevantes nos critérios de aceitação e insights.
```

---

## Testing

To test the implementation:

1. Create a new project with a codebase folder
2. Let the memory scan complete
3. Check logs for: `📋 Retrieved X business rules for prompt injection`
4. Generate an Epic from interview
5. Verify the Epic title and criteria reference the business rules
6. Decompose to Stories and verify rules are inherited
7. Decompose to Tasks and verify validation criteria

---

## Key Insights

### 1. Priority System
Interface-derived rules (system names, domains) are most valuable because they:
- Contain official system names (`<title>SEI Contas</title>`)
- Contain organizational context (`.gov.br` = government)
- Represent explicit user-facing behavior

### 2. Inheritance Pattern
Business rules flow DOWN the hierarchy:
- Epic → Stories → Tasks → Subtasks
- Each level receives the SAME rules
- This ensures consistency across all cards

### 3. Graceful Degradation
If no business rules exist:
- Functions return empty strings
- Prompts render without business rules section
- No errors thrown

---

## Status: COMPLETE

**Key Achievements:**
- Business rules now influence ALL card generation
- Interface rules have highest priority
- Rules are retrieved from RAG at each generation step
- Prompts include clear instructions to respect rules
- Source classification enables priority ordering

**Impact:**
- Cards generated will better reflect actual system requirements
- System names like "SEI PE" will appear in card titles
- Validation rules will appear in acceptance criteria
- Better alignment between code analysis and generated cards
