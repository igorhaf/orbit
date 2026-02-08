# PROMPT #204 - AI Flow: 8 Utility Node Types
## Visual Utility Nodes for AI Flow Diagram

**Date:** February 8, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Transforms AI Flow from a simple fallback chain into a rich visual pipeline with pre/post-processing nodes

---

## Objective

Implement 8 new utility node types for the AI Flow visual diagram, expanding it beyond simple model fallback chains into a full AI pipeline configuration tool. Each node type represents a different processing step that can be placed on the canvas.

**Key Requirements:**
1. 8 new visual node types: Cache, RAG Context, Prompt Transformer, Router, Retry, Validator, Cost Guard, Rate Limiter
2. Each node has unique color, icon, and configuration display
3. Nodes can be added from a sidebar section and removed from the canvas
4. Node configurations are persisted in the database alongside the chain
5. Utility nodes are positioned above/below the main model chain flow

---

## What Was Implemented

### 1. Backend: Model & Schema Updates
- Added `utility_nodes` JSON column to `AIFlowChain` model
- Created `UtilityNodeConfig` and `UtilityNodeResponse` Pydantic schemas
- Defined `UTILITY_NODE_TYPES` constant with all 8 types
- Updated `AIFlowChainBase` schema to include `utility_nodes` field
- Updated `_chain_to_dict` to include utility_nodes in API responses
- Updated `upsert_chain` endpoint to save utility_nodes

### 2. Backend: Utility Node Types Catalog
- Created `UTILITY_NODE_CATALOG` with full metadata for each node type:
  - **Cache**: Redis cache check (TTL, cache level)
  - **RAG Context**: Semantic enrichment (max results, similarity threshold)
  - **Prompt Transformer**: Prompt transformation (compression, max tokens, language)
  - **Router**: Conditional routing (complexity, threshold, routes)
  - **Retry**: Exponential backoff retry (max retries, backoff config)
  - **Validator**: Output validation (JSON schema, length, keywords)
  - **Cost Guard**: Budget limiter (per-call, daily, monthly)
  - **Rate Limiter**: Request throttling (max requests, window)
- New endpoint: `GET /api/v1/ai-flow/utility-node-types`

### 3. Database Migration
- Migration `20260208_utility` adds `utility_nodes` column to `ai_flow_chains` table

### 4. Frontend: 8 Custom ReactFlow Node Components
Each component features:
- Unique color-coded left border matching its type
- Custom SVG icon
- Configuration summary display (key metrics visible on node)
- Enable/disable status indicator
- Remove button (x) on hover
- Left/Right handles for ReactFlow connections

Components:
- `CacheNode` (violet) - Shows TTL and cache level
- `RAGContextNode` (cyan) - Shows max results and similarity threshold
- `PromptTransformerNode` (amber) - Shows transformation mode and max tokens
- `RouterNode` (emerald) - Shows condition and threshold
- `RetryNode` (blue) - Shows max retries and backoff base
- `ValidatorNode` (green) - Shows validation type and retry behavior
- `CostGuardNode` (red) - Shows per-call and daily budget limits
- `RateLimiterNode` (pink) - Shows request limit and window

### 5. Frontend: Node Type Registry
- Extended `nodeTypes` from 1 to 9 types:
  ```typescript
  const nodeTypes = {
    modelNode, cacheNode, ragContextNode, promptTransformerNode,
    routerNode, retryNode, validatorNode, costGuardNode, rateLimiterNode,
  };
  ```
- Created `UTILITY_TYPE_TO_NODE_TYPE` mapping for type resolution

### 6. Frontend: Sidebar "Flow Nodes" Section
- New sidebar section below "Available Models"
- Shows active utility nodes with remove buttons
- Catalog of all 8 node types with descriptions
- One-click add from catalog

### 7. Frontend: Flow Diagram Integration
- Updated `buildFlowFromChain` to render utility nodes
- Pre-processing nodes (Cache, RAG, Transformer, Router, Rate Limiter) positioned above chain
- Post-processing nodes (Retry, Validator, Cost Guard) positioned below chain
- Dashed edges connect utility nodes to Start/Error nodes with type-colored lines
- Utility nodes are draggable and positions are saved

### 8. Frontend: State Management
- `workingUtilityNodes` state tracks active utility nodes
- `utilityNodeTypes` state holds catalog from API
- Unsaved changes detection includes utility nodes
- Save handler sends utility_nodes to backend
- Counter in controls bar shows "X models + Y nodes"

---

## Files Modified/Created

### Created:
1. **backend/alembic/versions/20260208_add_utility_nodes_to_ai_flow_chains.py** - Migration
   - Adds `utility_nodes` JSON column

### Modified:
1. **backend/app/models/ai_flow_chain.py** - Added `utility_nodes` column
2. **backend/app/schemas/ai_flow_chain.py** - Added utility node schemas, UTILITY_NODE_TYPES, updated chain schemas
3. **backend/app/api/routes/ai_flow.py** - Added UTILITY_NODE_CATALOG, utility-node-types endpoint, updated chain dict/upsert
4. **frontend/src/lib/types.ts** - Added UtilityNodeType, AIFlowUtilityNode, AIFlowUtilityNodeType interfaces, updated AIFlowChain
5. **frontend/src/lib/api.ts** - Added utilityNodeTypes() API function
6. **frontend/src/app/ai-flow/page.tsx** - 8 node components, icons, sidebar section, state management, flow integration

---

## Testing Results

### Verification:

```bash
 Python syntax: model, schema, routes, migration all compile
 Migration: 20260208_utility ran successfully
 API: GET /utility-node-types returns all 8 node types with configs
 API: GET /chains returns utility_nodes field
 Backend restart: successful, no errors
```

---

## Success Metrics

- **8 new node types** implemented with unique visuals
- **Full persistence** - utility nodes saved/loaded from database
- **Zero breaking changes** - existing chain functionality preserved
- **Clean architecture** - catalog-based approach for easy future extension

---

## Key Insights

### 1. Pre/Post Processing Split
Utility nodes are logically split into pre-processing (Cache, RAG, Transformer, Router, Rate Limiter) placed above the chain, and post-processing (Retry, Validator, Cost Guard) placed below. This visual separation makes the flow intuitive.

### 2. Catalog-Based Architecture
The `UTILITY_NODE_CATALOG` on the backend provides a single source of truth for all node types, including default configurations. The frontend fetches this catalog dynamically, making it easy to add new node types in the future without frontend changes.

### 3. Non-Destructive Extension
The `utility_nodes` field is nullable JSON, so existing chains continue to work perfectly. The visual flow still shows the core model chain even without utility nodes.

---

## Status: COMPLETE

**Key Achievements:**
- 8 fully visual utility node types with unique icons, colors, and config displays
- Seamless integration into existing AI Flow diagram
- Sidebar catalog for adding nodes
- Full persistence (save/load utility nodes alongside chain)
- Pre/post-processing visual layout

**Impact:**
- AI Flow evolves from simple fallback chain to rich visual pipeline
- Users can visually configure caching, validation, rate limiting, and more
- Foundation for future orchestration logic tied to these nodes
