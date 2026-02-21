# PROMPT #131 - UI Simplification
## Continuous Scroll and Interview List View

**Date:** January 31, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** UI/UX Improvement
**Impact:** Simplified user experience with single scroll and consistent interview navigation

---

## Objective

Simplify the UI by:
1. Removing fixed header/footer from ItemDetailPanel - enabling continuous scroll
2. Removing the Interviews tab from project navigation
3. Showing interviews as subcomponents below backlog items (tree view style)
4. Changing Interview tab in card to list view (similar to Criteria tab)

---

## What Was Implemented

### 1. ItemDetailPanel - Continuous Scroll

**Before:**
- Fixed header at top
- Fixed footer at bottom
- Content in middle with separate scroll

**After:**
- Single continuous scrollable container
- Header is sticky (stays visible while scrolling)
- Tabs bar is sticky below header
- Content and footer scroll together
- No more nested scroll areas

**Key Changes:**
- Changed outer div from `h-[90vh] flex flex-col` to `max-h-[90vh] overflow-y-auto`
- Made header sticky with `sticky top-0 bg-white z-10`
- Made tabs sticky with `sticky top-[92px] bg-white z-10`
- Removed `flex-1 overflow-y-auto` from content div
- Footer now scrolls with content

### 2. Removed Interviews Tab from Project Page

**Before:**
- 7 tabs: Overview, Backlog, Kanban Board, Commits, Interviews, RAG Analytics, Blocking Analytics

**After:**
- 6 tabs: Overview, Backlog, Kanban Board, Commits, RAG Analytics, Blocking Analytics

**Rationale:**
- Interviews are now shown directly below backlog items
- No need for separate tab when interviews are contextually visible

### 3. Interviews Below Backlog Items

**Implementation:**
- Added `interviewsMap` state to BacklogListView
- Fetch all interviews for the project on load
- Map interviews by `parent_task_id`
- Render interviews below each item in tree view
- Blue text with interview type, message count, and status

**Visual Style:**
- Icon: 💬
- Title: "Card Interview", "Epic Interview", etc.
- Message count: "X msgs"
- Status badge: colored by status (green=completed, blue=active)
- Hover: light blue background
- Click: navigates to interview page

### 4. Interview Tab as List View

**Before:**
- Embedded ChatInterface in a 500px container
- Full chat interaction within the card

**After:**
- List view similar to Acceptance Criteria tab
- Each interview shown as a clickable row
- Shows: icon, interview type, message count, status, arrow
- Click navigates to interview page
- "New Interview" button creates and navigates to new interview

**Benefits:**
- Consistent with Criteria tab UI
- Cleaner, less crowded interface
- Full interview experience in dedicated page

---

## Files Modified

### 1. [ItemDetailPanel.tsx](frontend/src/components/backlog/ItemDetailPanel.tsx)
- Added `useRouter` for navigation
- Changed `cardInterview` to `cardInterviews` (array)
- Updated `fetchCardInterview` to get all interviews
- Replaced embedded ChatInterface with list view
- Made header and tabs sticky
- Removed fixed footer

### 2. [BacklogListView.tsx](frontend/src/components/backlog/BacklogListView.tsx)
- Added `useRouter` and `interviewsApi` imports
- Added `Interview` type import
- Added `interviewsMap` state
- Added `fetchInterviews` function
- Render interviews below each item in tree view

### 3. [page.tsx](frontend/src/app/projects/[id]/page.tsx)
- Removed `interviews` from Tab type
- Removed Interviews tab from navigation
- Removed InterviewTree component usage
- Cleaned up unused imports (interviewsApi, useRouter)

---

## Testing Results

```bash
# TypeScript compilation
npx tsc --noEmit

# No new errors introduced by PROMPT #131
# All existing errors are pre-existing and unrelated
```

---

## Success Metrics

- Single scroll experience in ItemDetailPanel
- Interviews visible contextually below backlog items
- Interview tab shows list (consistent with Criteria)
- Navigation to interview page works correctly
- Reduced visual complexity

---

## Key Insights

### 1. Continuous Scroll UX
Single scroll is more natural for long content. Fixed headers/footers create complexity and nested scroll areas that confuse users.

### 2. Contextual Information
Showing interviews below their parent items provides immediate context without requiring tab navigation.

### 3. List vs Embedded
For complex features like chat, a dedicated page is better than embedding in a panel. List view provides overview, click for details.

---

## Status: COMPLETE

All objectives achieved:
- ItemDetailPanel has continuous scroll
- Interviews tab removed from project page
- Interviews shown below backlog items
- Interview tab shows list view with navigation

**Commit:** 29759e3
**Push:** Successful to main branch
