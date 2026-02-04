# PROMPT #162 - Consolidation of Job Queue + RAG as Central Memory
## RAG-First Architecture for Semantic Context and Duplicate Detection

**Date:** February 3, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation / System Consolidation
**Impact:** Foundation for semantic memory and intelligent card deduplication

---

## Objective

Consolidate two critical systems in ORBIT:

1. **RAG as Central Memory** - All information must be persisted in RAG as local semantic context
2. **Job Queue System** - All AI operations should be asynchronous via Redis (infrastructure already exists)

**Core Principle:**
> "External AI calls should be based ONLY on the local semantic context from RAG"

---

## What Was Implemented

### Phase 1: RAG for Cards (HIGH PRIORITY)

#### 1.1 Index Cards in RAG on Create/Activate

Added new methods to `RAGService`:

- `store_card()` - Store card (Epic/Story/Task/Subtask) with full metadata
- `find_similar_cards()` - Find similar cards for duplicate detection
- `update_card()` - Update card RAG entry
- `delete_card()` - Remove card from RAG

**Integration Points:**
- `activate_suggested_epic()` - Indexes epic after activation
- `activate_suggested_story()` - Indexes story after activation
- `activate_suggested_task()` - Indexes task after activation
- `activate_suggested_subtask()` - Indexes subtask after activation

#### 1.2 Semantic Duplicate Detection (Auto-Skip)

Before creating new draft cards, the system now checks RAG for similar existing cards:

- **Threshold:** 85% similarity
- **Behavior:** Auto-skip silencioso (log only, no user notification)
- **Scope:** Project-scoped (only checks within same project)

**Implementation in:**
- `_generate_draft_stories()` - Checks before creating each story
- `_generate_draft_tasks()` - Checks before creating each task
- `_generate_draft_subtasks()` - Checks before creating each subtask

**Log Example:**
```
INFO: Skipping similar story: 'User Authentication...' (similar to 'Login System...' - 87%)
INFO: Skipped 3 duplicate stories
```

### Phase 2: RAG for Context & Interview Answers

#### 2.1 Index Project Context When Locked

When project context is locked (first Epic approved), both semantic and human context are indexed in RAG:

```python
rag_service.store_project_context(
    project_id=project.id,
    context_semantic=project.context_semantic,
    context_human=project.context_human
)
```

**Benefits:**
- Cross-project learning (find similar projects)
- Pattern reuse across projects
- Semantic search for project understanding

#### 2.2 Use Interview Answers for Card Generation

Added retrieval of relevant interview answers during card generation:

```python
relevant_answers = rag_service.get_relevant_interview_answers(
    query=f"{epic_title} {epic_description}",
    project_id=project.id,
    top_k=5,
    similarity_threshold=0.5
)
```

**Integration in:**
- `_generate_full_epic_content()` - Adds relevant answers to epic generation context
- `_generate_full_story_content()` - Adds relevant answers to story generation context

**Before (interview answers orphaned):**
```
Interview answers were stored in RAG but NEVER retrieved
```

**After (answers used for context):**
```
## RESPOSTAS RELEVANTES DA ENTREVISTA
*(O usuário mencionou isto durante a entrevista de contexto)*

- User mentioned they need OAuth authentication
- User wants two-factor authentication for admin users
```

### Phase 3: Job Queue UI Improvements

#### 3.1 Job Queue Already in Menu

Verified that `/jobs` is already present in the sidebar navigation (line 133-146 in Sidebar.tsx).

#### 3.2 JobIndicator Component

Created new component for visual job indication:

**File:** `frontend/src/components/ui/JobIndicator.tsx`

**Features:**
- Pulsing dot indicator when jobs are active
- Support for project, interview, task entities
- Size variants (sm, md, lg)
- Optional icon and progress display
- Multiple jobs indicator (+N)

**Usage:**
```tsx
// Simple pulsing dot
<JobIndicator entityType="project" entityId={project.id} />

// With icon and progress
<JobIndicator
  entityType="interview"
  entityId={interview.id}
  showIcon
  showProgress
/>

// Positioned badge
<JobIndicatorBadge
  entityType="task"
  entityId={task.id}
  position="top-right"
/>
```

---

## Files Modified/Created

### Created:
1. **[JobIndicator.tsx](frontend/src/components/ui/JobIndicator.tsx)** - New component
   - Lines: 130+
   - Features: Visual job indication for entities

### Modified:

1. **[rag_service.py](backend/app/services/rag_service.py)**
   - Added: `store_card()`, `find_similar_cards()`, `update_card()`, `delete_card()`
   - Added: `store_project_context()`, `get_relevant_interview_answers()`
   - Lines added: ~200

