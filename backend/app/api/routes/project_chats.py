"""
Project Chat API Routes
PROMPT #282 - RAG Chat: Project Knowledge Chat Sessions

Provides chat sessions where users ask questions about their project
and get AI-powered answers based on the project's RAG knowledge base.
"""

import logging
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.project import Project
from app.models.project_chat import ProjectChat
from app.prompts.loader import PromptLoader
from app.schemas.project_chat import (
    ChatMessageResponse,
    ChatMessageSend,
    ProjectChatCreate,
    ProjectChatListItem,
    ProjectChatResponse,
    ProjectChatUpdate,
)
from app.services.ai_orchestrator import AIOrchestrator
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)

router = APIRouter()


# ──────────────────────────────────────────────
# CRUD Endpoints
# ──────────────────────────────────────────────

@router.get("/{project_id}/chats", response_model=List[ProjectChatListItem])
async def list_chats(project_id: UUID, db: Session = Depends(get_db)):
    """List all chat sessions for a project, ordered by most recent."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    chats = (
        db.query(ProjectChat)
        .filter(ProjectChat.project_id == project_id)
        .order_by(ProjectChat.updated_at.desc())
        .all()
    )

    return [
        ProjectChatListItem(
            id=chat.id,
            project_id=chat.project_id,
            title=chat.title,
            message_count=len(chat.messages) if chat.messages else 0,
            created_at=chat.created_at,
            updated_at=chat.updated_at,
        )
        for chat in chats
    ]


@router.post("/{project_id}/chats", response_model=ProjectChatResponse)
async def create_chat(
    project_id: UUID,
    data: Optional[ProjectChatCreate] = None,
    db: Session = Depends(get_db),
):
    """Create a new chat session for a project."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    chat = ProjectChat(
        project_id=project_id,
        title=data.title if data and data.title else "New Chat",
        messages=[],
    )
    db.add(chat)
    db.commit()
    db.refresh(chat)

    logger.info(f"Created chat session {chat.id} for project {project_id}")
    return chat


@router.get("/{project_id}/chats/{chat_id}", response_model=ProjectChatResponse)
async def get_chat(project_id: UUID, chat_id: UUID, db: Session = Depends(get_db)):
    """Get a chat session with all messages."""
    chat = (
        db.query(ProjectChat)
        .filter(ProjectChat.id == chat_id, ProjectChat.project_id == project_id)
        .first()
    )
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    return chat


@router.patch("/{project_id}/chats/{chat_id}", response_model=ProjectChatResponse)
async def update_chat(
    project_id: UUID,
    chat_id: UUID,
    data: ProjectChatUpdate,
    db: Session = Depends(get_db),
):
    """Update chat title."""
    chat = (
        db.query(ProjectChat)
        .filter(ProjectChat.id == chat_id, ProjectChat.project_id == project_id)
        .first()
    )
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    chat.title = data.title
    db.commit()
    db.refresh(chat)
    return chat


@router.delete("/{project_id}/chats/{chat_id}")
async def delete_chat(project_id: UUID, chat_id: UUID, db: Session = Depends(get_db)):
    """Delete a chat session."""
    chat = (
        db.query(ProjectChat)
        .filter(ProjectChat.id == chat_id, ProjectChat.project_id == project_id)
        .first()
    )
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    db.delete(chat)
    db.commit()

    logger.info(f"Deleted chat session {chat_id}")
    return {"detail": "Chat deleted"}


# ──────────────────────────────────────────────
# Message Endpoint (core RAG chat logic)
# ──────────────────────────────────────────────

MAX_CONVERSATION_MESSAGES = 20  # Last N messages sent to AI for context


