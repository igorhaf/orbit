"""
Interviews API Router
CRUD operations for managing AI-assisted interviews.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status, Body
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel

from app.database import get_db
from app.models.interview import Interview, InterviewStatus
from app.models.project import Project
from app.models.prompt import Prompt
from app.models.ai_model import AIModel, AIModelUsageType
from app.schemas.interview import InterviewCreate, InterviewUpdate, InterviewResponse, InterviewMessageCreate
from app.schemas.prompt import PromptResponse
from app.api.dependencies import get_interview_or_404

router = APIRouter()


class MessageRequest(BaseModel):
    """Request model for adding a message to an interview."""
    message: dict


class StatusUpdateRequest(BaseModel):
    """Request model for updating interview status."""
    status: InterviewStatus


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

    - **project_id**: Project this interview belongs to (required)
    - **conversation_data**: Initial conversation data as JSON array (required)
    - **ai_model_used**: Name/ID of AI model used (required)
    - **status**: Interview status (default: active)
    """
    # Validate conversation_data is a list
    if not isinstance(interview_data.conversation_data, list):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="conversation_data must be an array of messages"
        )

    db_interview = Interview(
        project_id=interview_data.project_id,
        conversation_data=interview_data.conversation_data,
        ai_model_used=interview_data.ai_model_used,
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
                detail="conversation_data must be an array of messages"
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

    - **interview_id**: UUID of the interview
    - **message**: Message object to add to conversation_data
    """
    if not isinstance(interview.conversation_data, list):
        interview.conversation_data = []

    interview.conversation_data.append(message_request.message)

    # Mark the conversation_data as modified for SQLAlchemy to detect the change
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(interview, "conversation_data")

    db.commit()
    db.refresh(interview)

    return interview


@router.patch("/{interview_id}/status", response_model=InterviewResponse)
async def update_interview_status(
    status_update: StatusUpdateRequest,
    interview: Interview = Depends(get_interview_or_404),
    db: Session = Depends(get_db)
):
    """
    Update the status of an interview.

    - **interview_id**: UUID of the interview
    - **status**: New status (active, completed, cancelled)
    """
    interview.status = status_update.status

    db.commit()
    db.refresh(interview)

    return interview


@router.get("/{interview_id}/prompts", response_model=List)
async def get_interview_prompts(
    interview: Interview = Depends(get_interview_or_404),
    db: Session = Depends(get_db)
):
    """
    Get all prompts generated from this interview.

    - **interview_id**: UUID of the interview
    """
    prompts = db.query(Prompt).filter(
        Prompt.created_from_interview_id == interview.id
    ).order_by(Prompt.created_at.desc()).all()

    return prompts


@router.post("/{interview_id}/generate-prompts", status_code=status.HTTP_201_CREATED)
async def generate_prompts(
    interview_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Gera prompts automaticamente baseado na entrevista usando IA (Claude API).

    Este endpoint:
    1. Busca a entrevista pelo ID
    2. Extrai a conversa completa
    3. Envia para Claude API para análise
    4. Gera prompts estruturados baseados no contexto
    5. Salva os prompts no banco de dados

    - **interview_id**: UUID of the interview

    Returns:
        - success: Boolean indicating success
        - prompts_generated: Number of prompts created
        - prompts: List of generated prompts
    """
    from app.services.prompt_generator import PromptGenerator

    # Verificar se a entrevista existe
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Interview {interview_id} not found"
        )

    # Gerar prompts usando AI Orchestrator
    try:
        generator = PromptGenerator(db=db)
        prompts = await generator.generate_from_interview(
            interview_id=str(interview_id),
            db=db
        )

        return {
            "success": True,
            "prompts_generated": len(prompts),
            "prompts": [PromptResponse.from_orm(p) for p in prompts]
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"Failed to generate prompts: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate prompts: {str(e)}"
        )


