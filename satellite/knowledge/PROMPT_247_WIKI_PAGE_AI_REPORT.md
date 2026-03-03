# PROMPT #247 — Wiki Page AI Operations (Generate/Expand/Summarize/Rephrase)

## Objective

Add per-page AI operations to wiki pages (generate, expand, summarize, rephrase) following the same pattern as project description AI actions in OverviewTab. Also redesign WikiPanel UI for consistency with the rest of the app.

## What Was Implemented

### Backend

1. **New JobType**: Added `WIKI_PAGE_AI` to `JobType` enum in `async_job.py` with NORMAL priority
2. **4 YAML Prompts**: Created in `backend/app/prompts/wiki/`:
   - `generate_page_content.yaml` — generates content for empty/new pages
   - `expand_page_content.yaml` — expands existing content with more details
   - `summarize_page_content.yaml` — condenses content keeping essentials
   - `rephrase_page_content.yaml` — rewrites with different words, same meaning
3. **Async Worker**: `_process_wiki_page_ai_async()` in `wiki_service.py` — follows same pattern as `_process_description_async` in `project_service.py`
4. **4 New Endpoints** in `wiki.py`:
   - `POST /{project_id}/wiki/{slug}/generate-content`
   - `POST /{project_id}/wiki/{slug}/expand-content`
   - `POST /{project_id}/wiki/{slug}/summarize-content`
   - `POST /{project_id}/wiki/{slug}/rephrase-content`
5. **DB Migration**: Added `wiki_page_ai` to PostgreSQL `jobtype` enum

### Frontend

1. **API Client**: Added 4 new methods to `wikiApi` in `frontend/src/lib/api/wiki.ts`
2. **WikiPanel Redesign** (`WikiPanel.tsx`):
   - Sidebar uses `<Card>` instead of raw borders
   - Create/Delete modals use `<Dialog>` from UI library
   - Delete button uses `<Button variant="ghost">`
   - Markdown rendering uses `prose prose-sm` (removed 10 custom component overrides)
   - AI action buttons in page header (expand/summarize/rephrase/generate)
   - Job polling via `useJobPolling` hook
   - Progress indicator during AI operations

## Files Created

- `backend/app/prompts/wiki/generate_page_content.yaml`
- `backend/app/prompts/wiki/expand_page_content.yaml`
- `backend/app/prompts/wiki/summarize_page_content.yaml`
- `backend/app/prompts/wiki/rephrase_page_content.yaml`
- `satellite/knowledge/PROMPT_247_WIKI_PAGE_AI_REPORT.md`

## Files Modified

- `backend/app/models/async_job.py` — new WIKI_PAGE_AI enum + priority
- `backend/app/services/wiki_service.py` — new `_process_wiki_page_ai_async` worker
- `backend/app/api/routes/wiki.py` — 4 new endpoints + imports
- `frontend/src/lib/api/wiki.ts` — 4 new API methods
- `frontend/src/components/wiki/WikiPanel.tsx` — complete UI redesign + AI buttons

## Testing Results

### Backend API Tests (all passed)
| Action | Status | Content Length | Notes |
|--------|--------|---------------|-------|
| Expand | Completed | Large (expanded) | Contextualized with project Meada |
| Summarize | Completed | 245 chars | Condensed correctly |
| Generate | Completed | 3723 chars | Generated from scratch with project context |
| Rephrase | Completed | 2799 chars | Reformulated Visao Geral page |

### Selenium Tests
- `test_06_knowledge_wiki.py`: **11/11 passed** (15.35s)

### Frontend
- Zero TypeScript errors in wiki files
- Frontend compiles and loads correctly

## Safeguards

- Empty AI responses are NOT saved (REGRA #0 compliance)
- Content is contextualized with project name, description, and existing wiki page titles
- Uses AIOrchestrator for multi-provider compatibility
- All prompts externalized to YAML (PROMPT #103 compliance)

## Status

**COMPLETED** — All 4 AI operations working, UI redesigned, tests passing.
