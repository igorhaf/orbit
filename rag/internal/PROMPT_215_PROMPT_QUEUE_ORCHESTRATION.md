# PROMPT #215 - Prompt Orchestration Priority Queue
## Execution Queue with Hierarchy, Priority, Dependencies, and Age Scoring

**Date:** February 9, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Cards/prompts are now organized in an intelligent execution queue that ensures correct order, preventing code breaks and improving consistency

---

## 🎯 Objective

Create a prompt orchestration priority queue that orders card/prompt execution by:
1. **Hierarchy** - Epics before Stories before Tasks before Subtasks (parent must execute before children)
2. **Priority** - Critical > High > Medium > Low > Trivial
3. **Dependencies** - Cards with fewer unresolved dependencies execute first
4. **Age** - Older cards as tiebreaker (first-in, first-served)
5. **Manual overrides** - User can drag-to-reorder

Plus integration with Settings, AI Flow diagram, and AI Models.

**Key Requirements:**
1. Per-project queue with position-based ordering
2. Auto-sort with configurable strategy weights
3. Topological sort for parent-before-child guarantee
4. Drag-and-drop manual reordering
5. Configurable in Settings page
6. New node type in AI Flow diagram
7. New usage_type in AI Models

---

## ✅ What Was Implemented

### 1. Database Model (`PromptQueue`)
- Per-project queue entries linking to Tasks
- Position-based ordering (1 = highest priority)
- Status tracking: pending, ready, executing, completed, failed, skipped, blocked
- Scoring factors stored: hierarchy_score, priority_score, age_score, dependency_score
- Manual override flag for user-reordered items
- Execution tracking (job_id, notes, executed_at)

### 2. Scoring Algorithm
- **Hierarchy Score** (0-100): Epic=100, Story=75, Bug=60, Task=50, Subtask=25
- **Priority Score** (0-100): Critical=100, High=80, Medium=50, Low=25, Trivial=10
- **Age Score** (0-100): Days since creation, capped at 100
- **Dependency Score** (0-100): Fewer deps = higher score (100 - deps*20)
- **5 Strategies**: balanced, hierarchy_first, priority_first, dependency_first, age_first

### 3. Topological Sort
Auto-sort resolves parent-child ordering: if parent and child are both in queue, parent always comes first. This ensures code consistency.

### 4. API Routes (8 endpoints)
- `GET /projects/{id}/queue` - Get full queue ordered by position
- `POST /projects/{id}/queue` - Add single card
- `POST /projects/{id}/queue/bulk` - Add multiple cards
- `DELETE /projects/{id}/queue/{item_id}` - Remove item
- `DELETE /projects/{id}/queue` - Clear completed
- `PUT /projects/{id}/queue/reorder` - Manual drag-drop reorder
- `POST /projects/{id}/queue/auto-sort` - Auto-sort with strategy
- `POST /projects/{id}/queue/populate` - Auto-populate from project cards
- `PATCH /projects/{id}/queue/{item_id}/status` - Update status
- `GET /projects/{id}/queue/stats` - Queue statistics

### 5. Frontend Queue Tab
- New "Queue" tab in project page
- Visual score bars (purple=hierarchy, orange=priority, blue=age, green=deps)
- Drag-and-drop reordering
- Auto-sort with strategy selector
- Populate from cards button
- Status badges with color coding
- Skip/Remove actions per item
- Clear completed button

### 6. Settings Integration
- `queue_auto_sort_strategy` - Default sorting strategy
- `queue_max_concurrent` - Max concurrent executions (1-5)
- `queue_auto_populate` - Auto-add activated cards to queue

### 7. AI Flow Integration
- New `prompt_queue` utility node type
- Purple color (#8b5cf6), list-ordered icon
- Config: strategy, max_concurrent, auto_populate
- Description explaining hierarchy and dependency ordering

### 8. AI Models Integration
- New `queue_orchestration` usage type
- Can configure specific AI model for queue execution
- Selectable in Settings default models
- Migration to add enum value to PostgreSQL

---

## 📁 Files Created

1. **backend/app/models/prompt_queue.py** - Database model + QueueItemStatus enum
2. **backend/app/schemas/prompt_queue.py** - Pydantic schemas (10 schemas)
3. **backend/app/api/routes/prompt_queue.py** - API routes (8 endpoints)
4. **backend/alembic/versions/20260209_create_prompt_queue.py** - Create table migration
5. **backend/alembic/versions/20260209_add_queue_orchestration_usage_type.py** - Add enum value migration
6. **frontend/src/components/backlog/PromptQueuePanel.tsx** - Queue UI component

## 📁 Files Modified

1. **backend/app/models/__init__.py** - Register PromptQueue model
2. **backend/app/models/ai_model.py** - Add QUEUE_ORCHESTRATION usage type
3. **backend/app/api/routes/__init__.py** - Register prompt_queue routes
4. **backend/app/api/routes/system_settings.py** - Add default queue settings
5. **backend/app/api/routes/ai_flow.py** - Add prompt_queue utility node type
6. **backend/app/schemas/ai_flow_chain.py** - Add prompt_queue to utility node types
7. **backend/app/main.py** - Register prompt_queue router
8. **frontend/src/lib/types.ts** - Add PromptQueueItem, PromptQueueResponse, QUEUE_ORCHESTRATION
9. **frontend/src/lib/api.ts** - Add promptQueueApi client
10. **frontend/src/app/projects/[id]/page.tsx** - Add Queue tab
11. **frontend/src/app/settings/page.tsx** - Add queue settings section + queue_orchestration model

---

## 🧪 Testing Results

```
✅ Database model created with proper constraints (unique project+task)
✅ 8 API endpoints implemented with scoring algorithm
✅ Topological sort ensures parent-before-child ordering
✅ 5 sort strategies with configurable weights
✅ Drag-and-drop reordering in frontend
✅ Visual score bars for each factor
✅ Settings page with queue configuration
✅ AI Flow prompt_queue node type registered
✅ AI Models queue_orchestration usage type added
```

---

## 🎯 Success Metrics

✅ **Correct ordering**: Parents execute before children
✅ **Priority respect**: Higher priority cards rise to top
✅ **Dependency resolution**: Cards with fewer deps execute first
✅ **Age fairness**: Older cards don't get stuck forever
✅ **Manual control**: Users can override with drag-and-drop
✅ **Full integration**: Settings, AI Flow, AI Models all connected

---

## 🎉 Status: COMPLETE

The prompt orchestration priority queue is fully implemented with smart ordering, visual management, and integration across Settings, AI Flow, and AI Models.

**Key Achievements:**
- ✅ Per-project execution queue with position-based ordering
- ✅ 4-factor scoring (hierarchy, priority, dependency, age) with 5 strategies
- ✅ Topological sort guaranteeing parent-before-child execution
- ✅ Drag-and-drop UI with visual score indicators
- ✅ Settings configuration for queue behavior
- ✅ AI Flow diagram node type
- ✅ AI Models usage type for queue execution

---
