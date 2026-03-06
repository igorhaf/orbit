"""
Interview Messaging Endpoints
PROMPT #261 - Refactor endpoints.py into sub-modules

HTTP endpoints for interview messaging:
- POST /{id}/send-message       - Send message and get AI response (sync)
- PATCH /{id}/update-project-info - Update project info during interview
- POST /{id}/send-message-async - Send message and get AI response (async)
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from uuid import UUID
from datetime import datetime
import logging

# Database and dependencies
from app.database import get_db
from app.models.interview import Interview, InterviewStatus
from app.models.project import Project
from app.models.task import Task
from app.schemas.interview import (
    InterviewMessageCreate,
    ProjectInfoUpdate,
)

# PROMPT #78 - Unified Open-Ended Interview System
from .unified_open_handler import handle_unified_open_interview

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================================
# MESSAGING ENDPOINTS
# ============================================================================

@router.post("/{interview_id}/send-message", status_code=status.HTTP_200_OK)
async def send_message_to_interview(
    interview_id: UUID,
    message: InterviewMessageCreate,
    db: Session = Depends(get_db)
):
    """
    Envia mensagem do usuario e obtem resposta da IA.

    PROMPT #68 - Dual-Mode Interview System
    Routes to correct handler based on interview_mode:
    - orchestrator: Q1-Q8 conditional stack -> AI contextual questions (first interview)
    - meta_prompt: Q1-Q17 fixed questions -> AI contextual questions (first interview alternative)
    - requirements: Q1-Q7 stack -> AI business questions (legacy)
    - task_focused: Q1 task type -> AI focused questions (existing projects)

    - **interview_id**: UUID of the interview
    - **message**: User message content

    Returns:
        - success: Boolean
        - message: AI response message
        - usage: Token usage statistics
    """

    # Buscar interview
    interview = db.query(Interview).filter(
        Interview.id == interview_id
    ).first()

    if not interview:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Entrevista {interview_id} nao encontrada"
        )

    # Inicializar conversation_data se vazio
    if not interview.conversation_data:
        interview.conversation_data = []

    # DEBUG: Log state before adding user message
    logger.info(f"DEBUG - Before adding user message:")
    logger.info(f"  - Current conversation_data length: {len(interview.conversation_data)}")
    logger.info(f"  - User message content: {message.content[:100]}")

    # Adicionar mensagem do usuario
    user_message = {
        "role": "user",
        "content": message.content,
        "timestamp": datetime.utcnow().isoformat()
    }
    interview.conversation_data.append(user_message)
    flag_modified(interview, "conversation_data")  # CRITICAL: SQLAlchemy needs this for JSONB changes
    db.flush()  # PROMPT #99: Flush first to write to DB

    # DEBUG: Log state after adding user message
    logger.info(f"DEBUG - After adding user message:")
    logger.info(f"  - New conversation_data length: {len(interview.conversation_data)}")
    logger.info(f"  - Message at index {len(interview.conversation_data)-1}: role={user_message['role']}, content={user_message['content'][:50]}")

    # PROMPT #171 - Index user answer in RAG for semantic search
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

        # Calculate question number
        message_count = len(interview.conversation_data)
        question_number = (message_count - 1) // 2  # Approximate question number

        rag_service.store(
            content=message.content,
            metadata={
                "type": "interview_answer",
                "interview_id": str(interview.id),
                "question_number": question_number,
                "question": question_content or "",
                "interview_mode": interview.interview_mode,
                "timestamp": datetime.utcnow().isoformat()
            },
            project_id=interview.project_id
        )

        logger.info(f"RAG: Indexed interview answer (Q{question_number}) for interview {interview.id}")

    except Exception as e:
        # Don't fail the request if RAG indexing fails
        logger.warning(f"RAG indexing failed for interview answer: {e}")

    # Buscar projeto para pegar titulo e descricao
    project = db.query(Project).filter(
        Project.id == interview.project_id
    ).first()

    project_context = ""
    stack_context = ""
    if project:
        project_context = f"""