@router.post(
    "/{project_id}/chats/{chat_id}/messages",
    response_model=ChatMessageResponse,
)
async def send_message(
    project_id: UUID,
    chat_id: UUID,
    data: ChatMessageSend,
    db: Session = Depends(get_db),
):
    """
    Send a user message and get an AI response based on RAG knowledge.

    Flow:
    1. Store user message
    2. Query RAG for relevant project knowledge
    3. Build system prompt with RAG context
    4. Call AIOrchestrator (usage_type=interview)
    5. Store and return AI response
    """
    chat = (
        db.query(ProjectChat)
        .filter(ProjectChat.id == chat_id, ProjectChat.project_id == project_id)
        .first()
    )
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    user_content = data.content.strip()
    now = datetime.now(timezone.utc).isoformat()

    # 1. Store user message
    messages = list(chat.messages or [])
    messages.append({"role": "user", "content": user_content, "timestamp": now})

    # 2. Query RAG for relevant knowledge
    rag_context = _build_rag_context(db, project_id, user_content)

    # 3. Build system prompt from YAML
    loader = PromptLoader()
    system_prompt, _ = loader.render(
        "context/rag_chat",
        {
            "project_name": project.name or "Project",
            "rag_context": rag_context,
            "project_description": project.description or "",
            "user_message": user_content,
        },
    )

    # 4. Build conversation messages (last N for context window)
    ai_messages = _build_ai_messages(messages)

    # 5. Call AIOrchestrator
    orchestrator = AIOrchestrator(db)
    try:
        response = await orchestrator.execute(
            usage_type="interview",
            messages=ai_messages,
            system_prompt=system_prompt,
            max_tokens=2000,
            project_id=project_id,
        )

        ai_content = response.get("content", "Desculpe, nao consegui processar sua pergunta.")
        ai_model = response.get("model", "unknown")

    except Exception as e:
        logger.error(f"AI error in chat {chat_id}: {e}")
        ai_content = "Desculpe, ocorreu um erro ao processar sua pergunta. Tente novamente."
        ai_model = "error"

    # 6. Store AI response
    ai_timestamp = datetime.now(timezone.utc).isoformat()
    messages.append({
        "role": "assistant",
        "content": ai_content,
        "timestamp": ai_timestamp,
        "model": ai_model,
    })

    chat.messages = messages

    # 7. Auto-generate title from first user message
    if chat.title == "New Chat" and user_content:
        chat.title = user_content[:60].strip()
        if len(user_content) > 60:
            chat.title += "..."

    db.commit()
    db.refresh(chat)

    logger.info(f"Chat {chat_id}: user asked, AI responded (model={ai_model})")

    return ChatMessageResponse(
        role="assistant",
        content=ai_content,
        timestamp=ai_timestamp,
        model=ai_model,
    )


# ──────────────────────────────────────────────
# Helper functions
# ──────────────────────────────────────────────

def _build_rag_context(db: Session, project_id: UUID, query: str) -> str:
    """Query RAG and build context string for the AI."""
    rag_service = RAGService(db)

    # Search all RAG document types for this project
    general_results = rag_service.retrieve(
        query=query,
        filter={"project_id": str(project_id)},
        top_k=15,
        similarity_threshold=0.4,
    )

    # Also get business rules (higher priority)
    business_rules = rag_service.get_business_rules(
        project_id=project_id,
        query=query,
        top_k=10,
        similarity_threshold=0.4,
    )

    # Build context sections
    sections = []

    if business_rules:
        rules_text = rag_service.format_business_rules_for_prompt(business_rules, max_chars=3000)
        if rules_text:
            sections.append(f"### Regras de Negocio\n{rules_text}")

    if general_results:
        # Deduplicate against business rules content
        rules_content = {r.get("content", "")[:100] for r in business_rules}
        unique_results = [
            r for r in general_results
            if r.get("content", "")[:100] not in rules_content
        ]

        if unique_results:
            general_items = []
            for r in unique_results[:10]:
                doc_type = r.get("metadata", {}).get("type", "unknown")
                similarity = r.get("similarity", 0)
                content = r.get("content", "")[:500]
                general_items.append(f"[{doc_type} | sim={similarity:.2f}]\n{content}")

            sections.append("### Documentos Relevantes\n" + "\n\n".join(general_items))

    if not sections:
        return "Nenhum conhecimento encontrado no RAG para esta pergunta."

    return "\n\n".join(sections)


def _build_ai_messages(messages: list) -> list:
    """Build message list for AIOrchestrator from chat history."""
    # Take last N messages for context
    recent = messages[-MAX_CONVERSATION_MESSAGES:]

    ai_messages = []
    for msg in recent:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role in ("user", "assistant") and content:
            ai_messages.append({"role": role, "content": content})

    return ai_messages
