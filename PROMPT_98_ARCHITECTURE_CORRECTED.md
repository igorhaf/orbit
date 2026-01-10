# PROMPT #98 - Card-Focused Architecture (CORRECTED)
## Epic vs Hierarchical Interviews - Clarification

**Date:** January 9, 2026
**Status:** ✅ CORRECTED & EXPLAINED
**Type:** Architecture Documentation
**Key Change:** Card-focused is ONLY for hierarchical interviews (Story/Task/Subtask), NOT for Epic

---

## 🎯 The Insight

**Epic is not a work item - it's the project itself.**

When creating the first interview, you're defining the **Epic** (the big goal/project). Epics don't have a motivation type because they're not a type of work - they're the container for work.

Motivation types are for **Stories, Tasks, and Subtasks** - the actual work items that fall under the Epic.

---

## 📊 Interview Architecture (CORRECTED)

```
┌─────────────────────────────────────────────────────────────────┐
│                    FIRST INTERVIEW (Epic Creation)              │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  No parent_task_id                                               │
│  ↓                                                                │
│  ALWAYS: meta_prompt mode (17 questions)                        │
│  - Q1-Q8: Stack configuration                                    │
│  - Q9+: AI contextual questions (business/design/mobile)        │
│  ↓                                                                │
│  OUTPUT: Epic with project specifications                        │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                             ↓ (Create hierarchical interviews from Epic)
┌─────────────────────────────────────────────────────────────────┐
│          HIERARCHICAL INTERVIEWS (Story/Task/Subtask)           │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  parent_task_id = Epic/Story/Task ID                            │
│  ↓                                                                │
│  ┌──────────────────────────────────────────────────────┐       │
│  │ use_card_focused = true (OPTIONAL)                   │       │
│  │                                                      │       │
│  │ Card-Focused Mode: Q1-Q3 fixed + AI contextual     │       │
│  │ - Q1: Motivation type (bug, feature, design, etc.) │       │
│  │ - Q2: Title                                         │       │
│  │ - Q3: Description                                   │       │
│  │ - Q4+: AI contextual (motivation-aware)             │       │
│  │                                                      │       │
│  │ OUTPUT: Story/Task/Subtask with motivation type    │       │
│  └──────────────────────────────────────────────────────┘       │
│  │                                                              │
│  └──────────────────────────────────────────────────────┐       │
│  │ use_card_focused = false (DEFAULT)                   │       │
│  │                                                      │       │
│  │ Standard Hierarchical Mode:                          │       │
│  │ - Epic → Story: orchestrator (8 questions + AI)    │       │
│  │ - Story → Task: task_orchestrated (2 + AI)         │       │
│  │ - Task → Subtask: subtask_orchestrated (2 + AI)    │       │
│  │                                                      │       │
│  │ OUTPUT: Story/Task/Subtask without motivation type  │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Interview Mode Decision Tree

```python
if parent_task_id is None:
    # FIRST INTERVIEW - EPIC CREATION
    interview_mode = "meta_prompt"  # Always! Epic has no motivation type

else:
    # HIERARCHICAL INTERVIEW - Story/Task/Subtask Creation
    parent_task = get_parent_task(parent_task_id)

    if use_card_focused == True:
        interview_mode = "card_focused"  # Q1: motivation type + Q2-Q3 fixed + AI

    else:
        # Determine mode based on parent type
        if parent_task.item_type == "EPIC":
            interview_mode = "orchestrator"         # Epic → Story
        elif parent_task.item_type == "STORY":
            interview_mode = "task_orchestrated"    # Story → Task
        elif parent_task.item_type == "TASK":
            interview_mode = "subtask_orchestrated" # Task → Subtask
```

---

## 🎨 Interview Modes (Updated)

### 1️⃣ Meta-Prompt Mode
**Used for:** First interview (Epic creation)
**Questions:** 17 fixed + AI contextual
**Duration:** Comprehensive
**Output:** Epic with full project specifications

### 2️⃣ Card-Focused Mode (NEW!)
**Used for:** Hierarchical interviews when motivation type is needed
**Questions:** 3 fixed (motivation type + title + description) + AI contextual
**Duration:** Fast
**Motivation Types:** 10 options (bug, feature, design, etc.)
**Output:** Story/Task/Subtask with motivation type

### 3️⃣ Orchestrator Mode
**Used for:** Hierarchical interviews (Epic → Story, default)
**Questions:** 8 fixed + AI contextual
**Duration:** Medium
**Output:** Story without motivation type

### 4️⃣ Task-Orchestrated Mode
**Used for:** Hierarchical interviews (Story → Task, default)
**Questions:** 2 fixed + AI contextual
**Duration:** Quick
**Output:** Task without motivation type

### 5️⃣ Subtask-Orchestrated Mode
**Used for:** Hierarchical interviews (Task → Subtask, default)
**Questions:** 2 fixed + AI contextual
**Duration:** Quick
**Output:** Subtask without motivation type

---

## 💡 When to Use Card-Focused

**Card-Focused is best for:**
- Creating Stories/Tasks/Subtasks from an Epic
- When you want to categorize work by type (bug, feature, design, etc.)
- Quick interviews that don't need full specification
- Teams that prefer motivation-driven organization

**Standard Hierarchical is best for:**
- Creating Stories with full specification (orchestrator)
- Creating Tasks/Subtasks with context from parent
- When motivation type is not important
- Following default hierarchical flow

---

## 📝 Code Changes

### Backend (`endpoints.py`)
**Before:** Card-focused could work without parent (for Epic)
**After:** Card-focused only works with parent_task_id (hierarchical only)

```python
# CORRECTED LOGIC
if parent_task_id is None:
    # Epic - always meta_prompt
    interview_mode = "meta_prompt"
    if use_card_focused:
        logger.warning("use_card_focused=true ignored for Epic")