2. **[context_generator.py](backend/app/services/context_generator.py)**
   - Import: Added `RAGService`
   - Modified: `activate_suggested_epic()` - RAG indexing
   - Modified: `activate_suggested_story()` - RAG indexing
   - Modified: `activate_suggested_task()` - RAG indexing
   - Modified: `activate_suggested_subtask()` - RAG indexing
   - Modified: `lock_context()` - Index context in RAG
   - Modified: `_generate_draft_stories()` - Duplicate detection
   - Modified: `_generate_draft_tasks()` - Duplicate detection
   - Modified: `_generate_draft_subtasks()` - Duplicate detection
   - Modified: `_generate_full_epic_content()` - Interview answers context
   - Modified: `_generate_full_story_content()` - Interview answers context

3. **[index.ts](frontend/src/components/ui/index.ts)**
   - Added export for `JobIndicator` and `JobIndicatorBadge`

---

## Testing

### Verification Points:

```bash
# 1. Card indexing on activation
- Activate an epic -> Check logs for "Epic indexed in RAG"
- Activate a story -> Check logs for "Story indexed in RAG"

# 2. Duplicate detection
- Generate stories for an epic
- Check logs for any "Skipping similar story" messages

# 3. Context indexing
- Lock project context (approve first epic)
- Check logs for "Project context indexed in RAG"

# 4. Interview answers in context
- Generate epic content
- Check logs for "Added X relevant interview answers to epic context"

# 5. JobIndicator component
- Import and use in a page
- Verify pulsing indicator appears when jobs are active
```

---

## Success Metrics

| Metric | Before | After |
|--------|--------|-------|
| Cards indexed in RAG | Only DONE | On activation |
| Duplicate detection | Title-only | Semantic (85%) |
| Context in RAG | No | Yes (when locked) |
| Interview answers used | Never | Yes (top 5 relevant) |
| Job indication | Bell only | Entity-specific badges |

---

## Key Insights

### 1. RAG as Foundation for Intelligence
By indexing cards and context in RAG, the system now has a semantic foundation for:
- Preventing duplicate work
- Learning from past decisions
- Cross-project pattern recognition

### 2. Interview Answers Were Orphaned
Discovery: Interview answers were being stored in RAG (PROMPT #97) but **never retrieved** for any purpose. Now they're used to enrich card generation context.

### 3. Auto-Skip is Transparent
The duplicate detection uses "auto-skip silencioso" - no UI disruption, just logging. This allows the system to be intelligent without being intrusive.

### 4. Future Extensibility
The new RAG methods (`store_card`, `find_similar_cards`, etc.) provide a clean API for future features like:
- Card similarity search
- "Related cards" suggestions
- Cross-project card templates

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   RAG INGESTION PIPELINE                     │
├─────────────────────────────────────────────────────────────┤

Event                    →  Service              →  RAG Storage
────────────────────────────────────────────────────────────────

Card Activation
  Epic/Story/Task/Subtask →  store_card()        →  type: "card"
  activated                   metadata:              item_type: epic|story|task|subtask
                              card_id, parent_id,    workflow_state: open
                              labels, workflow_state

Context Locked
  First Epic approved    →  store_project_context →  type: "project_context"
                              context_semantic        context_type: semantic|human
                              context_human

Draft Generation
  New story/task/subtask →  find_similar_cards   →  If >85% similar → SKIP
  being created              (pre-create check)

Card Generation
  Epic/Story content     →  get_relevant_answers →  Interview answers
  being generated            (context enrichment)    injected into prompt

┌─────────────────────────────────────────────────────────────┐
│                   RAG RETRIEVAL PIPELINE                     │
├─────────────────────────────────────────────────────────────┤

Use Case                 →  Query Builder        →  RAG Service
────────────────────────────────────────────────────────────────

Duplicate Detection:
  New card title         →  find_similar_cards   →  Cards >85% similar

Context for Generation:
  Card title             →  get_relevant_answers →  Interview answers
                            (project scoped)        (top 5, >50% similar)
```

---

## Status: COMPLETE

The RAG consolidation is complete. All cards are now indexed on activation, duplicates are detected and auto-skipped, project context is indexed when locked, and interview answers are used to enrich card generation.

**Key Achievements:**
- Cards indexed in RAG on activation (not just when DONE)
- Semantic duplicate detection with 85% threshold
- Auto-skip silencioso for duplicate cards
- Project context indexed in RAG when locked
- Interview answers used for card generation context
- JobIndicator component created for visual job indication

**Impact:**
- Foundation for semantic intelligence across the system
- Prevents duplicate work automatically
- Uses previously orphaned interview answers
- Visual feedback for active jobs on any entity

---

**Next Steps (Future PROMPTs):**
- Phase 4: Async interviews with job system
- Phase 5: Async memory scan in wizard
- Cross-project card templates using RAG similarity

---
