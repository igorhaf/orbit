# PROMPT #137 - Immediate Project Creation on Folder Selection
## Draft Project Flow with Background Memory Scan

**Date:** February 1, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Major UX improvement - projects created immediately, no data loss on wizard abandon

---

## 🎯 Objective

Change project creation flow so the project is created **immediately** when selecting a folder, with AI-generated title. Memory Scan runs in background and continues even if user leaves. Context Interview is optional but required before Epic creation.

**Key Requirements:**
1. Project created as "draft" immediately on folder selection
2. Memory Scan continues in background even if user leaves wizard
3. User can skip wizard at any time and go directly to project
4. Context Interview can be completed later via banner on project page
5. Epic creation blocked until Context Interview is completed

---

## 🔍 Flow Comparison

### Previous Flow (PROMPT #98)
```
Select folder → [Memory Scan in background]
             → Enter name
             → Click "Next"
             → PROJECT CREATED
             → Context Interview → Review → Confirm
             → If user abandons → PROJECT DELETED
```

### New Flow (PROMPT #137)
```
Select folder → PROJECT CREATED IMMEDIATELY (draft)
             → Memory Scan continues in background
             → Title auto-updated from AI suggestion
             → Wizard continues (Context Interview OPTIONAL)
             → User can go to project at any moment
             → If user abandons → PROJECT KEPT as draft
```

---

## ✅ What Was Implemented

### 1. Backend: `/quick-create` Endpoint

New endpoint that creates project immediately with just `code_path`:

**File:** `backend/app/api/routes/projects.py`

```python
@router.post("/quick-create")
async def quick_create_project(
    code_path: str = Query(..., description="Absolute path to existing code folder"),
    db: Session = Depends(get_db)
):
    """
    PROMPT #137 - Create project immediately when folder is selected.

    1. Validates code_path exists
    2. Creates project with temporary name based on folder name
    3. Starts memory scan job in background
    4. Returns project + job_id for tracking
    """
```

Features:
- Validates folder path exists
- Uses folder name as temporary title (converted to Title Case)
- Creates project with `status=draft` and `context_locked=False`
- Starts Memory Scan job in background
- Returns project data + job_id for frontend tracking

### 2. Frontend: Modified Wizard

**File:** `frontend/src/app/projects/new/page.tsx`

Changes:
- `handleFolderSelect` now calls `/quick-create` instead of `/scan-memory`
- Project is created immediately when folder is selected
- `handleBasicSubmit` now updates existing project (PATCH) instead of creating
- **Removed PROMPT #98 cleanup logic** - projects are kept as drafts
- Added "Skip to Project" button in steps 1 and 2

### 3. Frontend: Context Setup Banner

**File:** `frontend/src/app/projects/[id]/page.tsx`

Added amber banner for draft projects without context:

```typescript
{/* PROMPT #137 - Context Setup Banner for draft projects */}
{project && !project.context_locked && !project.context_human && (
  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
    <h4>Complete Project Setup</h4>
    <p>Run the Context Interview to establish project foundation and enable Epics.</p>
    <Button>Configure Context</Button>
  </div>
)}
```

### 4. New Page: Setup Context

**File:** `frontend/src/app/projects/[id]/setup-context/page.tsx`

Dedicated page for completing Context Interview on draft projects:
- 3-step wizard: Interview → Review → Complete
- Creates interview session
- Generates context (human + semantic)
- Shows suggested epics preview
- Redirects to project page on completion

### 5. Frontend: Epic Creation Blocking

**File:** `frontend/src/components/interview/InterviewList.tsx`

Added check before Epic creation:

```typescript
// PROMPT #137 - Block Epic creation if project has no context
if (targetProject && !targetProject.context_locked && !targetProject.context_human) {
  showWarning('Please complete the Context Interview before creating Epics...');
  return;
}
```

---

## 📁 Files Modified/Created

### Created:
1. **[frontend/src/app/projects/[id]/setup-context/page.tsx](frontend/src/app/projects/[id]/setup-context/page.tsx)** - Context Interview page for draft projects
   - Lines: ~350
   - Features: 3-step wizard, interview session, context generation, suggested epics preview

### Modified:
1. **[backend/app/api/routes/projects.py](backend/app/api/routes/projects.py)** - Added `/quick-create` endpoint
   - Lines changed: ~80

2. **[frontend/src/app/projects/new/page.tsx](frontend/src/app/projects/new/page.tsx)** - Modified wizard flow
   - Lines changed: ~100
   - Changes: Immediate project creation, removed cleanup, added Skip button

3. **[frontend/src/app/projects/[id]/page.tsx](frontend/src/app/projects/[id]/page.tsx)** - Added context setup banner
   - Lines changed: ~25
   - Changes: Amber banner for draft projects

4. **[frontend/src/components/interview/InterviewList.tsx](frontend/src/components/interview/InterviewList.tsx)** - Epic creation blocking
   - Lines changed: ~15
   - Changes: Block Epic if no context

---

## 🧪 Testing Results

### Verification:

```bash
✅ Select folder → Project created immediately as draft
✅ Temporary name shows folder name in Title Case
✅ Memory Scan starts in background
✅ User can skip wizard → Project appears in list
✅ Draft project shows amber "Configure Context" banner
✅ Click "Configure Context" → Opens setup-context page
✅ Try to create Epic without context → Warning shown, blocked
✅ Complete Context Interview → Banner disappears
✅ Create Epic → Works normally after context set
```

---

## 🎯 Success Metrics

✅ **Zero Data Loss:** Projects never deleted, always kept as drafts
✅ **Immediate Feedback:** Project visible in list immediately after folder selection
✅ **Background Processing:** Memory Scan continues even if user leaves
✅ **Flexible Flow:** User can complete interview now or later
✅ **Enforced Foundation:** Epics require context, ensuring quality

---

## 💡 Key Insights

### 1. Draft Status Strategy
Using `status=draft` and `context_locked=False` together provides clear indication:
- `draft` = project created but not fully configured
- `context_locked=False` + no `context_human` = needs Context Interview

### 2. PROMPT #98 Cleanup Removed
Previous logic deleted projects on wizard abandon. New approach:
- **Before:** Project created at step 2, deleted if abandoned
- **After:** Project created at step 0, kept as draft forever

### 3. Two Entry Points for Context Interview
1. **During wizard:** Continue flow naturally
2. **Later via banner:** `/projects/[id]/setup-context` page

---

## 🎉 Status: COMPLETE

PROMPT #137 successfully implemented immediate project creation flow.

**Key Achievements:**
- ✅ Project created immediately on folder selection
- ✅ Memory Scan runs in background
- ✅ "Skip to Project" button available
- ✅ Context Setup banner on draft projects
- ✅ Dedicated `/setup-context` page
- ✅ Epic creation blocked without context

**Impact:**
- No more data loss on wizard abandon
- Projects always visible in list after folder selection
- Users can complete setup at their own pace
- Quality enforced through Epic blocking

---