else:
    # Hierarchical - check use_card_focused
    if use_card_focused:
        interview_mode = "card_focused"
    else:
        interview_mode = get_mode_for_parent_type(parent_task)
```

### Frontend (`InterviewList.tsx`)
**Before:** Had checkbox to choose card-focused for Epic
**After:** No checkbox - explains card-focused is for hierarchical

```tsx
// Removed: useCardFocused state
// Removed: Card-focused toggle checkbox
// Added: Info message about card-focused being for hierarchical

<div className="bg-blue-50 p-4 rounded">
  <p>This interview will create an Epic for your project.</p>
  <p>Card-focused mode is available for hierarchical interviews
     (Stories, Tasks, Subtasks) created from this Epic.</p>
</div>
```

---

## 🔑 Key Points

### Epic (First Interview)
- ✅ Always meta-prompt mode (17 questions)
- ✅ Gathers comprehensive project information
- ❌ No motivation type (Epic is not a work item)
- ❌ Card-focused not applicable

### Stories/Tasks/Subtasks (Hierarchical)
- ✅ Default: orchestrator/task_orchestrated/subtask_orchestrated
- ✅ Optional: card-focused mode (if use_card_focused=true)
- ✅ Motivation type available in card-focused mode
- ✅ Parent context automatically passed

---

## 📊 Example Flows

### Flow 1: Standard Project Creation
```
1. User creates project
2. Clicks "New Interview"
3. Meta-prompt interview starts (Q1-Q17)
   - Questions about stack, business, design, etc.
4. Epic created with full specifications
5. User can now create Stories from Epic
```

### Flow 2: Create Story with Card-Focused
```
1. User views Epic in Backlog
2. Clicks "Create Interview" on Epic
3. Selects use_card_focused=true
4. Card-focused interview starts
   - Q1: "What's the motivation? (bug, feature, design, etc.)"
   - Q2: "Story title?"
   - Q3: "Story description?"
   - Q4+: AI contextual questions
5. Story created with motivation type
```

### Flow 3: Create Story with Standard Mode
```
1. User views Epic in Backlog
2. Clicks "Create Interview" on Epic (default)
3. Orchestrator interview starts
   - Q1-Q8: Standard story questions
   - Q9+: AI contextual
4. Story created without motivation type
```

---

## 🎯 Why This Design?

### 1. Semantic Clarity
**Epic ≠ Work Item**
- Epic is the project goal/container
- Stories/Tasks/Subtasks are work items
- Only work items have a "type of work" (motivation)

### 2. Simplicity
**One mode for first interview**
- No user confusion about Epic options
- Always comprehensive (meta-prompt)
- Card-focused is optional enhancement for hierarchical

### 3. Flexibility
**Two options for hierarchical**
- Default: Standard mode (full specification)
- Optional: Card-focused (quick + motivation type)

### 4. Progressive Disclosure
**Complexity increases with hierarchy**
- First interview: Comprehensive (need full project specs)
- Hierarchical: Choose detail level (standard vs quick)

---

## ✅ Status

**Architecture:** ✅ CORRECTED
**Backend:** ✅ Implemented correctly
**Frontend:** ✅ Updated to match architecture
**Tests:** ✅ Still 17/17 passing
**Documentation:** ✅ This document

---

## 🚀 Next Steps

1. **Frontend Hierarchical Creation** (future)
   - Add "Create Interview" button to Epic/Story/Task cards
   - Allow selecting card-focused or standard mode
   - Auto-fill parent_task_id

2. **Card-Focused Enhancement** (future)
   - Maybe add card-focused option for first interview?
   - Or keep Epic always meta-prompt for consistency?

---

**PROMPT #98 Architecture:** ✅ CORRECTED & DOCUMENTED

🤖 Generated with Claude Code
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
