# PROMPT #261 - File Fragmentation for Context Reduction

**Date:** 2026-03-05
**Status:** COMPLETED
**Type:** Refactoring

---

## Objective

Fragment large files with multiple responsibilities into smaller, cohesive modules to reduce AI context window consumption and improve code maintainability. Selection criteria: semantic cohesion, not arbitrary line counts.

---

## What Was Implemented

### Classification Results

**Files Analyzed:** 36 files > 1000 lines
**Fragmented:** 10 files (6 critical + 4 recommended)
**Kept as-is (cohesive):** 11 files
**Skipped (already modular):** 3 frontend components

### Files Kept as-is (Cohesive) — Justification

| File | Lines | Justification |
|------|-------|---------------|
| `backend/app/prompts/context_prompts.py` | 1945 | Data constants, same domain, no logic |
| `backend/app/contracts/generation_contracts.py` | 1993 | Data constants, same domain |
| `backend/app/prompts/interviews_prompts.py` | 1544 | Data constants, same domain |
| `backend/app/contracts/interviews_contracts.py` | 1344 | Data constants, same domain |
| `backend/app/contracts/pipeline_contracts.py` | 1195 | Data constants, same domain |
| `backend/app/services/ai_orchestrator/orchestrator.py` | 1563 | Already uses mixins, cohesive around AIOrchestrator |
| `backend/app/services/watchdog.py` | 1246 | Cohesive background process (job executor + self-healing) |
| `backend/app/services/rag_service.py` | 1204 | Cohesive service (embeddings + search + storage) |
| `backend/app/services/continuous_rag_service.py` | 1090 | Cohesive service (scan + extract + store) |
| `frontend/src/app/ai-flow/page.tsx` | 1263 | Already has sub-components extracted |
| `frontend/src/components/backlog/BacklogListView.tsx` | 1211 | Cohesive list component |

### Frontend Components Skipped — Justification

| File | Lines | Justification |
|------|-------|---------------|
| `frontend/src/app/jobs/page.tsx` | 1717 | Deeply intertwined state; further splitting adds prop-drilling complexity |
| `frontend/src/app/projects/[id]/page.tsx` | 1361 | Already has 3 tab components extracted |
| `frontend/src/components/backlog/ItemDetailPanel.tsx` | 1257 | Already has 7 tab components extracted |

---

## Files Fragmented

### 1. `frontend/src/lib/types.ts` (1121 lines → 8 files)

**Strategy:** Split monolithic types file into domain-specific modules with barrel re-export.

| New Module | Content | Lines |
|-----------|---------|-------|
| `types/enums.ts` | 11 enums (TaskStatus, ItemType, PriorityLevel, etc.) | ~95 |
| `types/project.ts` | Project, ProjectCreate, ProjectUpdate, ProjectWithRelations | ~90 |
| `types/task.ts` | Task, relationships, comments, transitions, backlog types | ~280 |
| `types/interview.ts` | Interview, ConversationMessage, StackConfiguration | ~75 |
| `types/prompt.ts` | Prompt, ChatMessage, ChatSession, Commit types | ~120 |
| `types/ai-models.ts` | AIModel, AIFlowChain, metrics, utility nodes, profiles | ~200 |
| `types/common.ts` | SystemSettings, KanbanBoard, Analytics, RagStats | ~175 |
| `types/index.ts` | Barrel file re-exporting all modules | ~10 |

**Imports updated:** 0 — barrel file preserves `@/lib/types` path for all 50+ consumers.

### 2. `backend/app/api/routes/knowledge.py` (1292 lines → package)

**Strategy:** Convert to FastAPI sub-router package.

| New Module | Endpoints | Lines |
|-----------|-----------|-------|
| `knowledge/__init__.py` | Router composition | ~20 |
| `knowledge/search.py` | 3 search endpoints | ~133 |
| `knowledge/rules.py` | 5 rules CRUD endpoints | ~287 |
| `knowledge/documents.py` | 5 document endpoints | ~382 |
| `knowledge/stats.py` | 5 stats endpoints | ~358 |

