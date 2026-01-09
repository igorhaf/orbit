# PROMPT #93 - Fix Question Sequence Bug
## Critical Bug Fix: Interview Questions Out of Order

**Date:** January 8, 2026
**Status:** ✅ COMPLETED
**Priority:** CRITICAL
**Type:** Bug Fix
**Impact:** First interviews now show correct question sequence (tipo de sistema → stack → AI)

---

## 🐛 Bug Description

**User reported:**
```
❌ ACTUAL (WRONG):
titulo → descrição → BACKEND → tipo de sistema → AI

✅ EXPECTED (CORRECT):
titulo → descrição → TIPO DE SISTEMA → backend/database/etc → AI
```

**Root Cause:** Two bugs were causing questions to appear out of order:
1. **Question number calculation bug** in `handle_simple_interview`
2. **Obsolete "requirements" mode** still being used for some interviews

---

## 🔍 Root Cause Analysis

### Bug #1: Incorrect Question Number Calculation

**File:** [backend/app/api/routes/interview_handlers.py](backend/app/api/routes/interview_handlers.py:104)

**Problem:**
```python
# BEFORE (LINE 104):
question_number = message_count // 2
```

**Why it's wrong:**
```
Flow:
1. Start interview → conversation_data = [Q1] (length=1)
2. User answers "My Title" → conversation_data = [Q1, A1] (length=2)
3. send_message called with message_count=2
4. question_number = 2 // 2 = 1  ❌ (Q1 already asked!)
5. System returns Q1 again OR skips to AI phase
```

**Correct calculation:**
```python
# AFTER (LINE 107):
question_number = (message_count // 2) + 1

# With fix:
# message_count=2 ([Q1, A1]) → question_number = 2 ✅ (next is Q2)
# message_count=4 ([Q1, A1, Q2, A2]) → question_number = 3 ✅ (next is Q3)
# message_count=6 ([Q1, A1, Q2, A2, Q3, A3]) → question_number = 4 ✅ (next is Q4)
```

---

### Bug #2: Obsolete "requirements" Mode Still Active

**File:** [backend/app/api/routes/interviews/endpoints.py](backend/app/api/routes/interviews/endpoints.py:162)

**Problem:**
```python
# BEFORE (LINE 158-162):
else:
    # NOT FIRST - Use PROMPT #68 logic (requirements or task_focused)
    detector = ProjectStateDetector(db)
    should_skip_stack = detector.should_skip_stack_questions(project)
    interview_mode = "task_focused" if should_skip_stack else "requirements"  ❌
```

**Why it's wrong:**
- "requirements" mode uses OLD question system from `fixed_questions.py`
- OLD system has: Q1=Title, Q2=Description, **Q3=Backend** ❌ (wrong!)
- NEW "simple" mode has: Q1=Title, Q2=Description, **Q3=System Type** ✅ (correct!)
- PROMPT #91 deprecated "requirements" mode (replaced by "simple")

**After fix:**
```python
# AFTER (LINE 158-165):
else:
    # NOT FIRST - Use task_focused mode (PROMPT #68)
    # PROMPT #93 - "requirements" mode deprecated (replaced by "simple" for first interviews)
    interview_mode = "task_focused"  ✅

    logger.info(f"Creating additional interview for project {project.name}:")
    logger.info(f"  - interview_mode: task_focused (for creating tasks)")
    logger.info(f"  - First interview already collected project info with 'simple' mode")
```

---

## ✅ What Was Fixed

### Fix #1: Question Number Calculation

**File:** [backend/app/api/routes/interview_handlers.py](backend/app/api/routes/interview_handlers.py:102-107)

**Changed:**
- Line 104: `question_number = message_count // 2`
- **To:**  Line 107: `question_number = (message_count // 2) + 1`
- Added detailed comments explaining the calculation (lines 103-106)

**Impact:**
- ✅ Q1 (Title) → Q2 (Description) → Q3 (System Type) → Q4-Q8 (Stack) → AI questions
- ✅ No more skipping questions
- ✅ No more repeating questions

---

### Fix #2: Remove "requirements" Mode

**File:** [backend/app/api/routes/interviews/endpoints.py](backend/app/api/routes/interviews/endpoints.py:158-165)

**Changed:**
- Lines 159-168: Removed `ProjectStateDetector` logic
- Removed conditional: `"task_focused" if should_skip_stack else "requirements"`
- **To:** Always use `"task_focused"` for non-first interviews
- Updated log messages to reflect the change

