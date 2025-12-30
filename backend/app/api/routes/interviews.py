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
from app.schemas.interview import InterviewCreate, InterviewUpdate, InterviewResponse, InterviewMessageCreate, StackConfiguration, ProjectInfoUpdate
from app.schemas.prompt import PromptResponse
from app.api.dependencies import get_interview_or_404

router = APIRouter()


def get_fixed_question(question_number: int, project: Project) -> dict:
    """
    Returns hardcoded fixed questions without calling AI.
    Questions 1-2: Title and Description (text input, prefilled)
    Questions 3-6: Stack questions (single choice)

    PROMPT #57 - Fixed Questions Without AI
    """
    questions = {
        1: {
            "role": "assistant",
            "content": "❓ Pergunta 1: Qual é o título do projeto?\n\nDigite o título do seu projeto.",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question",
            "question_type": "text",
            "prefilled_value": project.name,
            "question_number": 1
        },
        2: {
            "role": "assistant",
            "content": "❓ Pergunta 2: Descreva brevemente o objetivo do projeto.\n\nForneça uma breve descrição do que o projeto faz.",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question",
            "question_type": "text",
            "prefilled_value": project.description,
            "question_number": 2
        },
        3: {
            "role": "assistant",
            "content": "❓ Pergunta 3: Qual framework de backend você vai usar?\n\nOPÇÕES:\n○ Laravel (PHP)\n○ Django (Python)\n○ FastAPI (Python)\n○ Express.js (Node.js)\n○ Outro\n\n◉ Escolha uma opção",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question",
            "question_type": "single_choice",
            "question_number": 3,
            "options": {
                "type": "single",
                "choices": [
                    {"id": "laravel", "label": "Laravel (PHP)", "value": "laravel"},
                    {"id": "django", "label": "Django (Python)", "value": "django"},
                    {"id": "fastapi", "label": "FastAPI (Python)", "value": "fastapi"},
                    {"id": "express", "label": "Express.js (Node.js)", "value": "express"},
                    {"id": "other", "label": "Outro", "value": "other"}
                ]
            }
        },
        4: {
            "role": "assistant",
            "content": "❓ Pergunta 4: Qual banco de dados você vai usar?\n\nOPÇÕES:\n○ PostgreSQL\n○ MySQL\n○ MongoDB\n○ SQLite\n\n◉ Escolha uma opção",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question",
            "question_type": "single_choice",
            "question_number": 4,
            "options": {
                "type": "single",
                "choices": [
                    {"id": "postgresql", "label": "PostgreSQL", "value": "postgresql"},
                    {"id": "mysql", "label": "MySQL", "value": "mysql"},
                    {"id": "mongodb", "label": "MongoDB", "value": "mongodb"},
                    {"id": "sqlite", "label": "SQLite", "value": "sqlite"}
                ]
            }
        },
        5: {
            "role": "assistant",
            "content": "❓ Pergunta 5: Qual framework de frontend você vai usar?\n\nOPÇÕES:\n○ Next.js (React)\n○ React\n○ Vue.js\n○ Angular\n○ Sem frontend / Apenas API\n\n◉ Escolha uma opção",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question",
            "question_type": "single_choice",
            "question_number": 5,
            "options": {
                "type": "single",
                "choices": [
                    {"id": "nextjs", "label": "Next.js (React)", "value": "nextjs"},
                    {"id": "react", "label": "React", "value": "react"},
                    {"id": "vue", "label": "Vue.js", "value": "vue"},
                    {"id": "angular", "label": "Angular", "value": "angular"},
                    {"id": "none", "label": "Sem frontend / Apenas API", "value": "none"}
                ]
            }
        },
        6: {
            "role": "assistant",
            "content": "❓ Pergunta 6: Qual framework CSS você vai usar?\n\nOPÇÕES:\n○ Tailwind CSS\n○ Bootstrap\n○ Material UI\n○ CSS Customizado\n\n◉ Escolha uma opção",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question",
            "question_type": "single_choice",
            "question_number": 6,
            "options": {
                "type": "single",
                "choices": [
                    {"id": "tailwind", "label": "Tailwind CSS", "value": "tailwind"},
                    {"id": "bootstrap", "label": "Bootstrap", "value": "bootstrap"},
                    {"id": "materialui", "label": "Material UI", "value": "materialui"},
                    {"id": "custom", "label": "CSS Customizado", "value": "custom"}
                ]
            }
        }
    }

    return questions.get(question_number)


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
    Gera tasks automaticamente baseado na entrevista usando IA (Claude API).

    Este endpoint:
    1. Busca a entrevista pelo ID
    2. Extrai a conversa completa
    3. Envia para Claude API para análise
    4. Gera tasks estruturadas baseadas no contexto
    5. Salva as tasks no banco de dados (Kanban board - coluna Backlog)

    - **interview_id**: UUID of the interview

    Returns:
        - success: Boolean indicating success
        - tasks_created: Number of tasks created
        - message: Success message
    """
    from app.services.prompt_generator import PromptGenerator

    # Verificar se a entrevista existe
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Interview {interview_id} not found"
        )

    # Gerar tasks usando AI Orchestrator
    try:
        generator = PromptGenerator(db=db)
        tasks = await generator.generate_from_interview(
            interview_id=str(interview_id),
            db=db
        )

        return {
            "success": True,
            "tasks_created": len(tasks),
            "message": f"Generated {len(tasks)} tasks successfully!"
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"Failed to generate tasks: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate tasks: {str(e)}"
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

    # PROMPT #57 - Return fixed Question 1 (Title) without calling AI
    logger.info(f"Starting interview {interview_id} with fixed Question 1 for project: {project.name}")

    # Get fixed Question 1 (Title)
    assistant_message = get_fixed_question(1, project)

    if not assistant_message:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get fixed question 1"
        )

    # Add Question 1 to conversation
    interview.conversation_data.append(assistant_message)

    # Set model to indicate fixed question (no AI)
    interview.ai_model_used = "system/fixed-questions"

    db.commit()
    db.refresh(interview)

    logger.info(f"Interview {interview_id} started successfully with fixed Question 1")

    return {
        "success": True,
        "message": assistant_message
    }


@router.post("/{interview_id}/save-stack", status_code=status.HTTP_200_OK)
async def save_interview_stack(
    interview_id: UUID,
    stack: StackConfiguration,
    db: Session = Depends(get_db)
):
    """
    Saves the tech stack configuration to the project after stack questions are answered.

    This endpoint is called automatically after the user completes the 4 stack questions
    (backend, database, frontend, css) at the start of the interview.

    - **interview_id**: UUID of the interview
    - **stack**: Stack configuration with backend, database, frontend, css choices

    Returns:
        - success: Boolean
        - message: Confirmation message
    """
    import logging
    logger = logging.getLogger(__name__)

    # Buscar interview
    interview = db.query(Interview).filter(Interview.id == interview_id).first()

    if not interview:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Interview {interview_id} not found"
        )

    # Buscar projeto
    project = db.query(Project).filter(Project.id == interview.project_id).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )

    # Salvar stack no projeto
    project.stack_backend = stack.backend
    project.stack_database = stack.database
    project.stack_frontend = stack.frontend
    project.stack_css = stack.css

    db.commit()
    db.refresh(project)

    logger.info(f"Stack configuration saved for project {project.id}: {stack.backend} + {stack.database} + {stack.frontend} + {stack.css}")

    return {
        "success": True,
        "message": f"Stack configuration saved: {stack.backend} + {stack.database} + {stack.frontend} + {stack.css}"
    }


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
    stack_context = ""
    if project:
        project_context = f"""
