# PROMPT #282 - RAG Chat: Replace Interview Tab with Project Knowledge Chat
## Chat system for querying project knowledge base via RAG

**Date:** 2026-02-14
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** New chat interface replaces Interview tab - users can ask questions about their project and get AI-powered answers from RAG knowledge base

---

## Objective

Replace the Interview tab (which redirected to setup-context wizard) with a **RAG-based chat system**. The chat is simple and user-driven: user asks questions, AI answers using the project's RAG knowledge base as memory.

**Key Differences from Interview:**
- User-driven: user asks, AI answers (not the other way around)
- RAG-powered: searches all project documents to build context
- Multiple sessions: like ChatGPT, user can have multiple conversations
- Inline: renders directly inside the project tab (no page navigation)
- Uses interview AI flow (usage_type="interview") for model selection
- Completely isolated from card interviews (which remain unchanged)

---

## What Was Implemented

### 1. Backend Model: ProjectChat
**File:** `backend/app/models/project_chat.py`

SQLAlchemy model with: id, project_id (FK CASCADE), title, messages (JSON array), timestamps. Messages stored as JSON array with role/content/timestamp/model.

### 2. Database Migration
**File:** `backend/alembic/versions/20260214_create_project_chats.py`

Creates `project_chats` table with indexes on project_id and project_id+created_at.

### 3. Pydantic Schemas
**File:** `backend/app/schemas/project_chat.py`

Schemas: ProjectChatCreate, ProjectChatUpdate, ProjectChatResponse, ProjectChatListItem, ChatMessageSend, ChatMessageResponse.

### 4. API Routes (Core Logic)
**File:** `backend/app/api/routes/project_chats.py`

6 endpoints:
- `GET /projects/{id}/chats` - List sessions
- `POST /projects/{id}/chats` - Create session
- `GET /projects/{id}/chats/{chat_id}` - Get session with messages
- `DELETE /projects/{id}/chats/{chat_id}` - Delete session
- `PATCH /projects/{id}/chats/{chat_id}` - Update title
- `POST /projects/{id}/chats/{chat_id}/messages` - **Send message (core)**

**Send message flow (async job pattern):**
1. Store user message in chat.messages JSON (committed to DB before job)
2. Create async job (CHAT_MESSAGE type, CRITICAL priority=10)
3. Submit to PriorityJobExecutor
4. Return HTTP 202 with job_id immediately
5. Background task: Query RAG (retrieve + get_business_rules)
6. Build system prompt from YAML with RAG context
7. Build conversation history (last 20 messages)
8. Call `AIOrchestrator.execute(usage_type="interview")`
9. Re-fetch chat from DB (session may expire during AI call)
10. Store AI response and auto-generate title from first question
11. Complete job with result

### 5. YAML Prompt
**File:** `backend/app/prompts/context/rag_chat.yaml`

System prompt in Portuguese instructing AI to answer based only on provided project knowledge. Variables: project_name, rag_context, project_description.

### 6. Frontend: ProjectChatPanel
**File:** `frontend/src/components/chat/ProjectChatPanel.tsx`

Split-panel layout:
- **Left sidebar** (w-64): New Chat button, sessions list with delete, active highlighting
- **Right area**: Message thread with user/assistant bubbles, Markdown rendering, typing indicator with progress messages, Enter to send / Shift+Enter for newline
- Empty state with helpful message
- Optimistic UI: user message shown immediately before AI responds
- Job polling via `jobsApi.poll()` with real-time progress display
- Auto-selects most recent session on load

### 7. Project Page Tab Replacement
**File:** `frontend/src/app/projects/[id]/page.tsx`

- Removed conditional Interview tab (was hidden when context_locked)
- Added permanent "Chat" tab (always visible)
- Removed router.push to setup-context
- Renders ProjectChatPanel inline when Chat tab selected

### 8. API Client
**File:** `frontend/src/lib/api.ts`

Added `projectChatsApi` with: list, create, get, delete, updateTitle, sendMessage.

---

## Files Created

1. **`backend/app/models/project_chat.py`** - SQLAlchemy model
2. **`backend/app/schemas/project_chat.py`** - Pydantic schemas
3. **`backend/app/api/routes/project_chats.py`** - API routes + async job RAG chat logic
4. **`backend/app/prompts/context/rag_chat.yaml`** - YAML prompt
5. **`backend/alembic/versions/20260214_create_project_chats.py`** - Migration (project_chats table)
6. **`backend/alembic/versions/20260214_add_chat_message_jobtype.py`** - Migration (chat_message enum)
7. **`frontend/src/components/chat/ProjectChatPanel.tsx`** - Chat UI component

## Files Modified

1. **`backend/app/models/__init__.py`** - Added ProjectChat import
2. **`backend/app/models/project.py`** - Added chats relationship
3. **`backend/app/models/async_job.py`** - Added CHAT_MESSAGE job type + CRITICAL priority
4. **`backend/app/contracts/business/job_priorities.yaml`** - Added chat_message: 10
5. **`backend/app/main.py`** - Registered project_chats router
6. **`frontend/src/app/projects/[id]/page.tsx`** - Replaced Interview tab with Chat
7. **`frontend/src/lib/api.ts`** - Added projectChatsApi

---

## Testing Results

```
OK  Python syntax: project_chat.py (model)
OK  Python syntax: project_chat.py (schemas)
OK  Python syntax: project_chats.py (routes)
OK  Database: project_chats table created
OK  Tab: Interview replaced with Chat (always visible)
OK  Chat: inline rendering in project page
OK  Async job: CHAT_MESSAGE created with CRITICAL priority (10)
OK  Job polling: progress updates (10% → 30% → 50% → 80% → 100%)
OK  AI response: RAG-powered answer stored in chat.messages
OK  Title: auto-generated from first user message
OK  Session persistence: re-query chat after AI call prevents stale session
```

---

## Key Insights

### 1. RAG Context Building
The chat queries ALL types of RAG documents (not just a specific type) with a low similarity threshold (0.4) to cast a wide net. Business rules are queried separately with higher priority since they're the most valuable context.

### 2. Conversation History
Last 20 messages are sent to the AI for context. This provides continuity in multi-turn conversations while keeping token usage reasonable.

### 3. Title Auto-Generation
Session title auto-generated from the first user message (first 60 chars). This avoids requiring users to name sessions manually.

### 4. Async Job Pattern
Chat uses the standard ORBIT async job pattern (like all AI operations). The `send_message` endpoint returns HTTP 202 immediately with a job_id. The background task runs in `PriorityJobExecutor` with its own DB session. Critical fix: must `db.expire_all()` and re-query the chat after the AI call to avoid stale session errors.

### 5. Setup-context Not Deleted
The setup-context page file remains in the filesystem but is no longer linked from the project tab. It can be removed in a future cleanup if desired.

---

## Status: COMPLETE

**Key Achievements:**
- Chat tab replaces Interview tab (always visible, no conditional)
- Multiple chat sessions per project with persistence
- AI answers based on RAG knowledge (all document types + business rules)
- Async job system integration (CHAT_MESSAGE, CRITICAL priority)
- Job visible in Jobs page with progress updates
- Clean ChatGPT-like UI with sidebar and message bubbles
- Markdown rendering for AI responses
- Enter to send, Shift+Enter for newline
- Card interviews remain completely unchanged
