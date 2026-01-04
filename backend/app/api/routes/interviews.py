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


def _clean_ai_response(content: str) -> str:
    """
    Remove internal analysis blocks from AI response before showing to user.

    PROMPT #53 - Clean Interview Responses

    Removes blocks like:
    - CONTEXT_ANALYSIS: {...}
    - STEP 1: CONTEXT_ANALYSIS
    - Any internal structured analysis that shouldn't be visible

    Args:
        content: Raw AI response content

    Returns:
        Cleaned content with only user-facing question
    """
    import re
    import logging

    logger = logging.getLogger(__name__)
    logger.info(f"🧹 Cleaning AI response (length: {len(content)} chars)")

    # Pattern 1: Remove entire ACTION blocks (e.g., "ACTION: REQUIREMENTS_INTERVIEW")
    content = re.sub(
        r'ACTION:\s*\w+.*?(?=❓|$)',
        '',
        content,
        flags=re.DOTALL | re.IGNORECASE
    )

    # Pattern 2: Remove all STEP blocks (STEP 1, STEP 2, etc.)
    content = re.sub(
        r'STEP\s+\d+:.*?(?=❓|STEP|$)',
        '',
        content,
        flags=re.DOTALL | re.IGNORECASE
    )

    # Pattern 3: Remove CONTEXT_ANALYSIS blocks
    content = re.sub(
        r'CONTEXT_ANALYSIS:.*?(?=❓|$)',
        '',
        content,
        flags=re.DOTALL | re.IGNORECASE
    )

    # Pattern 4: Remove command-style lines (CLASSIFY, SELECT, EXTRACT, ANALYZE, etc.)
    content = re.sub(
        r'^\s*(CLASSIFY|SELECT|EXTRACT|ANALYZE|IDENTIFY|DETECT|CREATE|GENERATE|PRIORITIZE|EVALUATE)\s+.*?$',
        '',
        content,
        flags=re.MULTILINE | re.IGNORECASE
    )

    # Pattern 5: Remove structured data sections
    content = re.sub(
        r'^\s*(project_context|conversation_history|already_covered|missing_info|question_priority|remaining_topics|single_most_relevant|Constraints):.*?(?=^❓|^[A-Z]|\Z)',
        '',
        content,
        flags=re.MULTILINE | re.DOTALL
    )

    # Pattern 4: Remove lines that are clearly internal structure
    lines = content.split('\n')
    cleaned_lines = []
    skip_block = False

    for line in lines:
        stripped = line.strip()

        # Skip empty lines at start
        if not stripped and not cleaned_lines:
            continue

        # Detect start of internal analysis block
        if any(marker in stripped.lower() for marker in [
            'action:',
            'step 1:',
            'step 2:',
            'step 3:',
            'context_analysis',
            'question_prioritization',
            'project_context:',
            'conversation_history:',
            'already_covered_topics:',
            'remaining_topics',
            'missing_information:',
            'question_priority:',
            'single_most_relevant',
            'constraints:',
            'classify ',
            'select ',
            'extract ',
            'analyze ',
            'identify ',
            'detect ',
            'core features:',
            'business rules:',
            'integrations and users:',
            'performance and security:'
        ]):
            skip_block = True
            continue

        # Detect end of internal block (when we hit actual question)
        if stripped.startswith('❓') or stripped.startswith('Pergunta'):
            skip_block = False

        # Keep line if not in skip block
        if not skip_block:
            cleaned_lines.append(line)

    content = '\n'.join(cleaned_lines)

    # Clean up excessive whitespace
    content = re.sub(r'\n{3,}', '\n\n', content)
    content = content.strip()

    logger.info(f"✨ Cleaned response (new length: {len(content)} chars)")

    return content


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

        # Build options text for display (for backward compatibility with text parsing)
        # NOTE: We don't include "◉ Escolha uma opção" anymore because MessageParser
        # incorrectly treats it as an option (it starts with ◉ symbol)
        options_text = "\n".join([f"○ {choice['label']}" for choice in choices])

        return {
            "role": "assistant",
            "content": f"{question_text}\n\n{options_text}\n\nPor favor, escolha uma das opções acima.",
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
    Gera backlog hierárquico (Epic → Stories → Tasks) automaticamente baseado na entrevista.

    PROMPT #52 - Hierarchical Backlog Generation from Interview

    Este endpoint:
    1. Busca a entrevista pelo ID
    2. Gera 1 Epic baseado na entrevista completa
    3. Decompõe o Epic em 3-7 Stories
    4. Decompõe cada Story em 3-10 Tasks técnicas
    5. Salva toda a hierarquia no banco de dados com relacionamentos parent_id

    - **interview_id**: UUID of the interview

    Returns:
        - success: Boolean indicating success
        - epic_created: Epic details
        - stories_created: Number of stories created
        - tasks_created: Number of tasks created
        - total_items: Total items in hierarchy
        - message: Success message
    """
    from app.services.backlog_generator import BacklogGeneratorService
    from app.models.task import ItemType, PriorityLevel, TaskStatus
    from uuid import uuid4
    from datetime import datetime

    # Verificar se a entrevista existe
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Interview {interview_id} not found"
        )

    # Gerar hierarquia Epic → Stories → Tasks
    try:
        generator = BacklogGeneratorService(db=db)

        # Step 1: Generate Epic from interview
        logger.info(f"🎯 PROMPT #52: Generating hierarchical backlog from interview {interview_id}")
        epic_suggestion = await generator.generate_epic_from_interview(
            interview_id=interview_id,
            project_id=interview.project_id
        )

        # Step 2: Create Epic in database
        epic = Task(
            id=uuid4(),
            project_id=interview.project_id,
            created_from_interview_id=interview_id,
            title=epic_suggestion["title"],
            description=epic_suggestion["description"],
            item_type=ItemType.EPIC,
            priority=PriorityLevel[epic_suggestion["priority"].upper()],
            story_points=epic_suggestion.get("story_points"),
            acceptance_criteria=epic_suggestion.get("acceptance_criteria", []),
            interview_insights=epic_suggestion.get("interview_insights", {}),
            interview_question_ids=epic_suggestion.get("interview_question_ids", []),
            generation_context=epic_suggestion.get("_metadata", {}),
            reporter="system",
            workflow_state="backlog",
            status=TaskStatus.BACKLOG,
            order=0,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db.add(epic)
        db.commit()
        db.refresh(epic)
        logger.info(f"✅ Created Epic: {epic.title} (id: {epic.id})")

        # Step 3: Decompose Epic into Stories
        stories_suggestions = await generator.decompose_epic_to_stories(
            epic_id=epic.id,
            project_id=interview.project_id
        )

        # Step 4: Create Stories in database
        created_stories = []
        for i, story_suggestion in enumerate(stories_suggestions):
            story = Task(
                id=uuid4(),
                project_id=interview.project_id,
                created_from_interview_id=interview_id,
                parent_id=epic.id,  # Link to Epic
                title=story_suggestion["title"],
                description=story_suggestion["description"],
                item_type=ItemType.STORY,
                priority=PriorityLevel[story_suggestion["priority"].upper()],
                story_points=story_suggestion.get("story_points"),
                acceptance_criteria=story_suggestion.get("acceptance_criteria", []),
                interview_insights=story_suggestion.get("interview_insights", {}),
                generation_context=story_suggestion.get("_metadata", {}),
                reporter="system",
                workflow_state="backlog",
                status=TaskStatus.BACKLOG,
                order=i,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(story)
            created_stories.append(story)

        db.commit()
        for story in created_stories:
            db.refresh(story)
        logger.info(f"✅ Created {len(created_stories)} Stories under Epic {epic.id}")

        # Step 5: Decompose each Story into Tasks
        all_created_tasks = []
        for story in created_stories:
            tasks_suggestions = await generator.decompose_story_to_tasks(
                story_id=story.id,
                project_id=interview.project_id
            )

            # Step 6: Create Tasks in database
            for i, task_suggestion in enumerate(tasks_suggestions):
                task = Task(
                    id=uuid4(),
                    project_id=interview.project_id,
                    created_from_interview_id=interview_id,
                    parent_id=story.id,  # Link to Story
                    title=task_suggestion["title"],
                    description=task_suggestion["description"],
                    item_type=ItemType.TASK,
                    priority=PriorityLevel[task_suggestion["priority"].upper()],
                    story_points=task_suggestion.get("story_points"),
                    acceptance_criteria=task_suggestion.get("acceptance_criteria", []),
                    generation_context=task_suggestion.get("_metadata", {}),
                    reporter="system",
                    workflow_state="backlog",
                    status=TaskStatus.BACKLOG,
                    order=i,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                db.add(task)
                all_created_tasks.append(task)

        db.commit()
        for task in all_created_tasks:
            db.refresh(task)
        logger.info(f"✅ Created {len(all_created_tasks)} Tasks across all Stories")

        total_items = 1 + len(created_stories) + len(all_created_tasks)  # Epic + Stories + Tasks

        logger.info(f"🎉 PROMPT #52 SUCCESS: Created hierarchical backlog with {total_items} items "
                   f"(1 Epic → {len(created_stories)} Stories → {len(all_created_tasks)} Tasks)")

        return {
            "success": True,
            "epic_created": {
                "id": str(epic.id),
                "title": epic.title,
                "item_type": "epic"
            },
            "stories_created": len(created_stories),
            "tasks_created": len(all_created_tasks),
            "total_items": total_items,
            "message": f"Generated hierarchical backlog: 1 Epic → {len(created_stories)} Stories → {len(all_created_tasks)} Tasks!"
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"Failed to generate hierarchical backlog: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate hierarchical backlog: {str(e)}"
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
            "success": provisioning_result is not None and provisioning_result.get("success", False),
        }
    }

    # Add provisioning details if it succeeded
    if provisioning_result and provisioning_result.get("success"):
        response["provisioning"]["project_path"] = provisioning_result.get("project_path")
        response["provisioning"]["project_name"] = provisioning_result.get("project_name")
        response["provisioning"]["credentials"] = provisioning_result.get("credentials", {})
        response["provisioning"]["next_steps"] = provisioning_result.get("next_steps")
        response["provisioning"]["scripts_executed"] = provisioning_result.get("scripts_executed", [])
    # Add error details if provisioning failed or was skipped
    else:
        if provisioning_result and provisioning_result.get("error"):
            response["provisioning"]["error"] = provisioning_result["error"]
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

    # DEBUG: Log state before adding user message
    logger.info(f"🔍 DEBUG - Before adding user message:")
    logger.info(f"  - Current conversation_data length: {len(interview.conversation_data)}")
    logger.info(f"  - User message content: {message.content[:100]}")

    # Adicionar mensagem do usuário
    user_message = {
        "role": "user",
        "content": message.content,
        "timestamp": datetime.utcnow().isoformat()
    }
    interview.conversation_data.append(user_message)

    # DEBUG: Log state after adding user message
    logger.info(f"🔍 DEBUG - After adding user message:")
    logger.info(f"  - New conversation_data length: {len(interview.conversation_data)}")
    logger.info(f"  - Message at index {len(interview.conversation_data)-1}: role={user_message['role']}, content={user_message['content'][:50]}")

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

    # CRITICAL FIX: Commit user message IMMEDIATELY to prevent loss during orchestrator.execute()
    # The orchestrator does db.commit() which expires the interview object, causing a reload
    # that would lose the uncommitted user message
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(interview, "conversation_data")
    db.commit()
    logger.info(f"✅ User message committed to database")

    # Count messages to determine if we're in fixed questions phase (Questions 1-6)
    message_count = len(interview.conversation_data)

    # DEBUG: Log message count and decision point
    logger.info(f"🔍 DEBUG - Decision point:")
    logger.info(f"  - message_count: {message_count}")
    logger.info(f"  - Last 3 messages:")
    for i in range(max(0, len(interview.conversation_data) - 3), len(interview.conversation_data)):
        msg = interview.conversation_data[i]
        content_preview = msg.get('content', '')[:80]
        logger.info(f"    - Index {i}: role={msg.get('role')}, content={content_preview}")

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
        logger.info(f"✅ DEBUG - Returning fixed question (message_count={message_count} in question_map)")
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

        # DEBUG: Log after appending fixed question
        logger.info(f"🔍 DEBUG - After appending fixed question:")
        logger.info(f"  - conversation_data length: {len(interview.conversation_data)}")
        logger.info(f"  - Question appended at index {len(interview.conversation_data)-1}")

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

**IMPORTANTE - ESCOLHA O FORMATO CORRETO:**

Para perguntas de ESCOLHA ÚNICA (apenas uma resposta):
○ Opção 1
○ Opção 2
○ Opção 3
○ Opção 4
○ Opção 5
◉ [Escolha uma opção]

Para perguntas de MÚLTIPLA ESCOLHA (várias respostas):
☐ Opção 1
☐ Opção 2
☐ Opção 3
☐ Opção 4
☐ Opção 5
☑️ [Selecione todas que se aplicam]

**REGRAS OBRIGATÓRIAS PARA OPÇÕES:**
1. SEMPRE forneça PELO MENOS 3-5 opções por pergunta
2. NUNCA crie pergunta com apenas 1 ou 2 opções (sem sentido!)
3. Se não conseguir 3+ opções, reformule como pergunta aberta (texto livre)
4. Opções devem ser realistas, relevantes e mutuamente exclusivas (para single choice)
5. Sempre inclua uma opção "Outro" ou "Nenhuma das anteriores" quando apropriado

Use ○ para escolha única (radio) e ☐ para múltipla escolha (checkbox).

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
            # CRITICAL DEBUG: Log BEFORE calling orchestrator
            logger.info(f"🚨 BEFORE orchestrator.execute():")
            logger.info(f"  - conversation_data length: {len(interview.conversation_data)}")
            logger.info(f"  - Last message: [{len(interview.conversation_data)-1}] {interview.conversation_data[-1].get('role')}: {interview.conversation_data[-1].get('content', '')[:50]}")

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

            # CRITICAL DEBUG: Log AFTER calling orchestrator
            logger.info(f"🚨 AFTER orchestrator.execute():")
            logger.info(f"  - conversation_data length: {len(interview.conversation_data)}")
            logger.info(f"  - Last message: [{len(interview.conversation_data)-1}] {interview.conversation_data[-1].get('role')}: {interview.conversation_data[-1].get('content', '')[:50]}")

            # Clean AI response - remove internal analysis blocks
            cleaned_content = _clean_ai_response(response["content"])

            # Adicionar resposta da IA
            assistant_message = {
                "role": "assistant",
                "content": cleaned_content,
                "timestamp": datetime.utcnow().isoformat(),
                "model": f"{response['provider']}/{response['model']}"
            }

            # DEBUG: Log before appending AI business question
            logger.info(f"🔍 DEBUG - Before appending AI business question:")
            logger.info(f"  - conversation_data length: {len(interview.conversation_data)}")
            logger.info(f"  - AI response content: {response['content'][:100]}")

            interview.conversation_data.append(assistant_message)

            # DEBUG: Log after appending AI business question
            logger.info(f"🔍 DEBUG - After appending AI business question:")
            logger.info(f"  - conversation_data length: {len(interview.conversation_data)}")
            logger.info(f"  - Question appended at index {len(interview.conversation_data)-1}")

            # Salvar no banco
            interview.ai_model_used = response["model"]

            # Mark as modified for SQLAlchemy
            from sqlalchemy.orm.attributes import flag_modified
            flag_modified(interview, "conversation_data")

            # CRITICAL DEBUG: Log conversation_data RIGHT BEFORE COMMIT
            logger.info(f"🚨 CRITICAL - RIGHT BEFORE COMMIT:")
            logger.info(f"  - Total messages in conversation_data: {len(interview.conversation_data)}")
            logger.info(f"  - Last 5 messages:")
            for i in range(max(0, len(interview.conversation_data) - 5), len(interview.conversation_data)):
                msg = interview.conversation_data[i]
                logger.info(f"    [{i}] {msg.get('role')}: {msg.get('content', '')[:60]}")

            db.commit()

            # CRITICAL DEBUG: Log conversation_data RIGHT AFTER COMMIT
            logger.info(f"🚨 CRITICAL - RIGHT AFTER COMMIT:")
            logger.info(f"  - Total messages: {len(interview.conversation_data)}")

            db.refresh(interview)

            # CRITICAL DEBUG: Log conversation_data AFTER REFRESH
            logger.info(f"🚨 CRITICAL - AFTER REFRESH:")
            logger.info(f"  - Total messages: {len(interview.conversation_data)}")
            logger.info(f"  - Last 5 messages:")
            for i in range(max(0, len(interview.conversation_data) - 5), len(interview.conversation_data)):
                msg = interview.conversation_data[i]
                logger.info(f"    [{i}] {msg.get('role')}: {msg.get('content', '')[:60]}")

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
