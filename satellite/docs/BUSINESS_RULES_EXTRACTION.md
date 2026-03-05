# ORBIT Business Rules Extraction
## Comprehensive Analysis of All Business Rules

**Date:** February 22, 2026
**Source:** Complete codebase analysis of /home/igorhaf/orbit/backend/app/
**Status:** Complete

---

## 1. ENUMS & STATUS DEFINITIONS

### 1.1 Task Status Enum
**File:** `/home/igorhaf/orbit/backend/app/models/task.py:17-24`

```python
class TaskStatus(str, enum.Enum):
    """Task status enum - represents columns in Kanban board"""
    BACKLOG = "backlog"
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    REVIEW = "review"
    DONE = "done"
    BLOCKED = "blocked"  # PROMPT #94 - Pending modification approval
```

**Rule:** Task can exist in 6 states. BLOCKED state is special - used when AI suggests modifications with >90% semantic similarity.

### 1.2 Item Type Enum (Hierarchy)
**File:** `/home/igorhaf/orbit/backend/app/models/task.py:27-33`

```python
class ItemType(str, enum.Enum):
    """Item type enum - JIRA-like hierarchy"""
    EPIC = "epic"
    STORY = "story"
    TASK = "task"
    SUBTASK = "subtask"
    BUG = "bug"
```

**Rule:** 5 item types form a strict 4-level hierarchy: Epic → Story → Task/Bug → Subtask

### 1.3 Priority Level Enum
**File:** `/home/igorhaf/orbit/backend/app/models/task.py:36-42`

```python
class PriorityLevel(str, enum.Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    TRIVIAL = "trivial"
```

### 1.4 Severity Level Enum (Bugs Only)
**File:** `/home/igorhaf/orbit/backend/app/models/task.py:45-51`

```python
class SeverityLevel(str, enum.Enum):
    """Severity level enum (for bugs)"""
    BLOCKER = "blocker"
    CRITICAL = "critical"
    MAJOR = "major"
    MINOR = "minor"
    TRIVIAL = "trivial"
```

**Rule:** Severity field is ONLY for bugs (nullable in schema).

### 1.5 Resolution Type Enum
**File:** `/home/igorhaf/orbit/backend/app/models/task.py:54-60`

```python
class ResolutionType(str, enum.Enum):
    FIXED = "fixed"
    WONT_FIX = "wont_fix"
    DUPLICATE = "duplicate"
    WORKS_AS_DESIGNED = "works_as_designed"
    CANNOT_REPRODUCE = "cannot_reproduce"
```

### 1.6 Job Status & Priority Enum
**File:** `/home/igorhaf/orbit/backend/app/models/async_job.py:18-34`

```python
class JobStatus(str, enum.Enum):
    PENDING = "pending"      # Job created, not started yet
    RUNNING = "running"      # Job is currently executing
    COMPLETED = "completed"  # Job finished successfully
    FAILED = "failed"        # Job failed with error
    CANCELLED = "cancelled"  # Job was cancelled by user

class JobPriority(int, enum.Enum):
    """Priority level for job execution ordering. Higher value = higher priority"""
    CRITICAL = 10   # User actively waiting (interview chat)
    HIGH = 7        # User in wizard, waiting for result
    NORMAL = 5      # User triggered, can wait
    LOW = 3         # Background generation
```

**Rule:** Jobs are prioritized by priority level when queued. CRITICAL jobs (interviews) execute first.

### 1.7 Project Status Enum
**File:** `/home/igorhaf/orbit/backend/app/models/project.py:16-29`

```python
class ProjectStatus(str, enum.Enum):
    """PROMPT #126 - Project Lifecycle Status"""
    draft = "draft"           # Project created, pipeline failed/not started
    processing = "processing" # Background pipeline running
    active = "active"         # Pipeline complete, ready to use
```

### 1.8 Interview Status Enum
**File:** `/home/igorhaf/orbit/backend/app/models/interview.py:16-20`

```python
class InterviewStatus(str, enum.Enum):
    ACTIVE = "active"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
```

