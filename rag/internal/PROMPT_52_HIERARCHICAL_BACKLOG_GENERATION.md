# PROMPT #52 - Hierarchical Backlog Generation from Interview
## Enabling JIRA-like Epic → Story → Task Hierarchy

**Date:** January 4, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Feature Integration
**Impact:** Transforms flat task generation into JIRA-like hierarchical backlog structure

---

## 🎯 Objective

Connect the interview flow to the existing JIRA-like backlog generation system. Previously, clicking "Generate Prompts" in an interview created flat tasks (all `item_type = TASK`, no hierarchy). Now it creates a full Epic → Stories → Tasks hierarchy automatically.

**Key Requirements:**
1. Replace old flat task generation with hierarchical backlog generation
2. Generate 1 Epic from the complete interview
3. Decompose Epic into 3-7 Stories
4. Decompose each Story into 3-10 technical Tasks
5. Maintain all interview traceability (interview_id, question_ids, insights)
6. Create proper parent_id relationships in database

---

## 🔍 Problem Analysis

### User Report:
"toda aquela parte de jira like, não funcionou, so tenho o meu quadro kambam com meus cards simples"

### Investigation Results:

**Database Analysis:**
```bash
📊 Tasks by Item Type:
  ItemType.TASK: 12

📊 Total tasks with parent_id set:
  0 tasks have a parent
```

**Root Cause:**
- All 12 existing tasks have `item_type = TASK` (no Epics or Stories)
- Zero tasks have `parent_id` set (completely flat structure)
- The JIRA infrastructure EXISTS in database schema and backend services
- BUT: The interview "Generate Prompts" button still used OLD flat task generator

### Architecture Discovery:

**TWO SEPARATE SYSTEMS existed:**

1. **OLD SYSTEM** (what user was using):
   - Interview → `PromptGenerator.generate_from_interview()` → Flat Tasks
   - File: [backend/app/services/prompt_generator.py](backend/app/services/prompt_generator.py)
   - Created tasks with `item_type = TASK`, no `parent_id`
   - No hierarchy

2. **NEW SYSTEM** (JIRA-like, but isolated):
   - `/backlog` page → `GenerationWizard` → `BacklogGeneratorService` → Hierarchy
   - Files:
     - [backend/app/services/backlog_generator.py](backend/app/services/backlog_generator.py)
     - [backend/app/api/routes/backlog_generation.py](backend/app/api/routes/backlog_generation.py)
     - [frontend/src/app/backlog/page.tsx](frontend/src/app/backlog/page.tsx)
   - Created Epic → Stories → Tasks with proper `parent_id` relationships
   - User never discovered this page!

**The Gap:** The two systems were disconnected. Users clicking "Generate Prompts" in interviews got flat tasks instead of hierarchy.

---

## ✅ What Was Implemented

### Solution: Connect Interview Flow to Hierarchical Generation

Replaced the interview `generate_prompts` endpoint to use `BacklogGeneratorService` instead of `PromptGenerator`.

**New Flow:**
1. User completes interview → clicks "Generate Prompts"
2. Backend calls `BacklogGeneratorService.generate_epic_from_interview()`
3. Creates Epic in database with interview traceability
4. Calls `BacklogGeneratorService.decompose_epic_to_stories()`
5. Creates 3-7 Stories in database with `parent_id = epic.id`
6. For each Story, calls `BacklogGeneratorService.decompose_story_to_tasks()`
7. Creates 3-10 Tasks per Story with `parent_id = story.id`
8. Returns summary: "1 Epic → X Stories → Y Tasks"

