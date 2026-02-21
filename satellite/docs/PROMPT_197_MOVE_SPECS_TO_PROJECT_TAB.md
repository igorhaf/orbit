# PROMPT #197 - Move Specs to Project Detail Tab
## Remove standalone Specs pages, add Specs tab to project detail

**Date:** February 8, 2026
**Status:** COMPLETED
**Priority:** MEDIUM
**Type:** Feature (UI Refactor)
**Impact:** Specs management now integrated into project detail page, standalone pages removed

---

## Objective

Move Specs functionality from the standalone `/specs` page into a "Specs" tab within the project detail page. Remove all standalone specs pages, sidebar entry, and breadcrumbs references.

**Key Requirements:**
1. Create reusable `ProjectSpecsList` component with full CRUD
2. Add "Specs" tab to project detail page
3. Remove standalone `/specs` and `/specs/generate` pages
4. Remove "Specs" from sidebar navigation

---

## What Was Implemented

### 1. New `ProjectSpecsList` Component
Extracted all Specs management logic from the standalone page into a reusable component:
- Receives `projectId` as prop (no project selector needed)
- Full CRUD: create, edit, delete specs
- Filters: category, status, search
- Specs table with all columns (category, framework, type, title, language, version, usage, status, actions)
- Create/Edit dialogs with shared form fields
- Delete confirmation dialog
- Loading states and empty states

### 2. Project Detail Page Update
- Added `'specs'` to Tab type union
- Added "Specs" tab button in the tab navigation
- Added `ProjectSpecsList` rendering when tab is active

### 3. Cleanup
- Removed "Specs" entry from sidebar navigation
- Removed 'specs' from breadcrumbs label map
- Deleted `frontend/src/app/specs/page.tsx` (982 lines)
- Deleted `frontend/src/app/specs/generate/page.tsx` (pattern discovery)
- Deleted entire `frontend/src/app/specs/` directory

---

## Files Created

1. **frontend/src/components/specs/ProjectSpecsList.tsx** - Reusable specs management component
2. **frontend/src/components/specs/index.ts** - Component exports

## Files Modified

3. **frontend/src/app/projects/[id]/page.tsx** - Added Specs tab
4. **frontend/src/components/layout/Sidebar.tsx** - Removed Specs entry
5. **frontend/src/components/layout/Breadcrumbs.tsx** - Removed specs reference

## Files Deleted

6. **frontend/src/app/specs/page.tsx** - Standalone specs page
7. **frontend/src/app/specs/generate/page.tsx** - Pattern discovery page

---

## Testing Results

```bash
 Frontend build: SUCCESS (no errors)
 ProjectSpecsList component created with full CRUD
 Specs tab added to project detail page
 Sidebar cleaned up
 Standalone pages deleted
```

---

## Status: COMPLETE

Specs management moved from standalone page to project detail tab. Net deletion: 1106 lines (1723 removed, 617 added).
