# PROMPT #151 - Context Interview Persistence Fix
## Deep Link Navigation and Interview Resumption

**Date:** February 2, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** Users can now leave during context interview and return to resume exactly where they left off

---

## 🎯 Objective

Fix the issue where Context Interview was not persisted when users left the page during question generation and returned later.

**User Report:**
> "a entrevista do contexto continua sem ser persistida, se eu começo a entrevista e vou fazer outra coisa, ou durante a geração da pergunta, eu vou para outra área, o sinho mostra corretamente que a pergunta foi gerada, mas se eu entro no projeto, a entrevista ta reiniciada"

**Translation:** The context interview is not being persisted. If I start the interview and go do something else, or during question generation I go to another area, the bell correctly shows the question was generated, but if I enter the project, the interview is reset.

---

## 🔍 Root Cause Analysis

The investigation revealed multiple issues:

### Issue 1: Deep Link Pointed to Wrong Destination
When a context interview question was generated in background, the deep_link was:
```
/projects/{project_id}?interview={interview_id}
```

This navigated to the **project detail page**, not the **wizard**. The project page had no logic to handle the `?interview=` parameter for context interviews.

### Issue 2: Project Page Had No Redirect Logic
When users navigated to `/projects/[id]` for a project without context, the page didn't check if there was an active context interview that should be resumed in the wizard.

### Issue 3: Wizard Didn't Accept URL Resume Parameter
The wizard relied solely on localStorage for state restoration. If localStorage was cleared or the user used a different browser tab, the interview couldn't be resumed.

---

## ✅ What Was Implemented

### 1. Fixed Deep Links for Context Interviews

**File:** `backend/app/api/routes/interviews/endpoints.py`

Changed deep_link generation in `send_message_async` endpoint (line 2030-2038):

```python
# BEFORE - Wrong deep link for context interviews
else:
    deep_link = f"/projects/{interview.project_id}?interview={interview_id}"

# AFTER - Context interviews go to wizard with resume param
elif interview.interview_mode == 'context' or not interview.parent_task_id:
    # Context interview - redirect to wizard to continue
    deep_link = f"/projects/new?resume={interview.project_id}"
else:
    deep_link = f"/projects/{interview.project_id}?interview={interview_id}"
```

Also fixed in context generation endpoint (line 923):
```python
# BEFORE
deep_link = f"/projects/new?projectId={interview.project_id}&step=3"

# AFTER
deep_link = f"/projects/new?resume={interview.project_id}"
```

### 2. Added `?resume=` Parameter Support to Wizard

**File:** `frontend/src/app/projects/new/page.tsx`

Added `useSearchParams` hook and updated state restoration logic:

```typescript
import { useRouter, useSearchParams } from 'next/navigation';

export default function NewProjectPage() {
  const searchParams = useSearchParams();  // PROMPT #151

  useEffect(() => {
    const restoreWizardState = async () => {
      // PROMPT #151 - Check for resume query param first (from notification deep link)
      const resumeProjectId = searchParams.get('resume');

      // Get saved state from localStorage
      const savedState = localStorage.getItem(WIZARD_STORAGE_KEY);
      const parsedState = savedState ? JSON.parse(savedState) : null;

      // Determine which project ID to use (query param takes priority)
      const targetProjectId = resumeProjectId || parsedState?.projectId;

      // ... rest of restoration logic using targetProjectId
    };

    restoreWizardState();
  }, [router, searchParams]);
}
```

### 3. Added Auto-Redirect from Project Page to Wizard

**File:** `frontend/src/app/projects/[id]/page.tsx`

When user navigates to project page for a project without context, check if there's an active context interview and redirect to wizard:

