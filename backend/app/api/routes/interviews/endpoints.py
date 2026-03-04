"""
Interviews API Endpoints
PROMPT #69 - Refactor interviews.py

HTTP endpoints for interview management:
- CRUD operations
- Dual-mode interview routing
- Async job creation (backlog generation, task generation)
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel
import logging

# Database and dependencies
from app.database import get_db
from app.models.interview import Interview, InterviewStatus
from app.models.project import Project
from app.models.prompt import Prompt
from app.models.task import Task, ItemType, PriorityLevel, TaskStatus
from app.schemas.interview import (
    InterviewCreate,
    InterviewUpdate,
    InterviewResponse,
    InterviewMessageCreate,
    StackConfiguration,
    ProjectInfoUpdate
)
from app.api.dependencies import get_interview_or_404

# Services
from app.services.project_state_detector import ProjectStateDetector
# PROMPT #103 - External prompts support
from app.prompts import get_prompt_service
# Import helper functions from modular files (PROMPT #69)
from .response_cleaners import clean_ai_response
from .context_builders import (
    prepare_interview_context,
    extract_task_type_from_answer
)
from .task_type_prompts import build_task_focused_prompt
from .fixed_questions import (
    get_fixed_question,
    get_fixed_question_task_focused,
    get_fixed_question_meta_prompt
)
# PROMPT #91 / PROMPT #94 - Orchestrator Interview Mode
from .orchestrator_questions import (
    get_orchestrator_fixed_question,
    count_fixed_questions_orchestrator,
    is_fixed_question_complete_orchestrator
)
# PROMPT #97 - Task Orchestrated Interview Mode
from .task_orchestrated_questions import (
    get_task_orchestrated_fixed_question,
    count_fixed_questions_task_orchestrated,
    is_fixed_question_complete_task_orchestrated
)
# PROMPT #98 - Card-Focused Interview Mode (Story/Task with Motivation Type)
from .card_focused_questions import (
    get_card_focused_fixed_question,
    count_fixed_questions_card_focused,
    is_fixed_question_complete_card_focused,
    get_motivation_type_from_answers
)
from .card_focused_prompts import build_card_focused_prompt
# PROMPT #78 - Unified Open-Ended Interview System
from .unified_open_handler import (
    handle_unified_open_interview,
    generate_first_question
)

logger = logging.getLogger(__name__)

router = APIRouter()


# Request Models
class MessageRequest(BaseModel):
    """Request model for adding a message to an interview."""
    message: dict


class StatusUpdateRequest(BaseModel):
    """Request model for updating interview status."""
    status: InterviewStatus


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
    - New projects: Q1-Q7 stack questions → AI business questions
    - Existing projects: Skip stack, ask task type → Focused questions

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
            detail=f"Projeto {interview_data.project_id} não encontrado"
        )

    # PROMPT #97 - Hierarchical Interview Flow
    # PROMPT #98 - Card-focused mode for Stories/Tasks (not for Epic - Epic has no motivation type)
    # Determine interview mode based on parent_task_id and use_card_focused flag
    parent_task_id = interview_data.parent_task_id

    # DEBUG: Log interview creation parameters (PROMPT #98 debugging)
    logger.info(f"📋 CREATE INTERVIEW - Parameters received:")
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
                detail=f"Tarefa pai {parent_task_id} não encontrada"
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
                # Epic → Story
                interview_mode = "orchestrator"
                logger.info(f"  - interview_mode: orchestrator (PROMPT #97 - Creates Story)")
            elif parent_task.item_type == ItemType.STORY:
                # Story → Task
                interview_mode = "task_orchestrated"
                logger.info(f"  - interview_mode: task_orchestrated (PROMPT #97 - Creates Task)")
            else:
                # Fallback for other types
                interview_mode = "task_orchestrated"
                logger.warning(f"Unknown parent type {parent_task.item_type}, defaulting to task_orchestrated")

    # DEBUG: Log the determined interview mode (PROMPT #98 debugging)
    logger.info(f"✅ INTERVIEW MODE DETERMINED: interview_mode={interview_mode}")

    # PROMPT #232 - IA-1 fix: Cancel existing active interview on same card before creating new
    if parent_task_id:
        active_interview = db.query(Interview).filter(
            Interview.parent_task_id == parent_task_id,
            Interview.status == "active"
        ).first()
        if active_interview:
            active_interview.status = "cancelled"
            db.flush()
            logger.info(f"🚫 Cancelled previous active interview {active_interview.id} on card {parent_task_id}")
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
            logger.info(f"🚫 Cancelled previous active project interview {active_interview.id}")

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

            logger.info(f"✅ RAG: Indexed interview answer (Q{question_number}) for interview {interview.id}")

        except Exception as e:
            # Don't fail the request if RAG indexing fails
            logger.warning(f"⚠️  RAG indexing failed for interview answer: {e}")

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


# ============================================================================
# ASYNC JOB ENDPOINTS (PROMPT #65 - Async Job System)
# ============================================================================

@router.post("/{interview_id}/generate-prompts-async", status_code=status.HTTP_202_ACCEPTED)
async def generate_prompts_async(
    interview_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Generate backlog hierarchy (Epic → Stories → Tasks) ASYNCHRONOUSLY.

    PROMPT #65 - Async Job System

    This endpoint was previously blocking for 2-5 minutes while generating:
    - 1 Epic (30s)
    - 3-7 Stories (1-2 min)
    - 15-50 Tasks (1-3 min)

    Now it returns immediately and processes in background:
    1. Creates async job with status=PENDING
    2. Returns job_id immediately (HTTP 202 Accepted)
    3. Generates Epic → Stories → Tasks in background
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
            detail=f"Entrevista {interview_id} não encontrada"
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
        "message": "Geração de backlog iniciada. Isso pode levar 2-5 minutos. Consulte GET /api/v1/jobs/{} para o progresso.".format(job.id)
    }


async def _generate_backlog_async(
    job_id: UUID,
    interview_id: UUID,
    project_id: UUID
):
    """
    Background task to generate Epic → Stories → Tasks hierarchy.

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
        logger.info(f"🚀 Starting backlog generation for job {job_id}")

        generator = BacklogGeneratorService(db=db)

        # STEP 1: Generate Epic (0-30%)
        job_manager.update_progress(job_id, 10.0, "Gerando Epic a partir da entrevista...")
        logger.info(f"🎯 Generating Epic from interview {interview_id}")

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

        logger.info(f"✅ Created Epic: {epic.title}")
        job_manager.update_progress(job_id, 30.0, f"Epic criado: {epic.title}")

        # STEP 2: Decompose to Stories (30-60%)
        job_manager.update_progress(job_id, 35.0, "Decompondo Epic em Stories...")
        logger.info(f"📋 Decomposing Epic {epic.id} into Stories")

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

        logger.info(f"✅ Created {len(created_stories)} Stories")
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

        logger.info(f"🎉 Backlog generation complete: {total_items} items created")

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
            "message": f"Backlog hierárquico gerado: 1 Epic → {len(created_stories)} Stories → {len(all_created_tasks)} Tasks!"
        })

        logger.info(f"✅ Job {job_id} completed successfully")

    except Exception as e:
        logger.error(f"❌ Backlog generation failed for job {job_id}: {str(e)}", exc_info=True)
        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()


