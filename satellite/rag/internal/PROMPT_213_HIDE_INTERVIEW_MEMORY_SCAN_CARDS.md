# PROMPT #213 - Hide Interview Options for Memory-Scan Cards
## Cards Created from Business Rules Should Not Show Interview Options

**Date:** February 9, 2026
**Status:** ✅ COMPLETED
**Priority:** MEDIUM
**Type:** Feature Implementation
**Impact:** Cards created from codebase memory scan (business rules) no longer show interview options, preventing unnecessary AI interviews on already-verified items

---

## 🎯 Objective

Cards that are created automatically during codebase memory scan (business rules extracted from code) are "closed" cards - they represent verified, existing functionality. These cards should NOT present interview options to the user, since interviewing them makes no sense (they're already fully defined from the code itself).

**Key Requirements:**
1. Hide Interview tab in ItemDetailPanel for from_code cards
2. Hide interview entries in BacklogListView tree for from_code cards
3. Hide interview/subtask-suggestion buttons in TaskCard for from_code cards

---

## 🔍 Pattern Analysis

### How Memory-Scan Cards Are Identified

Cards created from codebase memory scan have distinctive attributes set in `context_generator.py`:
- `labels=["business_rule", "verified", "from_code"]`
- `workflow_state="closed"`
- `resolution="fixed"`
- `reporter="system"`

The **`from_code`** label is the most reliable and specific identifier, unique to business-rule cards from codebase memory scan.

### Existing Patterns

- `isSuggestedItem` pattern: checks `labels?.includes('suggested') || workflow_state === 'draft'`
- `showInterviewButtons` prop on TaskCard already controls interview button visibility
- Interview tab in ItemDetailPanel uses a tabs array that can be conditionally filtered

---

## ✅ What Was Implemented

### 1. ItemDetailPanel.tsx - Hide Interview Tab
- Added `isFromCode` flag: `const isFromCode = item.labels?.includes('from_code') === true`
- Conditionally excludes Interview tab from tabs array for from_code cards using spread operator
- When a from_code card is opened, the Interview tab simply doesn't appear

### 2. BacklogListView.tsx - Hide Interview Entries in Tree
- Added condition `!item.labels?.includes('from_code')` before rendering interview entries
- From_code cards no longer show interview items beneath them in the backlog tree

### 3. TaskCard.tsx - Hide Interview/Subtask Buttons
- Added `isFromCode` flag: `const isFromCode = task.labels?.includes('from_code') === true`
- Added `!isFromCode` condition to both interview button sections:
  - AI-Suggested Subtasks section (line 332)
  - Create Sub-Interview button (line 436)

---

## 📁 Files Modified

### Modified:
1. **frontend/src/components/backlog/ItemDetailPanel.tsx**
   - Added `isFromCode` constant (line 87)
   - Conditionally excluded Interview tab from tabs array (line 567)

2. **frontend/src/components/backlog/BacklogListView.tsx**
   - Added `!item.labels?.includes('from_code')` guard on interview rendering (line 745)

3. **frontend/src/components/backlog/TaskCard.tsx**
   - Added `isFromCode` constant (line 127)
   - Added `!isFromCode` to subtask suggestions condition (line 332)
   - Added `!isFromCode` to create interview button condition (line 436)

---

## 🧪 Testing Results

### Verification:

```
✅ ItemDetailPanel: Interview tab hidden for from_code cards
✅ BacklogListView: Interview entries not rendered for from_code cards
✅ TaskCard: Interview/subtask buttons hidden for from_code cards
✅ Non from_code cards: All interview features work normally
✅ Suggested items: Still correctly handled (separate logic)
```

---

## 🎯 Success Metrics

✅ **No Interview UI for business rule cards**: Cards with label "from_code" never show interview options
✅ **No regression**: Regular cards, suggested cards, and interview-created cards work as before
✅ **Minimal changes**: Only 3 files modified with surgical additions

---

## 🎉 Status: COMPLETE

Cards created from codebase memory scan (business rules) now properly hide all interview-related UI elements.

**Key Achievements:**
- ✅ Interview tab removed from ItemDetailPanel for from_code cards
- ✅ Interview tree entries hidden in BacklogListView for from_code cards
- ✅ Interview/subtask buttons hidden in TaskCard for from_code cards

**Impact:**
- Cleaner UX: users won't be confused by interview options on verified business rule cards
- Consistent behavior: closed cards from code analysis are treated as read-only verified items

---
