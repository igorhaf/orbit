# PROMPT #196 - Remove Standalone Commits Page
## Remove redundant /commits page from sidebar - commits are per-project only

**Date:** February 8, 2026
**Status:** COMPLETED
**Priority:** LOW
**Type:** Feature (UI Cleanup)
**Impact:** Cleaner sidebar navigation, no more redundant commits page

---

## Objective

Remove the standalone `/commits` page and its sidebar menu entry. Commits and all git operations are already available per-project in the project detail commits tab, making the standalone page redundant.

**Key Requirements:**
1. Remove "Commits" entry from sidebar navigation
2. Remove standalone `/commits` page
3. Keep per-project commit functionality intact (CommitHistory component, commitsApi)

---

## What Was Implemented

### 1. Sidebar Cleanup
Removed the "Commits" navigation item from the sidebar menu.

### 2. Breadcrumbs Cleanup
Removed 'commits' from the breadcrumb labels map and UUID label switch case.

### 3. Page Deletion
Deleted `frontend/src/app/commits/page.tsx` (standalone commits page with 614 lines).

### 4. Preserved Per-Project Functionality
- `CommitHistory` component (used in project detail) - kept
- `commitsApi` in `api.ts` (used by CommitHistory and TaskExecutionChat) - kept
- Backend `/api/v1/commits/` endpoints - kept

---

## Files Modified/Deleted

### Deleted:
1. **frontend/src/app/commits/page.tsx** - Standalone commits page (614 lines)

### Modified:
1. **frontend/src/components/layout/Sidebar.tsx** - Removed "Commits" menu entry
2. **frontend/src/components/layout/Breadcrumbs.tsx** - Removed 'commits' references

---

## Testing Results

```bash
 Frontend build: SUCCESS
 Sidebar renders without Commits entry
 Per-project commit functionality preserved (CommitHistory, commitsApi)
```

---

## Status: COMPLETE

Removed standalone Commits page from sidebar. Per-project commits remain fully functional.