@router.post("/{interview_id}/generate-task-direct", status_code=status.HTTP_202_ACCEPTED)
async def generate_task_direct(
    interview_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Generate SINGLE TASK directly from task-focused interview (ASYNC).

    PROMPT #68 - Dual-Mode Interview System (FASE 4)

    For task-focused interviews (existing projects), this endpoint generates
    a SINGLE task directly without Epic→Story→Task hierarchy.

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
            detail=f"Entrevista {interview_id} não encontrada"
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
        "message": f"Geração de tarefas iniciada. Isso pode levar 30-60 segundos. Consulte GET /api/v1/jobs/{job.id} para o progresso."
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

        logger.info(f"🚀 Starting direct task generation for interview {interview_id}")

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
            raise Exception("Entrevista ou projeto não encontrado")

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

        logger.info(f"✅ Task generated: {task.id} - {task.title}")

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

        logger.info(f"🎉 Direct task generation completed for job {job_id}")

    except Exception as e:
        logger.error(f"❌ Direct task generation failed for job {job_id}: {str(e)}", exc_info=True)
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
            detail=f"Entrevista {interview_id} não encontrada"
        )

    # Validate interview mode
    if interview.interview_mode not in ["context", "meta_prompt"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Não é possível gerar contexto a partir do modo '{interview.interview_mode}'. "
                   f"Apenas entrevistas 'context' suportam geração de contexto."
        )

    # Get project for notification
    project = db.query(Project).filter(Project.id == interview.project_id).first()
    project_name = project.name if project else "projeto"

    # PROMPT #232 - IA-2 fix: prevent context regeneration after lock
    if project and project.context_locked:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Contexto do projeto já está travado. "
                   "Não é possível regenerar contexto após ativação de cards."
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
        "message": "Geração de contexto iniciada. Você pode navegar livremente - uma notificação aparecera quando concluir.",
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
        logger.info(f"🚀 Context generation background task started for job {job_id}")

        # Get project name for notification
        project = db.query(Project).filter(Project.id == project_id).first()
        project_name = project.name if project else "projeto"

        job_manager.update_progress(job_id, 20.0, "Analisando respostas da entrevista...")

        context_service = ContextGeneratorService(db)

        job_manager.update_progress(job_id, 50.0, "Gerando contexto semântico...")

        result = await context_service.generate_context_from_interview(
            interview_id=interview_id,
            project_id=project_id
        )

        job_manager.update_progress(job_id, 80.0, "Gerando epicos sugeridos...")

        # PROMPT #133 - Update notification_title for success
        job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        if job:
            epic_count = len(result.get("suggested_epics", []))
            job.notification_title = f"✅ Contexto gerado para '{project_name}' - {epic_count} epicos sugeridos"
            db.commit()

        job_manager.complete_job(job_id, {
            "success": True,
            "context_semantic": result["context_semantic"],
            "context_human": result["context_human"],
            "semantic_map": result.get("semantic_map", {}),
            "interview_insights": result.get("interview_insights", {}),
            "suggested_epics": result.get("suggested_epics", [])
        })

        logger.info(f"✅ Context generation job {job_id} completed")

    except Exception as e:
        logger.error(f"❌ Context generation job {job_id} failed: {str(e)}", exc_info=True)

        # PROMPT #133 - Update notification_title for failure
        try:
            job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
            if job:
                error_msg = str(e)[:80]
                job.notification_title = f"❌ Erro na geração de contexto: {error_msg}"
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
    - Interview → generates Epic + Stories
    - Each Story → generates Tasks

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
            detail=f"Entrevista {interview_id} não encontrada"
        )

    # Validate interview mode (PROMPT #92/94 - Accept meta_prompt and orchestrator)
    if interview.interview_mode not in ["meta_prompt", "orchestrator"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Não é possível gerar hierarquia a partir do modo '{interview.interview_mode}'. "
                   f"Apenas entrevistas 'meta_prompt' e 'orchestrator' suportam geração completa de hierarquia."
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
        "message": f"Geração de hierarquia iniciada a partir do meta prompt. Isso pode levar 2-5 minutos. Consulte GET /api/v1/jobs/{job.id} para o progresso."
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
    2. Call AI to generate complete Epic → Stories → Tasks hierarchy
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

        logger.info(f"🚀 Starting meta prompt hierarchy generation for interview {interview_id}")

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
            raise Exception("Entrevista ou projeto não encontrado")

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

        logger.info(f"✅ Hierarchy generated: {result['metadata']['total_items']} items created")

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
            "message": f"Hierarquia completa gerada: 1 Epic → {len(result['stories'])} Stories → {len(result['tasks'])} Tasks!"
        })

        logger.info(f"🎉 Meta prompt hierarchy generation completed for job {job_id}")

    except Exception as e:
        logger.error(f"❌ Meta prompt hierarchy generation failed for job {job_id}: {str(e)}", exc_info=True)
        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()


