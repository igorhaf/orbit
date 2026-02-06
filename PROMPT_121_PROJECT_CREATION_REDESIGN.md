# PROMPT #121 - Project Creation Flow Redesign
## Simplified Pipeline: Scan + Rich Context + Title Generation

**Date:** February 6, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation / Refactor
**Impact:** Major UX improvement - simplified project creation from 4-step wizard to single-click pipeline

---

## Objective

Redesign the project creation flow to remove the multi-step wizard and replace it with a streamlined pipeline:
1. User selects a code folder and scan depth
2. Clicks "Generate Project" - single button
3. Pipeline runs in background: scan codebase -> generate rich context -> set title -> activate
4. Progress bars show real-time pipeline stages
5. Project card is grayed out while processing
6. When complete, project is ready with "Generate Epics" and "Interview" buttons

**Key Requirements:**
1. Remove the 4-step wizard (basic info, interview, review, confirm)
2. Keep the FolderPicker and scan depth selector (preserved as-is)
3. Single "Generate" button triggers full pipeline
4. Loading page with progress bars for each pipeline stage
5. Project cards disabled/grayed while processing
6. "Generate Epics" button on project detail page
7. "Interview" button for context interview (locked after first epic)
8. All jobs visible in Jobs page, prompts logged

---

## What Was Implemented

### 1. Backend: Processing Status + Pipeline Job Type
- Added `processing` to `ProjectStatus` enum in `project.py`
- Added `PROJECT_PIPELINE` to `JobType` enum in `async_job.py` with HIGH priority
- Created Alembic migration `20260206_add_processing_status.py`

### 2. Backend: Rich Context Generation Service
- Created 4 specialized YAML prompt files for chunked AI context generation:
  - `rich_context_architecture.yaml` - Architecture & stack analysis
  - `rich_context_business_domain.yaml` - Business domain & rules analysis
  - `rich_context_features.yaml` - Feature landscape mapping
  - `rich_context_consolidation.yaml` - Consolidation into semantic + human context
- Added `generate_rich_context_from_memory()` method to `ContextGenerator`
- Makes 3 focused AI calls + 1 consolidation call
- Stores results in project model and RAG service
- Supports progress callbacks for real-time UI updates

### 3. Backend: Pipeline Endpoint
- New `POST /create-and-process` endpoint in `projects.py`
- Creates project with `status=processing`
- Launches `_process_project_pipeline()` background function via PriorityJobExecutor
- Pipeline stages: scan (0-40%), rich context (40-85%), title (85-95%), finalize (95-100%)
- On success: sets `status=active`; on failure: reverts to `status=draft`

### 4. Frontend: Simplified /projects/new Page
- Removed 4-step wizard (basic info, interview, review, confirm)
- Single page with: FolderPicker, scan depth selector, "Generate Project" button
- Pipeline progress view with overall progress bar + 4 stage indicators
- Each stage shows: pending (gray), active (blue with spinner + progress bar), completed (green with checkmark)
- User can navigate away; processing continues in background with notification

### 5. Frontend: Processing Project Cards
- Project cards show "Processing" badge with spinner when `status === 'processing'`
- Cards are grayed out with `opacity-60 pointer-events-none` while processing
- Card body shows loading spinner with "Analyzing codebase..." text

### 6. Frontend: Project Detail Page Buttons
- Added "Generate Epics" button (visible when project has memory context)
- Added "Interview" button (visible when context is not locked)
- Removed redirect to wizard for projects without context
- Added "Processing" banner for projects currently being processed
- Updated "No Context" banner text for new flow

### 7. Frontend: API Methods
- Added `createAndProcess()` to `projectsApi`
- Added `generateCards()` to `projectsApi`
- Updated `Project` type with `processing` status and `initial_memory_context` field

---

## Files Modified/Created

### Created:
1. **backend/app/prompts/context/rich_context_architecture.yaml** - Architecture analysis prompt
2. **backend/app/prompts/context/rich_context_business_domain.yaml** - Business domain prompt
3. **backend/app/prompts/context/rich_context_features.yaml** - Features mapping prompt
4. **backend/app/prompts/context/rich_context_consolidation.yaml** - Consolidation prompt
5. **backend/alembic/versions/20260206_add_processing_status.py** - Migration

### Modified:
1. **backend/app/models/project.py** - Added `processing` to ProjectStatus enum
2. **backend/app/models/async_job.py** - Added `PROJECT_PIPELINE` to JobType + priority mapping
3. **backend/app/services/context_generator.py** - Added `generate_rich_context_from_memory()` method
4. **backend/app/api/routes/projects.py** - Added `create-and-process` endpoint + pipeline background function
5. **frontend/src/app/projects/new/page.tsx** - Complete rewrite: wizard -> simplified pipeline page
6. **frontend/src/app/projects/page.tsx** - Processing status badge + grayed out cards
7. **frontend/src/app/projects/[id]/page.tsx** - Generate Epics + Interview buttons, processing banner
8. **frontend/src/lib/api.ts** - Added createAndProcess, generateCards methods
9. **frontend/src/lib/types.ts** - Updated Project interface

---

## Testing Results

```
Backend model imports: OK (ProjectStatus, JobType.PROJECT_PIPELINE verified)
Migration: OK (ran successfully in Docker)
TypeScript: OK (only pre-existing errors remain, no new errors introduced)
```

---

## Success Metrics

- Wizard removed: 4-step wizard replaced with single-page form
- Pipeline progress: Real-time progress bars with 4 stages
- Processing cards: Grayed out with spinner while pipeline runs
- Generate Epics: Button available on project detail page
- Interview: Button available when context not locked
- Background processing: User can navigate away, notified on completion

---

## Status: COMPLETE

**Key Achievements:**
- Simplified project creation from 4 steps to 1 click
- Rich context generation via 4 chunked AI prompts
- Real-time pipeline progress visualization
- Processing state properly reflected in UI

**Impact:**
- Faster project onboarding
- Richer AI-generated context from memory scan
- Cleaner separation of concerns (project creation vs. interview)
