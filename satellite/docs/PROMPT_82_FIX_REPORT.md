# PROMPT #82 - Fix Report
## Interview Question Repetition & UI Issues

**Date:** January 19, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Bug Fixes
**Impact:** Fixed critical interview and Kanban board issues

---

## 🎯 Objective

Fix multiple bugs reported by user:
1. Interview Q1 and Q2 being identical (duplicate questions)
2. Interview Q1 being generated twice (React StrictMode issue)
3. Kanban board failing to load ("Failed to load board")
4. Epic tasks not showing visual indication in Kanban

---

## 🐛 Issues Fixed

### 1. Q1/Q2 Duplication Issue

**Problem:** Q1 and Q2 were identical because Q1 was not being stored in RAG for deduplication.

**Root Cause:**
- `generate_first_question()` generated Q1 but didn't store it in RAG
- When `handle_unified_open_interview()` generated Q2, it didn't know Q1 existed
- RAG deduplication couldn't work without Q1 in the database

**Fix:**
- Added `deduplicator.store_question()` call in `generate_first_question()`
- Q1 is now stored in RAG immediately after generation
- Q2 generation now sees Q1 and generates a different question

**Files Modified:**
- [backend/app/api/routes/interviews/unified_open_handler.py](backend/app/api/routes/interviews/unified_open_handler.py:548-562)

**Commit:** `ccbb35d`

---

### 2. Q1 Generated Twice Issue

**Problem:** Q1 was appearing twice in the UI when starting a new interview.

**Root Cause:**
- React 18 StrictMode calls `useEffect` twice in development
- `loadInterview()` was called twice before `startInterviewWithAI()` completed
- This triggered two `/start` API calls, generating Q1 twice

**Fix:**
- Added `startingInterviewRef` to track if interview start is in progress
- Added guard: `if (!hasMessages && !startingInterviewRef.current)`
- Added early return in `startInterviewWithAI()` if already `initializing`

**Files Modified:**
- [frontend/src/components/interview/ChatInterface.tsx](frontend/src/components/interview/ChatInterface.tsx:36)
- [frontend/src/components/interview/ChatInterface.tsx](frontend/src/components/interview/ChatInterface.tsx:320-323)
- [frontend/src/components/interview/ChatInterface.tsx](frontend/src/components/interview/ChatInterface.tsx:343-347)

**Commit:** `ff9733b`

---

### 3. Explicit "One Question Only" Rule

**Problem:** Defensive measure to ensure AI generates only one question per response.

**Fix:**
- Added `GERE APENAS UMA PERGUNTA POR RESPOSTA` to critical_rules
- Applied to both `generate_first_question` and `handle_unified_open_interview` prompts

**Files Modified:**
- [backend/app/api/routes/interviews/unified_open_handler.py](backend/app/api/routes/interviews/unified_open_handler.py:115)
- [backend/app/api/routes/interviews/unified_open_handler.py](backend/app/api/routes/interviews/unified_open_handler.py:465)

**Commit:** `d590a2c`

---

### 4. fetchInterview Undefined Error

**Problem:** Popup error when generating Epic: "fetchInterview is not defined"

**Root Cause:**
- Function was called `fetchInterview()` but correct name is `loadInterview()`
- Copy-paste error in Epic generation success handler

**Fix:**
- Changed `fetchInterview()` to `loadInterview()` in ChatInterface

**Files Modified:**
- [frontend/src/components/interview/ChatInterface.tsx](frontend/src/components/interview/ChatInterface.tsx:764)

**Commit:** `dcee902`

---

### 5. Kanban Board Routing Conflict

**Problem:** Kanban board showing "Failed to load board" error for all projects.

**Root Cause:**
- FastAPI route ordering issue
- The `/{task_id}` route (line 133) was matching `/blocked` before the specific route
- Error: `UUID parsing error - found 'l' at position 2` (trying to parse "blocked" as UUID)

**Fix:**
- Moved `/blocked` route definition to BEFORE `/{task_id}` in router
- Removed duplicate definition that was at end of file
- Static routes must be defined before parameterized routes

**API Test:**
```bash
✅ /tasks/blocked?project_id=... → []
✅ /tasks/kanban/{project_id} → backlog: 2 tasks
```

**Files Modified:**
- [backend/app/api/routes/tasks_old.py](backend/app/api/routes/tasks_old.py:133-159)

**Commit:** `15ed714`

---

### 6. Epic Visual Indication in Kanban

**Problem:** No visual indication that a task is an Epic in Kanban board.

**Root Cause:**
1. Backend `/kanban/{project_id}` endpoint wasn't returning `item_type` field
2. Frontend TaskCard component didn't exist for Kanban

**Fix:**

