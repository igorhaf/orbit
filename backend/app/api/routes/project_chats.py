"""
Project Chat API Routes
PROMPT #282 - RAG Chat: Project Knowledge Chat Sessions

Provides chat sessions where users ask questions about their project
and get AI-powered answers based on the project's RAG knowledge base.

Uses async job system (like all AI operations in ORBIT) for non-blocking UI.
"""

import logging
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.database import get_db
from app.models.project import Project
from app.models.project_chat import ProjectChat
from app.schemas.project_chat import (
    ChatMessageResponse,
    ChatMessageSend,
    ProjectChatCreate,
    ProjectChatListItem,
    ProjectChatResponse,
    ProjectChatUpdate,
)

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
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

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
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    chat = ProjectChat(
        project_id=project_id,
        title=data.title if data and data.title else "Novo Chat",
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
        raise HTTPException(status_code=404, detail="Chat não encontrado")

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
        raise HTTPException(status_code=404, detail="Chat não encontrado")

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
        raise HTTPException(status_code=404, detail="Chat não encontrado")

    db.delete(chat)
    db.commit()

    logger.info(f"Deleted chat session {chat_id}")
    return {"detail": "Chat excluido com sucesso"}


# ──────────────────────────────────────────────
# Message Endpoint (async job - non-blocking)
# ──────────────────────────────────────────────

MAX_CONVERSATION_MESSAGES = 20  # Last N messages sent to AI for context


@router.post(
    "/{project_id}/chats/{chat_id}/messages",
    status_code=status.HTTP_202_ACCEPTED,
)
async def send_message(
    project_id: UUID,
    chat_id: UUID,
    data: ChatMessageSend,
    db: Session = Depends(get_db),
):
    """
    Send a user message and create a background job for AI response.

    Returns HTTP 202 with job_id immediately. Frontend polls job status.

    Flow:
    1. Store user message in chat
    2. Create async job (CHAT_MESSAGE, CRITICAL priority)
    3. Submit to PriorityJobExecutor
    4. Return job_id for polling
    """
    from app.models.async_job import JobType
    from app.services.job_manager import JobManager
    from app.services.job_executor import PriorityJobExecutor

    chat = (
        db.query(ProjectChat)
        .filter(ProjectChat.id == chat_id, ProjectChat.project_id == project_id)
        .first()
    )
    if not chat:
        raise HTTPException(status_code=404, detail="Chat não encontrado")

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    user_content = data.content.strip()
    now = datetime.now(timezone.utc).isoformat()

    # 1. Store user message BEFORE creating async job
    messages = list(chat.messages or [])
    messages.append({"role": "user", "content": user_content, "timestamp": now})
    chat.messages = messages
    flag_modified(chat, "messages")  # CRITICAL for JSON column changes

    # Auto-generate title from first user message
    if chat.title in ("New Chat", "Novo Chat") and user_content:
        chat.title = user_content[:60].strip()
        if len(user_content) > 60:
            chat.title += "..."

    db.flush()
    db.commit()
    db.refresh(chat)

    logger.info(f"Chat {chat_id}: user message stored, creating job...")

    # 2. Create async job
    deep_link = f"/projects/{project_id}?tab=chat"
    notification_title = f"Chat: {chat.title[:40]}"

    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.CHAT_MESSAGE,
        input_data={
            "project_id": str(project_id),
            "chat_id": str(chat_id),
            "user_content": user_content,
        },
        project_id=project_id,
        deep_link=deep_link,
        notification_title=notification_title,
    )

    logger.info(f"Created async job {job.id} for chat {chat_id} (priority={job.priority})")

    # 3. Submit to priority queue
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(
        job.priority,
        _process_chat_message_async,
        job.id,
        project_id,
        chat_id,
        user_content,
    )

    # 4. Return immediately (HTTP 202)
    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": f"Job criada. Use GET /api/v1/jobs/{job.id} para obter resultado.",
        "deep_link": deep_link,
        "notification_title": notification_title,
    }


# ──────────────────────────────────────────────
# Background processing function
# ──────────────────────────────────────────────

async def _process_chat_message_async(
    job_id: UUID,
    project_id: UUID,
    chat_id: UUID,
    user_content: str,
):
    """
    Background task: query RAG, call AI, store response.

    Runs in PriorityJobExecutor thread with its own DB session.
    """
    from app.database import SessionLocal
    from app.services.job_manager import JobManager
    from app.services.ai_orchestrator import AIOrchestrator
    from app.services.rag_service import RAGService
    from app.prompts.loader import PromptLoader

    db = SessionLocal()
    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        job_manager.update_progress(job_id, 10.0, "Buscando na base de conhecimento...")

        # Load chat and project
        chat = db.query(ProjectChat).filter(ProjectChat.id == chat_id).first()
        project = db.query(Project).filter(Project.id == project_id).first()

        if not chat or not project:
            job_manager.fail_job(job_id, "Chat ou projeto não encontrado")
            return

        # 1. Query RAG for relevant knowledge
        rag_context = _build_rag_context(db, project_id, user_content)
        job_manager.update_progress(job_id, 30.0, "Construindo contexto...")

        # 2. Build system prompt from YAML
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

        # 3. Build conversation messages (last N for context window)
        messages = list(chat.messages or [])
        ai_messages = _build_ai_messages(messages)

        job_manager.update_progress(job_id, 50.0, "Chamando IA...")

        # 4. Call AIOrchestrator
        orchestrator = AIOrchestrator(db)
        try:
            response = await orchestrator.execute(
                usage_type="interview",
                messages=ai_messages,
                system_prompt=system_prompt,
                max_tokens=2000,
                project_id=project_id,
            )

            ai_content = response.get("content", "Desculpe, não consegui processar sua pergunta.")
            ai_model = response.get("model", "unknown")

        except Exception as e:
            logger.error(f"AI error in chat {chat_id}: {e}")
            ai_content = "Desculpe, ocorreu um erro ao processar sua pergunta. Tente novamente."
            ai_model = "error"

        job_manager.update_progress(job_id, 80.0, "Salvando resposta...")

        # 5. Store AI response - re-query chat to avoid stale session
        ai_timestamp = datetime.now(timezone.utc).isoformat()

        # Re-fetch chat from DB (session may have expired during AI call)
        db.expire_all()
        chat = db.query(ProjectChat).filter(ProjectChat.id == chat_id).first()
        if not chat:
            job_manager.fail_job(job_id, "Chat não encontrado apos chamada de IA")
            return

        current_messages = list(chat.messages or [])
        current_messages.append({
            "role": "assistant",
            "content": ai_content,
            "timestamp": ai_timestamp,
            "model": ai_model,
        })

        chat.messages = current_messages
        flag_modified(chat, "messages")
        db.commit()

        logger.info(f"Chat {chat_id}: AI responded (model={ai_model})")

        # 6. Complete job with result
        job_manager.complete_job(job_id, {
            "role": "assistant",
            "content": ai_content,
            "timestamp": ai_timestamp,
            "model": ai_model,
        })

    except Exception as e:
        logger.error(f"Chat message job {job_id} failed: {e}", exc_info=True)
        try:
            db.rollback()
            job_manager.fail_job(job_id, str(e)[:500])
        except Exception as inner_e:
            logger.error(f"Failed to mark job {job_id} as failed: {inner_e}")
    finally:
        db.close()


# ──────────────────────────────────────────────
# Helper functions
# ──────────────────────────────────────────────

def _build_rag_context(db: Session, project_id: UUID, query: str) -> str:
    """Query RAG and build context string for the AI."""
    from app.services.rag_service import RAGService

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
