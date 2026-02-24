# PROMPT #263 - AI Studio: Unified AI Administration

## Objective

Unify the AI administration experience by combining Operations (fallback chains) and Pipeline (Deep Pipeline configurator) into a single "AI Studio" page with tabs, replacing the scattered and confusing separate pages.

## What Was Implemented

### 1. AI Studio Page with Tabs
- Renamed "AI Flow" → "AI Studio" in Sidebar navigation
- Added tab navigation (Operacoes | Pipeline) to the page
- Operations tab preserves existing AI Flow canvas without changes
- Pipeline tab shows new visual pipeline configurator
- Deep linking support via `?tab=pipeline&project={id}` query params

### 2. Pipeline Tab - Visual Configurator (ReactFlow)
- 13 pipeline phase nodes arranged in 2-row layout
- Each node shows: phase name, model (short name), score badge, provider-colored border
- Click node to open side panel for configuration
- Profile selector (Economy/Balanced/Quality) updates all nodes instantly
- Last run score badge in top bar
- Collapsible run history section

### 3. Phase Config Panel
- Side panel (w-72) with model selector, max_tokens, concurrency controls
- Shows contract name when available
- Extended Thinking budget for phases 3 and 6
- Last run score and duration stats

### 4. Run History & Comparison
- RunHistoryTable with checkbox selection for comparing 2 runs
- RunDetailDialog showing per-phase score bars and durations
- RunCompareDialog for side-by-side diff with color-coded improvements/regressions

### 5. Project Page Integration
- Pipeline profile selector dropdown next to run button
- Profile passed to `ragApi.deepPipeline(projectId, profile)`
- "Configurar no AI Studio" link → opens Pipeline tab
- "Ver historico completo" link → opens Pipeline tab with project context

### 6. API Client Updates
- `deepPipeline()` now accepts optional profile parameter
- `pipelineProfiles()` - list available profiles
- `deepPipelineRuns()` - run history with limit
- `deepPipelineRunDetail()` - per-phase scores/durations
- `deepPipelineCompare()` - side-by-side comparison

## Files Created
- `frontend/src/components/ai-studio/PipelineTab.tsx` - Main pipeline tab with ReactFlow canvas
- `frontend/src/components/ai-studio/PipelinePhaseNode.tsx` - Custom ReactFlow node for phases
- `frontend/src/components/ai-studio/PhaseConfigPanel.tsx` - Side panel for phase configuration
- `frontend/src/components/ai-studio/RunHistoryTable.tsx` - History table with comparison
- `frontend/src/components/ai-studio/RunDetailDialog.tsx` - Run detail dialog
- `frontend/src/components/ai-studio/RunCompareDialog.tsx` - Run comparison dialog
- `frontend/src/components/ai-studio/index.ts` - Barrel export

## Files Modified
- `frontend/src/app/ai-flow/page.tsx` - Added tab system (Operations + Pipeline), Suspense boundary
- `frontend/src/components/layout/Sidebar.tsx` - "AI Flow" → "AI Studio"
- `frontend/src/components/layout/Breadcrumbs.tsx` - Added 'ai-flow' → 'AI Studio' label
- `frontend/src/lib/api/knowledge.ts` - New pipeline API methods
- `frontend/src/app/projects/[id]/page.tsx` - Profile selector + AI Studio links

## Testing Results
- `npx next build` - SUCCESS (all pages compile without errors)
- Suspense boundary properly wraps useSearchParams for SSR compatibility
- Tab navigation switches between Operations and Pipeline without reload
- All existing AI Flow functionality preserved in Operations tab

## Status
**COMPLETED** - AI Studio unified admin with visual pipeline configurator