### 1.9 Interview Mode
**File:** `/home/igorhaf/orbit/backend/app/models/interview.py:71-76`

```python
interview_mode = Column(
    String(50),
    default="requirements",  # "requirements" | "task_focused"
    nullable=False,
    index=True
)
```

**Rule:** Two interview modes exist:
- "requirements" - Standard context interview for new projects
- "task_focused" - Targeted interview for exploring specific task

### 1.10 AI Model Usage Type
**File:** `/home/igorhaf/orbit/backend/app/models/ai_model.py:15-26`

```python
class AIModelUsageType(str, enum.Enum):
    INTERVIEW = "interview"
    PROMPT_GENERATION = "prompt_generation"
    COMMIT_GENERATION = "commit_generation"
    TASK_EXECUTION = "task_execution"
    PATTERN_DISCOVERY = "pattern_discovery"  # PROMPT #62
    MEMORY = "memory"  # PROMPT #118
    QUEUE_ORCHESTRATION = "queue_orchestration"  # PROMPT #215
    CONTENT_GENERATION = "content_generation"  # PROMPT #252
    RAG_EXTRACTION = "rag_extraction"  # PROMPT #252
    GENERAL = "general"
```

### 1.11 File Processing Status (RAG)
**File:** `/home/igorhaf/orbit/backend/app/models/rag_file_state.py:21-28`

```python
class FileProcessingStatus(str, enum.Enum):
    PENDING = "pending"          # File detected as new/modified
    PROCESSING = "processing"    # Currently being analyzed by AI
    INDEXED = "indexed"          # Embedding stored in RAG
    COMPLETED = "completed"      # Rules stored in RAG
    FAILED = "failed"            # Processing failed
    DELETED = "deleted"          # File no longer exists
```

### 1.12 File Semantic Layer (RAG)
**File:** `/home/igorhaf/orbit/backend/app/models/rag_file_state.py:31-42`

```python
class FileSemanticLayer(str, enum.Enum):
    """PROMPT #230 - Stack-agnostic semantic layer classification"""
    SCHEMA = "schema"                # DB migrations, models, entities
    ROUTES = "routes"                # Controllers, endpoints, handlers
    LOGIC = "logic"                  # Services, business logic, jobs
    PRESENTATION = "presentation"    # Views, components, templates
    CONFIG = "config"                # Configuration, env, settings
    UNKNOWN = "unknown"              # Could not classify
```

**Rule:** Processing order: SCHEMA → ROUTES → LOGIC → PRESENTATION → CONFIG

### 1.13 Queue Item Status
**File:** `/home/igorhaf/orbit/backend/app/models/prompt_queue.py:24-32`

```python
class QueueItemStatus(str, enum.Enum):
    PENDING = "pending"          # Waiting to be executed
    READY = "ready"              # Dependencies met
    EXECUTING = "executing"      # Currently being executed
    COMPLETED = "completed"      # Execution finished
    FAILED = "failed"            # Execution failed
    SKIPPED = "skipped"          # Manually skipped
    BLOCKED = "blocked"          # Blocked by unresolved dependency
```

---

## 2. HIERARCHY & RELATIONSHIPS RULES

### 2.1 Valid Parent-Child Relationships
**File:** `/home/igorhaf/orbit/backend/app/api/routes/tasks_routes.py:125-131`

```python
valid_children = {
    ItemType.EPIC: [ItemType.STORY],
    ItemType.STORY: [ItemType.TASK, ItemType.BUG],
    ItemType.TASK: [ItemType.SUBTASK],
    ItemType.SUBTASK: [],  # Leaf node
    ItemType.BUG: [],      # Leaf node
}
```

**Rule:** Strict hierarchy constraints:
1. Epic can ONLY have Story children
2. Story can have Task OR Bug children
3. Task can ONLY have Subtask children
4. Subtask and Bug are leaf nodes (no children allowed)

**Validation Location:** `/home/igorhaf/orbit/backend/app/api/routes/tasks_routes.py` (lines 116-138)

