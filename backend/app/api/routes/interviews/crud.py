"""
Interview CRUD Endpoints
PROMPT #261 - Refactor endpoints.py into sub-modules

HTTP endpoints for basic interview CRUD operations:
- GET /           - List interviews
- POST /          - Create interview
- GET /{id}       - Get interview
- PATCH /{id}     - Update interview
- DELETE /{id}    - Delete interview
- POST /{id}/messages - Add message to interview
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from typing import List, Optional
from uuid import UUID
from datetime import datetime
import logging

# Database and dependencies
from app.database import get_db
from app.models.interview import Interview, InterviewStatus
from app.models.project import Project
from app.models.task import Task, ItemType, TaskStatus
from app.schemas.interview import (
    InterviewCreate,
    InterviewUpdate,
    InterviewResponse,
)
from app.api.dependencies import get_interview_or_404

# Shared request models
from .models import MessageRequest

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================================
# CRUD ENDPOINTS
# ============================================================================

@router.get("/", response_model=List[InterviewResponse])
async def list_interviews(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    project_id: Optional[UUID] = Query(None, description="Filter by project ID"),
    status: Optional[InterviewStatus] = Query(None, description="Filter by status"),
    db: Session = Depends(get_db)
):
    """
    List all interviews with filtering options.

    - **project_id**: Filter by project
    - **status**: Filter by interview status (active, completed, cancelled)
    """
    query = db.query(Interview)

    if project_id:
        query = query.filter(Interview.project_id == project_id)
    if status:
        query = query.filter(Interview.status == status)

    interviews = query.order_by(Interview.created_at.desc()).offset(skip).limit(limit).all()

    return interviews


@router.post("/", response_model=InterviewResponse, status_code=status.HTTP_201_CREATED)
async def create_interview(
    interview_data: InterviewCreate,
    db: Session = Depends(get_db)
):
    """
    Create a new interview (start a new AI interview session).

    PROMPT #68 - Dual-Mode Interview System:
    - Automatically detects project state (new vs existing with code)
    - Sets interview_mode ("requirements" or "task_focused")
    - New projects: Q1-Q7 stack questions -> AI business questions
    - Existing projects: Skip stack, ask task type -> Focused questions

    - **project_id**: Project this interview belongs to (required)
    - **conversation_data**: Initial conversation data as JSON array (required)
    - **ai_model_used**: Name/ID of AI model used (required)
    - **status**: Interview status (default: active)
    """
    # Validate conversation_data is a list
    if not isinstance(interview_data.conversation_data, list):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="conversation_data deve ser um array de mensagens"
        )

    # PROMPT #76 - Detect if this is the first interview (Meta Prompt mode)
    # PROMPT #68 - Otherwise detect project state and set interview mode
    project = db.query(Project).filter(Project.id == interview_data.project_id).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Projeto {interview_data.project_id} nao encontrado"
        )

    # PROMPT #97 - Hierarchical Interview Flow
    # PROMPT #98 - Card-focused mode for Stories/Tasks (not for Epic - Epic has no motivation type)
    # Determine interview mode based on parent_task_id and use_card_focused flag
    parent_task_id = interview_data.parent_task_id

    # DEBUG: Log interview creation parameters (PROMPT #98 debugging)
    logger.info(f"CREATE INTERVIEW - Parameters received:")
    logger.info(f"  - parent_task_id: {parent_task_id}")
    logger.info(f"  - use_card_focused: {interview_data.use_card_focused}")
    logger.info(f"  - project_id: {interview_data.project_id}")
    logger.info(f"  - ai_model_used: {interview_data.ai_model_used}")

    if parent_task_id is None:
        # PROMPT #89 - Context Interview vs Meta Prompt
        # If context is NOT locked, this is a Context Interview (first interview ever)
        # If context IS locked, this is a Meta Prompt for Epic creation
        if not project.context_locked:
            # CONTEXT INTERVIEW - First interview to establish project context
            interview_mode = "context"
            logger.info(f"Creating CONTEXT interview for project {project.name}:")
            logger.info(f"  - interview_mode: context (PROMPT #89 - Establishes project context)")
            logger.info(f"  - context_locked: False (context not yet generated)")
        else:
            # EPIC CREATION - Context is locked, can create Epic
            interview_mode = "meta_prompt"
            logger.info(f"Creating EPIC interview for project {project.name}:")
            logger.info(f"  - interview_mode: meta_prompt (PROMPT #97 - Creates Epic)")
            logger.info(f"  - context_locked: True (context already established)")

        if interview_data.use_card_focused:
            logger.warning(f"  - Note: use_card_focused=true ignored for first interview")
    else:
        # HIERARCHICAL INTERVIEW - Story/Task creation
        # Card-focused mode applies here (with motivation types)
        parent_task = db.query(Task).filter(Task.id == parent_task_id).first()

        if not parent_task:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Tarefa pai {parent_task_id} nao encontrada"
            )

        # PROMPT #98 - Check if card-focused mode is requested
        if interview_data.use_card_focused:
            # Card-focused: Q1 motivation type, Q2 title, Q3 description, Q4+ AI contextual
            interview_mode = "card_focused"
            logger.info(f"Creating hierarchical interview (card-focused) from '{parent_task.title}':")
            logger.info(f"  - interview_mode: card_focused (PROMPT #98 - Creates item with motivation type)")
        else:
            # Standard hierarchical: depends on parent type
            logger.info(f"Creating hierarchical interview from '{parent_task.title}':")
            if parent_task.item_type == ItemType.EPIC:
                # Epic -> Story
                interview_mode = "orchestrator"
                logger.info(f"  - interview_mode: orchestrator (PROMPT #97 - Creates Story)")
            elif parent_task.item_type == ItemType.STORY:
                # Story -> Task
                interview_mode = "task_orchestrated"
                logger.info(f"  - interview_mode: task_orchestrated (PROMPT #97 - Creates Task)")
            else:
                # Fallback for other types
                interview_mode = "task_orchestrated"
                logger.warning(f"Unknown parent type {parent_task.item_type}, defaulting to task_orchestrated")

    # DEBUG: Log the determined interview mode (PROMPT #98 debugging)
    logger.info(f"INTERVIEW MODE DETERMINED: interview_mode={interview_mode}")

    # PROMPT #232 - IA-1 fix: Cancel existing active interview on same card before creating new
    if parent_task_id:
        active_interview = db.query(Interview).filter(
            Interview.parent_task_id == parent_task_id,
            Interview.status == "active"
        ).first()
        if active_interview:
            active_interview.status = "cancelled"
            db.flush()
            logger.info(f"Cancelled previous active interview {active_interview.id} on card {parent_task_id}")
    else:
        # PROMPT #232 - IA-1 fix: Cancel existing active context/meta_prompt interview
        active_interview = db.query(Interview).filter(
            Interview.project_id == interview_data.project_id,
            Interview.parent_task_id == None,
            Interview.status == "active"
        ).first()
        if active_interview:
            active_interview.status = "cancelled"
            db.flush()
            logger.info(f"Cancelled previous active project interview {active_interview.id}")

    db_interview = Interview(
        project_id=interview_data.project_id,
        parent_task_id=parent_task_id,  # PROMPT #97
        conversation_data=interview_data.conversation_data,
        ai_model_used=interview_data.ai_model_used,
        interview_mode=interview_mode,  # PROMPT #97 - Hierarchical mode
        created_at=datetime.utcnow()
    )

    db.add(db_interview)
    db.commit()
    db.refresh(db_interview)

    return db_interview


@router.get("/{interview_id}", response_model=InterviewResponse)
async def get_interview(
    interview: Interview = Depends(get_interview_or_404)
):
    """
    Get a specific interview by ID.

    - **interview_id**: UUID of the interview
    """
    return interview


@router.patch("/{interview_id}", response_model=InterviewResponse)
async def update_interview(
    interview_update: InterviewUpdate,
    interview: Interview = Depends(get_interview_or_404),
    db: Session = Depends(get_db)
):
    """
    Update an interview (partial update).

    - **conversation_data**: Updated conversation data (optional)
    - **ai_model_used**: Updated AI model (optional)
    - **status**: Updated status (optional)
    """
    update_data = interview_update.model_dump(exclude_unset=True)

    # Validate conversation_data if provided
    if "conversation_data" in update_data:
        if not isinstance(update_data["conversation_data"], list):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="conversation_data deve ser um array de mensagens"
            )

    for field, value in update_data.items():
        setattr(interview, field, value)

    db.commit()
    db.refresh(interview)

    return interview


@router.delete("/{interview_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_interview(
    interview: Interview = Depends(get_interview_or_404),
    db: Session = Depends(get_db)
):
    """
    Delete an interview.

    - **interview_id**: UUID of the interview to delete

    Note: This will also delete related prompts created from this interview.
    """
    db.delete(interview)
    db.commit()
    return None


@router.post("/{interview_id}/messages", response_model=InterviewResponse)
async def add_message_to_interview(
    message_request: MessageRequest,
    interview: Interview = Depends(get_interview_or_404),
    db: Session = Depends(get_db)
):
    """
    Add a new message to an interview's conversation.

    PROMPT #84 - RAG Phase 2: Interview answers are now indexed in RAG for semantic search

    - **interview_id**: UUID of the interview
    - **message**: Message object to add to conversation_data
    """
    # PROMPT #234 SM-1: Prevent adding messages to completed/cancelled interviews
    if interview.status in ('completed', 'cancelled'):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot add messages to interview with status '{interview.status}'"
        )

    if not isinstance(interview.conversation_data, list):
        interview.conversation_data = []

    interview.conversation_data.append(message_request.message)

    # Mark the conversation_data as modified for SQLAlchemy to detect the change
    flag_modified(interview, "conversation_data")  # PROMPT #99: SQLAlchemy JSONB fix

    db.flush()
    db.commit()
    db.refresh(interview)

    # PROMPT #84 - RAG Phase 2: Index user answers in RAG
    if message_request.message.get("role") == "user":
        try:
            from app.services.rag_service import RAGService

            rag_service = RAGService(db)

            # Find the previous assistant message (the question)
            question_content = None
            if len(interview.conversation_data) >= 2:
                # Look backwards for last assistant message
                for msg in reversed(interview.conversation_data[:-1]):
                    if msg.get("role") == "assistant":
                        question_content = msg.get("content", "")
                        break

            # Index the answer with metadata
            user_content = message_request.message.get("content", "")
            message_count = len(interview.conversation_data)
            question_number = (message_count - 1) // 2  # Approximate question number

            rag_service.store(
                content=user_content,
                metadata={
                    "type": "interview_answer",
                    "interview_id": str(interview.id),
                    "question_number": question_number,
                    "question": question_content or "",
                    "interview_mode": interview.interview_mode,
                    "timestamp": message_request.message.get("timestamp", datetime.utcnow().isoformat())
                },
                project_id=interview.project_id
            )

            logger.info(f"RAG: Indexed interview answer (Q{question_number}) for interview {interview.id}")

        except Exception as e:
            # Don't fail the request if RAG indexing fails
            logger.warning(f"RAG indexing failed for interview answer: {e}")

    return interview
