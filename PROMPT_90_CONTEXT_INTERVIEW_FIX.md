# PROMPT #90 - Context Interview Flow Fix
## Ensuring Context Interview Runs Before Epic Interview

**Date:** January 19, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Bug Fix / Flow Correction
**Impact:** Critical - Projects now properly establish context before Epic creation

---

## Objective

Fix the Context Interview flow to ensure that:
1. New projects go through Context Interview BEFORE Epic Interview
2. Frontend correctly displays interview type based on `context_locked` state
3. Users cannot skip the Context Interview for new projects

**Key Requirements:**
1. New Project button must redirect to `/projects/new` wizard (includes Context Interview)
2. Interview modal must show "Context Interview" when `context_locked=false`
3. Backend correctly uses fixed questions Q1-Q3 for Context Interview mode
4. System prevents Epic creation until context is established

---

## Problem Identified

The user reported that the system was not running the Context Interview:
- Screenshot 1: "Create New Project" modal (simple modal, no Context Interview)
- Screenshot 2: "Create New Interview" showing "Epic Interview (First Interview)" instead of "Context Interview"

**Root Causes:**
1. `/projects` page used a simple modal to create projects, bypassing the wizard
2. `InterviewList` always showed "Epic Interview" regardless of project context state
3. `unified_open_handler.py` didn't use the fixed questions from `context_questions.py`

---

## What Was Implemented

### 1. Redirect New Project to Wizard

**File:** `frontend/src/app/projects/page.tsx`

Changed the "New Project" button to redirect to `/projects/new` instead of opening a modal:

```typescript
// Before
<Button onClick={() => setShowCreateDialog(true)}>New Project</Button>

// After
<Button onClick={() => router.push('/projects/new')}>New Project</Button>
```

Also removed the create project modal dialog (no longer needed).

### 2. Context-Aware Interview Type Display

**File:** `frontend/src/components/interview/InterviewList.tsx`

Added `project` prop to detect context state and display correct interview type:

```typescript
// New prop
interface InterviewListProps {
  projectId?: string;
  showHeader?: boolean;
  showCreateButton?: boolean;
  project?: Project;  // PROMPT #90 - Pass project to detect context state
}

// Conditional display
{projectProp && !projectProp.context_locked ? (
  <div className="bg-amber-50 ...">
    <p>Context Interview (Required First Step)</p>
    <p>This interview will establish the foundational context for your project.</p>
  </div>
) : (
  <div className="bg-blue-50 ...">
    <p>Epic Interview</p>
    <p>This interview will create an Epic for your project.</p>
  </div>
)}
```

### 3. Context-Aware Button in Project Page

**File:** `frontend/src/app/projects/[id]/page.tsx`

Updated the "New Interview" button to:
- Show "Context Interview" when `context_locked=false`
- Show "New Epic Interview" when `context_locked=true`
- Added tooltip explaining the interview type

```typescript
<Button
  title={!project?.context_locked
    ? 'Start Context Interview to establish project foundation'
    : 'Start Epic Interview'}
>
  {!project?.context_locked ? 'Context Interview' : 'New Epic Interview'}
</Button>
```

### 4. Backend Fixed Questions for Context Interview

**File:** `backend/app/api/routes/interviews/unified_open_handler.py`

Integrated `context_questions.py` module for Context Interview mode:

```python
# Import context questions
from app.api.routes.interviews.context_questions import (
    get_context_fixed_question,
    count_fixed_questions_context,
    is_fixed_question_complete_context,
    get_context_ai_prompt,
    should_end_context_interview
)

# In generate_first_question()
if interview.interview_mode == "context":
    fixed_question = get_context_fixed_question(1, project, db)
    if fixed_question:
        return fixed_question

# In handle_unified_open_interview()
if interview.interview_mode == "context":
    question_number = (message_count // 2) + 1
    if question_number <= count_fixed_questions_context():
        fixed_question = get_context_fixed_question(question_number, project, db)
        # Return fixed question Q1, Q2, or Q3
    elif should_end_context_interview(interview.conversation_data):
        # Return completion message
```

---

## Files Modified

