# PROMPT #189 - Clickable Processing Project Cards
## Show processing projects on projects page with click-to-details navigation

**Date:** February 7, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Enhancement / Bug Fix
**Impact:** Users can now see and interact with projects being generated, improving visibility into the creation pipeline

---

## Objective

Two issues were reported:
1. **Bug:** Project creation wizard completed the entire process but the projects page appeared empty
2. **Feature:** While a project is being built (scanning files, creating context, etc.), the project card should appear on the projects page with visual indicators showing it's still being generated. Clicking the card should navigate to the detailed progress page.

**Key Requirements:**
1. Processing project cards should be visually distinct (dashed border, hover effect)
2. Clicking a processing card navigates to the progress page with detailed pipeline stages
3. The progress page should support resuming from query params (projectId, jobId)
4. Fix TypeScript type mismatch with `jobsApi.list()` return type

---

## Investigation Results

### Root Cause Analysis

The backend `create-and-process` endpoint correctly creates the project with `status="processing"` and commits to the database immediately. The `list_projects` endpoint has NO status filter - it returns ALL projects.

The "empty page" issue was likely caused by:
- Pipeline failure reverting status to `draft` (the project appeared as a normal card without context)
- OR a TypeScript type mismatch in `jobsApi.list()` where code used `.data` but the API returns `{ jobs, total, limit, offset }` directly

### Key Finding
The processing card on the projects page had **NO click handler** - users couldn't navigate to see detailed progress when they navigated away from the creation wizard.

---

## What Was Implemented

### 1. Clickable Processing Cards (projects/page.tsx)
- Added `onClick` handler to Card component for processing projects
- Navigates to `/projects/new?projectId={id}&jobId={jobId}` on click
- Visual indicators: dashed blue border, cursor pointer, hover shadow effect
- Added "Click for details" hint text on processing cards

### 2. Pipeline Resume Support (projects/new/page.tsx)
- Added `useSearchParams` to read `projectId` and `jobId` query params
- New `useEffect` that:
  - Fetches project info via `projectsApi.get()`
  - If project is still processing: sets pipeline state and starts job polling
  - If project is no longer processing: redirects to project page
  - Falls back to finding the latest pipeline job if jobId not provided
- Wrapped component with `Suspense` boundary (required by Next.js for `useSearchParams`)
- Dynamic page title: "Processing Project" when in progress mode, "New Project" otherwise

### 3. TypeScript Fix
- Fixed `jobsApi.list()` return type usage in both files
- Changed `jobsRes.data || jobsRes` to `jobsRes.jobs || []` (correct property name)

---

## Files Modified

### Modified:
1. **frontend/src/app/projects/page.tsx** - Clickable processing cards
   - Added `onClick`, `className` props to Card for processing state
   - Dashed border, hover shadow, cursor pointer visual indicators
   - "Click for details" hint text
   - Fixed `jobsApi.list()` type usage (`.data` -> `.jobs`)

2. **frontend/src/app/projects/new/page.tsx** - Pipeline resume support
   - Added `useSearchParams`, `useEffect`, `Suspense` imports
   - Renamed component to `NewProjectContent`, wrapped in Suspense
   - Added resume logic via query params (`projectId`, `jobId`)
   - Dynamic page title based on processing state
   - Added `projectsApi`, `jobsApi` imports
   - Fixed `jobsApi.list()` type usage

### Created:
1. **PROMPT_189_IMPLEMENTATION_REPORT.md** - This report

---

## Testing Results

### Verification:

```bash
TypeScript compilation: No new errors in modified files
Processing card: Clickable with dashed border, blue hover effect
Navigation: /projects/new?projectId=X&jobId=Y resumes progress view
Job polling: Automatically picks up pipeline progress on resume
Redirect: If project already completed, redirects to project page
```

---

## Success Metrics

- **Processing cards are clickable:** Users can click to see detailed progress
- **Pipeline progress is resumable:** Navigating back shows current stage
- **Visual distinction:** Processing cards have dashed border and blue styling
- **TypeScript clean:** No new compilation errors

---

## Key Insights

### 1. Pipeline Visibility Gap
The original implementation assumed users would stay on the `/projects/new` page during processing. When they navigated away, the only feedback was the notification bell. Now the projects list itself serves as a progress dashboard.

### 2. Suspense Boundary Required
Next.js App Router requires `useSearchParams` to be wrapped in a Suspense boundary to support static rendering. The component was split into `NewProjectContent` (inner) and `NewProjectPage` (outer with Suspense).

### 3. Type Safety Fix
The `jobsApi.list()` API returns `{ jobs: JobResponse[], total, limit, offset }` but both the projects page and new project page were using `.data` which doesn't exist on the return type. This was causing a TypeScript error and potentially runtime issues.

---

## Status: COMPLETE

**Key Achievements:**
- Processing project cards are now clickable with visual feedback
- Clicking navigates to detailed pipeline progress view
- Progress view supports resume via query params
- Fixed TypeScript type mismatch in job listing

**Impact:**
- Users can monitor project creation progress from the projects list
- No more "empty page" confusion - processing projects are clearly visible
- One-click access to detailed pipeline stages from anywhere
