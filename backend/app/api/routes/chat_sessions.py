"""
Chat Sessions API Router
CRUD operations for managing chat sessions during task execution.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel

from app.database import get_db
from app.models.chat_session import ChatSession, ChatSessionStatus
from app.models.ai_model import AIModel, AIModelUsageType
from app.schemas.chat_session import ChatSessionCreate, ChatSessionUpdate, ChatSessionResponse
from app.api.dependencies import get_chat_session_or_404

router = APIRouter()


class MessageRequest(BaseModel):
    """Request model for adding a message to a chat session."""
    message: dict


class StatusUpdateRequest(BaseModel):
    """Request model for updating chat session status."""
    status: ChatSessionStatus


class SendMessageRequest(BaseModel):
    """Request model for sending a message and getting AI response."""
    content: str


@router.get("/", response_model=List[ChatSessionResponse])
async def list_chat_sessions(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    task_id: Optional[UUID] = Query(None, description="Filter by task ID"),
    status: Optional[ChatSessionStatus] = Query(None, description="Filter by status"),
    db: Session = Depends(get_db)
):
    """
    List all chat sessions with filtering.

    - **task_id**: Filter by task
    - **status**: Filter by session status (active, completed, failed)
    """
    query = db.query(ChatSession)

    if task_id:
        query = query.filter(ChatSession.task_id == task_id)
    if status:
        query = query.filter(ChatSession.status == status)

    sessions = query.order_by(ChatSession.created_at.desc()).offset(skip).limit(limit).all()

    return sessions


@router.post("/", response_model=ChatSessionResponse, status_code=status.HTTP_201_CREATED)
async def create_chat_session(
    session_data: ChatSessionCreate,
    db: Session = Depends(get_db)
):
    """
    Create a new chat session.

    - **task_id**: Task this chat session belongs to (required)
    - **messages**: Initial messages as JSON array (required)
    - **ai_model_used**: AI model used for this session (required)
    - **status**: Session status (default: active)
    """
    # Validate messages is a list
    if not isinstance(session_data.messages, list):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="messages must be an array"
        )

    db_session = ChatSession(
        task_id=session_data.task_id,
        messages=session_data.messages,
        ai_model_used=session_data.ai_model_used,
        status=session_data.status,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )

    db.add(db_session)
    db.commit()
    db.refresh(db_session)

    return db_session


@router.get("/{session_id}", response_model=ChatSessionResponse)
async def get_chat_session(
    session: ChatSession = Depends(get_chat_session_or_404)
):
    """
    Get a specific chat session by ID.

    - **session_id**: UUID of the chat session
    """
    return session


@router.patch("/{session_id}", response_model=ChatSessionResponse)
async def update_chat_session(
    session_update: ChatSessionUpdate,
    session: ChatSession = Depends(get_chat_session_or_404),
    db: Session = Depends(get_db)
):
    """
    Update a chat session (partial update).

    - **messages**: Updated messages array (optional)
    - **ai_model_used**: Updated AI model (optional)
    - **status**: Updated status (optional)
    """
    update_data = session_update.model_dump(exclude_unset=True)

    # Validate messages if provided
    if "messages" in update_data:
        if not isinstance(update_data["messages"], list):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="messages must be an array"
            )

    for field, value in update_data.items():
        setattr(session, field, value)

    session.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(session)

    return session


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat_session(
    session: ChatSession = Depends(get_chat_session_or_404),
    db: Session = Depends(get_db)
):
    """
    Delete a chat session.

    - **session_id**: UUID of the session to delete
    """
    db.delete(session)
    db.commit()
    return None


@router.post("/{session_id}/messages", response_model=ChatSessionResponse)
async def add_message_to_session(
    message_request: MessageRequest,
    session: ChatSession = Depends(get_chat_session_or_404),
    db: Session = Depends(get_db)
):
    """
    Add a new message to a chat session.

    - **session_id**: UUID of the chat session
    - **message**: Message object to add
    """
    if not isinstance(session.messages, list):
        session.messages = []

    session.messages.append(message_request.message)

    # Mark as modified for SQLAlchemy
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(session, "messages")

    session.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(session)

    return session


@router.patch("/{session_id}/status", response_model=ChatSessionResponse)
async def update_session_status(
    status_update: StatusUpdateRequest,
    session: ChatSession = Depends(get_chat_session_or_404),
    db: Session = Depends(get_db)
):
    """
    Update the status of a chat session.

    - **session_id**: UUID of the session
    - **status**: New status (active, completed, failed)
    """
    session.status = status_update.status
    session.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(session)

    return session


@router.post("/{session_id}/send-message", status_code=status.HTTP_200_OK)
async def send_message_and_execute(
    session_id: UUID,
    message_request: SendMessageRequest,
    db: Session = Depends(get_db)
):
    """
    Envia mensagem do usuário e obtém resposta da IA executando a task.

    Este endpoint:
    1. Adiciona a mensagem do usuário ao histórico
    2. Busca o AI Model configurado para task_execution
    3. Chama Claude API com contexto completo da task
    4. Salva resposta da IA no histórico
    5. Retorna a resposta

    - **session_id**: UUID of the chat session
    - **content**: Message content from user

    Returns:
        - success: Boolean
        - message: AI response
        - usage: Token usage statistics
    """
    from app.services.task_executor import TaskExecutor
    import logging
    logger = logging.getLogger(__name__)

    # Buscar session
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id
    ).first()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Chat session {session_id} not found"
        )

    # Executar task com a mensagem do usuário usando AI Orchestrator
    try:
        executor = TaskExecutor(db=db)

        result = await executor.execute_task(
            task_id=str(session.task_id),
            chat_session_id=str(session_id),
            user_message=message_request.content,
            db=db
        )

        return result

    except ValueError as e:
        logger.error(f"Validation error during task execution: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Failed to execute task: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to execute task: {str(e)}"
        )


@router.post("/{session_id}/execute", status_code=status.HTTP_200_OK)
async def execute_task_direct(
    session_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Executa a task diretamente sem mensagem adicional do usuário.

    Útil para iniciar a execução automática da task baseado apenas no prompt.

    Este endpoint:
    1. Busca a chat session
    2. Obtém contexto da task e prompt
    3. Executa com Claude API
    4. Retorna o resultado

    - **session_id**: UUID of the chat session

    Returns:
        - success: Boolean
        - response: AI response with code/solution
        - usage: Token usage statistics
    """
    from app.services.task_executor import TaskExecutor
    import logging
    logger = logging.getLogger(__name__)

    # Buscar session
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id
    ).first()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Chat session {session_id} not found"
        )

    # Executar task diretamente usando AI Orchestrator
    try:
        executor = TaskExecutor(db=db)

        result = await executor.execute_task(
            task_id=str(session.task_id),
            chat_session_id=str(session_id),
            user_message=None,  # Sem mensagem adicional
            db=db
        )

        return result

    except ValueError as e:
        logger.error(f"Validation error during task execution: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Failed to execute task: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to execute task: {str(e)}"
        )
