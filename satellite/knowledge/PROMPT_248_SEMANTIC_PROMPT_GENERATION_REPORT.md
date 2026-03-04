# PROMPT #248 - Card Semantic Prompt Generation

## Objective

Transform the card's "Prompt" tab from a static display into an interactive prompt generation tool. The new feature generates a semantic prompt on-demand using all available context: card data, hierarchy, wiki pages, RAG business rules, and project semantic context.

## What Was Implemented

### 1. Backend Endpoint

**File:** `backend/app/api/routes/tasks/orbit_integration.py`

New endpoint `POST /api/v1/tasks/{task_id}/generate-semantic-prompt`:
- Gathers context from: card hierarchy (parent), project.context_semantic, wiki pages (up to 5), RAG business rules (semantic search by card title), tech stack
- Loads contract YAML via ContractLoader
- Calls AIOrchestrator (with auto-cache) for prompt generation
- Saves to `task.generated_prompt`, marks `prompt_edited_by = 'ai'`
- Returns prompt text + sources used (wiki pages list, rules count, parent/project context flags)
- Respects REGRA #0: if `prompt_edited_by == 'human'`, requires `force: true` to overwrite

### 2. Contract YAML

**File:** `backend/app/contracts/pipeline/card_semantic_prompt.yaml`

Externalized prompt template with variables: card_title, card_type, card_description, labels, acceptance_criteria, parent_title, parent_prompt, project_context, business_rules, wiki_context, tech_stack.

### 3. Frontend API Method

**File:** `frontend/src/lib/api/tasks.ts`

New method `generateSemanticPrompt(taskId, force?)` calling the backend endpoint.

### 4. PromptTab Redesign

**File:** `frontend/src/components/backlog/PromptTab.tsx`

Complete redesign:
- **Empty state**: Large "Gerar Prompt Semantico" button with AI icon and description
- **With prompt**: Display + Regenerar/Copiar/Exportar buttons
- **Sources section**: Shows badges for wiki pages, business rules, parent context, project context
- **REGRA #0 protection**: Confirmation dialog when regenerating human-edited prompts
- **Loading state**: Spinner during generation
- **Error handling**: Error message display

### 5. ItemDetailPanel Integration

**File:** `frontend/src/components/backlog/ItemDetailPanel.tsx`

Passes `projectId={item.project_id}` to PromptTab.

### 6. Type Additions

**File:** `frontend/src/lib/types.ts`

Added `description_edited_by` and `prompt_edited_by` fields to Task interface.

## Files Modified/Created

| # | File | Change |
|---|------|--------|
| 1 | `backend/app/api/routes/tasks/orbit_integration.py` | New endpoint |
| 2 | `backend/app/contracts/pipeline/card_semantic_prompt.yaml` | New contract |
| 3 | `frontend/src/lib/api/tasks.ts` | New API method |
| 4 | `frontend/src/components/backlog/PromptTab.tsx` | Complete redesign |
| 5 | `frontend/src/components/backlog/ItemDetailPanel.tsx` | Pass projectId prop |
| 6 | `frontend/src/lib/types.ts` | Add prompt_edited_by fields |

## Testing

- Backend syntax check: PASS
- TypeScript compilation: PASS (no new errors)
- Backend restart: PASS
- API test: Generated prompt for card "Integrar resumo de sessao" using 5 wiki pages + parent context + project context via qwen3:14b model

## Status

**COMPLETED**