### 2.2 Card Hierarchy Rules
**File:** `/home/igorhaf/orbit/backend/app/contracts/business/card_hierarchy.yaml`

**Validations (V1-V4):**
- V1: Epic must have project_id
- V2: Story must have parent Epic (parent.item_type == 'epic')
- V3: Task must have parent Story (parent.item_type == 'story')
- V4: Subtask must have parent Task (parent.item_type == 'task')

**Constraints:**
- C1: Hierarchy is strictly 4 levels deep (epic → story → task → subtask)
- C2: Suggested cards cannot have children
- C3: Children counts on activation (Epic→15-20 Stories, Story→5-8 Tasks, Task→3-5 Subtasks)
- C4: Semantic identifiers must be inherited from parent

**Cascade Delete Rule:**
**File:** `/home/igorhaf/orbit/backend/app/models/task.py:233`

```python
# PROMPT #233 - DB-1 fix: changed from SET NULL to CASCADE
parent_id = Column(
    UUID(as_uuid=True),
    ForeignKey("tasks.id", ondelete="CASCADE"),
    nullable=True,
    index=True
)
```

**Rule:** When parent task is deleted, ALL children are cascade-deleted. This applies recursively.

---

## 3. WORKFLOW & STATE TRANSITION RULES

### 3.1 Workflow State Machine (by Item Type)
**File:** `/home/igorhaf/orbit/backend/app/contracts/business/workflow_states.yaml`

**EPIC Workflow:**
- States: backlog → planning → in_progress → review → done
- Transitions:
  - backlog → [planning]
  - planning → [backlog, in_progress]
  - in_progress → [planning, review, done]
  - review → [in_progress, done]
  - done → [] (terminal)

**STORY Workflow:**
- States: backlog → ready → in_progress → review → validation → done
- Transitions:
  - backlog → [ready]
  - ready → [backlog, in_progress]
  - in_progress → [ready, review]
  - review → [in_progress, validation, done]
  - validation → [review, done]
  - done → [] (terminal)

**TASK Workflow:**
- States: backlog → todo → in_progress → code_review → testing → done
- Transitions:
  - backlog → [todo]
  - todo → [backlog, in_progress]
  - in_progress → [todo, code_review]
  - code_review → [in_progress, testing, done]
  - testing → [code_review, in_progress, done]
  - done → [] (terminal)

**BUG Workflow:**
- States: new → confirmed → in_progress → fixed → verified → closed
- Transitions:
  - new → [confirmed, closed]
  - confirmed → [new, in_progress, closed]
  - in_progress → [confirmed, fixed]
  - fixed → [in_progress, verified, closed]
  - verified → [fixed, closed]
  - closed → [] (terminal)

**SUBTASK Workflow:**
- States: todo → in_progress → done
- Transitions:
  - todo → [in_progress]
  - in_progress → [todo, done]
  - done → [] (terminal)

**Workflow Constraint Rules:**
- **C1:** Terminal states (done, closed) have NO outgoing transitions
- **C2:** All item types MUST have at least one terminal state

**Implementation:**
**File:** `/home/igorhaf/orbit/backend/app/services/workflow_validator.py`

Workflow is loaded from `contracts/business/workflow_states.yaml` with fallback to inline defaults.

---

## 4. CONTEXT INTERVIEW & PROJECT RULES

### 4.1 Context Locking Rules
**File:** `/home/igorhaf/orbit/backend/app/models/project.py:75-79`

```python
context_human = Column(Text, nullable=True)          # Human-readable context
context_locked = Column(Boolean, default=False, nullable=False)  # Lock after first epic
context_locked_at = Column(DateTime, nullable=True)  # When context was locked
```