INFORMAÇÕES DO PROJETO (já definidas):
- Título: {project.name}
- Descrição: {project.description}

Use isso como base. NÃO pergunte título/descrição novamente.
Suas perguntas devem aprofundar nos requisitos técnicos baseados neste contexto.
"""

        # Check if stack is already configured
        if project.stack_backend:
            stack_context = f"""
STACK JÁ CONFIGURADO:
- Backend: {project.stack_backend}
- Banco de Dados: {project.stack_database}
- Frontend: {project.stack_frontend}
- CSS: {project.stack_css}

As perguntas de stack estão completas. Foque nos requisitos de negócio agora.
"""

    # Count messages to determine if we're in fixed questions phase (Questions 1-6)
    message_count = len(interview.conversation_data)

    # PROMPT #57 - Fixed Questions Without AI
    # Message count after adding user message:
    # message_count = 2 (Q1 + A1) → Return Q2 (Description) - Fixed
    # message_count = 4 (Q1 + A1 + Q2 + A2) → Return Q3 (Backend) - Fixed
    # message_count = 6 (... + Q3 + A3) → Return Q4 (Database) - Fixed
    # message_count = 8 (... + Q4 + A4) → Return Q5 (Frontend) - Fixed
    # message_count = 10 (... + Q5 + A5) → Return Q6 (CSS) - Fixed
    # message_count >= 12 (... + Q6 + A6) → Return Q7+ (Business) - AI

    # Map message_count to question number
    question_map = {
        2: 2,   # After A1 (Title) → Ask Q2 (Description)
        4: 3,   # After A2 (Description) → Ask Q3 (Backend)
        6: 4,   # After A3 (Backend) → Ask Q4 (Database)
        8: 5,   # After A4 (Database) → Ask Q5 (Frontend)
        10: 6,  # After A5 (Frontend) → Ask Q6 (CSS)
    }

    # Check if we should return a fixed question
    if message_count in question_map:
        # Return fixed question (no AI)
        question_number = question_map[message_count]
        logger.info(f"Returning fixed Question {question_number} for interview {interview_id}")

        assistant_message = get_fixed_question(question_number, project)

        if not assistant_message:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to get fixed question {question_number}"
            )

        interview.conversation_data.append(assistant_message)

        # Mark as modified for SQLAlchemy
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(interview, "conversation_data")

        db.commit()
        db.refresh(interview)

        logger.info(f"Fixed Question {question_number} sent for interview {interview_id}")

        return {
            "success": True,
            "message": assistant_message,
            "usage": {
                "model": "system/fixed-question",
                "input_tokens": 0,
                "output_tokens": 0,
                "total_cost_usd": 0.0
            }
        }

    # If message_count >= 12, use AI for business questions
    elif message_count >= 12:
        logger.info(f"Using AI for business question (message_count={message_count}) for interview {interview_id}")

        # Preparar system prompt para perguntas de negócio
        system_prompt = f"""Você é um analista de requisitos de IA ajudando a coletar requisitos técnicos detalhados para um projeto de software.

