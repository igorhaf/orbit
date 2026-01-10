# PROMPT #98 - Card-Focused Interview Bug Analysis & Fix
## Error: "Unexpected interview state (message_count=1)"

**Date:** January 9, 2026
**Status:** 🔍 INVESTIGATING
**Error Type:** Interview Routing/State Management
**Root Cause:** Interview `interview_mode` mismatch between creation and handler execution

---

## 🐛 The Error

```
❌ Send message job failed: Unexpected interview state (message_count=1)
```

This error occurs when:
1. User attempts to send a message to a card-focused interview
2. The message count is 1 (only the user's message, no Q1 from /start)
3. The handler routes to `handle_meta_prompt_interview` instead of `handle_card_focused_interview`

---

## 🔍 Root Cause Analysis

### Why This Happens

The error occurs because the interview is being routed to the **wrong handler**. The routing logic in `send_message_to_interview` (line 1561 onwards) uses `interview.interview_mode` to determine which handler to call:

```python
if interview.interview_mode == "orchestrator":
    return await handle_orchestrator_interview(...)
elif interview.interview_mode == "meta_prompt":
    return await handle_meta_prompt_interview(...)  # <-- ERROR COMES FROM HERE
elif interview.interview_mode == "card_focused":
    return await handle_card_focused_interview(...)  # <-- SHOULD GO HERE
```

The error "Unexpected interview state (message_count=1)" comes from `handle_meta_prompt_interview` (line 313 in interview_handlers.py), which means **the interview was created with `interview_mode="meta_prompt"` instead of `interview_mode="card_focused"`**.

### Interview Creation Logic

When creating an interview, `interview_mode` is determined by:

```python
if parent_task_id is None:
    # No parent → FIRST INTERVIEW → always "meta_prompt"
    interview_mode = "meta_prompt"
else:
    # Has parent → Check if card_focused is requested
    if interview_data.use_card_focused:
        # ✅ CORRECT MODE
        interview_mode = "card_focused"
    else:
        # Fallback to orchestrator/task_orchestrated/subtask_orchestrated
        interview_mode = "orchestrator" # or based on parent type
```

**The interview will only be card_focused if BOTH conditions are true:**
1. ✅ `parent_task_id` is **NOT None** (creating a Story/Task/Subtask, not first interview)
2. ✅ `use_card_focused=true` is passed during interview creation

---

## ✅ What Was Fixed

### 1. Added card_focused Support to /start Endpoint
**File:** `backend/app/api/routes/interviews/endpoints.py` (lines 1111-1116)

**Change:** Added `elif interview.interview_mode == "card_focused"` branch to handle card-focused interviews:

```python
elif interview.interview_mode == "card_focused":
    # Card-focused interview (PROMPT #98): Get Q1 (motivation type selection)
    parent_card = None
    if interview.parent_task_id:
        parent_card = db.query(Task).filter(Task.id == interview.parent_task_id).first()
    assistant_message = get_card_focused_fixed_question(1, project, db, parent_card, {})
```

**Why:** The /start endpoint is called when beginning an interview. It must return Q1 based on the interview mode. Without this, card-focused interviews would return the wrong Q1 (from meta_prompt or another mode).

### 2. Added Debug Logging
**File:** `backend/app/api/routes/interviews/endpoints.py`

Added logging at three critical points:
- **Line 179-183:** Logs parameters received during interview creation
- **Line 238:** Logs the determined interview_mode after evaluation
- **Line 1105:** Logs the interview_mode when /start is called

This allows us to trace if the interview is being created with the wrong mode.

---

## 🔧 How to Use Card-Focused Interviews Correctly

### Prerequisites
1. **Create a parent task first** (Epic, Story, or Task)
2. **Pass the parent task ID** when creating the interview
3. **Pass `use_card_focused=true`** when creating the interview

### Step-by-Step

**Step 1: Create an Epic**
```
POST /api/v1/projects/{project_id}/tasks
{
  "title": "User Authentication System",
  "item_type": "EPIC",
  "description": "Implement auth system"
}
```
Response: `{ id: epic_id, item_type: "EPIC", ... }`

**Step 2: Create Card-Focused Interview for Story from Epic**
```
POST /api/v1/interviews
{
  "project_id": "{project_id}",
  "parent_task_id": "{epic_id}",           // ✅ REQUIRED
  "use_card_focused": true,                // ✅ REQUIRED
  "ai_model_used": "claude-sonnet-4-5",
  "conversation_data": []
}
```

Response should include:
```json
{
  "id": "interview_id",
  "interview_mode": "card_focused",        // ✅ MUST be "card_focused"
  "parent_task_id": "epic_id",
  "conversation_data": []
}
```

**Step 3: Start Interview**
```
POST /api/v1/interviews/{interview_id}/start
```

Response:
```json
{
  "success": true,
  "message": {
    "role": "assistant",
    "content": "...",
    "question_type": "single_choice",
    "model": "system/fixed-question-card-focused",
    "options": [
      { "value": "bug", "label": "🐛 Bug Fix", ... },
      { "value": "feature", "label": "✨ New Feature", ... },
      ...
    ]
  }
}
```

**Step 4: Send User Response**
```
POST /api/v1/interviews/{interview_id}/send-message
{
  "content": "feature"
}
```

This will return Q2 (Title input).

---

## 🧪 Testing the Fix

### Test Case 1: Card-Focused Interview Creation
```bash
# 1. Create project
PROJECT_ID=$(curl -X POST http://localhost:3000/api/v1/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"Test"}' | jq -r '.id')

# 2. Create Epic
EPIC_ID=$(curl -X POST http://localhost:3000/api/v1/projects/$PROJECT_ID/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Epic","item_type":"EPIC","description":"Test"}' | jq -r '.id')

# 3. Create card-focused interview
curl -X POST http://localhost:3000/api/v1/interviews \
  -H "Content-Type: application/json" \
  -d "{\"project_id\":\"$PROJECT_ID\",\"parent_task_id\":\"$EPIC_ID\",\"use_card_focused\":true,\"ai_model_used\":\"claude\",\"conversation_data\":[]}"

# Check response: interview_mode should be "card_focused"
```

### Test Case 2: Verify Routing
```bash
# 1. Start interview (should return Q1 from card_focused)
curl -X POST http://localhost:3000/api/v1/interviews/{interview_id}/start

# Check logs for:
# - "🚀 START INTERVIEW - interview_mode=card_focused"
# - "✅ INTERVIEW MODE DETERMINED: interview_mode=card_focused"
```

### Test Case 3: Send Message
```bash
# 2. Send user response
curl -X POST http://localhost:3000/api/v1/interviews/{interview_id}/send-message \
  -H "Content-Type: application/json" \
  -d '{"content":"feature"}'

# Should return Q2 (Title input), not error
```

---

## 🔍 Debugging Steps

If you get "Unexpected interview state (message_count=1)", follow these steps:

### Step 1: Check Interview Mode
```bash
curl http://localhost:3000/api/v1/interviews/{interview_id}
```

Expected:
```json
{
  "interview_mode": "card_focused",
  "parent_task_id": "...",
  "conversation_data": [ ... ]
}
```

### Step 2: Check Backend Logs
```bash
docker logs orbit-backend | grep -i "INTERVIEW MODE DETERMINED\|START INTERVIEW"
```

You should see:
```
✅ INTERVIEW MODE DETERMINED: interview_mode=card_focused
🚀 START INTERVIEW - interview_mode=card_focused
```

If you see:
```
✅ INTERVIEW MODE DETERMINED: interview_mode=meta_prompt
```

Then the issue is: **`use_card_focused` was not passed as `true` during creation**.

### Step 3: Check Request Parameters
```bash
docker logs orbit-backend | grep "CREATE INTERVIEW"
```

You should see:
```
📋 CREATE INTERVIEW - Parameters received:
  - parent_task_id: {some_uuid}
  - use_card_focused: True        # ✅ MUST be True
  - project_id: {some_uuid}
  - ai_model_used: claude-...
```

If you see `use_card_focused: False`, then the frontend is not passing the flag correctly.

---

## 📋 What Still Works

✅ **Meta Prompt Interviews** - First interview, 17 fixed questions
✅ **Orchestrator Interviews** - Hierarchical mode without motivation type
✅ **Task-Focused Interviews** - Simple task type selection
✅ **Subtask-Focused Interviews** - Atomic decomposition

---

## 🚀 Summary of Changes

### Files Modified
1. **backend/app/api/routes/interviews/endpoints.py**
   - Added card_focused support to `/start` endpoint (lines 1111-1116)
   - Added debug logging for interview creation (lines 179-183, 238, 1105)

### Commits
- `ef8428e` - fix: add card-focused mode support to interview start endpoint
- `309fbf2` - debug: add logging to interview creation and start endpoints

### What's Still Needed
1. **Frontend Update** - Ensure `use_card_focused=true` is passed when creating card-focused interviews
2. **Test Coverage** - Add end-to-end tests for full card-focused flow
3. **Documentation** - Update API documentation to explain card-focused mode usage

---

## 📚 Related Tests

All card-focused tests are passing:
- ✅ 17/17 tests in `backend/tests/test_card_focused_interviews.py`
- ✅ All 10 motivation types validated
- ✅ Fixed questions phase (Q1-Q3) verified
- ✅ AI contextual phase confirmed

See `PROMPT_98_TEST_SUITE_REPORT.md` for details.

---

## 🎯 Next Steps

1. **Verify** - Check backend logs to confirm interview_mode is correct
2. **Debug** - Use debug endpoints to check interview parameters
3. **Test** - Run end-to-end test with correct parameters
4. **Fix Frontend** - Ensure `use_card_focused=true` is passed correctly
5. **Document** - Update API docs with card-focused usage examples

---

**Generated with Claude Code**
**Date:** January 9, 2026
