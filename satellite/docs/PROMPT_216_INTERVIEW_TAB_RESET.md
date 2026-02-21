# PROMPT #216 - Interview Tab Reset on Tab Switch
## Fix: Interview tab returns to list when switching tabs after interview

**Date:** February 9, 2026
**Status:** ✅ COMPLETED
**Priority:** MEDIUM
**Type:** Bug Fix
**Impact:** After completing or closing an interview, switching tabs and returning to the Interview tab now shows the interview list instead of the last interview chat

---

## 🎯 Objective

Fix the behavior where switching away from the Interview tab and returning to it would show the last opened interview chat, instead of showing the interview list.

**Problem:**
- User completes/closes an interview
- Switches to another tab (Overview, Children, etc.)
- Switches back to Interview tab
- Expected: see the interview list
- Actual: sees the last interview chat view (because `selectedInterviewId` persisted)

**Key Requirements:**
1. Reset `selectedInterviewId` when user switches away from the Interview tab
2. Returning to the Interview tab always shows the interview list
3. Don't break the `initialInterviewId` flow (when clicking into an interview from outside)

---

## ✅ What Was Implemented

### 1. Added useEffect to reset interview selection on tab change

When `activeTab` changes to any tab other than 'interview', `selectedInterviewId` is reset to `null`. This ensures that when the user navigates back to the Interview tab, they see the interview list view rather than the last opened chat.

The `initialInterviewId` prop flow is unaffected — it still correctly sets the selected interview and switches to the tab when triggered from external navigation.

---

## 📁 Files Modified

1. **frontend/src/components/backlog/ItemDetailPanel.tsx** - Added useEffect to clear `selectedInterviewId` on tab switch
   - Lines added: 5

---

## 🧪 Testing Results

```
✅ selectedInterviewId resets to null when switching away from interview tab
✅ Returning to interview tab shows interview list
✅ initialInterviewId flow still works (external navigation to specific interview)
```

---

## 🎯 Success Metrics

✅ **Tab switch clears interview selection**: `selectedInterviewId` is null when returning to Interview tab
✅ **Interview list is shown**: Users see the list of interviews, not the last chat

---

## 🎉 Status: COMPLETE

Simple but impactful UX fix. The Interview tab now correctly shows the interview list when returning to it after switching tabs.

**Key Achievements:**
- ✅ Interview tab resets to list view on tab switch
- ✅ No interference with external interview navigation

---