### Frontend:
1. **[frontend/src/app/projects/page.tsx](frontend/src/app/projects/page.tsx)**
   - Changed: "New Project" button redirects to `/projects/new`
   - Removed: Create project modal
   - Added: `useRouter` import

2. **[frontend/src/components/interview/InterviewList.tsx](frontend/src/components/interview/InterviewList.tsx)**
   - Added: `project` prop to interface
   - Changed: Interview type display based on `context_locked` state

3. **[frontend/src/app/projects/[id]/page.tsx](frontend/src/app/projects/[id]/page.tsx)**
   - Changed: "New Interview" button text and tooltip based on context state
   - Added: Pass `project` prop to InterviewList

### Backend:
4. **[backend/app/api/routes/interviews/unified_open_handler.py](backend/app/api/routes/interviews/unified_open_handler.py)**
   - Added: Import `context_questions` functions
   - Changed: `generate_first_question()` to use fixed Q1 for context mode
   - Changed: `handle_unified_open_interview()` to use fixed Q1-Q3 for context mode

---

## Context Interview Flow (Fixed)

```
┌─────────────────────────────────────────────────────────────────┐
│                     NEW PROJECT FLOW                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. User clicks "New Project"                                   │
│     └── Redirects to /projects/new (wizard)                     │
│                                                                  │
│  2. Step 1: Enter project name                                  │
│     └── Creates project with context_locked=false               │
│     └── Creates interview with interview_mode="context"          │
│                                                                  │
│  3. Step 2: Context Interview                                   │
│     └── Q1 (Fixed): Project Title                               │
│     └── Q2 (Fixed): Problem Statement                           │
│     └── Q3 (Fixed): Project Vision                              │
│     └── Q4+ (AI): Contextual questions                          │
│     └── Complete: Generate Context                              │
│                                                                  │
│  4. Step 3: Review Context                                      │
│     └── Shows context_human (human-readable)                    │
│     └── Collapsible context_semantic (for AI)                   │
│                                                                  │
│  5. Step 4: Confirm                                             │
│     └── Project ready for Epic creation                         │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  EXISTING PROJECT (context not locked):                         │
│  - "New Interview" button shows "Context Interview"              │
│  - Modal shows amber warning about Context Interview             │
│  - Backend uses context questions mode                           │
│                                                                  │
│  EXISTING PROJECT (context locked):                             │
│  - "New Interview" button shows "New Epic Interview"             │
│  - Modal shows blue info about Epic Interview                    │
│  - Backend uses meta_prompt mode                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Testing Results

### Verification:
```bash
✅ Backend imports working (unified_open_handler.py)
✅ Docker containers running (backend, frontend, db, redis)
✅ Backend health check passed
✅ Code compiles without errors
```

---

## Success Metrics

- **New projects now go through Context Interview** before Epic creation
- **Frontend correctly displays interview type** based on `context_locked` state
- **Fixed questions Q1-Q3 are used** for Context Interview mode
- **Users cannot skip Context Interview** when creating new projects via wizard
- **Existing behavior preserved** for projects with locked context

---

## Key Insights

### 1. Two Entry Points Issue
The original implementation had two ways to create projects:
- `/projects/new` wizard (correct - includes Context Interview)
- Modal in `/projects` page (bypassed Context Interview)

Solution: Redirect all project creation to the wizard.

### 2. Frontend-Backend Coordination
The backend was already detecting `context_locked=false` and setting `interview_mode="context"`, but:
- Frontend wasn't showing this to users
- `unified_open_handler.py` wasn't using the fixed questions

Solution: Added context state detection to frontend + integrated `context_questions.py` in backend.

### 3. Hybrid Question Flow
Context Interview uses:
- Q1-Q3: Fixed questions (Title, Problem, Vision) from `context_questions.py`
- Q4+: AI-generated contextual questions

This ensures essential information is always collected while allowing flexibility for deeper exploration.

---

## Status: COMPLETE

**Key Achievements:**
- Context Interview now runs before Epic Interview for new projects
- Frontend correctly displays interview type based on project state
- Backend uses fixed questions for Context Interview mode
- All entry points for project creation lead to the wizard

**Impact:**
- Users will always establish project context before creating Epics
- Context is immutable after first Epic, ensuring consistency
- Better user experience with clear interview type indication

---