# ============================================================================
# INTERVIEW INTERACTION ENDPOINTS
# ============================================================================

@router.post("/{interview_id}/start", status_code=status.HTTP_200_OK)
async def start_interview(
    interview_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Inicia a entrevista com primeira pergunta aberta gerada por IA.

    PROMPT #78 - Unified Open-Ended Interview System

    Este endpoint é chamado automaticamente quando o usuário abre o chat pela primeira vez.
    Agora retorna uma pergunta ABERTA gerada por IA (não mais perguntas fixas).

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
            detail=f"Entrevista {interview_id} não encontrada"
        )

    # Verificar se já foi iniciada
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
            detail="Projeto não encontrado"
        )

    # Inicializar conversa
    interview.conversation_data = []

    # PROMPT #78 - Unified Open-Ended Interview System
    # Generate first open-ended question using AI
    logger.info(f"🌟 Starting interview {interview_id} with OPEN-ENDED Question 1 for project: {project.name}")

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

    logger.info(f"✅ Interview {interview_id} started with open-ended Question 1")

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
            detail=f"Entrevista {interview_id} não encontrada"
        )

    # Buscar projeto
    project = db.query(Project).filter(Project.id == interview.project_id).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Projeto não encontrado"
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
        "message": f"Configuração de stack salva: {stack_description}",
    }


