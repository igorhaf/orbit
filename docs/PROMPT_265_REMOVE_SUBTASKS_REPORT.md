# PROMPT #265 — Complete Removal of Subtask Layer

## Objective

Eliminate the entire subtask layer from ORBIT to reduce complexity and processing overhead. The hierarchy changes from `Epic -> Story -> Task -> Subtask` to `Epic -> Story -> Task` (leaf node).

## What Was Implemented

### 1. Database Changes

- **Deleted 900 subtask records** from `tasks` table
- **Dropped `subtask_suggestions` column** from `tasks` table
- **Removed `SUBTASK` from Python `ItemType` enum** (left in PostgreSQL enum for compatibility)
- **Removed `SUBTASK_ACTIVATION` from Python `JobType` enum**
- **Created migration** `p265_remove_subtasks.py`

### 2. Deleted Files (13 files)

**Python modules:**
- `backend/app/api/routes/interviews/subtask_focused_questions.py`
- `backend/app/api/routes/interviews/subtask_orchestrated_questions.py`

**YAML prompts:**
- `backend/app/prompts/interviews/subtask_focused.yaml`
- `backend/app/prompts/backlog/subtasks_from_task.yaml`
- `backend/app/prompts/context/draft_subtasks.yaml`
- `backend/app/prompts/context/subtask_specification.yaml`
- `backend/app/prompts/context/subtask_titles_generation.yaml`

**YAML contracts:**
- `backend/app/contracts/pipeline/deep_subtask_decomposition.yaml`
- `backend/app/contracts/generation/draft_subtasks.yaml`
- `backend/app/contracts/generation/subtask_specification.yaml`
- `backend/app/contracts/generation/subtask_titles_generation.yaml`
- `backend/app/contracts/interviews/subtask_focused.yaml`

### 3. Backend Services Modified (~18 files)

- `task_hierarchy.py` — Task is now leaf node (no children allowed)
- `workflow_validator.py` — Removed subtask workflow states/transitions
- `task_activator.py` — Removed `activate_suggested_subtask()` and `_generate_full_subtask_content()`
- `card_activator.py` — Removed subtask imports
- `draft_generator.py` — Removed `_generate_draft_subtasks()` and fallback methods
- `epic_activator.py` — Removed subtask generation call
- `content_formatter.py` — Removed subtask defaults and validation
- `business_rules.py` — Removed subtask creation from rules
- `meta_prompt_processor.py` — Removed `_create_subtask()` and subtask tracking
- `backlog_generator.py` — Removed `suggested_subtasks` from task creation
- `deep_pipeline.py` — Removed phase 4d (subtask decomposition)
- `watchdog.py` — Removed subtask activation
- `job_manager.py` — Removed SUBTASK_ACTIVATION mapping
- `rag_pipeline.py` — Removed subtask from valid types, ordering, hierarchy
- `model_selector.py` — Removed subtask complexity weight
- `project_service.py` — Removed subtask counting
- `budget_manager.py` — Removed subtask budget
- `prompt_context_compressor.py` — Removed subtask context compression

### 4. Backend API Routes Modified (~7 files)

- `interviews/endpoints.py` — Removed subtask interview modes and imports
- `interviews/card_focused_prompts.py` — Removed subtask icon and prompts
- `tasks/workflow.py` — Removed subtask routing and suggestions
- `tasks/workflow_helpers.py` — Removed subtask activation handlers
- `tasks/kanban.py` — Removed subtask_suggestions from response
- `tasks/crud.py` — Updated hierarchy validation (Task is leaf)
- `prompt_queue.py` — Removed subtask from type map and ordering

### 5. Contracts YAML Updated (~10 files)

- `business/job_priorities.yaml`, `card_hierarchy.yaml`, `generation_counts.yaml`
- `business/queue_scoring.yaml`, `workflow_states.yaml`
- `execution/token_budgets.yaml`
- `pipeline/cards_detail_generation.yaml`, `cards_epic_generation.yaml`, `deep_quality_review.yaml`
- `generation/meta_prompt_hierarchy.yaml`

### 6. YAML Prompts Updated (~3 files)

- `backlog/hierarchy_generation.yaml`, `meta_prompt_hierarchy.yaml`
- `rag/generate_cards.yaml`

### 7. Frontend Modified (~14 files)

- `lib/types.ts` — Removed SUBTASK enum, SubtaskSuggestion interface, subtask_suggestions field
- `backlog/TaskCard.tsx` — Removed subtask suggestions UI, accept button, icon
- `backlog/ItemDetailPanel.tsx` — Removed subtask activation, accept function, icon
- `backlog/HierarchyTab.tsx` — Simplified conditions (no subtask check)
- `backlog/BacklogFilters.tsx` — Removed Subtarefa filter
- `backlog/InlineCardCreator.tsx` — Removed subtask option
- `backlog/BacklogListView.tsx` — Removed subtask icon and activation
- `backlog/PromptQueuePanel.tsx` — Removed subtask icon
- `backlog/InterviewTab.tsx` — Updated text
- `interview/InterviewTree.tsx` — Removed subtask icon
- `kanban/TaskCard.tsx` — Removed subtask display
- `contexts/NotificationContext.tsx` — Removed subtask_activation notification
- `app/settings/page.tsx` — Updated hierarchy text
- `lib/api/knowledge.ts` — Removed subtask from stats

### 8. Scripts Modified (~2 files)

- `scripts/generate_cards_from_rag.py` — Removed subtask generation and SQL column
- `scripts/generate_all_cards_from_rag.py` — Removed subtask generation

## Impact Summary

| Category | Deleted | Modified |
|----------|---------|----------|
| Backend Python | 2 | ~27 |
| YAML Prompts | 5 | 3 |
| YAML Contracts | 5 | 10 |
| Frontend | 0 | 14 |
| Scripts | 0 | 2 |
| Migration | 1 (created) | 0 |
| Database records | 900 subtasks deleted | 1 column dropped |
| **Total** | **13 files** | **~56 files** |

## Testing Results

- **TypeScript**: Zero new errors (all pre-existing)
- **Backend imports**: All modules load correctly
- **Selenium tests**: 115/115 passed (1 skipped)
- **Database**: 900 subtasks deleted, subtask_suggestions column dropped

## Status

**COMPLETED**