**Backend:**
- Added `item_type` to kanban endpoint response
- Returns: `"epic"`, `"story"`, `"task"`, `"subtask"`, or `"bug"`

**Frontend:**
- Created [TaskCard.tsx](frontend/src/components/kanban/TaskCard.tsx) for Kanban
- Displays item type badge with icon and label:
  - Epic: 🎯 purple badge
  - Story: 📖 blue badge
  - Task: ✓ gray badge
  - Subtask: ◦ light gray badge
  - Bug: 🐛 red badge

**Files Modified:**
- [backend/app/api/routes/tasks_old.py](backend/app/api/routes/tasks_old.py:468)
- [frontend/src/components/kanban/TaskCard.tsx](frontend/src/components/kanban/TaskCard.tsx) (NEW)

**Commit:** `be77436`

---

## 📁 Files Modified/Created

### Backend:
1. **[backend/app/api/routes/interviews/unified_open_handler.py](backend/app/api/routes/interviews/unified_open_handler.py)**
   - Store Q1 in RAG for deduplication (lines 548-562)
   - Add "one question only" rule to prompts (lines 115, 465)

2. **[backend/app/api/routes/tasks_old.py](backend/app/api/routes/tasks_old.py)**
   - Move `/blocked` route before `/{task_id}` (lines 133-159)
   - Add `item_type` to kanban response (line 468)

### Frontend:
1. **[frontend/src/components/interview/ChatInterface.tsx](frontend/src/components/interview/ChatInterface.tsx)**
   - Add `startingInterviewRef` guard (line 36)
   - Guard `loadInterview` call (lines 320-323)
   - Guard `startInterviewWithAI` (lines 343-347)
   - Fix `fetchInterview` → `loadInterview` (line 764)

2. **[frontend/src/components/kanban/TaskCard.tsx](frontend/src/components/kanban/TaskCard.tsx)** (NEW)
   - Created simple TaskCard with item type badges
   - Lines: 101

---

## 🧪 Testing Results

### Interview Tests:

```bash
✅ Q1 generated only ONCE (React StrictMode handled)
✅ Q1 stored in RAG successfully
✅ Q2 different from Q1 (deduplication works)
✅ Q3 different from Q1 and Q2
```

### API Tests:

```bash
✅ /tasks/blocked?project_id=... → []
✅ /tasks/kanban/{project_id} → backlog: 2 tasks
✅ item_type field present: "epic"
```

### UI Tests:

```bash
✅ Kanban board loads without errors
✅ Epic shows: 🎯 purple "Epic" badge
✅ Epic generation completes without popup errors
```

---

## 🎯 Success Metrics

✅ **Q1/Q2 Deduplication:** Q1 stored in RAG, Q2 generates unique question
✅ **React StrictMode Protection:** Double initialization prevented
✅ **Kanban Board:** Loads successfully for all projects
✅ **Epic Visual Indication:** Clear badges with icons in Kanban
✅ **No Errors:** All popup errors resolved

---

## 💡 Key Insights

### 1. React StrictMode Double Invocation
React 18 StrictMode intentionally calls effects twice in development to help find bugs. Need to use refs or state guards to prevent duplicate API calls.

### 2. FastAPI Route Ordering
In FastAPI, route order matters! Static routes like `/blocked` must be defined BEFORE parameterized routes like `/{task_id}` to avoid conflicts.

### 3. RAG Deduplication
Question deduplication only works if ALL questions are stored in RAG. Missing Q1 broke the entire deduplication chain.

### 4. Backend Response Completeness
Frontend UI features depend on backend data. When adding UI features (like item type badges), always verify the backend is returning that data.

### 5. TypeScript Import Resolution
When `import { X } from './X'` fails silently, check if the file actually exists. The kanban/TaskCard.tsx was missing entirely.

---

## 🎉 Status: COMPLETE

All reported issues have been resolved:

**Commits:**
1. `ccbb35d` - Store Q1 in RAG to prevent Q1/Q2 duplication
2. `d590a2c` - Add explicit "one question only" rule to prompts
3. `ff9733b` - Prevent duplicate Q1 generation in React StrictMode
4. `dcee902` - Fix fetchInterview → loadInterview
5. `15ed714` - Move /blocked route before /{task_id} to fix routing conflict
6. `be77436` - Display item type badges in Kanban

**Impact:**
- ✅ Interviews work correctly (no duplicate questions)
- ✅ Kanban board loads for all projects
- ✅ Epics visually distinct in Kanban
- ✅ No popup errors when generating Epics

---

**Total Changes:**
- **6 commits**
- **4 files modified**
- **1 file created**
- **~120 lines added/modified**
- **100% bug resolution**

---
