# PROMPT #234 - Auditoria Profunda v2: Seguranca, State Machines, Error Handling, Real-Time
## Deep System Audit - Security, State Machines, Error Handling, WebSocket, YAML Migration

**Date:** 2026-02-20
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Bug Fix / Security / Refactor
**Impact:** 14 files modified, 672 lines of technical debt removed, 5 security/stability improvements

---

## Objective

Continuation of PROMPT #233 (which fixed ~30 bugs). A DEEPER analysis was conducted using 6 parallel exploration agents covering: End-to-End Flows, Error Handling, YAML Prompts, WebSocket/Real-Time, Security/Validation, and State Machines. ~80 new issues were found; the most critical were organized into 5 implementation batches.

---

## What Was Implemented

### Batch 1: Security (SEC-1, SEC-2)

**SEC-1: API Keys exposed in AIModelResponse**
- `backend/app/schemas/ai_model.py`: Added `field_validator('api_key')` to mask API keys in all GET responses (shows only last 4 chars: `***...xxxx`)
- `frontend/src/app/ai-models/page.tsx`: Updated edit form to not pre-fill masked api_key

**SEC-2: DELETE /prompts/ deletes ALL without project scope**
- `backend/app/api/routes/prompts.py`: Changed `project_id` from optional to `Query(...)` (required). DELETE now scoped to project.
- `frontend/src/lib/api/prompts.ts`: Updated `deleteAll(projectId)` to pass project_id
- `frontend/src/app/prompts/page.tsx`: Disabled global clear button (no project context available)

### Batch 2: State Machine Guards (SM-1, SM-2, SM-3)

**SM-1: Interview accepts messages after COMPLETED**
- `backend/app/api/routes/interviews/endpoints.py`: Added status guard before `add_message_to_interview()` - returns 409 if interview is completed/cancelled

**SM-2: Context lock without SELECT FOR UPDATE**
- `backend/app/services/context_generator/card_activator.py`: Added `.with_for_update()` to 4 project query locations to prevent race conditions on `context_locked` field

**SM-3: Jobs stuck RUNNING forever**
- `backend/app/services/job_manager.py`: Created `cleanup_stale_jobs(stale_minutes=10)` method that marks RUNNING/PENDING jobs older than threshold as FAILED
- `backend/app/api/routes/jobs.py`: Added `POST /jobs/cleanup-stale` endpoint

### Batch 3: Error Handling (EH-1, EH-2)

**EH-1: Bare except: silences critical errors (5 locations)**
- `backend/app/services/file_processor.py`: Changed 2 `except:` to `except OSError:` (lines 314, 413)
- `backend/app/services/context_generator/card_activator.py`: Changed `except:` to `except (json.JSONDecodeError, ValueError):` and `except (ValueError, SyntaxError):`
- `backend/app/api/routes/git_commits.py`: Changed `except:` to `except (ValueError, TypeError):`

**EH-2: Fire-and-forget asyncio.create_task without error handling**
- `backend/app/services/ai_orchestrator.py`: Created `_safe_broadcast()` wrapper that logs errors instead of silently dropping them
- Applied wrapper to all 3 `asyncio.create_task(broadcast_chain_event(...))` calls
- Note: `job_manager.py` already had a safe wrapper (`_broadcast_job_event`)

### Batch 4: Frontend Real-Time (RT-3)

**RT-3: useEffect without cleanup of async calls**
- `frontend/src/components/backlog/BacklogListView.tsx`: Added `let cancelled = false` pattern to main data loading useEffect, preventing setState after unmount
- `frontend/src/app/projects/[id]/page.tsx`: Added cancellation flag to enrichment polling useEffect

**RT-2 (Deferred):** WebSocket deduplication in Jobs page requires extending NotificationContext with event subscription API - too large for this batch.

### Batch 5: YAML Prompt Migration (YP-1)

**5 hardcoded system_prompts migrated to PromptLoader:**
- Epic activation (`context/activate_epic_full.yaml`) - ~170 lines removed
- Epic simple/fallback (`context/epic_specification_simple.yaml`) - ~15 lines replaced with render() call
- Story specification (`context/story_specification.yaml`) - ~170 lines removed
- Task specification (`context/task_specification.yaml`) - ~160 lines removed
- Subtask specification (`context/subtask_specification.yaml`) - ~95 lines removed

**Total: 672 lines of hardcoded prompts removed** from `card_activator.py`, now loaded from existing YAML files via PromptLoader.

---

## Files Modified

### Backend:
1. **backend/app/schemas/ai_model.py** - API key masking in response
2. **backend/app/api/routes/prompts.py** - Required project_id on DELETE
3. **backend/app/api/routes/interviews/endpoints.py** - Interview status guard
4. **backend/app/api/routes/jobs.py** - Stale jobs cleanup endpoint
5. **backend/app/api/routes/git_commits.py** - Fixed bare except
6. **backend/app/services/ai_orchestrator.py** - Safe broadcast wrapper
7. **backend/app/services/context_generator/card_activator.py** - FOR UPDATE locks, bare except fixes, YAML migration (-672 lines!)
8. **backend/app/services/file_processor.py** - Fixed bare excepts
9. **backend/app/services/job_manager.py** - Stale jobs cleanup method

### Frontend:
10. **frontend/src/app/ai-models/page.tsx** - Don't pre-fill masked api_key
11. **frontend/src/app/prompts/page.tsx** - Disabled global clear
12. **frontend/src/app/projects/[id]/page.tsx** - useEffect cleanup
13. **frontend/src/components/backlog/BacklogListView.tsx** - useEffect cleanup
14. **frontend/src/lib/api/prompts.ts** - deleteAll requires projectId

---

## Testing Results

```
Backend imports: OK
Frontend build: OK (22 pages)
card_activator.py syntax: OK
ai_orchestrator.py syntax: OK
```

---

## Issues Documented (Not Fixed - Tech Debt)

| # | Issue | Severity | Reason |
|---|-------|----------|--------|
| SEC-3 | Cross-project isolation | High | Requires RBAC |
| RT-1 | WebSocket without auth | High | Requires auth system |
| RT-2 | Duplicate WebSocket in Jobs page | Medium | Requires NotificationContext refactor |
| SM-dual | Dual state (status+workflow_state) | Medium | Requires state machine refactor |
| EH-partial | Partial batch commits | Medium | Requires savepoint pattern |
| EH-n1 | N+1 queries | Medium | Requires eager loading audit |
| YP-2 | 41 unused YAMLs | Low | Document, don't delete |

---

## Key Insights

1. **Security First**: API key exposure was the most critical find - full keys were returned in every GET response
2. **YAML Migration ROI**: Removing 672 lines of hardcoded prompts makes card_activator.py significantly more maintainable
3. **Safe Broadcast Pattern**: The `_safe_broadcast()` wrapper prevents silent WebSocket failures that could leave UI in stale state
4. **SELECT FOR UPDATE**: Essential for any field that acts as a mutex (like `context_locked`)

---

## Status: COMPLETE

**Key Achievements:**
- 5 security/stability improvements across 14 files
- 672 lines of hardcoded prompts migrated to YAML
- 5 bare `except:` blocks replaced with specific exception types
- Safe broadcast wrapper prevents silent WebSocket failures
- Interview state machine now properly guarded
- Stale jobs can be cleaned up via API

**Impact:**
- API keys no longer leak in responses
- DELETE operations require project scope
- Race conditions on context lock prevented
- Memory leaks from unmounted React components prevented
- card_activator.py reduced by ~25% in size