@router.post("/{interview_id}/start", status_code=status.HTTP_200_OK)
async def start_interview(
    interview_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Inicia a entrevista com primeira pergunta baseada no projeto.

    Este endpoint é chamado automaticamente quando o usuário abre o chat pela primeira vez.
    A IA gera uma pergunta estruturada com opções de múltipla escolha baseada no
    título e descrição do projeto.

    - **interview_id**: UUID of the interview

    Returns:
        - success: Boolean
        - message: Initial AI question with options
    """
    from app.services.ai_orchestrator import AIOrchestrator
    import logging

    logger = logging.getLogger(__name__)

    # Buscar interview
    interview = db.query(Interview).filter(
        Interview.id == interview_id
    ).first()

    if not interview:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Interview {interview_id} not found"
        )

    # Verificar se já foi iniciada
    if interview.conversation_data and len(interview.conversation_data) > 0:
        return {
            "success": True,
            "message": "Interview already started",
            "conversation": interview.conversation_data
        }

    # Buscar projeto para contexto
    project = db.query(Project).filter(
        Project.id == interview.project_id
    ).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )

    # Inicializar conversa
    interview.conversation_data = []

    # System prompt com contexto do projeto
    system_prompt = f"""You are an AI requirements analyst for software projects.

PROJECT CONTEXT (already defined):
- Title: {project.name}
- Description: {project.description}

This is the FIRST question. Based on the project context above, ask about the CORE FEATURES needed.

Use this EXACT format:

❓ Question 1: Which core features are essential for {project.name}?

OPTIONS:
□ [Relevant option 1 based on project description]
□ [Relevant option 2 based on project description]
□ [Relevant option 3 based on project description]
□ [Relevant option 4 based on project description]
□ [Relevant option 5 based on project description]
☑️ Select all that apply

Make the options SPECIFIC to the project type mentioned in the description.
Be direct and professional."""

    # Usar orquestrador
    orchestrator = AIOrchestrator(db)

    try:
        logger.info(f"Starting interview {interview_id} with AI for project: {project.name}")

        response = await orchestrator.execute(
            usage_type="interview",  # Usa Claude para entrevistas
            messages=[{
                "role": "user",
                "content": f"Start interview for project: {project.name}"
            }],
            system_prompt=system_prompt,
            max_tokens=800
        )

        # Adicionar mensagem inicial da IA
        assistant_message = {
            "role": "assistant",
            "content": response["content"],
            "timestamp": datetime.utcnow().isoformat(),
            "model": f"{response['provider']}/{response['model']}"
        }
        interview.conversation_data.append(assistant_message)

        interview.ai_model_used = response["model"]
        db.commit()
        db.refresh(interview)

        logger.info(f"Interview {interview_id} started successfully")

        return {
            "success": True,
            "message": assistant_message
        }

    except Exception as e:
        logger.error(f"Error starting interview: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to start interview: {str(e)}"
        )


@router.post("/{interview_id}/send-message", status_code=status.HTTP_200_OK)
async def send_message_to_interview(
    interview_id: UUID,
    message: InterviewMessageCreate,
    db: Session = Depends(get_db)
):
    """
    Envia mensagem do usuário e obtém resposta da IA.

    Este endpoint:
    1. Adiciona mensagem do usuário ao histórico
    2. Envia contexto completo para a IA
    3. Obtém resposta da IA
    4. Salva resposta no histórico
    5. Retorna resposta

    - **interview_id**: UUID of the interview
    - **message**: User message content

    Returns:
        - success: Boolean
        - message: AI response message
        - usage: Token usage statistics
    """
    from app.services.ai_orchestrator import AIOrchestrator
    import logging

    logger = logging.getLogger(__name__)

    # Buscar interview
    interview = db.query(Interview).filter(
        Interview.id == interview_id
    ).first()

    if not interview:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Interview {interview_id} not found"
        )

    # Inicializar conversation_data se vazio
    if not interview.conversation_data:
        interview.conversation_data = []

    # Adicionar mensagem do usuário
    user_message = {
        "role": "user",
        "content": message.content,
        "timestamp": datetime.utcnow().isoformat()
    }
    interview.conversation_data.append(user_message)

    # Buscar projeto para pegar título e descrição
    project = db.query(Project).filter(
        Project.id == interview.project_id
    ).first()

    project_context = ""
    if project:
        project_context = f"""
PROJECT INFORMATION (already defined):
- Title: {project.name}
- Description: {project.description}

Use this as the foundation. Do NOT ask for title/description again.
Your questions should dive deeper into technical requirements based on this context.
"""

    # Preparar system prompt com formato estruturado
    system_prompt = f"""You are an AI requirements analyst helping to gather detailed technical requirements for a software project.

{project_context}

CRITICAL RULES:
1. **Ask ONE question at a time**
2. **Always provide CLOSED-ENDED options** (multiple choice or single choice)
3. **Stay focused** on the project title and description
4. **Build context** - each question should relate to previous answers
5. **Be specific** - avoid vague or open-ended questions

QUESTION FORMAT (use this EXACT structure):

❓ Question [number]: [Your contextual question here]

OPTIONS:
□ Option 1
□ Option 2
□ Option 3
□ Option 4
□ Option 5
☑️ [Select all that apply] OR ◉ [Choose one option]

EXAMPLE QUESTIONS:
- "Which core features are essential for your [project type]?"
- "What tech stack do you prefer for [specific component]?"
- "Which third-party integrations do you need?"
- "What level of scalability is required?"
- "Which deployment platform will you use?"

TOPICS TO COVER (in order):
1. Core features and functionality
2. User roles and permissions
3. Tech stack preferences (frontend, backend, database)
4. Third-party integrations (payments, auth, etc)
5. Deployment and infrastructure
6. Performance and scalability requirements

REMEMBER:
- Extract actionable technical details
- Options should be realistic and common in the industry
- Questions adapt based on previous answers
- Increment question number with each new question
- After 8-12 questions, the interview is complete

Continue with the next relevant question based on the user's previous response!"""

    # Usar orquestrador para obter resposta
    orchestrator = AIOrchestrator(db)

    try:
        logger.info(f"Sending message to interview {interview_id}")

        # Clean messages - only keep role and content (remove timestamp, model, etc.)
        clean_messages = [
            {"role": msg["role"], "content": msg["content"]}
            for msg in interview.conversation_data
        ]

        response = await orchestrator.execute(
            usage_type="interview",  # Usa Claude para entrevistas
            messages=clean_messages,  # Histórico limpo sem campos extras
            system_prompt=system_prompt,
            max_tokens=1000
        )

        # Adicionar resposta da IA
        assistant_message = {
            "role": "assistant",
            "content": response["content"],
            "timestamp": datetime.utcnow().isoformat(),
            "model": f"{response['provider']}/{response['model']}"
        }
        interview.conversation_data.append(assistant_message)

        # Salvar no banco
        interview.ai_model_used = response["model"]

        # Mark as modified for SQLAlchemy
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(interview, "conversation_data")

        db.commit()
        db.refresh(interview)

        logger.info(f"AI responded to interview {interview_id}")

        return {
            "success": True,
            "message": assistant_message,
            "usage": response.get("usage", {})
        }

    except Exception as e:
        logger.error(f"Error in interview AI: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get AI response: {str(e)}"
        )
