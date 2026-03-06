"""
Interview Flow Endpoints
PROMPT #261 - Refactor endpoints.py into sub-modules

HTTP endpoints for interview flow control:
- POST /{id}/start                  - Start interview with first question
- POST /{id}/save-stack             - Save tech stack configuration
- PATCH /{id}/status                - Update interview status
- GET /{id}/prompts                 - Get prompts generated from interview
- POST /{id}/generate-prompts-async - Generate backlog hierarchy async
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from typing import List
from uuid import UUID
from datetime import datetime
import logging

# Database and dependencies
from app.database import get_db
from app.models.interview import Interview, InterviewStatus
from app.models.project import Project
from app.models.prompt import Prompt
from app.models.task import Task, ItemType, PriorityLevel, TaskStatus
from app.schemas.interview import (
    InterviewResponse,
    StackConfiguration,
)
from app.api.dependencies import get_interview_or_404

# Shared request models
from .models import StatusUpdateRequest

# PROMPT #78 - Unified Open-Ended Interview System
from .unified_open_handler import generate_first_question

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================================
# INTERVIEW FLOW ENDPOINTS
# ============================================================================

@router.post("/{interview_id}/start", status_code=status.HTTP_200_OK)
async def start_interview(
    interview_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Inicia a entrevista com primeira pergunta aberta gerada por IA.

    PROMPT #78 - Unified Open-Ended Interview System

    Este endpoint e chamado automaticamente quando o usuario abre o chat pela primeira vez.
    Agora retorna uma pergunta ABERTA gerada por IA (nao mais perguntas fixas).

    - **interview_id**: UUID of the interview

    Returns:
        - success: Boolean
        - message: Initial open-ended question from AI
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

    # Verificar se ja foi iniciada
    if interview.conversation_data and len(interview.conversation_data) > 0:
        return {
            "success": True,
            "message": "Entrevista ja iniciada",
            "conversation": interview.conversation_data
        }

    # Buscar projeto para contexto
    project = db.query(Project).filter(
        Project.id == interview.project_id
    ).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Projeto nao encontrado"
        )

    # Inicializar conversa
    interview.conversation_data = []

    # PROMPT #78 - Unified Open-Ended Interview System
    # Generate first open-ended question using AI
    logger.info(f"Starting interview {interview_id} with OPEN-ENDED Question 1 for project: {project.name}")

    # Get parent task for hierarchical interviews
    parent_task = None
    if interview.parent_task_id:
        parent_task = db.query(Task).filter(Task.id == interview.parent_task_id).first()

    # Generate first question using AI
    assistant_message = await generate_first_question(
        interview=interview,
        project=project,
        db=db,
        parent_task=parent_task
    )

    if not assistant_message:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Falha ao gerar primeira pergunta"
        )

    # Add Question 1 to conversation
    interview.conversation_data.append(assistant_message)
    flag_modified(interview, "conversation_data")

    # Set model from AI response
    interview.ai_model_used = assistant_message.get("model", "ai/open-ended")

    db.flush()
    db.commit()
    db.refresh(interview)

    logger.info(f"Interview {interview_id} started with open-ended Question 1")

    # PROMPT #81 - Include error if fallback was used
    response_data = {
        "success": True,
        "message": assistant_message
    }

    # If fallback was used, include error info in usage
    if assistant_message.get("model") == "system/fallback" and "fallback_error" in assistant_message:
        response_data["usage"] = {
            "fallback": True,
            "error": assistant_message["fallback_error"]
        }

    return response_data


@router.post("/{interview_id}/save-stack", status_code=status.HTTP_200_OK)
async def save_interview_stack(
    interview_id: UUID,
    stack: StackConfiguration,
    db: Session = Depends(get_db)
):
    """
    Saves the tech stack configuration to the project after stack questions are answered.

    This endpoint is called automatically after the user completes the stack questions
    (backend, database, frontend, css, mobile) at the start of the interview.

    - **interview_id**: UUID of the interview
    - **stack**: Stack configuration with backend, database, frontend, css, mobile choices

    Returns:
        - success: Boolean
        - message: Confirmation message

    PROMPT #67 - Mobile support added
    """
    # Buscar interview
    interview = db.query(Interview).filter(Interview.id == interview_id).first()

    if not interview:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Entrevista {interview_id} nao encontrada"
        )

    # Buscar projeto
    project = db.query(Project).filter(Project.id == interview.project_id).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Projeto nao encontrado"
        )

    # Salvar stack no projeto
    project.stack_backend = stack.backend
    project.stack_database = stack.database
    project.stack_frontend = stack.frontend
    project.stack_css = stack.css
    project.stack_mobile = stack.mobile  # PROMPT #67 - Mobile support

    db.commit()
    db.refresh(project)

    # Build stack description for logging
    stack_parts = [stack.backend, stack.database, stack.frontend, stack.css]
    if stack.mobile:
        stack_parts.append(stack.mobile)
    stack_description = " + ".join(stack_parts)
    logger.info(f"Stack configuration saved for project {project.id}: {stack_description}")

    return {
        "success": True,
        "message": f"Configuracao de stack salva: {stack_description}",
    }


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


@router.post("/{interview_id}/generate-prompts-async", status_code=status.HTTP_202_ACCEPTED)
async def generate_prompts_async(
    interview_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Generate backlog hierarchy (Epic -> Stories -> Tasks) ASYNCHRONOUSLY.

    PROMPT #65 - Async Job System

    This endpoint was previously blocking for 2-5 minutes while generating:
    - 1 Epic (30s)
    - 3-7 Stories (1-2 min)
    - 15-50 Tasks (1-3 min)

    Now it returns immediately and processes in background:
    1. Creates async job with status=PENDING
    2. Returns job_id immediately (HTTP 202 Accepted)
    3. Generates Epic -> Stories -> Tasks in background
    4. Client polls GET /jobs/{job_id} for progress and result

    Returns:
        {
            "job_id": "...",
            "status": "pending",
            "message": "Backlog generation started. This may take 2-5 minutes."
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

    # Create async job
    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.BACKLOG_GENERATION,
        input_data={
            "interview_id": str(interview_id),
            "project_id": str(interview.project_id)
        },
        project_id=interview.project_id,
        interview_id=interview_id
    )

    logger.info(f"Created async job {job.id} for backlog generation from interview {interview_id}")

    # Execute in background via priority queue
    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(job.priority, _generate_backlog_async, job.id, interview_id, interview.project_id)

    # Return job_id immediately
    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": "Geracao de backlog iniciada. Isso pode levar 2-5 minutos. Consulte GET /api/v1/jobs/{} para o progresso.".format(job.id)
    }


async def _generate_backlog_async(
    job_id: UUID,
    interview_id: UUID,
    project_id: UUID
):
    """
    Background task to generate Epic -> Stories -> Tasks hierarchy.

    This can take 2-5 minutes for complex projects:
    - Generate Epic: ~30s
    - Decompose to Stories (3-7): ~1-2 min
    - Decompose to Tasks (15-50): ~1-3 min

    Updates job progress at each step.
    """
    from app.database import SessionLocal
    from app.services.job_manager import JobManager
    from app.services.backlog_generator import BacklogGeneratorService
    from uuid import uuid4

    # Create new DB session
    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        logger.info(f"Starting backlog generation for job {job_id}")

        generator = BacklogGeneratorService(db=db)

        # STEP 1: Generate Epic (0-30%)
        job_manager.update_progress(job_id, 10.0, "Gerando Epic a partir da entrevista...")
        logger.info(f"Generating Epic from interview {interview_id}")

        epic_suggestion = await generator.generate_epic_from_interview(
            interview_id=interview_id,
            project_id=project_id
        )

        # Create Epic
        epic = Task(
            id=uuid4(),
            project_id=project_id,
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

        logger.info(f"Created Epic: {epic.title}")
        job_manager.update_progress(job_id, 30.0, f"Epic criado: {epic.title}")

        # STEP 2: Decompose to Stories (30-60%)
        job_manager.update_progress(job_id, 35.0, "Decompondo Epic em Stories...")
        logger.info(f"Decomposing Epic {epic.id} into Stories")

        stories_suggestions = await generator.decompose_epic_to_stories(
            epic_id=epic.id,
            project_id=project_id
        )

        created_stories = []
        for i, story_suggestion in enumerate(stories_suggestions):
            story = Task(
                id=uuid4(),
                project_id=project_id,
                created_from_interview_id=interview_id,
                parent_id=epic.id,
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

            # Update progress after each story
            progress = 35.0 + (i + 1) / len(stories_suggestions) * 25.0
            job_manager.update_progress(job_id, progress, f"Story {i+1}/{len(stories_suggestions)} criada")

        db.commit()
        for story in created_stories:
            db.refresh(story)

        logger.info(f"Created {len(created_stories)} Stories")
        job_manager.update_progress(job_id, 60.0, f"{len(created_stories)} Stories criadas")

        # STEP 3: Decompose Stories to Tasks (60-100%)
        all_created_tasks = []
        total_stories = len(created_stories)

        for story_idx, story in enumerate(created_stories):
            story_progress_start = 60.0 + (story_idx / total_stories) * 35.0
            job_manager.update_progress(
                job_id,
                story_progress_start,
                f"Decompondo Story {story_idx+1}/{total_stories} em Tasks..."
            )

            tasks_suggestions = await generator.decompose_story_to_tasks(
                story_id=story.id,
                project_id=project_id
            )

            for i, task_suggestion in enumerate(tasks_suggestions):
                task = Task(
                    id=uuid4(),
                    project_id=project_id,
                    created_from_interview_id=interview_id,
                    parent_id=story.id,
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

        total_items = 1 + len(created_stories) + len(all_created_tasks)

        logger.info(f"Backlog generation complete: {total_items} items created")

        # Complete job with result
        job_manager.complete_job(job_id, {
            "success": True,
            "epic_created": {
                "id": str(epic.id),
                "title": epic.title,
                "item_type": "epic"
            },
            "stories_created": len(created_stories),
            "tasks_created": len(all_created_tasks),
            "total_items": total_items,
            "message": f"Backlog hierarquico gerado: 1 Epic -> {len(created_stories)} Stories -> {len(all_created_tasks)} Tasks!"
        })

        logger.info(f"Job {job_id} completed successfully")

    except Exception as e:
        logger.error(f"Backlog generation failed for job {job_id}: {str(e)}", exc_info=True)
        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()