@router.post("/{interview_id}/send-message", status_code=status.HTTP_200_OK)
async def send_message_to_interview(
    interview_id: UUID,
    message: InterviewMessageCreate,
    db: Session = Depends(get_db)
):
    """
    Envia mensagem do usuário e obtém resposta da IA.

    PROMPT #68 - Dual-Mode Interview System
    Routes to correct handler based on interview_mode:
    - orchestrator: Q1-Q8 conditional stack → AI contextual questions (first interview)
    - meta_prompt: Q1-Q17 fixed questions → AI contextual questions (first interview alternative)
    - requirements: Q1-Q7 stack → AI business questions (legacy)
    - task_focused: Q1 task type → AI focused questions (existing projects)

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
            detail=f"Entrevista {interview_id} não encontrada"
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
    flag_modified(interview, "conversation_data")  # CRITICAL: SQLAlchemy needs this for JSONB changes
    db.flush()  # PROMPT #99: Flush first to write to DB

    # DEBUG: Log state after adding user message
    logger.info(f"🔍 DEBUG - After adding user message:")
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

        logger.info(f"✅ RAG: Indexed interview answer (Q{question_number}) for interview {interview.id}")

    except Exception as e:
        # Don't fail the request if RAG indexing fails
        logger.warning(f"⚠️  RAG indexing failed for interview answer: {e}")

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

    # CRITICAL FIX: Commit user message IMMEDIATELY
    db.commit()
    db.refresh(interview)  # PROMPT #99: Refresh to ensure data is synced
    logger.info(f"✅ User message committed to database")

    # Count messages to determine if we're in fixed questions phase
    message_count = len(interview.conversation_data)

    # DEBUG: Log message count and decision point
    logger.info(f"🔍 DEBUG - Decision point:")
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
            detail="Entrevista não encontrada"
        )

    # Get associated project
    project = db.query(Project).filter(Project.id == interview.project_id).first()
    if not project:
        logger.error(f"Project {interview.project_id} not found for interview {interview_id}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Projeto associado não encontrado"
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
            detail="Nenhum título ou descrição válido fornecido"
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
            detail="Falha ao atualizar informações do projeto"
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
            detail=f"Entrevista {interview_id} não encontrada"
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

    logger.info(f"✅ User message added to interview {interview_id} (message_count: {len(interview.conversation_data)})")

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

        logger.info(f"✅ RAG: Indexed interview answer (Q{question_number}) for interview {interview.id}")

    except Exception as e:
        # Don't fail the request if RAG indexing fails
        logger.warning(f"⚠️  RAG indexing failed for interview answer: {e}")

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
        logger.info(f"🚀 Background task started for job {job_id}")

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
            job_manager.fail_job(job_id, f"Entrevista {interview_id} não encontrada")
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
        logger.info(f"🌟 ASYNC: Generating open-ended question (message_count={message_count})")

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
            job.notification_title = f"✅ Pergunta gerada para '{task_title}'"
            db.commit()

        # Complete job with result
        job_manager.complete_job(job_id, {
            "success": result.get("success", True),
            "message": result.get("message"),
            "usage": result.get("usage", {})
        })

        logger.info(f"✅ Job {job_id} completed (open-ended question)")

    except Exception as e:
        logger.error(f"❌ Job {job_id} failed: {str(e)}", exc_info=True)
        # PROMPT #133 - Update notification_title for failure
        try:
            job = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
            if job:
                error_msg = str(e)[:100]  # Truncate long errors
                job.notification_title = f"❌ Erro na geração de pergunta: {error_msg}"
                db.commit()
        except Exception:
            pass  # Don't fail the error handling
        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()