INFORMACOES DO PROJETO (ja definidas):
- Titulo: {project.name}
- Descricao: {project.description}

Use isso como base. NAO pergunte titulo/descricao novamente.
Suas perguntas devem aprofundar nos requisitos tecnicos baseados neste contexto.
"""

        # Check if stack is already configured
        if project.stack_backend:
            stack_context = f"""
STACK JA CONFIGURADO:
- Backend: {project.stack_backend}
- Banco de Dados: {project.stack_database}
- Frontend: {project.stack_frontend}
- CSS: {project.stack_css}

As perguntas de stack estao completas. Foque nos requisitos de negocio agora.
"""

    # CRITICAL FIX: Commit user message IMMEDIATELY
    db.commit()
    db.refresh(interview)  # PROMPT #99: Refresh to ensure data is synced
    logger.info(f"User message committed to database")

    # Count messages to determine if we're in fixed questions phase
    message_count = len(interview.conversation_data)

    # DEBUG: Log message count and decision point
    logger.info(f"DEBUG - Decision point:")
    logger.info(f"  - interview_mode: {interview.interview_mode}")
    logger.info(f"  - message_count: {message_count}")
    logger.info(f"  - Last 3 messages:")
    for i in range(max(0, len(interview.conversation_data) - 3), len(interview.conversation_data)):
        msg = interview.conversation_data[i]
        content_preview = msg.get('content', '')[:80]
        logger.info(f"    - Index {i}: role={msg.get('role')}, content={content_preview}")

    # PROMPT #78 - Unified Open-Ended Interview System
    # ALL interview modes now use the unified open-ended handler
    # No more fixed questions - AI generates all questions

    # Get parent task for hierarchical interviews
    parent_task = None
    if interview.parent_task_id:
        parent_task = db.query(Task).filter(Task.id == interview.parent_task_id).first()

    # Use unified open-ended handler for ALL interview modes
    return await handle_unified_open_interview(
        interview=interview,
        project=project,
        message_count=message_count,
        db=db,
        parent_task=parent_task
    )


@router.patch("/{interview_id}/update-project-info")
async def update_project_info(
    interview_id: UUID,
    data: ProjectInfoUpdate,
    db: Session = Depends(get_db)
):
    """
    Update project title and/or description during interview.

    PROMPT #57 - Editable Project Info in Fixed Questions

    This endpoint allows users to update the project's title and description
    when answering Questions 1 and 2 of the interview.

    Args:
        interview_id: UUID of the interview
        data: ProjectInfoUpdate schema with optional title and/or description
        db: Database session

    Returns:
        Success confirmation with updated project data
    """
    logger.info(f"Updating project info for interview {interview_id}")

    # Find interview and associated project
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        logger.error(f"Interview {interview_id} not found")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Entrevista nao encontrada"
        )

    # Get associated project
    project = db.query(Project).filter(Project.id == interview.project_id).first()
    if not project:
        logger.error(f"Project {interview.project_id} not found for interview {interview_id}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Projeto associado nao encontrado"
        )

    # Update project fields if provided
    updated_fields = []

    if data.title is not None and data.title.strip():
        project.name = data.title.strip()
        updated_fields.append("title")
        logger.info(f"Updated project title to: {project.name}")

    if data.description is not None and data.description.strip():
        project.description = data.description.strip()
        updated_fields.append("description")
        logger.info(f"Updated project description to: {project.description}")

    # Validate that at least one field was provided
    if not updated_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nenhum titulo ou descricao valido fornecido"
        )

    # Commit changes to database
    try:
        db.commit()
        db.refresh(project)
        logger.info(f"Successfully updated project {project.id}: {', '.join(updated_fields)}")
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to update project {project.id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Falha ao atualizar informacoes do projeto"
        )

    # Return success with updated data
    return {
        "success": True,
        "updated_fields": updated_fields,
        "project": {
            "id": str(project.id),
            "name": project.name,
            "description": project.description
        }
    }


@router.post("/{interview_id}/send-message-async", status_code=status.HTTP_202_ACCEPTED)
async def send_message_async(
    interview_id: UUID,
    message: InterviewMessageCreate,
    db: Session = Depends(get_db)
):
    """
    Send message to interview and get AI response ASYNCHRONOUSLY.

    PROMPT #65 - Async Job System
    PROMPT #99 - Fixed async message duplication bug
    PROMPT #133 - Background jobs for ALL AI operations with deep links

    This endpoint prevents UI blocking by processing AI call in background.

    Returns:
        {
            "job_id": "...",
            "status": "pending",
            "message": "Job created, poll /jobs/{job_id} for result",
            "deep_link": "/projects/{id}?task={taskId}&tab=interview"
        }
    """
    from app.services.job_manager import JobManager
    from app.models.async_job import JobType

    # Validate interview exists
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Entrevista {interview_id} nao encontrada"
        )

    # Initialize conversation_data if empty
    if not interview.conversation_data:
        interview.conversation_data = []

    # CRITICAL FIX (PROMPT #99): Add user message BEFORE creating async job
    # The async handler expects the message to already be in conversation_data
    user_message = {
        "role": "user",
        "content": message.content,
        "timestamp": datetime.utcnow().isoformat()
    }
    interview.conversation_data.append(user_message)
    flag_modified(interview, "conversation_data")  # CRITICAL: SQLAlchemy needs this for JSONB changes
    db.flush()  # PROMPT #99: Flush first to write to DB
    db.commit()  # PROMPT #99: Then commit the transaction
    db.refresh(interview)  # PROMPT #99: Refresh to ensure data is synced

    logger.info(f"User message added to interview {interview_id} (message_count: {len(interview.conversation_data)})")

    # PROMPT #171 - Index user answer in RAG for semantic search
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

        # Calculate question number
        message_count = len(interview.conversation_data)
        question_number = (message_count - 1) // 2  # Approximate question number

        rag_service.store(
            content=message.content,
            metadata={
                "type": "interview_answer",
                "interview_id": str(interview.id),
                "question_number": question_number,
                "question": question_content or "",
                "interview_mode": interview.interview_mode,
                "timestamp": datetime.utcnow().isoformat()
            },
            project_id=interview.project_id
        )

        logger.info(f"RAG: Indexed interview answer (Q{question_number}) for interview {interview.id}")

    except Exception as e:
        # Don't fail the request if RAG indexing fails
        logger.warning(f"RAG indexing failed for interview answer: {e}")

    # PROMPT #133 - Build deep link and notification title
    # PROMPT #154 - For context interviews (no task_id), use project name instead
    task_id = interview.parent_task_id
    parent_task = None
    task_title = "entrevista"

    if task_id:
        parent_task = db.query(Task).filter(Task.id == task_id).first()
        if parent_task:
            task_title = parent_task.title[:50]
    else:
        # Context interview - use project name
        project = db.query(Project).filter(Project.id == interview.project_id).first()
        if project and project.name:
            task_title = project.name[:50]

    # Build deep link based on context
    # PROMPT #151 - Context interviews (no parent_task_id) should go to wizard, not project page
    if task_id:
        deep_link = f"/projects/{interview.project_id}?task={task_id}&tab=interview"
    elif interview.interview_mode == 'context' or not interview.parent_task_id:
        # Context interview - redirect to wizard to continue
        deep_link = f"/projects/new?resume={interview.project_id}"
    else:
        deep_link = f"/projects/{interview.project_id}?interview={interview_id}"

    notification_title = f"Gerando pergunta para '{task_title}'"

    # Create async job with PROMPT #133 enhancements
    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.INTERVIEW_QUESTION,  # PROMPT #133 - New job type
        input_data={
            "interview_id": str(interview_id),
            "message_content": message.content
        },
        project_id=interview.project_id,
        interview_id=interview_id,
        task_id=task_id,  # PROMPT #133
        deep_link=deep_link,  # PROMPT #133
        notification_title=notification_title  # PROMPT #133
    )

    logger.info(f"Created async job {job.id} for interview {interview_id} (deep_link={deep_link})")

    # Execute in background via priority queue
    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(job.priority, _process_interview_message_async, job.id, interview_id, message.content)

    # Return job_id immediately with deep_link for frontend
    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": f"Job criado com sucesso. Consulte GET /api/v1/jobs/{job.id} para o resultado.",
        "deep_link": deep_link,
        "notification_title": notification_title
    }


async def _process_interview_message_async(
    job_id: UUID,
    interview_id: UUID,
    message_content: str
):
    """
    Background task to process AI response for interview message.

    PROMPT #65 - Async Job System
    PROMPT #133 - Updates notification_title on success/failure for bell notifications
    """
    from app.database import SessionLocal
    from app.services.job_manager import JobManager
    from app.services.ai_orchestrator import AIOrchestrator
    from app.models.async_job import AsyncJob

    # Create new DB session for background task
    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        logger.info(f"Background task started for job {job_id}")

        # PROMPT #133 - Get job and task for notification title
        # PROMPT #154 - For context interviews (no task_id), use project name instead
        job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        task_title = "entrevista"
        if job and job.task_id:
            related_task = db.query(Task).filter(Task.id == job.task_id).first()
            if related_task:
                task_title = related_task.title[:50]
        elif job and job.project_id:
            # Context interview - use project name
            related_project = db.query(Project).filter(Project.id == job.project_id).first()
            if related_project:
                task_title = related_project.name[:50] if related_project.name else "projeto"

        # Get interview
        interview = db.query(Interview).filter(Interview.id == interview_id).first()
        if not interview:
            job_manager.fail_job(job_id, f"Entrevista {interview_id} nao encontrada")
            return

        # Initialize conversation_data if empty
        if not interview.conversation_data:
            interview.conversation_data = []

        # NOTE: User message is already added and committed by sync endpoint /send-message
        # Do NOT add it again here to avoid duplication!

        logger.info(f"User message already added by sync endpoint for interview {interview_id}")

        # Update progress: 30%
        job_manager.update_progress(job_id, 30.0, "Processando mensagem, chamando IA...")

        # Get project for context
        project = db.query(Project).filter(Project.id == interview.project_id).first()

        # Count messages
        message_count = len(interview.conversation_data)

        # PROMPT #78 - Unified Open-Ended Interview System
        # ALL questions are now AI-generated and open-ended
        logger.info(f"ASYNC: Generating open-ended question (message_count={message_count})")

        job_manager.update_progress(job_id, 40.0, "Gerando pergunta aberta...")

        # Get parent task for hierarchical interviews
        parent_task = None
        if interview.parent_task_id:
            parent_task = db.query(Task).filter(Task.id == interview.parent_task_id).first()

        # Use unified open-ended handler
        result = await handle_unified_open_interview(
            interview=interview,
            project=project,
            message_count=message_count,
            db=db,
            parent_task=parent_task
        )

        job_manager.update_progress(job_id, 80.0, "Processando resposta...")

        # PROMPT #133 - Update notification_title for success
        if job:
            job.notification_title = f"Pergunta gerada para '{task_title}'"
            db.commit()

        # Complete job with result
        job_manager.complete_job(job_id, {
            "success": result.get("success", True),
            "message": result.get("message"),
            "usage": result.get("usage", {})
        })

        logger.info(f"Job {job_id} completed (open-ended question)")

    except Exception as e:
        logger.error(f"Job {job_id} failed: {str(e)}", exc_info=True)
        # PROMPT #133 - Update notification_title for failure
        try:
            job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
            if job:
                error_msg = str(e)[:100]  # Truncate long errors
                job.notification_title = f"Erro na geracao de pergunta: {error_msg}"
                db.commit()
        except Exception:
            pass  # Don't fail the error handling
        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()
