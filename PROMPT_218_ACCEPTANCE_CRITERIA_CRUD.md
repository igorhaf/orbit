# PROMPT #218 - Acceptance Criteria CRUD
## Full add, edit, and delete functionality for acceptance criteria

**Date:** February 9, 2026
**Status:** ✅ COMPLETED
**Priority:** MEDIUM
**Type:** Bug Fix / Feature Implementation
**Impact:** Users can now add, edit, and delete acceptance criteria directly from the Criteria tab in the card detail panel

---

## 🎯 Objective

The Criteria tab in ItemDetailPanel had non-functional buttons — "Add Criterion" and the delete button per criterion had no `onClick` handlers. Users could not manage acceptance criteria.

**Key Requirements:**
1. Add new acceptance criteria via text input
2. Delete existing criteria
3. Edit criteria inline (double-click or edit button)
4. Persist changes to backend via `tasksApi.update`

---

## ✅ What Was Implemented

### 1. State Management
- `newCriterion` / `isAddingCriterion` for add flow
- `editingCriterionIdx` / `editingCriterionText` for inline edit

### 2. Handlers
- `handleAddCriterion()` — appends new criterion and saves
- `handleDeleteCriterion(idx)` — removes criterion by index and saves
- `handleEditCriterion(idx)` — updates criterion text at index and saves

### 3. UI Updates
- **Add button** — opens inline text input with Enter to save, Escape to cancel
- **Edit** — double-click on text or hover edit icon to enter edit mode
- **Delete** — hover trash icon per criterion
- **Numbering** — each criterion shows its index (1., 2., 3.)
- **Hover reveal** — edit and delete buttons appear on hover via `group-hover:opacity-100`

---

## 📁 Files Modified

1. **frontend/src/components/backlog/ItemDetailPanel.tsx**
   - Added state variables for criteria CRUD
   - Added 3 handler functions (add, delete, edit)
   - Replaced placeholder Criteria tab UI with fully functional version

---

## 🧪 Testing Results

```
✅ TypeScript compilation passes (no new errors)
✅ Add criterion with Enter key and Add button
✅ Delete criterion with trash icon
✅ Edit criterion with double-click or edit icon
✅ Changes persist via tasksApi.update
✅ Parent refreshes via onUpdate callback
```

---

## 🎉 Status: COMPLETE

Acceptance criteria in the Criteria tab are now fully functional with add, edit, and delete capabilities.

---