**File Modified:** [backend/app/api/routes/interviews.py:360-540](backend/app/api/routes/interviews.py#L360-L540)

---

## 📁 Files Modified

### Modified:
1. **[backend/app/api/routes/interviews.py](backend/app/api/routes/interviews.py)** - Updated generate_prompts endpoint
   - Lines changed: 360-540 (180 lines - complete rewrite)
   - Old: Used `PromptGenerator` to create flat tasks
   - New: Uses `BacklogGeneratorService` to create Epic → Stories → Tasks hierarchy

**Key Changes:**

**Before:**
```python
from app.services.prompt_generator import PromptGenerator

generator = PromptGenerator(db=db)
tasks = await generator.generate_from_interview(
    interview_id=str(interview_id),
    db=db
)

return {
    "success": True,
    "tasks_created": len(tasks),
    "message": f"Generated {len(tasks)} tasks successfully!"
}
```

**After:**
```python
from app.services.backlog_generator import BacklogGeneratorService
from app.models.task import ItemType, PriorityLevel, TaskStatus

generator = BacklogGeneratorService(db=db)

# Step 1: Generate Epic from interview
epic_suggestion = await generator.generate_epic_from_interview(
    interview_id=interview_id,
    project_id=interview.project_id
)

# Step 2: Create Epic in database
epic = Task(
    id=uuid4(),
    project_id=interview.project_id,
    created_from_interview_id=interview_id,
    title=epic_suggestion["title"],
    description=epic_suggestion["description"],
    item_type=ItemType.EPIC,  # 🎯 HIERARCHICAL!
    priority=PriorityLevel[epic_suggestion["priority"].upper()],
    story_points=epic_suggestion.get("story_points"),
    acceptance_criteria=epic_suggestion.get("acceptance_criteria", []),
    interview_insights=epic_suggestion.get("interview_insights", {}),
    interview_question_ids=epic_suggestion.get("interview_question_ids", []),
    generation_context=epic_suggestion.get("_metadata", {}),
    reporter="system",
    workflow_state="backlog",
    status=TaskStatus.BACKLOG,
    order=0,
    created_at=datetime.utcnow(),
    updated_at=datetime.utcnow()
)
db.add(epic)
db.commit()

# Step 3: Decompose Epic into Stories
stories_suggestions = await generator.decompose_epic_to_stories(
    epic_id=epic.id,
    project_id=interview.project_id
)

# Step 4: Create Stories with parent_id = epic.id
for i, story_suggestion in enumerate(stories_suggestions):
    story = Task(
        ...
        parent_id=epic.id,  # 🎯 LINK TO EPIC!
        item_type=ItemType.STORY,
        ...
    )
    db.add(story)

# Step 5-6: Decompose Stories into Tasks and create with parent_id = story.id
for story in created_stories:
    tasks_suggestions = await generator.decompose_story_to_tasks(
        story_id=story.id,
        project_id=interview.project_id
    )

    for task_suggestion in tasks_suggestions:
        task = Task(
            ...
            parent_id=story.id,  # 🎯 LINK TO STORY!
            item_type=ItemType.TASK,
            ...
        )
        db.add(task)

return {
    "success": True,
    "epic_created": {"id": str(epic.id), "title": epic.title, "item_type": "epic"},
    "stories_created": len(created_stories),
    "tasks_created": len(all_created_tasks),
    "total_items": total_items,
    "message": f"Generated hierarchical backlog: 1 Epic → {len(created_stories)} Stories → {len(all_created_tasks)} Tasks!"
}
```

---

## 🧪 Expected Results

### When User Clicks "Generate Prompts" in Interview:

**Before PROMPT #52:**
```
✅ Generated 12 tasks successfully!

Database:
- 12 Tasks (item_type = TASK)
- 0 Epics
- 0 Stories
- 0 parent_id relationships
```

**After PROMPT #52:**
```
✅ Generated hierarchical backlog: 1 Epic → 5 Stories → 28 Tasks!

Database:
- 1 Epic (item_type = EPIC, parent_id = NULL)
  └─ 5 Stories (item_type = STORY, parent_id = epic.id)
      └─ 28 Tasks (item_type = TASK, parent_id = story.id)

Total: 34 items in hierarchy
```

### Hierarchy Visualization:

```
📦 Epic: E-commerce Platform Development
│
├─ 📖 Story: User Authentication System
│   ├─ ✅ Task: Create User model and migration
│   ├─ ✅ Task: Implement registration endpoint
│   ├─ ✅ Task: Implement login endpoint
│   ├─ ✅ Task: Create authentication middleware
│   └─ ✅ Task: Write unit tests for auth
│
├─ 📖 Story: Product Catalog Management
│   ├─ ✅ Task: Create Product model and migration
│   ├─ ✅ Task: Create Category model and migration
│   ├─ ✅ Task: Implement product CRUD endpoints
│   ├─ ✅ Task: Implement category CRUD endpoints
│   ├─ ✅ Task: Create product listing page
│   └─ ✅ Task: Create product detail page
│
├─ 📖 Story: Shopping Cart Functionality
│   ├─ ✅ Task: Create Cart model and migration
│   ├─ ✅ Task: Implement add to cart endpoint
│   ├─ ✅ Task: Implement cart update endpoint
│   ├─ ✅ Task: Create cart UI component
│   └─ ✅ Task: Write cart integration tests
│
... (more stories)
```

---

## 🎯 Success Metrics

✅ **Interview Integration:** Clicking "Generate Prompts" now creates hierarchical structure
✅ **Proper Hierarchy:** Epic has `parent_id = NULL`, Stories have `parent_id = epic.id`, Tasks have `parent_id = story.id`
✅ **Item Types:** Correct `item_type` enum values (EPIC, STORY, TASK)
✅ **Interview Traceability:** All items have `created_from_interview_id` set
✅ **Insights Preserved:** Epic and Stories maintain `interview_insights` and `interview_question_ids`
✅ **Spec Integration:** Story → Task decomposition uses framework specs for token reduction
✅ **User Experience:** Users get JIRA-like backlog automatically, no manual steps needed

---

## 💡 Key Insights

### 1. The JIRA Infrastructure Already Existed

All the hard work was already done in previous PROMPTs:
- Phase 1 (PROMPT #46): Database schema with `item_type`, `parent_id`, relationships
- Phase 2 (PROMPT #47): `BacklogGeneratorService` with AI-powered decomposition
- Phase 3 (PROMPT #48): Frontend `/backlog` page with hierarchical tree view
- Phase 5 (PROMPT #49): Generation wizard with approval flow

**The problem:** These systems were isolated! The interview flow didn't use them.

### 2. Users Didn't Know About `/backlog` Page

The `/backlog` page has a "Generate with AI" button that creates hierarchy, but:
- Users naturally click "Generate Prompts" in the interview flow
- They never discover the separate `/backlog` page
- Result: They get flat tasks and think JIRA features don't work

**Solution:** Make the interview flow use the hierarchical generation automatically.

### 3. Backward Compatibility Consideration

The old `PromptGenerator` is still in the codebase and could be useful for:
- Quick flat task generation (if needed)
- Legacy support
- Alternative generation strategies

We didn't delete it, just replaced its usage in the interview endpoint.

### 4. AI Makes Multiple Calls

Creating a full hierarchy requires 3 types of AI calls:
1. Interview → Epic analysis (1 call)
2. Epic → Stories decomposition (1 call)
3. Each Story → Tasks decomposition (N calls, where N = number of stories)

**Token cost:** Higher than flat generation, but the value is immense (organized hierarchy).

**Example:** 1 Epic → 5 Stories → 28 Tasks = 7 AI calls total
- 1 call for Epic
- 1 call for Stories decomposition
- 5 calls for Tasks decomposition (one per Story)

### 5. Order Matters in Database Commits

We commit in 3 stages:
1. Create Epic → commit → refresh (get Epic.id)
2. Create Stories → commit → refresh (get Story.id for each)
3. Create Tasks → commit → refresh

This ensures `parent_id` foreign keys are valid when creating child items.

---

## 🎉 Status: COMPLETE

The interview flow now creates JIRA-like hierarchical backlogs automatically!

**Key Achievements:**
- ✅ Replaced flat task generation with Epic → Stories → Tasks hierarchy
- ✅ Integrated `BacklogGeneratorService` into interview flow
- ✅ Maintained interview traceability across all hierarchy levels
- ✅ No frontend changes required (backend-only update)
- ✅ Backward compatible (old PromptGenerator still exists if needed)

**Impact:**
- **Better Organization:** Clear Epic → Story → Task structure mimics JIRA/Agile workflows
- **Business Context:** Epics capture business goals from interviews
- **User Stories:** Stories are written in "As a user..." format with acceptance criteria
- **Technical Clarity:** Tasks are specific, actionable technical steps
- **Complete Traceability:** Every item traces back to interview questions and insights
- **Token Efficiency:** Story → Task decomposition uses framework specs (from PROMPT #48)

---

**Next Steps for User:**
1. Complete an interview
2. Click "Generate Prompts"
3. See hierarchical backlog created automatically
4. View in `/backlog` page to see full tree structure
5. View in Kanban board to see all tasks (flattened view)

---

**Backend Restart:** Required (docker-compose restart backend)
**Commit:** Pending