IMPORTANTE: Conduza TODA a entrevista em PORTUGUÊS. Todas as perguntas, opções e respostas devem ser em português.

{project_context}

{stack_context}

REGRAS CRÍTICAS PARA PERGUNTAS DE NEGÓCIO:
1. **Faça UMA pergunta por vez**
2. **Sempre forneça opções FECHADAS** (múltipla escolha ou escolha única)
3. **Mantenha o foco** no título e descrição do projeto
4. **Construa contexto** - cada pergunta deve se relacionar com respostas anteriores
5. **Seja específico** - evite perguntas vagas ou abertas

FORMATO DA PERGUNTA (use esta estrutura EXATA):

❓ Pergunta [número]: [Sua pergunta contextual aqui]

OPÇÕES:
□ Opção 1
□ Opção 2
□ Opção 3
□ Opção 4
□ Opção 5
☑️ [Selecione todas que se aplicam] OU ◉ [Escolha uma opção]

EXEMPLOS DE PERGUNTAS:
- "Quais funcionalidades essenciais são necessárias para seu [tipo de projeto]?"
- "Quais integrações de terceiros você precisa?"
- "Qual nível de escalabilidade é necessário?"
- "Qual plataforma de deploy você vai usar?"

TÓPICOS A COBRIR (em ordem):
1. Funcionalidades e recursos principais
2. Papéis de usuário e permissões
3. Integrações de terceiros (pagamentos, autenticação, etc)
4. Deploy e infraestrutura
5. Requisitos de performance e escalabilidade

LEMBRE-SE:
- Extraia detalhes técnicos acionáveis
- Opções devem ser realistas e comuns na indústria
- Perguntas se adaptam baseadas em respostas anteriores
- Incremente o número da pergunta a cada nova pergunta (você está na pergunta 7 ou superior)
- Após 8-12 perguntas no total (incluindo 6 perguntas fixas), a entrevista está completa

Continue com a próxima pergunta relevante baseada na resposta anterior do usuário!
"""

        # Usar orquestrador para obter resposta
        orchestrator = AIOrchestrator(db)

        try:
            # Clean messages - only keep role and content (remove timestamp, model, etc.)
            clean_messages = [
                {"role": msg["role"], "content": msg["content"]}
                for msg in interview.conversation_data
            ]

            response = await orchestrator.execute(
                usage_type="interview",  # Usa Claude para entrevistas
                messages=clean_messages,  # Histórico limpo sem campos extras
                system_prompt=system_prompt,
                max_tokens=1000,
                # PROMPT #58 - Add context for prompt logging
                project_id=interview.project_id,
                interview_id=interview.id
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

        except Exception as ai_error:
            logger.error(f"AI execution failed: {str(ai_error)}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to get AI response: {str(ai_error)}"
            )

    else:
        # Unexpected message_count - should not happen
        logger.error(f"Unexpected message_count={message_count} for interview {interview_id}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unexpected interview state (message_count={message_count})"
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
    when answering Questions 1 and 2 of the interview. The updates are saved
    to the project record in the database.

    Args:
        interview_id: UUID of the interview
        data: ProjectInfoUpdate schema with optional title and/or description
        db: Database session

    Returns:
        Success confirmation with updated project data
    """
    logger.info(f"Updating project info for interview {interview_id}")

    # 1. Find interview and associated project
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        logger.error(f"Interview {interview_id} not found")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Interview not found"
        )

    # Get associated project
    project = db.query(Project).filter(Project.id == interview.project_id).first()
    if not project:
        logger.error(f"Project {interview.project_id} not found for interview {interview_id}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Associated project not found"
        )

    # 2. Update project fields if provided
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
            detail="No valid title or description provided"
        )

    # 3. Commit changes to database
    try:
        db.commit()
        db.refresh(project)
        logger.info(f"Successfully updated project {project.id}: {', '.join(updated_fields)}")
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to update project {project.id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update project information"
        )

    # 4. Return success with updated data
    return {
        "success": True,
        "updated_fields": updated_fields,
        "project": {
            "id": str(project.id),
            "name": project.name,
            "description": project.description
        }
    }
