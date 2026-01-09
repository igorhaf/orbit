# PROMPT #68 - Dual-Mode Interview System with Task Exploration
## Adaptive Interview Flow Based on Project State

**Date:** January 6, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Transforms interview system to intelligently adapt based on project state, enabling both greenfield and brownfield development workflows

---

## 🎯 Objective

Implement a **dual-mode interview system** that automatically adapts based on project state:

**Key Requirements:**
1. **Auto-detect project state** (new vs existing with code)
2. **NEW PROJECT MODE**: Q1-Q7 stack questions → AI business questions → Epic→Story→Task hierarchy
3. **TASK-FOCUSED MODE**: Q1 task type selection → AI focused questions → Direct task creation
4. **Task exploration**: Create sub-interviews from existing tasks
5. **AI subtask suggestions**: Show suggestions in task cards with accept/explore options
6. **Backwards compatible**: Existing interviews continue working

---

## 🔍 Pattern Analysis

### Existing Patterns Identified

**Interview System (interviews.py):**
- Large monolithic file (2462 lines)
- Complex nested routing logic in `send_message_to_interview()`
- Fixed questions Q1-Q7 for stack configuration
- AI questions via AIOrchestrator

**Pattern Applied:**
- ✅ Extract complex routing to separate `interview_handlers.py` module
- ✅ Use dependency injection (pass functions as parameters)
- ✅ Maintain async/await patterns throughout
- ✅ Follow existing HTTPException error handling

**Task System (tasks.py):**
- RESTful CRUD endpoints
- Hierarchy support (Epic→Story→Task→Subtask)
- Relationship management

**Pattern Applied:**
- ✅ Add new endpoint following existing structure
- ✅ Return consistent JSON responses
- ✅ Use SQLAlchemy session management

---

## ✅ What Was Implemented

### FASE 1: Database Schema Changes

**Migrations Created:**
1. **[20260106020000_add_interview_mode_fields.py](backend/alembic/versions/20260106020000_add_interview_mode_fields.py)**
   - Added `interview_mode` (requirements | task_focused)
   - Added `parent_task_id` FK to tasks table
   - Added `task_type_selection` (bug/feature/refactor/enhancement)
   - Index on `interview_mode` for fast filtering

2. **[20260106020100_add_task_subtask_suggestions.py](backend/alembic/versions/20260106020100_add_task_subtask_suggestions.py)**
   - Added `subtask_suggestions` JSON column
   - Format: `[{title, description, story_points}]`
   - Enables AI to suggest without creating

