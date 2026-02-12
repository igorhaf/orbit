# PROMPT #226 - Double-Click Edit Dialog for AI Flow Nodes
## Per-Flow Model Overrides via Double-Click

**Date:** 2026-02-12
**Status:** COMPLETED
**Priority:** MEDIUM
**Type:** Feature Implementation
**Impact:** Users can now double-click any node (utility or model) in the AI Flow diagram to edit its per-flow configuration. Model nodes support temperature, max_tokens, and timeout overrides that are specific to that flow position.

---

## Objective

Fix the double-click edit functionality on AI Flow diagram nodes. The `handleNodeDoubleClick` handler only searched utility nodes, completely ignoring model nodes. Users need to be able to double-click any element in the flow to edit its per-flow configuration, treating each element as a unique object that can override default settings.

**Key Requirements:**
1. Double-click on utility nodes opens EditUtilityNodeDialog (was broken - handler existed but wasn't finding nodes)
2. Double-click on model nodes opens a new EditModelNodeDialog with per-flow overrides
3. Model overrides (temperature, max_tokens, timeout) are persisted alongside node positions
4. Visual indicator on model nodes when per-flow overrides are active

---

## What Was Implemented

### 1. ModelOverrides Interface
New TypeScript interface for per-flow model overrides:
```typescript
interface ModelOverrides {
  temperature?: number | null;
  max_tokens?: number | null;
  timeout_seconds?: number | null;
}
```

### 2. EditModelNodeDialog Component
New dialog component (~110 lines) featuring:
- Provider icon and model name header
- Info banner explaining per-flow override concept
- Three override fields: Temperature, Max Tokens, Timeout (seconds)
- Placeholders showing global model defaults
- Read-only section showing current global settings
- Save/Cancel footer

### 3. Updated handleNodeDoubleClick
Handler now checks both utility nodes AND model nodes:
- First searches `workingUtilityNodes` by node ID
- If not found, checks if node ID starts with `model-` and searches `workingChainModels`
- Opens the appropriate dialog for each type

### 4. State Management
- `editingModel` state: tracks which model is being edited
- `modelOverrides` state: `Record<string, ModelOverrides>` storing all per-flow overrides
- `handleSaveModelOverride` callback: saves or removes overrides (removes when all values null)

### 5. Persistence via node_positions
Overrides are stored in the existing `node_positions` JSON field under a `__model_overrides` key:
- On save: merges `{ __model_overrides: modelOverrides }` into node positions
- On load: extracts `__model_overrides` from saved positions and sets state
- No backend schema change needed

### 6. Override Indicator Badge
Model nodes now show a purple "Overrides" badge next to the position label (Primary/Fallback) when per-flow overrides are active. The `hasOverrides` flag is computed in `buildFlowFromChain` and passed to the ModelNode component.

### 7. Unsaved Changes Detection
`hasUnsavedChanges` now includes comparison of model overrides (saved vs working), so the "Unsaved changes" indicator properly reflects override edits.

---

## Files Modified

### Modified:
1. **[frontend/src/app/ai-flow/page.tsx](frontend/src/app/ai-flow/page.tsx)** - All changes in single file
   - Added `ModelOverrides` interface (line ~1039)
   - Added `EditModelNodeDialog` component (~110 lines, line ~1045-1151)
   - Added `editingModel` and `modelOverrides` state (line ~1777-1778)
   - Updated `handleNodeDoubleClick` for both node types (line ~2037-2052)
   - Added `handleSaveModelOverride` callback (line ~2015-2026)
   - Updated save handler to persist overrides (line ~2091-2094)
   - Updated load handler to extract overrides (line ~1853-1854)
   - Updated `hasUnsavedChanges` to include overrides comparison (line ~2148-2150)
   - Passed `modelOverrides` to `buildFlowFromChain` call (line ~1958)
   - Added `modelOverrides` to useEffect dependency (line ~1962)
   - Added `hasOverrides` flag in `buildFlowFromChain` model node data (line ~1348)
   - Added override indicator badge in `ModelNode` component (line ~373-377)
   - Added `EditModelNodeDialog` render in JSX (line ~2483-2490)

---

## Verification

```
TypeScript compilation: Compiled successfully
No new ESLint errors introduced
Docker frontend container running on port 3000
```

---

## Status: COMPLETE

**Key Achievements:**
- Double-click on utility nodes now correctly opens edit dialog
- Double-click on model nodes opens new per-flow override dialog
- Temperature, max_tokens, and timeout can be overridden per flow position
- Overrides are persisted in existing JSON field (no migration needed)
- Visual "Overrides" badge shows when a model has per-flow customizations
- Unsaved changes indicator includes override modifications