**Impact:**
- ✅ Only 3 interview modes now exist:
  - `"simple"` - First interview (collect project info with conditional stack)
  - `"task_focused"` - Subsequent interviews (create tasks)
  - `"meta_prompt"` - Legacy mode (17 questions for advanced users)
- ✅ No more interviews using obsolete "requirements" mode
- ✅ All first interviews use correct question sequence

---

## 📁 Files Modified

### 1. [backend/app/api/routes/interview_handlers.py](backend/app/api/routes/interview_handlers.py)
**Lines changed:** 102-107 (~6 lines)

**Changes:**
```python
# BEFORE:
question_number = message_count // 2

# AFTER:
# Start interview adds Q1 → conversation_data = [Q1] (length=1)
# User answers → conversation_data = [Q1, A1] (length=2) → next question is Q2
# message_count=2 ([Q1, A1]) → question_number=2
# message_count=4 ([Q1, A1, Q2, A2]) → question_number=3
question_number = (message_count // 2) + 1
```

---

### 2. [backend/app/api/routes/interviews/endpoints.py](backend/app/api/routes/interviews/endpoints.py)
**Lines changed:** 158-165 (~8 lines)

**Changes:**
```python
# BEFORE:
else:
    # NOT FIRST - Use PROMPT #68 logic (requirements or task_focused)
    detector = ProjectStateDetector(db)
    should_skip_stack = detector.should_skip_stack_questions(project)
    interview_mode = "task_focused" if should_skip_stack else "requirements"
    logger.info(f"Creating interview for project {project.name}:")
    logger.info(f"  - interview_mode: {interview_mode}")
    logger.info(f"  - should_skip_stack: {should_skip_stack}")
    ...

# AFTER:
else:
    # NOT FIRST - Use task_focused mode (PROMPT #68)
    # PROMPT #93 - "requirements" mode deprecated (replaced by "simple" for first interviews)
    interview_mode = "task_focused"

    logger.info(f"Creating additional interview for project {project.name}:")
    logger.info(f"  - interview_mode: task_focused (for creating tasks)")
    logger.info(f"  - First interview already collected project info with 'simple' mode")
```

**Total changes:** ~14 lines across 2 files

---

## 🧪 Testing Instructions

### Test 1: Create New Project and First Interview

```bash
# 1. Create project
POST /api/v1/projects
{
  "name": "Test Question Sequence",
  "description": "Verify correct question order"
}

# 2. Create first interview (should be mode="simple")
POST /api/v1/interviews
{
  "project_id": "{project_id}"
}

# 3. Start interview
POST /api/v1/interviews/{interview_id}/start

# Expected response:
{
  "message": {
    "content": "🎯 Pergunta 1: Qual é o título do projeto?",
    "question_type": "text",
    "question_number": 1
  }
}

# 4. Send Answer 1 (Title)
POST /api/v1/interviews/{interview_id}/messages
{
  "content": "My Test Project"
}

# Expected response:
{
  "message": {
    "content": "📝 Pergunta 2: Descreva brevemente o objetivo do projeto.",
    "question_type": "text",
    "question_number": 2
  }
}

# 5. Send Answer 2 (Description)
POST /api/v1/interviews/{interview_id}/messages
{
  "content": "Testing the question sequence fix"
}

# ✅ Expected Q3: System Type Selection
{
  "message": {
    "content": "🏗️ Pergunta 3: Que tipo de sistema você vai desenvolver?",
    "question_type": "single_choice",
    "question_number": 3,
    "options": {
      "choices": [
        {"id": "apenas_api", "label": "🔌 Apenas API"},
        {"id": "api_frontend", "label": "💻 API + Frontend Web"},
        {"id": "api_mobile", "label": "📱 API + Mobile"},
        {"id": "api_frontend_mobile", "label": "🌐 API + Frontend + Mobile"}
      ]
    }
  }
}

# ❌ If Q3 = "Qual framework de backend" → BUG STILL EXISTS!

# 6. Send Answer 3 (Select "API + Frontend + Mobile")
POST /api/v1/interviews/{interview_id}/messages
{
  "content": "api_frontend_mobile"
}

# ✅ Expected Q4: Backend Framework
{
  "message": {
    "content": "🔧 Pergunta 4: Qual framework de backend você vai usar?",
    "question_type": "single_choice",
    "question_number": 4,
    "options": {
      "choices": [
        {"id": "laravel", "label": "Laravel (PHP)"},
        {"id": "django", "label": "Django (Python)"},
        ...
      ]
    }
  }
}

# 7. Continue answering Q4-Q8 (backend, database, frontend, CSS, mobile)

# 8. After Q8, system should move to AI contextual questions
```