```typescript
// PROMPT #151 - Check if project needs context interview completion
if (!projectData.context_locked && !projectData.context_human) {
  try {
    const interviewsRes = await interviewsApi.list({
      project_id: projectId,
      status: 'active'
    });
    const interviews = interviewsRes.data || interviewsRes;

    // Find context interview (no parent_task_id)
    const contextInterview = interviews?.find((i: any) =>
      !i.parent_task_id && (i.interview_mode === 'context' || !i.interview_mode)
    );

    if (contextInterview) {
      console.log('🔄 Project has incomplete context interview, redirecting to wizard');
      router.replace(`/projects/new?resume=${projectId}`);
      return;
    }
  } catch (interviewError) {
    console.error('Failed to check for context interviews:', interviewError);
  }
}
```

---

## 📁 Files Modified

### Backend:
1. **[backend/app/api/routes/interviews/endpoints.py](backend/app/api/routes/interviews/endpoints.py)**
   - Line 888: Updated docstring for deep_link format
   - Line 923: Changed deep_link to use `?resume=` param
   - Lines 2030-2038: Added context interview check for deep_link generation

### Frontend:
1. **[frontend/src/app/projects/new/page.tsx](frontend/src/app/projects/new/page.tsx)**
   - Line 17: Added `useSearchParams` import
   - Line 58: Added `searchParams` hook call
   - Lines 116-240: Rewrote restoration logic to prioritize URL `resume` param

2. **[frontend/src/app/projects/[id]/page.tsx](frontend/src/app/projects/[id]/page.tsx)**
   - Line 9: Added `useRouter` import
   - Line 20: Added `interviewsApi` import
   - Line 28: Added router variable
   - Lines 78-95: Added redirect check for active context interviews

---

## 🧪 Testing Results

### Verification Flow:

1. ✅ **Start context interview, leave during question generation**
   - User starts interview and submits answer
   - AI generates next question in background
   - User navigates away (e.g., clicks on another menu item)

2. ✅ **Notification bell shows completion**
   - Bell badge shows unread notification
   - Clicking notification opens `/projects/new?resume={projectId}`

3. ✅ **Interview is restored**
   - Wizard loads with correct project
   - Interview step is active
   - All previous messages are visible
   - New question from background job is shown

4. ✅ **Direct project navigation also works**
   - User navigates directly to `/projects/{id}`
   - Page detects incomplete context interview
   - Auto-redirect to `/projects/new?resume={projectId}`

---

## 🎯 Success Metrics

✅ **Deep Link Accuracy:** Context interview notifications now link to wizard
✅ **URL-Based Resume:** `?resume={projectId}` param enables resumption from any source
✅ **Project Page Guard:** Auto-redirect prevents accessing project before context is set
✅ **Backward Compatible:** localStorage restoration still works as fallback

---

## 💡 Key Insights

### 1. Interview Data Was Always Persisted
The database persistence was working correctly. The issue was **navigation** - users were being sent to the wrong page where their interview state wasn't visible.

### 2. URL Parameters > localStorage
URL parameters are more reliable for cross-tab/session resume because:
- They work when localStorage is cleared
- They work in incognito mode
- They survive page refresh during navigation

### 3. Guard Rails Prevent Broken State
Adding redirect logic to the project page creates a safety net:
- User can't "skip" context interview by navigating directly
- Interview must be completed before project becomes usable
- Consistent UX regardless of how user arrives at project

---

## 🔄 User Flow After Fix

```
1. User creates project, starts context interview
2. User leaves page during question generation
   ↓
3. Background job completes, question saved to DB
4. Notification appears in bell (badge shows count)
   ↓
5a. User clicks notification
    → Deep link: /projects/new?resume={projectId}
    → Wizard loads, finds interview, shows messages
    → User continues interview

5b. User navigates to project directly
    → Project page loads
    → Checks: no context_locked, no context_human
    → Finds active context interview
    → Redirects to /projects/new?resume={projectId}
    → User continues interview
```

---

## 🎉 Status: COMPLETE

**What was delivered:**
- Fixed deep_link for context interview notifications
- Added `?resume=` URL parameter support to wizard
- Added auto-redirect from project page to wizard for incomplete interviews
- Interview persistence now works seamlessly

**Impact:**
- Users can leave and return to context interview without losing progress
- Clicking notification goes directly to interview resumption
- No more "interview reset" issue
- Consistent experience regardless of navigation path

---
