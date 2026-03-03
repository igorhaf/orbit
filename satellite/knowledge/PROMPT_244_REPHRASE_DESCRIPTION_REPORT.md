# PROMPT #244 — Reformular Descrição (Rephrase)

## Objective

Add a "Reformular" button alongside the existing "Detalhar" (expand) and "Resumir" (summarize) buttons for project descriptions. The rephrase action rewrites the description with different wording while keeping approximately the same length and meaning.

## What Was Implemented

### 1. YAML Prompt (`backend/app/prompts/projects/rephrase_description.yaml`)
- New prompt template for rephrasing descriptions
- Instructs AI to maintain same size, structure, and meaning
- Supports pinned fragments (preserved literally, per PROMPT #243)

### 2. Backend Endpoint (`backend/app/api/routes/projects.py`)
- `POST /api/v1/projects/rephrase-description`
- Accepts `{ title, current_description, project_id, pinned_fragments }`
- Uses PriorityJobExecutor with NORMAL priority (same pattern as expand/summarize)
- max_tokens: 800

### 3. Backend Service (`backend/app/services/project_service.py`)
- Added "rephrase" to the `prompt_map` in `_process_description_async`

### 4. Frontend — State & Handler (`frontend/src/app/projects/[id]/page.tsx`)
- New state: `rephrasingDescription`
- New handler: `handleRephraseDescription`
- Integrated into job polling callbacks (onComplete, onError)
- Integrated into error catch in `startDescriptionJob`

### 5. Frontend — Button (`frontend/src/app/projects/[id]/OverviewTab.tsx`)
- New props: `rephrasingDescription`, `onRephraseDescription`
- New button with refresh/cycle icon (indigo hover color)
- Positioned after summarize button, before persist button
- All 3 buttons mutually disable each other during loading

## Files Modified/Created

| File | Action |
|------|--------|
| `backend/app/prompts/projects/rephrase_description.yaml` | Created |
| `backend/app/api/routes/projects.py` | Added endpoint |
| `backend/app/services/project_service.py` | Added to prompt_map |
| `frontend/src/app/projects/[id]/page.tsx` | State + handler + props |
| `frontend/src/app/projects/[id]/OverviewTab.tsx` | Props + button UI |

## Button Layout (left to right)

| Icon | Color | Action | Tooltip |
|------|-------|--------|---------|
| Expand arrows | Green | Detalhar | "Detalhar descrição (expandir com mais informações)" |
| Compress arrows | Orange | Resumir | "Resumir descrição (condensar texto)" |
| Refresh cycle | Indigo | Reformular | "Reformular descrição (reescrever com outras palavras)" |

## Status

COMPLETE