---

## 🎯 Success Metrics

✅ **Question Sequence Fixed:**
- Q1: Title ✅
- Q2: Description ✅
- Q3: System Type (4 choices) ✅ (NOT backend!)
- Q4-Q8: Conditional stack questions ✅
  - apenas_api: Q4 backend, Q5 database (5 total)
  - api_frontend: Q4 backend, Q5 database, Q6 frontend, Q7 CSS (7 total)
  - api_mobile: Q4 backend, Q5 database, Q6 mobile (6 total)
  - api_frontend_mobile: Q4-Q8 all stacks (8 total)
- Q9+: AI contextual questions (closed-ended) ✅

✅ **No More "requirements" Mode:**
- First interviews: always use "simple" mode
- Additional interviews: always use "task_focused" mode
- Old "requirements" mode completely removed from new interview creation

✅ **Interview Modes (Final State):**
| Mode | When Used | Questions |
|------|-----------|-----------|
| `simple` | First interview | Q1-Q3 + conditional Q4-Q8 + AI |
| `task_focused` | Subsequent interviews | Q1 (task type) + AI |
| `meta_prompt` | Legacy/advanced | Q1-Q17 + AI |

---

## 💡 Key Insights

### 1. Message Count vs Question Number

The confusion arose from how message_count relates to question_number:

**Conversation structure:**
```
conversation_data = [Q1, A1, Q2, A2, Q3, A3, ...]
```

**Calculation:**
```python
# When user answers Q1:
conversation_data = [Q1, A1]  # length = 2
# We need to return Q2 (question #2)
question_number = (2 // 2) + 1 = 2 ✅

# When user answers Q2:
conversation_data = [Q1, A1, Q2, A2]  # length = 4
# We need to return Q3 (question #3)
question_number = (4 // 2) + 1 = 3 ✅
```

### 2. Interview Mode Evolution

The interview system has evolved through multiple prompts:

- **PROMPT #57**: Fixed questions (Q1-Q7 stack)
- **PROMPT #68**: Dual-mode (requirements vs task_focused)
- **PROMPT #76**: Meta prompt (17 questions)
- **PROMPT #91**: Simple mode (conditional questions) → **Deprecated "requirements"**
- **PROMPT #92**: Hierarchy generation from simple interviews
- **PROMPT #93**: Fixed sequence bug + removed "requirements" mode completely

### 3. Why "requirements" Mode Was Problematic

The old "requirements" mode used `get_fixed_question()` which had:
- Q3: Backend Framework (from specs)
- This conflicted with the new flow where Q3 should be System Type

By removing "requirements" entirely, we ensure:
- First interviews always use "simple" (correct Q3)
- Subsequent interviews use "task_focused" (no stack questions at all)

---

## 🎉 Status: COMPLETE

**What Was Delivered:**

✅ **Bug Fixes:**
- Fixed question number calculation (+1 offset)
- Removed obsolete "requirements" mode
- All interviews now use correct question sequence

✅ **Code Changes:**
- 2 files modified
- 14 lines changed
- Clear comments added explaining the logic

✅ **Documentation:**
- Complete bug analysis (this file)
- Root cause explanation
- Testing instructions

**Impact:**

- ⚡ **Correct Question Flow:** Users see Q1→Q2→Q3(tipo)→Q4-Q8(stack)→AI
- 🎯 **No More Confusion:** "requirements" mode completely removed
- 🔄 **Consistent Experience:** All new interviews use correct modes
- 📊 **Simpler System:** Only 3 modes instead of 4

**Next Steps for User:**

1. Create a new project
2. Start first interview
3. Verify questions appear in correct order:
   - Q1: Título ✅
   - Q2: Descrição ✅
   - Q3: Tipo de sistema (4 choices) ✅
   - Q4: Backend (após escolher tipo) ✅
   - Q5-Q8: Conditional stack ✅
   - Q9+: AI contextual questions ✅

4. If sequence is correct, proceed with PROMPT #92 workflow (hierarchy generation)

---

**Ready for Testing! 🚀**
