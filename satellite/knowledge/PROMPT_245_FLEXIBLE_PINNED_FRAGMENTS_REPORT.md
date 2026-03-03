# PROMPT #245 — Pinned Fragments: Reformulação Flexível com Destaque Visual

## Objective

Allow AI operations (expand, summarize, rephrase) to slightly rephrase pinned fragments while maintaining the same meaning. Visually highlight any changed fragments so the user notices the differences.

## What Was Implemented

### 1. Updated YAML Prompts (3 files)

All three description operation prompts now allow the AI to make small wording changes to pinned fragments (instead of requiring exact literal preservation). If any fragment is changed, the AI outputs a `---FRAGMENT_MAP---` section at the end with ORIGINAL/NOVO pairs.

- `backend/app/prompts/projects/expand_description.yaml` → v4
- `backend/app/prompts/projects/summarize_description.yaml` → v4
- `backend/app/prompts/projects/rephrase_description.yaml` → v2

### 2. Backend Fragment Mapping Parser

**File:** `backend/app/services/project_service.py` — `_process_description_async()`

- Parses `---FRAGMENT_MAP---` / `---END_FRAGMENT_MAP---` section from AI response
- Extracts ORIGINAL/NOVO pairs via regex
- Updates `pinned_fragments` in the database with new versions
- Strips the FRAGMENT_MAP section from the description text
- Returns `changed_fragments` array in job result (each entry: `{from, to}`)

### 3. Frontend State Management

**File:** `frontend/src/app/projects/[id]/page.tsx`

- New state: `changedFragments: string[]` — holds texts of recently-changed fragments
- Job polling `onComplete` extracts `changed_fragments` from result
- Auto-clears after 8 seconds via `setTimeout`
- Passes `changedFragments` prop to OverviewTab

### 4. Visual Highlight in OverviewTab

**File:** `frontend/src/app/projects/[id]/OverviewTab.tsx`

- New prop: `changedFragments?: string[]`
- `pinnedSpan()` accepts `isChanged` flag
- Changed fragments render with: `ring-2 ring-amber-400 animate-pulse` (amber pulsating ring)
- Normal fragments: `bg-gray-900 text-white` (unchanged)
- Tooltip changes to "Trecho reformulado pela IA" for changed fragments
- `renderChildrenWithHighlights()` builds a `Set` of changed fragment texts for O(1) lookup

## Files Modified/Created

| File | Action |
|------|--------|
| `backend/app/prompts/projects/expand_description.yaml` | Updated v3→v4 |
| `backend/app/prompts/projects/summarize_description.yaml` | Updated v3→v4 |
| `backend/app/prompts/projects/rephrase_description.yaml` | Updated v1→v2 |
| `backend/app/services/project_service.py` | Added FRAGMENT_MAP parsing |
| `frontend/src/app/projects/[id]/page.tsx` | Added changedFragments state |
| `frontend/src/app/projects/[id]/OverviewTab.tsx` | Added visual highlight |

## Visual Behavior

1. User clicks Reformular/Detalhar/Resumir with pinned fragments present
2. AI may slightly rephrase some fragments
3. Description updates, pinned fragments update in DB
4. Changed fragments appear with **amber pulsating ring** for 8 seconds
5. After 8s, they return to normal black highlight style
6. If AI didn't change any fragments, behavior is unchanged

## Status

COMPLETE
