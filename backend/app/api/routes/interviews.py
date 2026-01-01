"""
Interviews API Router
CRUD operations for managing AI-assisted interviews.
Integrated with Prompter Architecture (Phase 2: Integration)
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status, Body
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel
import os
import subprocess

from app.database import get_db
from app.models.interview import Interview, InterviewStatus
from app.models.project import Project
from app.models.prompt import Prompt
from app.models.ai_model import AIModel, AIModelUsageType
from app.schemas.interview import InterviewCreate, InterviewUpdate, InterviewResponse, InterviewMessageCreate, StackConfiguration, ProjectInfoUpdate
from app.schemas.prompt import PromptResponse
from app.api.dependencies import get_interview_or_404

# Prompter Architecture (gradual migration via feature flags)
try:
    from app.prompter.facade import PrompterFacade
    PROMPTER_AVAILABLE = True
except ImportError:
    PROMPTER_AVAILABLE = False

# Provisioning Service (PROMPT #60 - Automatic Provisioning)
from app.services.provisioning import ProvisioningService

router = APIRouter()


def get_specs_for_category(db: Session, category: str) -> list:
    """
    Get available frameworks from specs for a specific category.
    Returns list of choices formatted for interview options.

    DYNAMIC SYSTEM: Options come from specs table, not hardcoded.
    """
    from app.models.spec import Spec
    from sqlalchemy import func

    # Query distinct frameworks for this category
    specs = db.query(
        Spec.name,
        func.count(Spec.id).label('count')
    ).filter(
        Spec.category == category,
        Spec.is_active == True
    ).group_by(Spec.name).all()

    # Label mappings (same as in specs.py for consistency)
    labels = {
        # Backend
        'laravel': 'Laravel (PHP)',
        'django': 'Django (Python)',
        'fastapi': 'FastAPI (Python)',
        'express': 'Express.js (Node.js)',

        # Database
        'postgresql': 'PostgreSQL',
        'mysql': 'MySQL',
        'mongodb': 'MongoDB',
        'sqlite': 'SQLite',

        # Frontend
        'nextjs': 'Next.js (React)',
        'react': 'React',
        'vue': 'Vue.js',
        'angular': 'Angular',

        # CSS
        'tailwind': 'Tailwind CSS',
        'bootstrap': 'Bootstrap',
        'materialui': 'Material UI',
        'custom': 'CSS Customizado',
    }

    # Format choices
    choices = []
    for name, count in specs:
        label = labels.get(name, name.title())
        choices.append({
            "id": name,
            "label": label,
            "value": name
        })

    return choices


def get_fixed_question(question_number: int, project: Project, db: Session) -> dict:
    """
    Returns fixed questions with DYNAMIC options from specs.
    Questions 1-2: Title and Description (text input, prefilled)
    Questions 3-6: Stack questions (single choice, OPTIONS FROM SPECS)

    PROMPT #57 - Fixed Questions Without AI
    DYNAMIC SYSTEM: Questions 3-6 pull options from specs table
    """

    # Questions 1-2: Static (Title and Description)
    if question_number == 1:
        return {
            "role": "assistant",
            "content": "❓ Pergunta 1: Qual é o título do projeto?\n\nDigite o título do seu projeto.",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question",
            "question_type": "text",
            "prefilled_value": project.name,
            "question_number": 1
        }

    if question_number == 2:
        return {
            "role": "assistant",
            "content": "❓ Pergunta 2: Descreva brevemente o objetivo do projeto.\n\nForneça uma breve descrição do que o projeto faz.",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question",
            "question_type": "text",
            "prefilled_value": project.description,
            "question_number": 2
        }

    # Questions 3-6: DYNAMIC (Stack - from specs)
    category_map = {
        3: ("backend", "❓ Pergunta 3: Qual framework de backend você vai usar?"),
        4: ("database", "❓ Pergunta 4: Qual banco de dados você vai usar?"),
        5: ("frontend", "❓ Pergunta 5: Qual framework de frontend você vai usar?"),
        6: ("css", "❓ Pergunta 6: Qual framework CSS você vai usar?")
    }

    if question_number in category_map:
        category, question_text = category_map[question_number]

        # Get dynamic choices from specs
        choices = get_specs_for_category(db, category)

        # Build options text for display
        options_text = "\n".join([f"○ {choice['label']}" for choice in choices])

        return {
            "role": "assistant",
            "content": f"{question_text}\n\nOPÇÕES:\n{options_text}\n\n◉ Escolha uma opção",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question",
            "question_type": "single_choice",
            "question_number": question_number,
            "options": {
                "type": "single",
                "choices": choices
            }
        }

    return None


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
    assistant_message = get_fixed_question(1, project, db)

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

    # PROMPT #60 - AUTOMATIC PROVISIONING
    # Automatically provision project after stack is saved
    provisioning_result = None
    provisioning_error = None

    try:
        logger.info(f"Starting automatic provisioning for project {project.name}...")
        provisioning_service = ProvisioningService(db)

        # Validate stack against database specs
        is_valid, error_msg = provisioning_service.validate_stack(project.stack)
        if not is_valid:
            logger.warning(f"Stack validation failed: {error_msg}")
            provisioning_error = error_msg
        else:
            # Execute provisioning
            provisioning_result = provisioning_service.provision_project(project)
            logger.info(f"✅ Project provisioned successfully at: {provisioning_result['project_path']}")

    except ValueError as e:
        # Stack combination not supported
        logger.warning(f"Provisioning not available for this stack: {str(e)}")
        provisioning_error = str(e)
    except FileNotFoundError as e:
        # Script not found
        logger.error(f"Provisioning script not found: {str(e)}")
        provisioning_error = str(e)
    except subprocess.TimeoutExpired:
        # Script timeout
        logger.error(f"Provisioning timed out after 5 minutes")
        provisioning_error = "Provisioning timed out after 5 minutes"
    except subprocess.CalledProcessError as e:
        # Script execution failed
        logger.error(f"Provisioning script failed: {e.stderr}")
        provisioning_error = f"Provisioning script failed: {e.stderr}"
    except Exception as e:
        # Unexpected error
        logger.error(f"Unexpected error during provisioning: {str(e)}")
        provisioning_error = f"Unexpected error: {str(e)}"

    # Return response with provisioning info
    response = {
        "success": True,
        "message": f"Stack configuration saved: {stack.backend} + {stack.database} + {stack.frontend} + {stack.css}",
        "provisioning": {
            "attempted": True,
            "success": provisioning_result is not None,
        }
    }

    if provisioning_result:
        response["provisioning"]["project_path"] = provisioning_result["project_path"]
        response["provisioning"]["project_name"] = provisioning_result["project_name"]
        response["provisioning"]["credentials"] = provisioning_result.get("credentials", {})
        response["provisioning"]["next_steps"] = provisioning_result["next_steps"]
        response["provisioning"]["script_used"] = provisioning_result["script_used"]
    elif provisioning_error:
        response["provisioning"]["error"] = provisioning_error

    return response


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

        assistant_message = get_fixed_question(question_number, project, db)

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

        # Check if PrompterFacade is available and enabled
        use_prompter = (
            PROMPTER_AVAILABLE and
            os.getenv("PROMPTER_USE_TEMPLATES", "false").lower() == "true"
        )

        # Generate system prompt using PrompterFacade or legacy method
        if use_prompter:
            logger.info("Using PrompterFacade for interview question generation")
            try:
                prompter = PrompterFacade(db)
                question_num = (message_count // 2) + 1  # Calculate question number
                system_prompt = prompter.generate_interview_question(
                    project=project,
                    conversation_history=interview.conversation_data,
                    question_number=question_num
                )
            except Exception as e:
                logger.warning(f"PrompterFacade failed, falling back to legacy: {e}")
                use_prompter = False

        if not use_prompter:
            # LEGACY: Hardcoded system prompt
            logger.info("Using legacy hardcoded interview prompt")
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


@router.post("/{interview_id}/provision", status_code=status.HTTP_200_OK)
async def provision_project(
    interview_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Provision a project based on stack configuration from interview.

    This endpoint creates a complete project scaffold in ./projects/<project-name>/
    using the stack technologies selected during the interview (questions 3-6).

    The provisioning system:
    - Uses specs from database to determine available technologies
    - Automatically selects appropriate provisioning script based on stack
    - Creates Docker Compose setup with all services
    - Generates random database credentials
    - Configures Tailwind CSS
    - Provides complete README and setup instructions

    Supported Stack Combinations:
    - Laravel + PostgreSQL + Tailwind CSS
    - Next.js + PostgreSQL + Tailwind CSS
    - FastAPI + React + PostgreSQL + Tailwind CSS

    Args:
        interview_id: UUID of the interview
        db: Database session (injected)

    Returns:
        {
            "success": bool,
            "project_name": str,
            "project_path": str,
            "stack": dict,
            "credentials": dict,
            "next_steps": list[str]
        }

    Raises:
        404: Interview or project not found
        400: Stack not configured or unsupported
        500: Provisioning script execution failed

    PROMPT #59 - Automated Project Provisioning
    """
    import logging
    logger = logging.getLogger(__name__)

    from app.services.provisioning import get_provisioning_service

    # 1. Find interview and associated project
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        logger.error(f"Interview {interview_id} not found")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Interview not found"
        )

    project = db.query(Project).filter(Project.id == interview.project_id).first()
    if not project:
        logger.error(f"Project {interview.project_id} not found for interview {interview_id}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Associated project not found"
        )

    # 2. Validate stack is configured
    if not project.stack:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project stack not configured. Complete interview stack questions first (questions 3-6)."
        )

    logger.info(f"Provisioning project '{project.name}' with stack: {project.stack}")

    # 3. Validate stack configuration
    provisioning_service = get_provisioning_service(db)
    is_valid, error_msg = provisioning_service.validate_stack(project.stack)

    if not is_valid:
        logger.error(f"Invalid stack for project {project.id}: {error_msg}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg
        )

    # 4. Execute provisioning
    try:
        result = provisioning_service.provision_project(project)

        if not result.get("success"):
            # Provisioning failed but script executed (e.g., project already exists)
            logger.warning(f"Provisioning failed for project {project.id}: {result.get('error')}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=result.get("error", "Provisioning failed")
            )

        logger.info(f"✓ Successfully provisioned project '{project.name}' at {result['project_path']}")

        return {
            "success": True,
            "message": f"Project '{project.name}' provisioned successfully",
            "project_name": result["project_name"],
            "project_path": result["project_path"],
            "stack": result["stack"],
            "credentials": result.get("credentials", {}),
            "next_steps": result["next_steps"],
            "script_used": result["script_used"]
        }

    except ValueError as e:
        logger.error(f"Provisioning validation error: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

    except FileNotFoundError as e:
        logger.error(f"Provisioning script not found: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Provisioning script not found. Contact administrator."
        )

    except Exception as e:
        logger.error(f"Unexpected error during provisioning: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Provisioning failed: {str(e)}"
        )
