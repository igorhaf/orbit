# PROMPT #214 - Fix Interview Not Affecting Card Information
## Card Inference Never Executed Due to interview_mode String Mismatch

**Date:** February 9, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** Card-focused interviews now properly update cards with extracted information (description, acceptance criteria, story points, labels)

---

## 🎯 Objective

The user reported "a entrevista não esta afetando em nada as informações do card" - interviews were not affecting card information at all.

**Root Cause:** The backend sets `interview_mode = "card_focused"` when creating card-focused interviews, but the frontend was checking for `"card_inference"` to determine whether to run the card inference endpoint. This string mismatch meant the card inference was **never executed**.

**Key Requirements:**
1. Fix the interview_mode mismatch across all frontend files
2. Ensure card inference runs when completing card-focused interviews
3. Update outdated schema comments

---

## 🔍 Root Cause Analysis

### The Flow (Before Fix)

```
Card-Focused Interview Started
  ↓ (backend endpoint)
Set interview_mode = "card_focused" ✓
  ↓
User answers questions (Q1-Q8+)
  ↓
User clicks "Complete Interview"
  ↓ (frontend)
Check: if interview_mode === 'card_inference'   ← WRONG STRING
  ✗ FALSE (actual mode is 'card_focused')
  ↓
Skip card inference entirely
  ↓
Card remains unchanged despite interview
```

### Backend (Correct)
- `endpoints.py:227`: `interview_mode = "card_focused"`
- `tasks_old.py:2255-2410`: Card inference endpoint exists and works correctly

### Frontend (Bug)
- `ItemDetailPanel.tsx:236`: `interview_mode === 'card_inference'` ← WRONG
- `ChatInterface.tsx:771`: `interviewMode === 'card_inference'` ← WRONG
- `BacklogListView.tsx:756`: Display label used `'card_inference'` ← WRONG
- `InterviewTree.tsx:56,74`: Mode labels used `'card_inference'` ← WRONG

---

## ✅ What Was Fixed

### All references to `card_inference` replaced with `card_focused`:

1. **ItemDetailPanel.tsx** - 3 occurrences:
   - Line 236: Inference trigger condition (CRITICAL)
   - Line 1248: Interview header label
   - Line 1313: interviewMode prop passed to ChatInterface
   - Line 1395: Interview list item label

2. **ChatInterface.tsx** - 5 occurrences:
   - Line 23: TypeScript type definition
   - Line 26: Comment
   - Line 771: Card inference condition check (CRITICAL)
   - Line 785: Comment
   - Line 1047: Mode check for UI control

3. **BacklogListView.tsx** - 1 occurrence:
   - Line 756: Interview mode display label

4. **InterviewTree.tsx** - 2 occurrences:
   - Line 56: Mode label mapping
   - Line 74: Mode icon mapping

5. **Backend schema** - 1 occurrence:
   - `interview.py:62`: Updated comment from `card_inference` to `card_focused`

---

## 📁 Files Modified

### Modified:
1. **frontend/src/components/backlog/ItemDetailPanel.tsx** - Fixed interview_mode checks
2. **frontend/src/components/backlog/BacklogListView.tsx** - Fixed display label
3. **frontend/src/components/interview/ChatInterface.tsx** - Fixed inference trigger and types
4. **frontend/src/components/interview/InterviewTree.tsx** - Fixed mode labels
5. **backend/app/schemas/interview.py** - Updated outdated comment

---

## 🧪 Testing Results

### Verification:

```
✅ No remaining references to 'card_inference' in frontend
✅ Backend card inference endpoint unchanged (works correctly)
✅ Interview completion now triggers card inference for card_focused mode
✅ Card inference extracts: description, acceptance_criteria, story_points, labels
✅ Display labels correctly show "Card Interview" for card_focused mode
```

---

## 🎯 Success Metrics

✅ **Card inference now runs**: When completing a card-focused interview, AI extracts information and updates the card
✅ **Complete data flow**: Interview answers → AI extraction → Card updated with description, acceptance criteria, story points, labels
✅ **Zero regression**: Other interview modes (context, meta_prompt, orchestrator) unaffected

---

## 💡 Key Insights

### 1. String Mismatch Pattern
This was a classic case of a backend-frontend string constant mismatch. The backend was updated to use `"card_focused"` at some point, but the frontend still referenced the old `"card_inference"` value. This type of bug is invisible in testing unless you specifically complete an interview and check if the card was updated.

### 2. Card Inference Endpoint
The card inference endpoint (`POST /tasks/{id}/card-inference`) is well-implemented:
- Parses interview conversation data
- Uses AI to extract structured information (JSON)
- Updates card with: description addendum, acceptance criteria, story points, suggested labels
- Handles errors gracefully

---

## 🎉 Status: COMPLETE

Card-focused interviews now properly update cards with AI-extracted information.

**Key Achievements:**
- ✅ Fixed critical string mismatch across 5 files
- ✅ Card inference endpoint now properly triggered on interview completion
- ✅ Cards enriched with interview insights (description, criteria, points, labels)

**Impact:**
- Interviews now have tangible effect on card information
- Users will see their cards enriched after completing interviews
- Full interview data flow restored: collect → analyze → update

---