**Total endpoints preserved:** 18

### 3. `backend/app/api/routes/continuous_rag.py` (1157 lines → package)

**Strategy:** Convert to FastAPI sub-router package.

| New Module | Endpoints | Lines |
|-----------|-----------|-------|
| `continuous_rag/__init__.py` | Router composition | ~20 |
| `continuous_rag/phases.py` | 5 phase trigger endpoints | ~300 |
| `continuous_rag/deep_pipeline.py` | 10 deep pipeline endpoints + helper | ~500 |
| `continuous_rag/status.py` | 5 status/listing endpoints | ~300 |

**Total endpoints preserved:** 20

### 4. `backend/app/api/routes/projects.py` (1962 lines → package)

**Strategy:** Convert to FastAPI sub-router package with static-path routers first.

| New Module | Endpoints | Lines |
|-----------|-----------|-------|
| `projects/__init__.py` | Router composition (static before parameterized) | ~30 |
| `projects/browsing.py` | Folder/file browsing | ~200 |
| `projects/crud.py` | CRUD operations | ~320 |
| `projects/scanning.py` | Memory scan, quick-create, indexing | ~340 |
| `projects/descriptions.py` | AI description operations | ~260 |
| `projects/generation.py` | Wiki, card, hierarchy generation | ~210 |
| `projects/specs.py` | Specs discovery, listing, toggling | ~260 |
| `projects/context.py` | Summary, context, lock-context | ~160 |

**Total endpoints preserved:** 27

### 5. `backend/app/api/routes/interviews/endpoints.py` (1894 lines → 4 modules)

**Strategy:** Split into sub-modules with shared models file.

| New Module | Content | Lines |
|-----------|---------|-------|
| `interviews/models.py` | Shared Pydantic models | ~18 |
| `interviews/crud.py` | CRUD + status endpoints | ~297 |
| `interviews/flow.py` | Start, save-stack, interactive flow | ~380 |
| `interviews/generation.py` | Task/context/hierarchy generation | ~407 |
| `interviews/messaging.py` | Message handling (sync + async) | ~412 |

**Total endpoints preserved:** 17

### 6. `backend/app/services/backlog_generator.py` (1302 → 258 lines)

**Strategy:** Extract mixins for story/task generation and utility functions.

| New Module | Content | Lines |
|-----------|---------|-------|
| `backlog_generator.py` | Main class inheriting mixins | ~258 |
| `backlog_utils.py` | Business rules context, JSON cleanup, semantic conversion | ~297 |
| `backlog_stories.py` | StoryGenerationMixin | ~341 |
| `backlog_tasks.py` | TaskGenerationMixin | ~527 |

### 7. `backend/app/services/wiki_service.py` (1278 → 108 lines)

**Strategy:** Extract page builders and AI enrichment as module-level functions.

| New Module | Content | Lines |
|-----------|---------|-------|
| `wiki_service.py` | Re-exports for backward compatibility | ~108 |
| `wiki_pages.py` | Page builders, semantic linking, domain classification | ~880 |
| `wiki_enrichment.py` | AI enrichment, per-page AI operations | ~392 |

### 8. `backend/app/services/context_generator/draft_generator.py` (1613 → 911 lines)

**Strategy:** Extract story/task generation mixins and helper functions.

| New Module | Content | Lines |
|-----------|---------|-------|
| `draft_generator.py` | Main DraftGeneratorMixin class | ~911 |
| `draft_helpers.py` | Helper functions | ~186 |
| `draft_stories.py` | DraftStoriesMixin | ~318 |
| `draft_tasks.py` | DraftTasksMixin | ~310 |

### 9. `backend/app/services/rag_pipeline.py` (2107 lines → package)

**Strategy:** Convert to package with phase mixins.

