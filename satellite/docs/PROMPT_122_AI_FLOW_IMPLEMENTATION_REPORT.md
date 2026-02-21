# PROMPT #122 - AI Flow: Visual Fallback Chain Configuration
## n8n-style Flow Editor for AI Model Fallback Chains

**Date:** February 7, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Users can now visually configure per-operation AI model fallback chains, improving resilience and control over AI execution

---

## 🎯 Objective

Implement a visual flow editor page (AI Flow) that allows users to configure AI model fallback chains per operation (usage_type). Each chain defines an ordered sequence of AI models to try: if the first model fails, the system falls back to the next, and so on — similar to an n8n-style workflow diagram.

**Key Requirements:**
1. Visual n8n-style flow diagram using @xyflow/react
2. Per-operation (usage_type) fallback chain configuration
3. Full CRUD backend API for chain management
4. Integration with AI Orchestrator for chain-based execution
5. Uses existing AI Models as drag-and-drop components

---

## 🔍 Pattern Analysis

### Existing Patterns Identified

- **AI Models page** (`/ai-models`): Provider color coding (Anthropic=purple, OpenAI=green, Google=blue, Ollama=orange, Cohere=rose)
- **Sidebar navigation**: Icon + name entries with `pathname.startsWith()` active detection
- **API patterns**: FastAPI router with Pydantic schemas, SQLAlchemy models, Alembic migrations
- **Orchestrator**: Existing 2-level fallback (specific model → GENERAL → error), extended to N-level chain

---

## ✅ What Was Implemented

### 1. Backend Model — AIFlowChain
- SQLAlchemy model with UUID primary key
- `usage_type` (unique constraint — one chain per operation)
- `chain` (JSON array of AI Model UUIDs in fallback order)
- `is_active`, `created_at`, `updated_at`

### 2. Alembic Migration
- Creates `ai_flow_chains` table
- Reuses existing `ai_model_usage_type` PostgreSQL enum (no duplicate creation)
- Uses `postgresql.ENUM(..., create_type=False)` for proper enum reuse

### 3. Pydantic Schemas
- `AIFlowChainBase`: chain + is_active
- `AIFlowChainCreate`: adds usage_type for direct creation
- `AIFlowChainResponse`: full model with id + timestamps
- `AIFlowChainWithModels`: enriched with resolved model details
- `AIFlowChainModelInfo`: individual model info for frontend display

### 4. API Router (4 endpoints)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/ai-flow/chains` | GET | List all chains with resolved model details |
| `/api/v1/ai-flow/chains/{usage_type}` | GET | Get chain for specific operation |
| `/api/v1/ai-flow/chains/{usage_type}` | PUT | Upsert chain (create or update) |
| `/api/v1/ai-flow/chains/{usage_type}` | DELETE | Delete chain |

### 5. AI Orchestrator Integration
- `_get_chain_models(usage_type)`: Queries chain, resolves model configs
- Modified `choose_model()`: Checks chain BEFORE existing logic
- `execute_with_chain()`: Iterates chain models on failure, returns chain metadata
- `_execute_with_config()`: Executes with specific model, dispatches to correct provider

### 6. Frontend Page — /ai-flow
- **ReactFlow diagram** with custom ModelNode components
- **Provider-colored nodes** (purple/green/blue/orange/rose left borders)
- **Start → Model → Model → ... → Error** flow visualization
- **Primary/Fallback edge labels** (blue for primary, amber for fallback)
- **Dropdown selector** for switching between operations
- **Edit mode** with right sidebar listing available AI Models
- **Chain ordering** (move up/down/remove) in edit mode
- **All-chains overview grid** showing configured operations
- **Empty state** with "Configure Flow" button

### 7. Sidebar Navigation
- Added "AI Flow" entry with lightning bolt icon
- Positioned between "AI Models" and "Specs"

---

## 📁 Files Modified/Created

### Created:
1. **backend/app/models/ai_flow_chain.py** — SQLAlchemy model (50 lines)
2. **backend/app/schemas/ai_flow_chain.py** — Pydantic schemas (55 lines)
3. **backend/app/api/routes/ai_flow.py** — API router with 4 endpoints (143 lines)
4. **backend/alembic/versions/20260207_create_ai_flow_chains.py** — Migration (46 lines)
5. **frontend/src/app/ai-flow/page.tsx** — ReactFlow page (~550 lines)

### Modified:
1. **backend/app/models/__init__.py** — Import AIFlowChain + add to __all__
2. **backend/app/main.py** — Register ai_flow router
3. **backend/app/services/ai_orchestrator.py** — Chain-based fallback logic (~120 lines added)
4. **frontend/src/lib/types.ts** — AIFlowChain + AIFlowChainModel interfaces
5. **frontend/src/lib/api.ts** — aiFlowApi client methods
6. **frontend/src/components/layout/Sidebar.tsx** — AI Flow nav entry
7. **frontend/package.json** — @xyflow/react dependency

---

## 🧪 Testing Results

### Verification:

```bash
✅ Alembic migration runs successfully (ai_flow_chains table created)
✅ Table structure verified (id, usage_type, chain, is_active, created_at, updated_at)
✅ GET /api/v1/ai-flow/chains returns empty list
✅ PUT /api/v1/ai-flow/chains/interview creates chain with 3 models
✅ GET /api/v1/ai-flow/chains returns chain with resolved model details
✅ DELETE /api/v1/ai-flow/chains/interview removes chain (204)
✅ TypeScript compilation clean (no new errors in ai-flow files)
✅ Frontend page renders with ReactFlow diagram
```

---

## 🎯 Success Metrics

✅ **Visual Flow Editor:** n8n-style diagram with custom provider-colored nodes
✅ **Per-Operation Chains:** Each usage_type can have its own fallback sequence
✅ **Orchestrator Integration:** Chain-based fallback executes models in sequence on failure
✅ **Full CRUD API:** List, get, upsert, delete chains with model resolution
✅ **Edit Mode:** Add/remove/reorder models in the chain via sidebar

---

## 💡 Key Insights

### 1. PostgreSQL ENUM Reuse in Alembic
The `sa.Enum(..., create_type=False)` inside `op.create_table()` doesn't reliably prevent enum creation. Using `postgresql.ENUM(..., create_type=False)` from `sqlalchemy.dialects.postgresql` is the correct approach for reusing existing enum types.

### 2. Chain-Based Execution Strategy
The orchestrator's `execute_with_chain()` method wraps the existing provider executors, trying each model in sequence. This additive approach doesn't break existing `execute()` calls — services that don't use chains continue working as before.

### 3. ReactFlow v12+ API
@xyflow/react (v12) uses `useNodesState` and `useEdgesState` hooks with explicit type parameters. Custom nodes use `Handle` components for input/output connection points.

---

## 🎉 Status: COMPLETE

Implemented the AI Flow visual fallback chain editor, providing users with full control over per-operation AI model execution order.

**Key Achievements:**
- ✅ Visual n8n-style flow diagram with @xyflow/react
- ✅ Per-operation fallback chain configuration (7 usage types)
- ✅ Backend CRUD API with model resolution
- ✅ AI Orchestrator chain-based fallback execution
- ✅ Edit mode with model sidebar and chain ordering
- ✅ Provider-colored nodes matching AI Models page theme

**Impact:**
- Users can configure custom fallback chains per operation (e.g., "For interviews: try Gemini → Claude → Ollama")
- System resilience improved: if primary model fails, automatic fallback to alternatives
- Visual representation makes chain configuration intuitive and transparent

---
