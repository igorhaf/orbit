# PROMPT #228 - Parallelism Field on AI Models
## Max Concurrent Requests per Model

**Date:** 2026-02-12
**Status:** COMPLETED
**Priority:** MEDIUM
**Type:** Feature Implementation
**Impact:** Users can now define a maximum number of parallel API calls per AI model, preventing overload on rate-limited providers (especially local models like Ollama). The field is configurable globally in `/ai-models` and overridable per-flow position in `/ai-flow`.

---

## Objective

Add a `max_concurrent_requests` field to AI models that controls how many API calls can run in parallel for each model. When set, the backend uses an `asyncio.Semaphore` to enforce the limit. NULL means unlimited (no concurrency restriction).

**Key Requirements:**
1. New nullable Integer column on `ai_models` table
2. Backend enforcement via asyncio.Semaphore in AIOrchestrator
3. Configurable in AI Models page (`/ai-models`)
4. Visible and overridable in AI Flow diagram (`/ai-flow`)
5. Follows same pattern as `rate_limit_requests` and `timeout_seconds`

---

## What Was Implemented

### 1. Alembic Migration
New migration `20260212_add_max_concurrent_requests.py` adds `max_concurrent_requests` Integer column (nullable=True) to `ai_models` table. NULL = unlimited.

### 2. SQLAlchemy Model
Added `max_concurrent_requests = Column(Integer, nullable=True)` to `AIModel` in `backend/app/models/ai_model.py`.

### 3. Pydantic Schemas
- `AIModelBase`: `max_concurrent_requests: Optional[int] = Field(None, ...)`
- `AIModelUpdate`: `max_concurrent_requests: Optional[int] = None`
- Inherited automatically by `AIModelCreate`, `AIModelResponse`, `AIModelDetailResponse`

### 4. Backend Semaphore Enforcement
Module-level semaphore pool in `ai_orchestrator.py`:
- `_model_semaphores: Dict[str, asyncio.Semaphore]` stores per-model semaphores
- `_get_model_semaphore()` creates/reuses semaphores, recreates if limit changed
- `execute()`: acquires semaphore before API call, releases in `finally` block
- `execute_with_chain()`: same pattern for chain fallback execution
- `max_concurrent_requests` propagated through `_get_chain_models()`, `choose_model()`, `choose_model_for_task()`

### 5. Frontend - AI Models Page
- Create dialog: Input field for Max Concurrent Requests (number, min=1, placeholder="Unlimited")
- Edit dialog: Same field with current value
- Model card: Shows concurrency value (e.g., "2x") when set

### 6. Frontend - AI Flow Page
- `ModelOverrides` interface: Added `max_concurrent_requests?: number | null`
- `EditModelNodeDialog`: New Input field for per-flow concurrency override
- Global settings read-only section: Shows "Concurrency: 2x" or "Unlimited"
- `hasOverrides` check: Includes `max_concurrent_requests` for badge display
- Purple "Overrides" badge appears when any per-flow override is active

### 7. Frontend Types
Added `max_concurrent_requests?: number | null` to: `AIModel`, `AIModelCreate`, `AIModelUpdate`, `AIFlowChainModel` in `frontend/src/lib/types.ts`.

---

## Files Modified/Created

### Created:
1. **[backend/alembic/versions/20260212_add_max_concurrent_requests.py](backend/alembic/versions/20260212_add_max_concurrent_requests.py)** - Alembic migration

### Modified:
1. **[backend/app/models/ai_model.py](backend/app/models/ai_model.py)** - Added column
2. **[backend/app/schemas/ai_model.py](backend/app/schemas/ai_model.py)** - Added to schemas
3. **[backend/app/services/ai_orchestrator.py](backend/app/services/ai_orchestrator.py)** - Semaphore enforcement
4. **[frontend/src/lib/types.ts](frontend/src/lib/types.ts)** - TypeScript types
5. **[frontend/src/app/ai-models/page.tsx](frontend/src/app/ai-models/page.tsx)** - Form field + card display
6. **[frontend/src/app/ai-flow/page.tsx](frontend/src/app/ai-flow/page.tsx)** - Override dialog + ModelNode

---

## Verification

```
Alembic migration: Applied successfully
TypeScript compilation: Compiled successfully
No new errors introduced
Docker containers running
```

---

## Status: COMPLETE

**Key Achievements:**
- Concurrency control per AI model via asyncio.Semaphore
- Configurable globally in /ai-models and per-flow in /ai-flow
- NULL = unlimited (no restriction), consistent with rate_limit and timeout patterns
- Override badge shows when per-flow concurrency is customized
- No breaking changes to existing functionality
