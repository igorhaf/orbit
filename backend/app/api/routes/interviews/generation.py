"""
Interview Generation Endpoints
PROMPT #261 - Refactor endpoints.py into sub-modules

HTTP endpoints for generating artifacts from interviews:
- POST /{id}/generate-task-direct          - Generate single task from task-focused interview
- POST /{id}/generate-context              - Generate project context from context interview
- POST /{id}/generate-hierarchy-from-meta  - Generate complete hierarchy from meta prompt
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from uuid import UUID
from datetime import datetime
import logging

# Database and dependencies
from app.database import get_db
from app.models.interview import Interview, InterviewStatus
from app.models.project import Project
from app.models.task import Task, ItemType, PriorityLevel, TaskStatus

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================================
# GENERATION ENDPOINTS
# ============================================================================

@router.post("/{interview_id}/generate-task-direct", status_code=status.HTTP_202_ACCEPTED)
async def generate_task_direct(
    interview_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Generate SINGLE TASK directly from task-focused interview (ASYNC).

    PROMPT #68 - Dual-Mode Interview System (FASE 4)

    For task-focused interviews (existing projects), this endpoint generates
    a SINGLE task directly without Epic->Story->Task hierarchy.

    The task includes:
    - Title, description, acceptance criteria
    - Story points, priority, labels
    - interview_insights (context from interview)

    Returns:
        {
            "job_id": "...",
            "status": "pending",
            "message": "Task generation started. This may take 30-60 seconds."
        }

    Raises:
        400: If interview is not task-focused mode
        404: If interview not found
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

    # Validate task-focused mode
    if interview.interview_mode != "task_focused":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Apenas entrevistas focadas em tarefas podem gerar tarefas diretas. "
                   "Esta entrevista esta no modo 'requirements' (use generate-prompts-async)."
        )

    # Create async job
    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.TASK_GENERATION,  # New job type
        input_data={
            "interview_id": str(interview_id),
            "project_id": str(interview.project_id),
            "task_type": interview.task_type_selection or "feature"
        },
        project_id=interview.project_id,
        interview_id=interview_id
    )

    logger.info(f"Created async job {job.id} for direct task generation from interview {interview_id}")

    # Execute in background via priority queue
    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(job.priority, _generate_task_direct_async, job.id, interview_id, interview.project_id)

    # Return job_id immediately
    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": f"Geracao de tarefas iniciada. Isso pode levar 30-60 segundos. Consulte GET /api/v1/jobs/{job.id} para o progresso."
    }


async def _generate_task_direct_async(
    job_id: UUID,
    interview_id: UUID,
    project_id: UUID
):
    """
    Background task to generate single task from task-focused interview.

    PROMPT #68 - FASE 4

    Steps:
    1. Load interview and project
    2. Call BacklogGeneratorService.generate_task_from_interview_direct()
    3. AI analyzes interview and extracts task
    4. Create Task record
    5. Update job status
    """
    from app.services.job_manager import JobManager
    from app.services.backlog_generator import BacklogGeneratorService
    from app.database import SessionLocal

    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)

        logger.info(f"Starting direct task generation for interview {interview_id}")

        # Update progress: Loading interview
        job_manager.update_progress(
            job_id=job_id,
            progress=10,
            message="Carregando entrevista..."
        )

        # Load interview and project
        interview = db.query(Interview).filter(Interview.id == interview_id).first()
        project = db.query(Project).filter(Project.id == project_id).first()

        if not interview or not project:
            raise Exception("Entrevista ou projeto nao encontrado")

        # Update progress: Analyzing conversation
        job_manager.update_progress(
            job_id=job_id,
            progress=30,
            message=f"Analisando entrevista (tipo de tarefa: {interview.task_type_selection})..."
        )

        # Generate task via BacklogGeneratorService
        backlog_service = BacklogGeneratorService(db)
        task = await backlog_service.generate_task_from_interview_direct(
            interview=interview,
            project=project
        )

        logger.info(f"Task generated: {task.id} - {task.title}")

        # Update progress: Complete
        job_manager.update_progress(
            job_id=job_id,
            progress=100,
            message="Tarefa criada com sucesso!"
        )

        # Complete job
        result = {
            "task_id": str(task.id),
            "title": task.title,
            "description": task.description,
            "story_points": task.story_points,
            "priority": task.priority.value if task.priority else None,
            "labels": task.labels or [],
            "created_at": task.created_at.isoformat()
        }

        job_manager.complete_job(job_id, result)

        logger.info(f"Direct task generation completed for job {job_id}")

    except Exception as e:
        logger.error(f"Direct task generation failed for job {job_id}: {str(e)}", exc_info=True)
        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()


@router.post("/{interview_id}/generate-context", status_code=status.HTTP_202_ACCEPTED)
async def generate_context_from_interview(
    interview_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Generate project context from Context Interview (ASYNC).

    PROMPT #89 - Context Interview: Foundational Project Description
    PROMPT #133 - Now runs as background job with notifications

    This endpoint creates a background job to process a completed Context Interview.
    The user can navigate freely while context generation processes.
    A notification will appear when the context is ready.

    Returns:
        {
            "job_id": "uuid-of-job",
            "status": "pending",
            "message": "Context generation started...",
            "deep_link": "/projects/new?resume=xxx"  # PROMPT #151
        }

    Poll GET /api/v1/jobs/{job_id} for status and result.

    Raises:
        400: If interview is not context mode
        404: If interview not found
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

    # Validate interview mode
    if interview.interview_mode not in ["context", "meta_prompt"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Nao e possivel gerar contexto a partir do modo '{interview.interview_mode}'. "
                   f"Apenas entrevistas 'context' suportam geracao de contexto."
        )

    # Get project for notification
    project = db.query(Project).filter(Project.id == interview.project_id).first()
    project_name = project.name if project else "projeto"

    # PROMPT #232 - IA-2 fix: prevent context regeneration after lock
    if project and project.context_locked:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Contexto do projeto ja esta travado. "
                   "Nao e possivel regenerar contexto apos ativacao de cards."
        )

    # PROMPT #133 - Create background job
    # PROMPT #151 - Use resume param for wizard state restoration
    job_manager = JobManager(db)

    deep_link = f"/projects/new?resume={interview.project_id}"

    job = job_manager.create_job(
        job_type=JobType.CONTEXT_GENERATION,
        input_data={
            "interview_id": str(interview_id),
            "project_id": str(interview.project_id)
        },
        project_id=interview.project_id,
        interview_id=interview_id,
        deep_link=deep_link,
        notification_title=f"Gerando contexto para '{project_name}'..."
    )

    # Start background task via priority queue
    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(job.priority, _process_context_generation_async, job.id, interview_id, interview.project_id)

    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": "Geracao de contexto iniciada. Voce pode navegar livremente - uma notificacao aparecera quando concluir.",
        "deep_link": deep_link,
        "notification_title": job.notification_title
    }


async def _process_context_generation_async(
    job_id: UUID,
    interview_id: UUID,
    project_id: UUID
):
    """
    Background task to generate project context.

    PROMPT #133 - Background jobs for context generation
    """
    from app.database import SessionLocal
    from app.services.job_manager import JobManager
    from app.services.context_generator import ContextGeneratorService
    from app.models.async_job import AsyncJob

    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        logger.info(f"Context generation background task started for job {job_id}")

        # Get project name for notification
        project = db.query(Project).filter(Project.id == project_id).first()
        project_name = project.name if project else "projeto"

        job_manager.update_progress(job_id, 20.0, "Analisando respostas da entrevista...")

        context_service = ContextGeneratorService(db)

        job_manager.update_progress(job_id, 50.0, "Gerando contexto semantico...")

        result = await context_service.generate_context_from_interview(
            interview_id=interview_id,
            project_id=project_id
        )

        job_manager.update_progress(job_id, 80.0, "Gerando epicos sugeridos...")

        # PROMPT #133 - Update notification_title for success
        job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if job:
            epic_count = len(result.get("suggested_epics", []))
            job.notification_title = f"Contexto gerado para '{project_name}' - {epic_count} epicos sugeridos"
            db.commit()

        job_manager.complete_job(job_id, {
            "success": True,
            "context_semantic": result["context_semantic"],
            "context_human": result["context_human"],
            "semantic_map": result.get("semantic_map", {}),
            "interview_insights": result.get("interview_insights", {}),
            "suggested_epics": result.get("suggested_epics", [])
        })

        logger.info(f"Context generation job {job_id} completed")

    except Exception as e:
        logger.error(f"Context generation job {job_id} failed: {str(e)}", exc_info=True)

        # PROMPT #133 - Update notification_title for failure
        try:
            job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
            if job:
                error_msg = str(e)[:80]
                job.notification_title = f"Erro na geracao de contexto: {error_msg}"
                db.commit()
        except Exception:
            pass

        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()


@router.post("/{interview_id}/generate-hierarchy-from-meta", status_code=status.HTTP_202_ACCEPTED)
async def generate_hierarchy_from_meta_prompt(
    interview_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Generate complete project hierarchy from interview (ASYNC).

    PROMPT #78 - Meta Prompt Hierarchy Generation
    PROMPT #92 - Extended to support Orchestrator interviews
    PROMPT #94 - Renamed "simple" to "orchestrator"

    Supports two interview modes:
    - meta_prompt: 17 fixed questions (comprehensive, legacy)
    - orchestrator: 5-8 conditional questions (focused, default for new projects)

    After completing either interview type, this endpoint processes all responses
    and generates the ENTIRE project hierarchy:
    - 1 Epic (entire project)
    - ~10 Stories (features) - AI decides quantity based on complexity
    - ~10 Tasks per Story (with generated_prompt for execution)

    All items are fully populated with:
    - title, description, acceptance_criteria
    - priorities, labels, story_points
    - generated_prompt (for execution)
    - MD files (documentation)

    AI analyzes each level hierarchically:
    - Interview -> generates Epic + Stories
    - Each Story -> generates Tasks

    Returns:
        {
            "job_id": "...",
            "status": "pending",
            "message": "Hierarchy generation started. This may take 2-5 minutes."
        }

    Raises:
        400: If interview is not meta_prompt/orchestrator mode or not completed
        404: If interview not found
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

    # Validate interview mode (PROMPT #92/94 - Accept meta_prompt and orchestrator)
    if interview.interview_mode not in ["meta_prompt", "orchestrator"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Nao e possivel gerar hierarquia a partir do modo '{interview.interview_mode}'. "
                   f"Apenas entrevistas 'meta_prompt' e 'orchestrator' suportam geracao completa de hierarquia."
        )

    # Validate interview is completed
    if interview.status != InterviewStatus.COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Entrevista deve ser concluida antes de gerar hierarquia. Status atual: {interview.status.value}"
        )

    # Create async job
    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.BACKLOG_GENERATION,  # Reuse same type - both generate hierarchy
        input_data={
            "interview_id": str(interview_id),
            "project_id": str(interview.project_id),
            "mode": "meta_prompt"  # Distinguish from legacy backlog generation
        },
        project_id=interview.project_id,
        interview_id=interview_id
    )

    logger.info(f"Created async job {job.id} for {interview.interview_mode} hierarchy generation from interview {interview_id}")

    # Execute in background via priority queue
    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(job.priority, _generate_hierarchy_from_meta_async, job.id, interview_id, interview.project_id)

    # Return job_id immediately
    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": f"Geracao de hierarquia iniciada a partir do meta prompt. Isso pode levar 2-5 minutos. Consulte GET /api/v1/jobs/{job.id} para o progresso."
    }


async def _generate_hierarchy_from_meta_async(
    job_id: UUID,
    interview_id: UUID,
    project_id: UUID
):
    """
    Background task to generate complete hierarchy from meta prompt interview.

    PROMPT #78 - Meta Prompt Hierarchy Generation

    Steps:
    1. Extract Q1-Q9 + contextual Q&A from interview
    2. Call AI to generate complete Epic -> Stories -> Tasks hierarchy
    3. Create all database records
    4. Generate atomic prompts (generated_prompt) for each Task
    5. Update job progress and status
    """
    from app.services.job_manager import JobManager
    from app.services.meta_prompt_processor import MetaPromptProcessor
    from app.database import SessionLocal

    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)

        logger.info(f"Starting meta prompt hierarchy generation for interview {interview_id}")

        # Update progress: Loading interview
        job_manager.update_progress(
            job_id=job_id,
            progress=10,
            message="Carregando entrevista do meta prompt..."
        )

        # Load interview and project
        interview = db.query(Interview).filter(Interview.id == interview_id).first()
        project = db.query(Project).filter(Project.id == project_id).first()

        if not interview or not project:
            raise Exception("Entrevista ou projeto nao encontrado")

        # Update progress: Processing with AI
        job_manager.update_progress(
            job_id=job_id,
            progress=20,
            message="Analisando respostas do meta prompt e gerando hierarquia com IA..."
        )

        # Generate hierarchy via MetaPromptProcessor
        processor = MetaPromptProcessor(db)
        result = await processor.generate_complete_hierarchy(
            interview_id=interview_id,
            project_id=project_id
        )

        logger.info(f"Hierarchy generated: {result['metadata']['total_items']} items created")

        # Update progress: Complete
        job_manager.update_progress(
            job_id=job_id,
            progress=100,
            message="Hierarquia criada com sucesso!"
        )

        # Complete job with result
        job_manager.complete_job(job_id, {
            "success": True,
            "epic_id": result["epic"]["id"],
            "epic_title": result["epic"]["title"],
            "stories_created": len(result["stories"]),
            "tasks_created": len(result["tasks"]),
            "total_items": result["metadata"]["total_items"],
            "message": f"Hierarquia completa gerada: 1 Epic -> {len(result['stories'])} Stories -> {len(result['tasks'])} Tasks!"
        })

        logger.info(f"Meta prompt hierarchy generation completed for job {job_id}")

    except Exception as e:
        logger.error(f"Meta prompt hierarchy generation failed for job {job_id}: {str(e)}", exc_info=True)
        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()