**Model Extensions:**
- **[backend/app/models/interview.py](backend/app/models/interview.py#L52-L94)**: Added 3 new fields + relationship
- **[backend/app/models/task.py](backend/app/models/task.py#L202-L283)**: Added subtask_suggestions + exploration_interviews relationship

---

### FASE 2: Project State Detection

**New Service:** [backend/app/services/project_state_detector.py](backend/app/services/project_state_detector.py) (195 lines)

**Detection Logic:**
```python
class ProjectState(str, Enum):
    NEW_PROJECT = "new_project"               # Empty folder or no stack
    EXISTING_NO_STACK = "existing_no_stack"   # Has code but no stack
    EXISTING_WITH_STACK = "existing_with_stack" # Has code and stack
```

**Key Methods:**
- `detect_state(project)`: Combines stack config + filesystem checks
- `should_skip_stack_questions(project)`: Returns True for existing projects
- `_has_code_files(project)`: Searches for *.php, *.js, package.json, etc.

**Testing:**
- **[backend/tests/test_project_state_detector.py](backend/tests/test_project_state_detector.py)**: 14/14 tests passing
- Covers all 3 states, edge cases, filesystem checks

---

### FASE 3: Dual-Mode Interview Routing

**New Module:** [backend/app/api/routes/interview_handlers.py](backend/app/api/routes/interview_handlers.py) (408 lines)

**Purpose:** Extract complex routing logic from interviews.py for maintainability

**Key Functions:**

1. **`handle_requirements_interview()`** - NEW PROJECT MODE
   - Q1-Q7: Fixed stack questions (no AI)
   - Q8+: AI business questions
   - Delegates to `_handle_fixed_question()` and `_handle_ai_business_question()`

2. **`handle_task_focused_interview()`** - EXISTING PROJECT MODE
   - Q1: Task type selection (bug/feature/refactor/enhancement)
   - Q2+: AI questions tailored to task type
   - Extracts task type via `extract_task_type_func()`
   - Builds type-specific prompts via `build_task_focused_prompt_func()`

**Type-Specific AI Prompts (4 variants):**
- **Bug**: Reproduction, environment, expected vs actual behavior
- **Feature**: User story, acceptance criteria, integrations
- **Refactor**: Current code, problem, desired result
- **Enhancement**: Existing functionality, desired improvement

**Simplification:**
- **Before**: `send_message_to_interview()` ~300 lines of nested if/elif
- **After**: ~40 lines calling handlers with dependency injection

**Modified:** [backend/app/api/routes/interviews.py](backend/app/api/routes/interviews.py)
- Added imports from interview_handlers
- Added `get_fixed_question_task_focused()` for Q1 task type
- Added `_extract_task_type_from_answer()` with regex matching
- Added `_build_task_focused_prompt()` with 4 type-specific prompts
- Auto-detect project state in `create_interview()`

---

### FASE 4: Direct Task Creation Endpoint

**New Endpoint:** [POST /interviews/{id}/generate-task-direct](backend/app/api/routes/interviews.py#L2138-L2188)

**Purpose:** Generate single task from task-focused interview (no Epic/Story hierarchy)

**Flow:**
1. Validate interview_mode == "task_focused"
2. Create async job (JobType.TASK_GENERATION)
3. Execute in background via `_generate_task_direct_async()`
4. Return HTTP 202 with job_id

**Background Task:**
- Progress: 10% → 30% → 100%
- Calls `BacklogGeneratorService.generate_task_from_interview_direct()`
- Updates job status (COMPLETED or FAILED)

**Service Extension:** [backend/app/services/backlog_generator.py](backend/app/services/backlog_generator.py#L481-L693) (+213 lines)

**New Method:** `generate_task_from_interview_direct()`

**AI Prompt Differences:**
- Returns 1 TASK (not Epic)
- Includes `suggested_subtasks[]` (optional)
- Tailored for bug/feature/refactor/enhancement
- Story points, acceptance criteria, labels

**Output Example:**
```json
{
  "title": "Fix login authentication bug",
  "description": "...",
  "story_points": 3,
  "priority": "high",
  "labels": ["backend", "bug"],
  "acceptance_criteria": ["Criterion 1", "Criterion 2"],
  "suggested_subtasks": [
    {"title": "Subtask 1", "description": "...", "story_points": 1}
  ],
  "interview_insights": {...}
}
```

---

### FASE 5: Task Exploration Endpoint

**New Endpoint:** [POST /tasks/{task_id}/create-interview](backend/app/api/routes/tasks.py#L996-L1107)

**Purpose:** Create task-focused interview to explore task deeper

**Use Cases:**
- Task has suggested subtasks → explore with AI
- Task is complex → break down further
- Task needs clarification

**Pre-filled Context:**
```
👋 Vou ajudá-lo a explorar a task "Task Title".

CONTEXTO DA TASK:
- Título: ...
- Descrição: ...
- Tipo: task
- Story Points: 5
- Prioridade: high
- Critérios de Aceitação:
  - Criterion 1
  - Criterion 2
- Subtasks Sugeridas:
  1. Subtask 1 (2 pts)

O que deseja fazer com esta task?
- Explorar mais detalhes sobre a implementação?
- Quebrar em subtasks menores?
- Esclarecer requisitos?
- Adicionar mais critérios de aceitação?

Me diga como posso ajudar!
```

**Response:**
```json
{
  "id": "uuid",
  "project_id": "uuid",
  "interview_mode": "task_focused",
  "parent_task_id": "uuid",
  "conversation_data": [...],
  "ai_model_used": "system",
  "status": "active",
  "created_at": "2026-01-06T...",
  "task_context": {
    "task_id": "uuid",
    "task_title": "...",
    "task_type": "task",
    "has_subtask_suggestions": true
  }
}
```

---

### FASE 6: TaskCard Component (Frontend)

**New Component:** [frontend/src/components/backlog/TaskCard.tsx](frontend/src/components/backlog/TaskCard.tsx) (310 lines)

**Features:**
1. **Display Task Details**
   - Title, description, status, priority
   - Item type icon (🎯 Epic, 📖 Story, ✓ Task, ◦ Subtask, 🐛 Bug)
   - Story points badge
   - Labels (indigo badges)

2. **Acceptance Criteria**
   - Bulleted list with ✅ prefix
   - Clean typography

3. **AI-Suggested Subtasks (Expandable)**
   - Collapsible section with count
   - Each suggestion shows title, description, story points
   - Gray background cards

4. **Action Buttons**
   - **"Accept All Subtasks"**: Creates Subtask records, clears suggestions
   - **"Create Sub-Interview"** OR **"Explore this Task"**: Navigates to new interview
   - Loading states with spinners
   - Error handling with alerts

**API Integration:**
- `tasksApi.createInterview(taskId)` - Task exploration
- `tasksApi.create(data)` - Create subtask
- `tasksApi.update(taskId, data)` - Clear suggestions
- Uses `useRouter` for navigation

**Type Safety:**
- Added `SubtaskSuggestion` interface to [frontend/src/lib/types.ts](frontend/src/lib/types.ts#L152-L156)
- Extended `Task` interface with `subtask_suggestions?: SubtaskSuggestion[]`

**API Extension:**
- Added `tasksApi.createInterview()` to [frontend/src/lib/api.ts](frontend/src/lib/api.ts#L248-L252)

---

### FASE 7: BacklogListView Integration

**Modified:** [frontend/src/components/backlog/BacklogListView.tsx](frontend/src/components/backlog/BacklogListView.tsx)

**Changes:**
1. **View Mode Toggle**
   - State: `viewMode: 'tree' | 'card'`
   - Toggle buttons: 🌲 Tree / 🃏 Cards
   - Active state styling (white bg, blue text, shadow)

2. **Tree View (Original)**
   - Hierarchical display with expand/collapse
   - Checkbox selection
   - Expand All / Collapse All buttons
   - Preserved all existing functionality

3. **Card View (NEW - PROMPT #68)**
   - Flattened hierarchy via `flattenBacklog()`
   - Uses TaskCard component for each item
   - Space-y-4 layout (vertical spacing)
   - onUpdate callback triggers fetchBacklog refresh

**Export:**
- Added TaskCard to [frontend/src/components/backlog/index.ts](frontend/src/components/backlog/index.ts#L13)

---

## 📁 Files Modified/Created

### Created:

1. **[backend/alembic/versions/20260106020000_add_interview_mode_fields.py](backend/alembic/versions/20260106020000_add_interview_mode_fields.py)** - Interview mode migration
   - Lines: 58
   - Features: interview_mode, parent_task_id, task_type_selection

2. **[backend/alembic/versions/20260106020100_add_task_subtask_suggestions.py](backend/alembic/versions/20260106020100_add_task_subtask_suggestions.py)** - Subtask suggestions migration
   - Lines: 30
   - Features: subtask_suggestions JSON column

3. **[backend/app/api/routes/interview_handlers.py](backend/app/api/routes/interview_handlers.py)** - Dual-mode routing logic
   - Lines: 408
   - Features: handle_requirements_interview, handle_task_focused_interview, type-specific prompts

4. **[backend/app/services/project_state_detector.py](backend/app/services/project_state_detector.py)** - Project state detection
   - Lines: 195
   - Features: detect_state, should_skip_stack_questions, _has_code_files

5. **[backend/tests/test_project_state_detector.py](backend/tests/test_project_state_detector.py)** - Unit tests
   - Lines: 224
   - Features: 14 test cases (all passing)

6. **[frontend/src/components/backlog/TaskCard.tsx](frontend/src/components/backlog/TaskCard.tsx)** - Task card component
   - Lines: 310
   - Features: Task display, subtask suggestions, action buttons

### Modified:

1. **[backend/app/models/interview.py](backend/app/models/interview.py)** - Extended Interview model
   - Lines changed: +15
   - Added: interview_mode, parent_task_id, task_type_selection fields

2. **[backend/app/models/task.py](backend/app/models/task.py)** - Extended Task model
   - Lines changed: +11
   - Added: subtask_suggestions, exploration_interviews relationship

3. **[backend/app/models/async_job.py](backend/app/models/async_job.py)** - Added TASK_GENERATION job type
   - Lines changed: +1
   - Added: JobType.TASK_GENERATION enum value

4. **[backend/app/api/routes/interviews.py](backend/app/api/routes/interviews.py)** - Simplified routing + new endpoint
   - Lines changed: ~-260, +190
   - Simplified: send_message_to_interview (300→40 lines)
   - Added: generate-task-direct endpoint, helper functions

5. **[backend/app/api/routes/tasks.py](backend/app/api/routes/tasks.py)** - Task exploration endpoint
   - Lines changed: +112
   - Added: POST /tasks/{task_id}/create-interview

6. **[backend/app/services/backlog_generator.py](backend/app/services/backlog_generator.py)** - Direct task generation
   - Lines changed: +213
   - Added: generate_task_from_interview_direct method

7. **[frontend/src/lib/types.ts](frontend/src/lib/types.ts)** - Type definitions
   - Lines changed: +8
   - Added: SubtaskSuggestion interface, Task.subtask_suggestions field

8. **[frontend/src/lib/api.ts](frontend/src/lib/api.ts)** - API client
   - Lines changed: +5
   - Added: tasksApi.createInterview method

9. **[frontend/src/components/backlog/BacklogListView.tsx](frontend/src/components/backlog/BacklogListView.tsx)** - View mode toggle
   - Lines changed: +82
   - Added: Tree/Card view toggle, flattenBacklog, card view rendering

10. **[frontend/src/components/backlog/index.ts](frontend/src/components/backlog/index.ts)** - Export TaskCard
    - Lines changed: +2
    - Added: TaskCard export

---

## 🧪 Testing Results

### Manual Testing:

```bash
✅ Database Migrations
   - Migrations applied successfully (alembic upgrade head)
   - No conflicts with existing schema

✅ Unit Tests
   - test_project_state_detector.py: 14/14 passing
   - All edge cases covered (new/existing, code/no-code)

✅ Code Compilation
   - Backend: No Python syntax errors
   - Frontend: No TypeScript errors
   - All imports resolved correctly

✅ API Endpoints
   - POST /interviews (auto-detects mode)
   - POST /interviews/{id}/send-message (dual routing)
   - POST /interviews/{id}/generate-task-direct (async job)
   - POST /tasks/{task_id}/create-interview (exploration)

✅ Frontend Components
   - TaskCard renders correctly
   - View toggle works (Tree ↔ Card)
   - "Accept Subtasks" creates records
   - "Create Sub-Interview" navigates correctly
```

---

## 🎯 Success Metrics

✅ **Auto-Detection**: ProjectStateDetector correctly identifies 3 states
✅ **Requirements Mode**: Q1-Q7 stack questions appear for new projects
✅ **Task-Focused Mode**: Q1 task type selection for existing projects
✅ **Direct Task Creation**: Single task generated (no Epic/Story)
✅ **AI Suggestions**: subtask_suggestions populated in task
✅ **TaskCard Display**: Shows suggestions with expand/collapse
✅ **Accept Subtasks**: Creates Subtask records correctly
✅ **Task Exploration**: Sub-interview created with task context
✅ **Backwards Compatible**: Existing interviews work (mode="requirements")
✅ **Code Quality**: Modular architecture (interview_handlers.py)

---

## 💡 Key Insights

### 1. **Code Modularization Was Critical**

**Problem**: interviews.py was 2462 lines with complex nested routing
**Solution**: Extracted 408 lines to interview_handlers.py
**Result**: Maintainability improved, send_message_to_interview simplified from 300→40 lines

**Lesson**: When files exceed ~500 lines with complex logic, extract to separate modules using dependency injection pattern.

---

### 2. **Project State Detection Enables Smart UX**

**Approach**: Combine database stack config + filesystem checks
**Result**: System adapts automatically without user selection

**Example Flow:**
```
User creates project "my-laravel-app"
→ Folder exists with composer.json, *.php files
→ ProjectStateDetector returns EXISTING_NO_STACK
→ Interview skips Q1-Q7, goes straight to Q1 task type
→ User saves ~5 minutes of redundant questions
```

---

### 3. **AI Subtask Suggestions Improve Workflow**

**Traditional**: User manually creates subtasks
**With AI Suggestions**: AI analyzes interview and suggests breakdown

**User Options:**
1. Accept all → 1-click creates all subtasks
2. Explore → Opens sub-interview to refine with AI
3. Ignore → Continue without suggestions

**Flexibility**: User stays in control, AI provides intelligent defaults

---

### 4. **Async Jobs Essential for Long Operations**

**Pattern Used:** HTTP 202 + polling
**Why**: Task generation can take 10-30 seconds with AI calls

**Benefits:**
- Non-blocking UX (user can navigate away)
- Progress tracking (10% → 30% → 100%)
- Error recovery (job status persists)

**Alternative Considered:** WebSockets (rejected: overkill for this use case)

---

### 5. **Type-Specific Prompts Increase Relevance**

**Generic Prompt Issues:**
- AI asks irrelevant questions
- User gets frustrated answering unrelated queries

**Type-Specific Prompts (4 variants):**
- **Bug**: "How do you reproduce this? What's the expected behavior?"
- **Feature**: "What's the user story? What are acceptance criteria?"
- **Refactor**: "What code needs refactoring? Why?"
- **Enhancement**: "What functionality exists? How should it improve?"

**Result**: AI asks contextually relevant questions, user provides better info

---

### 6. **Backwards Compatibility via Defaults**

**Migration Strategy:**
- `interview_mode` defaults to "requirements"
- Existing interviews automatically get default mode
- No breaking changes to API responses

**Rollback Plan:**
- Drop new columns
- Frontend falls back to old flow (tree view only)
- Zero downtime migration

---

## 🎉 Status: COMPLETE

All 7 phases successfully implemented and tested.

**Key Achievements:**
- ✅ Dual-mode interview system working
- ✅ Auto-detects project state
- ✅ Task-focused interviews for existing projects
- ✅ AI subtask suggestions with UI
- ✅ Task exploration via sub-interviews
- ✅ Tree/Card view toggle
- ✅ Backwards compatible
- ✅ 14/14 unit tests passing
- ✅ Code modularized and maintainable

**Impact:**
- **New Projects**: Existing workflow preserved (Q1-Q7 → AI → Epic→Story→Task)
- **Existing Projects**: Fast-track to task creation (skip redundant stack questions)
- **User Productivity**: AI suggests subtasks, user accepts or refines
- **Developer Experience**: Cleaner codebase with separation of concerns

**Next Steps (Future Enhancements):**
1. Add interview templates for common task types
2. Implement label selection at interview start (existing projects)
3. Add "Create Epic from Interview" for existing projects
4. Cache project state detection for performance
5. Add analytics to track interview mode usage

---

**Total Lines of Code:**
- Backend: ~1,250 lines
- Frontend: ~450 lines
- Tests: ~225 lines
- **Total: ~1,925 lines**

**Total Files:**
- Created: 6
- Modified: 10
- **Total: 16 files**

---

**Commit:** `b8eb3f3`
**Branch:** `main`
**Pushed:** ✅ Yes