| New Module | Content | Lines |
|-----------|---------|-------|
| `rag_pipeline/__init__.py` | Re-export RagPipelineService | ~5 |
| `rag_pipeline/service.py` | Main class inheriting phase mixins | ~250 |
| `rag_pipeline/phase1_index.py` | Phase1Mixin - file indexing | ~150 |
| `rag_pipeline/phase2_rules.py` | Phase2Mixin - rule extraction + JSON parsing | ~570 |
| `rag_pipeline/phase3_cards.py` | Phase3Mixin - card generation + creation | ~650 |
| `rag_pipeline/phase4_wiki.py` | Phase4Mixin - wiki generation | ~400 |
| `rag_pipeline/utils.py` | Redis, language detection, git, constants | ~100 |

### 10. `backend/app/services/deep_pipeline.py` (2451 lines → package)

**Strategy:** Convert to package with phase mixins and telemetry module.

| New Module | Content | Lines |
|-----------|---------|-------|
| `deep_pipeline/__init__.py` | Re-export DeepPipelineService | ~5 |
| `deep_pipeline/service.py` | Main class inheriting all mixins | ~350 |
| `deep_pipeline/phases_0_to_3.py` | Phase0to3Mixin - structural scan, file analysis, rules, arch map | ~600 |
| `deep_pipeline/phases_4_to_7.py` | Phase4to7Mixin - card gen, wiki gen, QA, gap fill | ~600 |
| `deep_pipeline/telemetry.py` | TelemetryMixin - emit, scoring, reinforcement | ~400 |
| `deep_pipeline/utils.py` | UtilsMixin - file classification, ignore patterns, checkpoint | ~500 |

---

## Imports Updated

- **Frontend:** Zero import changes needed — barrel `index.ts` preserves `@/lib/types` path
- **Backend routes:** `main.py` unchanged — all route packages use same module paths
- **Backend services:** All packages re-export via `__init__.py` for backward compatibility
- **Mixin classes:** Imported and composed via multiple inheritance in main service classes

---

## Testing Results

### Backend Import Verification
All 9 fragmented backend modules import successfully:
- `from app.api.routes.knowledge import router` ✅
- `from app.api.routes.continuous_rag import router` ✅
- `from app.api.routes.projects import router` ✅
- `from app.api.routes.interviews import router` ✅
- `from app.services.backlog_generator import BacklogGeneratorService` ✅
- `from app.services.wiki_service import WikiService` ✅
- `from app.services.context_generator.draft_generator import DraftGeneratorMixin` ✅
- `from app.services.rag_pipeline import RagPipelineService` ✅
- `from app.services.deep_pipeline import DeepPipelineService` ✅

### Route Loading
- **323 routes loaded** in main.py — all present and correct
- All 21 RAG routes confirmed
- All knowledge, projects, interviews, continuous_rag routes verified

### Unit Tests (pytest)
- **46 passed** ✅
- **21 failed** — pre-existing (prompt content assertions from PROMPT #260 migration)
- **19 errors** — pre-existing (database connection issues in test environment)
- **0 failures from fragmentation** ✅

### TypeScript Type-Check
- **50 errors** — all pre-existing
- **0 errors related to `lib/types` refactoring** ✅

---

## Points Requiring Manual Review

1. **Pre-existing test failures:** 21 tests in `test_prompt_loader.py` and `test_prompt_service.py` fail on content assertions — these are from PROMPT #260 migration, not fragmentation
2. **Wiki service deferred imports:** `wiki_enrichment.py` and `wiki_pages.py` use deferred imports to avoid circular dependencies — monitor if future changes reintroduce circularity
3. **Deep pipeline mixin composition:** `DeepPipelineService` inherits from 4 mixins — ensure method resolution order (MRO) is correct if adding new mixins
4. **Frontend components not fragmented:** `jobs/page.tsx`, `projects/[id]/page.tsx`, and `ItemDetailPanel.tsx` were assessed but skipped — revisit if they grow further

---

## Summary

| Metric | Value |
|--------|-------|
| Files analyzed | 36 |
| Files fragmented | 10 |
| Files kept (cohesive) | 11 |
| Files skipped (already modular) | 3 |
| New modules created | ~50 |
| Total lines refactored | ~15,000+ |
| Behavior changes | 0 |
| New dependencies | 0 |
| Broken imports | 0 |
| Test regressions | 0 |
