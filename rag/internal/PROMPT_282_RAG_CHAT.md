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

**Send message flow:**
1. Store user message in chat.messages JSON
2. Query RAG: `rag_service.retrieve(query, project_id, top_k=15, threshold=0.4)`
3. Get business rules: `rag_service.get_business_rules(project_id, query, top_k=10)`
4. Build system prompt from YAML with RAG context
5. Build conversation history (last 20 messages)
6. Call `AIOrchestrator.execute(usage_type="interview")`
7. Store AI response and auto-generate title from first question

### 5. YAML Prompt
**File:** `backend/app/prompts/context/rag_chat.yaml`

System prompt in Portuguese instructing AI to answer based only on provided project knowledge. Variables: project_name, rag_context, project_description.

### 6. Frontend: ProjectChatPanel
**File:** `frontend/src/components/chat/ProjectChatPanel.tsx`

Split-panel layout:
- **Left sidebar** (w-64): New Chat button, sessions list with delete, active highlighting
- **Right area**: Message thread with user/assistant bubbles, Markdown rendering, typing indicator, Ctrl+Enter to send
- Empty state with helpful message
- Optimistic UI: user message shown immediately before AI responds

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
3. **`backend/app/api/routes/project_chats.py`** - API routes + RAG chat logic
4. **`backend/app/prompts/context/rag_chat.yaml`** - YAML prompt
5. **`backend/alembic/versions/20260214_create_project_chats.py`** - Migration
6. **`frontend/src/components/chat/ProjectChatPanel.tsx`** - Chat UI component

## Files Modified

1. **`backend/app/models/__init__.py`** - Added ProjectChat import
2. **`backend/app/models/project.py`** - Added chats relationship
3. **`backend/app/main.py`** - Registered project_chats router
4. **`frontend/src/app/projects/[id]/page.tsx`** - Replaced Interview tab with Chat
5. **`frontend/src/lib/api.ts`** - Added projectChatsApi

---

## Testing Results

```
OK  Python syntax: project_chat.py (model)
OK  Python syntax: project_chat.py (schemas)
OK  Python syntax: project_chats.py (routes)
OK  Database: project_chats table created
OK  Tab: Interview replaced with Chat (always visible)
OK  Chat: inline rendering in project page
```

---

## Key Insights

### 1. RAG Context Building
The chat queries ALL types of RAG documents (not just a specific type) with a low similarity threshold (0.4) to cast a wide net. Business rules are queried separately with higher priority since they're the most valuable context.

### 2. Conversation History
Last 20 messages are sent to the AI for context. This provides continuity in multi-turn conversations while keeping token usage reasonable.

### 3. Title Auto-Generation
Session title auto-generated from the first user message (first 60 chars). This avoids requiring users to name sessions manually.

### 4. Setup-context Not Deleted
The setup-context page file remains in the filesystem but is no longer linked from the project tab. It can be removed in a future cleanup if desired.

---

## Status: COMPLETE

**Key Achievements:**
- Chat tab replaces Interview tab (always visible, no conditional)
- Multiple chat sessions per project with persistence
- AI answers based on RAG knowledge (all document types + business rules)
- Clean ChatGPT-like UI with sidebar and message bubbles
- Markdown rendering for AI responses
- Card interviews remain completely unchanged