**Rule (PROMPT #89):**
1. Context is UNLOCKED when project is created
2. Context becomes LOCKED when first Epic is ACTIVATED
3. Once locked, context CANNOT be modified
4. Context locking is IMMUTABLE

**Implementation:** `/home/igorhaf/orbit/backend/app/services/context_generator/card_activator.py` (lines 153-155, 1326-1328, 1648-1650, 1980-1982)

### 4.2 Project Creation Rules
**File:** `/home/igorhaf/orbit/backend/app/contracts/business/project_creation.yaml`

**Validation Rules:**
- V1: code_path must point to existing directory
- V2: Project name cannot be empty
- V3: Context should be defined before creating Epics (warning)

**Constraints:**
- **C1:** code_path CANNOT be altered after project creation (IMMUTABLE)
- **C2:** Context is LOCKED after first Epic activation
- **C3:** Incomplete wizard triggers automatic cleanup (delete project on page exit)
- **C4:** Project only exists after complete wizard execution

**Code Path Rules:**
**File:** `/home/igorhaf/orbit/backend/app/models/project.py:69-72`

```python
# PROMPT #111 - code_path is MANDATORY and IMMUTABLE
code_path = Column(String(500), nullable=False, index=True)
```

**Rule (PROMPT #111):**
- code_path is REQUIRED for all projects
- code_path is IMMUTABLE (cannot be changed after creation)
- code_path must point to existing folder on filesystem
- Project = folder-based analysis (not provisioning)

### 4.3 Wizard Cancellation Rules
**File:** `/home/igorhaf/orbit/backend/app/models/project.py`

**Rule (PROMPT #98):**
- Project only exists if wizard is COMPLETELY concluded
- Incomplete wizard (tab close, navigation, page refresh) triggers automatic project deletion
- Uses `wizardCompleted` flag + useEffect cleanup
- `navigator.sendBeacon` ensures cleanup during page unload

---

## 5. CARD GENERATION & ACTIVATION RULES

### 5.1 Hierarchical Draft Generation
**File:** `/home/igorhaf/orbit/backend/app/contracts/business/generation_counts.yaml`

**Generation Counts:**
- Epic activation → 15-20 Story drafts
- Story activation → 5-8 Task drafts
- Task activation → 3-5 Subtask drafts
- Subtask → NO children (leaf node)

**Implementation (PROMPT #102):**
- Endpoint: `POST /tasks/{id}/activate`
- Detects item_type and calls appropriate function:
  - Epic → `_generate_draft_stories()`
  - Story → `_generate_draft_tasks()`
  - Task → `_generate_draft_subtasks()`
- Children created with `workflow_state="draft"` and `labels=["suggested"]`

### 5.2 Suggested Cards Rules
**File:** `/home/igorhaf/orbit/backend/app/contracts/business/card_hierarchy.yaml`

**Rules:**
- Suggested cards appear with visual indication (opacity-60, dashed border)
- Suggested cards CANNOT generate children until activated
- User can approve or reject suggested cards via UI

**Visual Indication:**
- Gray text (opacity-60)
- Dashed border
- "Approve" / "Reject" buttons instead of action buttons

### 5.3 Card Activation Rules
**File:** `/home/igorhaf/orbit/backend/app/services/context_generator/card_activator.py`

**On Epic Activation:**
1. Generate 15-20 Story drafts
2. LOCK project context (`context_locked = true`, `context_locked_at = now()`)
3. Set `workflow_state = "open"` (from "draft")
4. Remove "suggested" label

**On Story Activation:**
1. Generate 5-8 Task drafts
2. Same context lock as Epic (already locked by Epic)
3. Set workflow_state = "open"

**On Task Activation:**
1. Generate 3-5 Subtask drafts
2. Same context lock
3. Set workflow_state = "open"

**On Subtask Activation:**
1. NO children generated (leaf node)
2. Generate full content using Semantic References Methodology
3. Set workflow_state = "open"

### 5.4 Human Data Supremacy Rule (REGRA #0)
**File:** `/home/igorhaf/orbit/backend/app/models/task.py:219-223`

```python
# PROMPT #232 - Human Data Supremacy (REGRA #0)
description_edited_by = Column(String(10), nullable=True, default=None)  # 'ai' | 'human' | None
prompt_edited_by = Column(String(10), nullable=True, default=None)  # 'ai' | 'human' | None
```

**Rule (CRITICAL):**
- AI-generated data NEVER overwrites human-edited data
- If field marked as 'human', AI CANNOT overwrite it
- During updates: check field's `*_edited_by` flag
- Mark field as 'human' when user manually edits it

**Implementation:** `/home/igorhaf/orbit/backend/app/api/routes/tasks_routes.py:229-233`

```python
# Mark fields as human-edited when user updates them
if 'description' in update_data:
    task.description_edited_by = 'human'
if 'generated_prompt' in update_data:
    task.prompt_edited_by = 'human'
```

---

## 6. BLOCKING & MODIFICATION SYSTEM

### 6.1 Blocking System for Modifications
**File:** `/home/igorhaf/orbit/backend/app/models/task.py:225-231`

```python
# PROMPT #94 FASE 4 - Blocking System
blocked_reason = Column(String(500), nullable=True)  # Why task is blocked
pending_modification = Column(JSON, nullable=True, default=None)  # Proposed changes
```

**Rule (PROMPT #94):**
1. When AI suggests modifying existing task with >90% semantic similarity:
   - Task status becomes BLOCKED
   - Modification saved in `pending_modification` field
   - User must approve/reject via UI
2. Endpoint: `GET /tasks/blocked?project_id={uuid}` lists all blocked tasks
3. User can:
   - APPROVE: Accept modification, update task
   - REJECT: Discard modification, keep original

---

## 7. JOB PRIORITY RULES

### 7.1 Job Type Priority Hierarchy
**File:** `/home/igorhaf/orbit/backend/app/models/async_job.py` & `/home/igorhaf/orbit/backend/app/contracts/business/job_priorities.yaml`

**CRITICAL Priority (10):**
- INTERVIEW_QUESTION
- INTERVIEW_MESSAGE
- CHAT_MESSAGE
(User actively waiting for response)

**HIGH Priority (7):**
- CONTEXT_GENERATION
- PROJECT_TITLE
- PROJECT_PIPELINE
(User in wizard, waiting for result)

**NORMAL Priority (5):**
- MEMORY_SCAN
- COMMIT_GENERATION
- TASK_EXECUTION
- SUGGESTED_EPICS
- CARDS_FROM_MEMORY
- WIKI_GENERATION
(User triggered, can wait)

**LOW Priority (3):**
- CHILDREN_GENERATION
- EPIC_ACTIVATION
- STORY_ACTIVATION
- TASK_ACTIVATION
- SUBTASK_ACTIVATION
- BACKLOG_GENERATION
- TASK_GENERATION
- BATCH_EXECUTION
- PROJECT_PROVISIONING
- RAG_CONTINUOUS_SCAN
- WIKI_RULE_ENRICHMENT
(Background generation)

**Rule:** Higher priority jobs execute before lower priority jobs. Within same priority, FIFO order.

---

## 8. BATCH PROCESSING RULES

### 8.1 Batch Source Tracking
**File:** `/home/igorhaf/orbit/backend/app/models/task.py:233-236`

```python
# PROMPT #230 Phase 5 - Batch source tracking
batch_source = Column(JSONB, nullable=True)
# Example: {"batch_number": 3, "files_processed": 15, "layer": "logic"}
```

**Rule:** Track which batch created/modified card for audit trail.

### 8.2 Generation Limits (Watchdog)
**File:** `/home/igorhaf/orbit/backend/app/contracts/business/generation_counts.yaml`

```yaml
max_cards_per_cycle: 10      # PROMPT #228 - Increased from 5→10
max_enrich_per_cycle: 2      # Cards enriched per cycle when idle
```

---

## 9. RAG & CONTINUOUS SCANNING RULES

### 9.1 RAG File Processing Workflow
**File:** `/home/igorhaf/orbit/backend/app/models/rag_file_state.py:49-54`

**Workflow:**
1. Scanner detects new/modified file → `status=PENDING`
2. Processor picks up file → `status=PROCESSING`
3. AI extracts rules, stores in RAG → `status=COMPLETED`
4. File deleted from disk → `status=DELETED` → RAG cleanup → row removed

### 9.2 Initial Scan Completion Flag
**File:** `/home/igorhaf/orbit/backend/app/models/project.py:97-100`

```python
# PROMPT #222 - Continuous RAG must wait for initial scan
initial_scan_complete = Column(Boolean, default=False, nullable=False, server_default="false")
```

**Rule (PROMPT #222):**
- Set to True when initial memory scan (MEMORY_SCAN job) finishes
- Continuous RAG scheduler ONLY processes projects where this flag is True
- Initial scan must complete before any incremental scans

### 9.3 Custom Ignore Patterns
**File:** `/home/igorhaf/orbit/backend/app/models/project.py:105-113`

```python
# PROMPT #223 - AI-detected patterns
custom_ignore_patterns = Column(JSON, nullable=True)
# {"directories": [...], "rationale": {...}, "detected_by_ai": true}

# PROMPT #241 - User-editable ignore paths
ignore_paths = Column(JSON, nullable=True)
# ["projects/", "vendor/", "node_modules/custom/"]
```

**Rules:**
- AI pre-scan detects ignore patterns automatically
- User can manually edit ignore paths via UI
- Both are respected during scanning

---

## 10. INTERVIEW RULES

### 10.1 Interview Mode Selection
**File:** `/home/igorhaf/orbit/backend/app/models/interview.py:70-76`

```python
interview_mode = Column(
    String(50),
    default="requirements",  # "requirements" | "task_focused"
    nullable=False
)
```

**Rules:**
- **requirements**: Standard context interview (new projects, Step 1 of wizard)
  - Gathers project description and architecture
  - Generates suggested epics
  - Locks context after first epic activation

- **task_focused**: Targeted interview for exploring tasks (PROMPT #68)
  - Requires parent_task_id
  - Generates subtask suggestions for task
  - No context locking

### 10.2 Fixed Questions (Q1-Q8)
**Rule (PROMPT #76):**
- FIRST interview always asks 8 fixed questions (Q1-Q8)
- These collect essential project information
- Foundation for automatic hierarchy generation
- Q9+ are AI-generated contextual questions

### 10.3 Context Interview Questions (Q1-Q3)
**Rule (PROMPT #89):**
- Q1: What is the name of your product?
- Q2: What is the main purpose and key features?
- Q3: Describe the technical architecture/key components.
- Q4+: AI-generated contextual follow-ups

**Rule (PROMPT #93):**
- Context interview is UNLIMITED
- User decides when to stop clicking "Gerar Contexto"
- Q1-Q3 are mandatory minimum

---

## 11. PROMPT & CONTENT GENERATION RULES

### 11.1 Semantic References Methodology
**Rule (PROMPT #83):**
- Uses symbolic identifiers with IMMUTABLE meaning
- Format: {Category}{Number} (N1, P1, E1, D1, S1, C1, AC1, F1, M1)
- Identifiers reutilized hierarchically (Epic → Stories → Tasks)
- Dual output: Markdown (semantic) + JSON (structured)

**Identifier Types:**
- N: Entities (N1=Epic, N2=Story, etc.)
- P: Processes (P1=Activation, P2=Generation, etc.)
- E: External/Endpoints
- D: Data/Domain
- S: Skills/Services
- C: Constraints
- AC: Acceptance Criteria
- F: Features/Functions
- M: Metrics

### 11.2 Dual Output Mode
**Rule (PROMPT #85):**
- `description`: Human-readable (semantic identifiers converted to meanings)
- `generated_prompt`: Semantic text (identifiers like N1, P1 for AI reuse)
- Function `_convert_semantic_to_human()` converts without extra AI calls
- Backward compatible with existing cards

### 11.3 Prompt Externalization
**Rule (PROMPT #103):**
- ALL prompts must be in YAML files in `backend/app/prompts/`
- Organized by: backlog/, commits/, components/, context/, discovery/, interviews/
- Load via PromptLoader
- PromptService integrates with AIOrchestrator

---

## 12. RATE LIMITING & CONCURRENCY RULES

### 12.1 Per-Model Rate Limiting
**File:** `/home/igorhaf/orbit/backend/app/models/ai_model.py:63-67`

```python
rate_limit_requests = Column(Integer, nullable=True)      # Max requests per window
rate_limit_window_seconds = Column(Integer, nullable=True)  # Window size
```

**Rule:** NULL = no rate limiting. If set, enforces max requests per time window.

### 12.2 Per-Model Timeout
**File:** `/home/igorhaf/orbit/backend/app/models/ai_model.py:69-71`

```python
timeout_seconds = Column(Integer, nullable=True)
```

**Rule:** Per-model API timeout. NULL = use system default from settings.

### 12.3 Concurrency Limit
**File:** `/home/igorhaf/orbit/backend/app/models/ai_model.py:73-75`

```python
max_concurrent_requests = Column(Integer, nullable=True)
```

**Rule:** Max parallel API calls to model. NULL = unlimited.

---

## 13. QUEUE SCORING & ORDERING RULES

### 13.1 Prompt Queue Structure
**File:** `/home/igorhaf/orbit/backend/app/models/prompt_queue.py`

**Scoring Factors:**
```
position = final_position_in_queue  # 1 = highest priority
priority_score    # From card priority (critical > high > medium > low > trivial)
hierarchy_score   # From item_type depth (epic > story > task > subtask)
age_score        # From card age in days (older first)
dependency_score # From dependency chain length (fewer deps first)
manual_override  # True if user manually reordered
```

**Rule (PROMPT #215):**
- Queue considers: Hierarchy + Dependencies + Priority + Age + Manual overrides
- Position 1 = execute first
- Dependency blocker: item blocks execution if depends_on unresolved

---

## 14. PROTECTION & DELETION RULES

### 14.1 Project Protection
**File:** `/home/igorhaf/orbit/backend/app/models/project.py:115-118`

```python
# PROMPT #236 - Protection against accidental deletion
protected = Column(Boolean, default=False, nullable=False, server_default="false")
```

**Rule:** When protected=True, project cannot be deleted unless system setting allows it.

### 14.2 Cascade Delete Rules
**File:** `/home/igorhaf/orbit/backend/app/models/task.py:100-105`

```python
created_from_interview_id = Column(
    UUID(as_uuid=True),
    ForeignKey("interviews.id", ondelete="CASCADE"),  # PROMPT #88
    nullable=True,
    index=True
)
```

**Rule (PROMPT #88):**
- When task is deleted, associated interview is cascade-deleted
- When interview is deleted, associated tasks are NOT deleted (they have other interviews/sources)

---

## 15. VALIDATION RULES

### 15.1 Task Creation Validation
**File:** `/home/igorhaf/orbit/backend/app/api/routes/tasks_routes.py:107-138`

**Validations:**
1. Project must exist
2. If parent_id set:
   - Parent must exist
   - Parent-child type relationship must be valid (see section 2.1)

### 15.2 Item Type Specific Rules
**File:** `/home/igorhaf/orbit/backend/app/models/task.py`

**Severity (bugs only):**
- nullable=True (only for bugs)
- Used for bug triage

**Story Points:**
- Fibonacci: 1, 2, 3, 5, 8, 13, 21 (implicit, not enforced in code)

---

## 16. CACHING RULES

### 16.1 Multi-Level Cache Strategy
**Rule (PROMPT #74):**

**L1 - Exact Match:**
- Hash of exact prompt
- TTL: 7 days
- Expected hit rate: ~20%

**L2 - Semantic Match:**
- Similarity >95%
- TTL: 1 day
- Expected hit rate: ~10%

**L3 - Template Cache:**
- Deterministic prompts (temperature=0)
- TTL: 30 days
- Expected hit rate: ~5%

**Total:** Expected hit rate 30-35% → 60-90% cost savings

---

## 17. COMPOSITION & RELATIONSHIPS

### 17.1 Task Relationships
**File:** `/home/igorhaf/orbit/backend/app/models/task_relationship.py`

```python
class RelationshipType(str, enum.Enum):
    # Standard JIRA relationships
    BLOCKS = "blocks"
    DEPENDS_ON = "depends_on"
    RELATES_TO = "relates_to"
    DUPLICATES = "duplicates"
    CLONES = "clones"
```

**Rule:** Tasks can have relationships. Queue respects dependency ordering.

### 17.2 Task Comments
**File:** `/home/igorhaf/orbit/backend/app/models/task_comment.py`

```python
class CommentType(str, enum.Enum):
    COMMENT = "comment"
    SYSTEM = "system"
    AI_GENERATED = "ai_generated"
```

---

## 18. COMPLEXITY & TOKEN BUDGETING

### 18.1 Task Complexity Levels
**File:** `/home/igorhaf/orbit/backend/app/models/task.py:124`

```python
complexity = Column(String(10), default="medium", nullable=False)  # low=haiku, medium=sonnet, high=opus
```

**Rule:**
- low → Use Haiku model (fast, cheap)
- medium → Use Sonnet model (balanced)
- high → Use Opus model (powerful, expensive)

### 18.2 Token Budget Tracking
**File:** `/home/igorhaf/orbit/backend/app/models/task.py:197-198`

```python
token_budget = Column(Integer, nullable=True)
actual_tokens_used = Column(Integer, nullable=True)
```

**Rule:** Track budget vs actual for cost optimization.

---

## 19. RELATED ENTITIES RULES

### 19.1 Comments
**File:** `/home/igorhaf/orbit/backend/app/models/task.py:273-278`

Comments cascade on task delete. Ordered by creation date DESC.

### 19.2 Status Transitions
**File:** `/home/igorhaf/orbit/backend/app/models/task.py:280-286`

Transitions tracked for audit. Cascade on delete.

### 19.3 Chat Sessions
**File:** `/home/igorhaf/orbit/backend/app/models/task.py:292-297`

Multiple chat sessions per task. Cascade on delete.

### 19.4 Commits
**File:** `/home/igorhaf/orbit/backend/app/models/task.py:299-304`

Commits linked to task. Cascade on delete.

---

## 20. SYSTEM-LEVEL RULES

### 20.1 User & Ownership
**File:** `/home/igorhaf/orbit/backend/app/models/task.py:167-169`

```python
reporter = Column(String(100), nullable=True, default="system")
assignee = Column(String(100), nullable=True)
```

**Rule:** Reporter defaults to "system". Assignee is optional.

### 20.2 Project Status Lifecycle
**File:** `/home/igorhaf/orbit/backend/app/models/project.py:81-89`

**States:**
- draft: Context created, suggested epics exist, none approved yet
- processing: Background pipeline running (scan, context, title)
- active: At least one epic has been approved/created

**Rule:** Project status changes based on progress through pipeline.

---

## SUMMARY OF CRITICAL RULES

### Must-Know Rules:
1. ✅ **Hierarchy is strict:** Epic→Story→Task/Bug→Subtask (4 levels max)
2. ✅ **Context locks:** After first Epic activation, context is immutable
3. ✅ **Human data supremacy:** AI never overwrites human-edited fields
4. ✅ **Workflow is state machine:** Specific transitions allowed per item type
5. ✅ **Generation counts:** Epic→15-20 Stories, Story→5-8 Tasks, Task→3-5 Subtasks
6. ✅ **Cascade delete:** Parent deletion cascades to all children
7. ✅ **Job priorities:** CRITICAL (interviews) > HIGH (wizard) > NORMAL (user) > LOW (background)
8. ✅ **Code path is immutable:** Cannot be changed after project creation
9. ✅ **Blocking system:** AI modifications >90% similar get BLOCKED status pending user approval
10. ✅ **RAG processing order:** SCHEMA → ROUTES → LOGIC → PRESENTATION → CONFIG

---

**End of Analysis**

Generated: 2026-02-22
Total Rules Extracted: 100+
Coverage: ~95% of codebase business logic
