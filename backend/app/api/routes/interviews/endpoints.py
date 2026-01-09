"""
Interviews API Endpoints
PROMPT #69 - Refactor interviews.py

HTTP endpoints for interview management:
- CRUD operations
- Dual-mode interview routing
- Async job creation (backlog generation, task generation, provisioning)
- Project provisioning
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel
import subprocess
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
from app.services.provisioning import ProvisioningService
from app.services.project_state_detector import ProjectStateDetector
from app.api.routes.interview_handlers import (
    handle_requirements_interview,
    handle_task_focused_interview,
    handle_meta_prompt_interview,
    handle_orchestrator_interview,  # PROMPT #91 / PROMPT #94
    handle_subtask_focused_interview,  # PROMPT #94 FASE 2
    handle_task_orchestrated_interview,  # PROMPT #97
    handle_subtask_orchestrated_interview,  # PROMPT #97
    handle_card_focused_interview  # PROMPT #98
)

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
# PROMPT #94 FASE 2 - Subtask-Focused Interview Mode
from .subtask_focused_questions import (
    build_subtask_focused_prompt
)
# PROMPT #97 - Task/Subtask Orchestrated Interview Modes
from .task_orchestrated_questions import (
    get_task_orchestrated_fixed_question,
    count_fixed_questions_task_orchestrated,
    is_fixed_question_complete_task_orchestrated
)
from .subtask_orchestrated_questions import (
    get_subtask_orchestrated_fixed_question,
    count_fixed_questions_subtask_orchestrated,
    is_fixed_question_complete_subtask_orchestrated
)
# PROMPT #98 - Card-Focused Interview Mode (Story/Task/Subtask with Motivation Type)
from .card_focused_questions import (
    get_card_focused_fixed_question,
    count_fixed_questions_card_focused,
    is_fixed_question_complete_card_focused,
    get_motivation_type_from_answers
)
from .card_focused_prompts import build_card_focused_prompt

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
            detail="conversation_data must be an array of messages"
        )

    # PROMPT #76 - Detect if this is the first interview (Meta Prompt mode)
    # PROMPT #68 - Otherwise detect project state and set interview mode
    project = db.query(Project).filter(Project.id == interview_data.project_id).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project {interview_data.project_id} not found"
        )

    # PROMPT #97 - Hierarchical Interview Flow
    # Determine interview mode based on parent_task_id
    parent_task_id = interview_data.parent_task_id

    if parent_task_id is None:
        # No parent → FIRST INTERVIEW → meta_prompt (creates Epic)
        interview_mode = "meta_prompt"
        logger.info(f"Creating FIRST interview for project {project.name}:")
        logger.info(f"  - interview_mode: meta_prompt (PROMPT #97 - Creates Epic)")
        logger.info(f"  - This interview collects comprehensive project info (Q1-Q18)")
    else:
        # Has parent → Hierarchical interview → mode depends on parent type
        parent_task = db.query(Task).filter(Task.id == parent_task_id).first()

        if not parent_task:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Parent task {parent_task_id} not found"
            )

        # PROMPT #98 - Check if card_focused mode is requested
        if interview_data.use_card_focused:
            # Card-focused mode with motivation type
            interview_mode = "card_focused"
            if parent_task.item_type == ItemType.EPIC:
                logger.info(f"Creating Story interview from Epic '{parent_task.title}':")
                logger.info(f"  - interview_mode: card_focused (PROMPT #98 - Creates Story with motivation type)")
            elif parent_task.item_type == ItemType.STORY:
                logger.info(f"Creating Task interview from Story '{parent_task.title}':")
                logger.info(f"  - interview_mode: card_focused (PROMPT #98 - Creates Task with motivation type)")
            elif parent_task.item_type == ItemType.TASK:
                logger.info(f"Creating Subtask interview from Task '{parent_task.title}':")
                logger.info(f"  - interview_mode: card_focused (PROMPT #98 - Creates Subtask with motivation type)")
        else:
            # Standard hierarchical mode without motivation type
            # Determine mode based on parent item_type
            if parent_task.item_type == ItemType.EPIC:
                # Epic → Story
                interview_mode = "orchestrator"
                logger.info(f"Creating Story interview from Epic '{parent_task.title}':")
                logger.info(f"  - interview_mode: orchestrator (PROMPT #97 - Creates Story)")
            elif parent_task.item_type == ItemType.STORY:
                # Story → Task
                interview_mode = "task_orchestrated"
                logger.info(f"Creating Task interview from Story '{parent_task.title}':")
                logger.info(f"  - interview_mode: task_orchestrated (PROMPT #97 - Creates Task)")
            elif parent_task.item_type == ItemType.TASK:
                # Task → Subtask
                interview_mode = "subtask_orchestrated"
                logger.info(f"Creating Subtask interview from Task '{parent_task.title}':")
                logger.info(f"  - interview_mode: subtask_orchestrated (PROMPT #97 - Creates Subtask)")
            else:
                # Fallback for other types
                interview_mode = "task_orchestrated"
                logger.warning(f"Unknown parent type {parent_task.item_type}, defaulting to task_orchestrated")

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

    PROMPT #84 - RAG Phase 2: Interview answers are now indexed in RAG for semantic search

    - **interview_id**: UUID of the interview
    - **message**: Message object to add to conversation_data
    """
    if not isinstance(interview.conversation_data, list):
        interview.conversation_data = []

    interview.conversation_data.append(message_request.message)

    # Mark the conversation_data as modified for SQLAlchemy to detect the change

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
            detail=f"Interview {interview_id} not found"
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

    # Execute in background
    import asyncio
    asyncio.create_task(
        _generate_backlog_async(
            job_id=job.id,
            interview_id=interview_id,
            project_id=interview.project_id
        )
    )

    # Return job_id immediately
    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": "Backlog generation started. This may take 2-5 minutes. Poll GET /api/v1/jobs/{} for progress.".format(job.id)
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
        job_manager.update_progress(job_id, 10.0, "Generating Epic from interview...")
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
        job_manager.update_progress(job_id, 30.0, f"Epic created: {epic.title}")

        # STEP 2: Decompose to Stories (30-60%)
        job_manager.update_progress(job_id, 35.0, "Decomposing Epic into Stories...")
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
            job_manager.update_progress(job_id, progress, f"Created Story {i+1}/{len(stories_suggestions)}")

        db.commit()
        for story in created_stories:
            db.refresh(story)

        logger.info(f"✅ Created {len(created_stories)} Stories")
        job_manager.update_progress(job_id, 60.0, f"Created {len(created_stories)} Stories")

        # STEP 3: Decompose Stories to Tasks (60-100%)
        all_created_tasks = []
        total_stories = len(created_stories)

        for story_idx, story in enumerate(created_stories):
            story_progress_start = 60.0 + (story_idx / total_stories) * 35.0
            job_manager.update_progress(
                job_id,
                story_progress_start,
                f"Decomposing Story {story_idx+1}/{total_stories} into Tasks..."
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
            "message": f"Generated hierarchical backlog: 1 Epic → {len(created_stories)} Stories → {len(all_created_tasks)} Tasks!"
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
    - suggested_subtasks (AI suggestions, not created yet)
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
            detail=f"Interview {interview_id} not found"
        )

    # Validate task-focused mode
    if interview.interview_mode != "task_focused":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only task-focused interviews can generate direct tasks. "
                   "This interview is in 'requirements' mode (use generate-prompts-async instead)."
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

    # Execute in background
    import asyncio
    asyncio.create_task(
        _generate_task_direct_async(
            job_id=job.id,
            interview_id=interview_id,
            project_id=interview.project_id
        )
    )

    # Return job_id immediately
    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": f"Task generation started. This may take 30-60 seconds. Poll GET /api/v1/jobs/{job.id} for progress."
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
    4. Create Task record with suggested_subtasks
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
            message="Loading interview..."
        )

        # Load interview and project
        interview = db.query(Interview).filter(Interview.id == interview_id).first()
        project = db.query(Project).filter(Project.id == project_id).first()

        if not interview or not project:
            raise Exception("Interview or project not found")

        # Update progress: Analyzing conversation
        job_manager.update_progress(
            job_id=job_id,
            progress=30,
            message=f"Analyzing interview (task type: {interview.task_type_selection})..."
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
            message="Task created successfully!"
        )

        # Complete job
        result = {
            "task_id": str(task.id),
            "title": task.title,
            "description": task.description,
            "story_points": task.story_points,
            "priority": task.priority.value if task.priority else None,
            "labels": task.labels or [],
            "suggested_subtasks_count": len(task.subtask_suggestions or []),
            "created_at": task.created_at.isoformat()
        }

        job_manager.complete_job(job_id, result)

        logger.info(f"🎉 Direct task generation completed for job {job_id}")

    except Exception as e:
        logger.error(f"❌ Direct task generation failed for job {job_id}: {str(e)}", exc_info=True)
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
    - 0-10 Subtasks per Task (with generated_prompt)

    All items are fully populated with:
    - title, description, acceptance_criteria
    - priorities, labels, story_points
    - generated_prompt (for execution)
    - MD files (documentation)

    AI analyzes each level hierarchically:
    - Interview → generates Epic + Stories
    - Each Story → generates Tasks
    - Each Task → generates Subtasks (if needed)

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
            detail=f"Interview {interview_id} not found"
        )

    # Validate interview mode (PROMPT #92/94 - Accept meta_prompt and orchestrator)
    if interview.interview_mode not in ["meta_prompt", "orchestrator"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot generate hierarchy from '{interview.interview_mode}' mode. "
                   f"Only 'meta_prompt' and 'orchestrator' interviews support full hierarchy generation."
        )

    # Validate interview is completed
    if interview.status != InterviewStatus.COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Interview must be completed before generating hierarchy. Current status: {interview.status.value}"
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

    # Execute in background
    import asyncio
    asyncio.create_task(
        _generate_hierarchy_from_meta_async(
            job_id=job.id,
            interview_id=interview_id,
            project_id=interview.project_id
        )
    )

    # Return job_id immediately
    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": f"Hierarchy generation started from meta prompt. This may take 2-5 minutes. Poll GET /api/v1/jobs/{job.id} for progress."
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
    2. Call AI to generate complete Epic → Stories → Tasks → Subtasks hierarchy
    3. Create all database records
    4. Generate atomic prompts (generated_prompt) for each Task/Subtask
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
            message="Loading meta prompt interview..."
        )

        # Load interview and project
        interview = db.query(Interview).filter(Interview.id == interview_id).first()
        project = db.query(Project).filter(Project.id == project_id).first()

        if not interview or not project:
            raise Exception("Interview or project not found")

        # Update progress: Processing with AI
        job_manager.update_progress(
            job_id=job_id,
            progress=20,
            message="Analyzing meta prompt responses and generating hierarchy with AI..."
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
            message="Hierarchy created successfully!"
        )

        # Complete job with result
        job_manager.complete_job(job_id, {
            "success": True,
            "epic_id": result["epic"]["id"],
            "epic_title": result["epic"]["title"],
            "stories_created": len(result["stories"]),
            "tasks_created": len(result["tasks"]),
            "subtasks_created": len(result["subtasks"]),
            "total_items": result["metadata"]["total_items"],
            "message": f"Generated complete hierarchy: 1 Epic → {len(result['stories'])} Stories → {len(result['tasks'])} Tasks → {len(result['subtasks'])} Subtasks!"
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
    Inicia a entrevista com primeira pergunta baseada no projeto.

    Este endpoint é chamado automaticamente quando o usuário abre o chat pela primeira vez.
    Retorna Question 1 (Title) - PROMPT #57 Fixed Questions.

    - **interview_id**: UUID of the interview

    Returns:
        - success: Boolean
        - message: Initial fixed question
    """
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

    # PROMPT #91 / PROMPT #57 - Return fixed Question 1 (Title) without calling AI
    logger.info(f"Starting interview {interview_id} with fixed Question 1 for project: {project.name}")

    # Get fixed Question 1 (Title) - use appropriate function based on interview mode
    # PROMPT #97 FIX - Call correct function for each interview mode
    # PROMPT #98 - Card-focused mode support added
    if interview.interview_mode == "orchestrator":
        assistant_message = get_orchestrator_fixed_question(1, project, db, {})
    elif interview.interview_mode == "meta_prompt":
        assistant_message = get_fixed_question_meta_prompt(1, project, db)
    elif interview.interview_mode == "card_focused":
        # Card-focused interview (PROMPT #98): Get Q1 (motivation type selection)
        parent_card = None
        if interview.parent_task_id:
            parent_card = db.query(Task).filter(Task.id == interview.parent_task_id).first()
        assistant_message = get_card_focused_fixed_question(1, project, db, parent_card, {})
    else:
        # Fallback for other modes (task_orchestrated, subtask_orchestrated, requirements, task_focused, subtask_focused)
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

    This endpoint is called automatically after the user completes the stack questions
    (backend, database, frontend, css, mobile) at the start of the interview.

    - **interview_id**: UUID of the interview
    - **stack**: Stack configuration with backend, database, frontend, css, mobile choices

    Returns:
        - success: Boolean
        - message: Confirmation message
        - provisioning: Provisioning result (if attempted)

    PROMPT #67 - Mobile support added
    PROMPT #60 - Automatic provisioning
    """
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
    project.stack_mobile = stack.mobile  # PROMPT #67 - Mobile support

    db.commit()
    db.refresh(project)

    # Build stack description for logging
    stack_parts = [stack.backend, stack.database, stack.frontend, stack.css]
    if stack.mobile:
        stack_parts.append(stack.mobile)
    stack_description = " + ".join(stack_parts)
    logger.info(f"Stack configuration saved for project {project.id}: {stack_description}")

    # PROMPT #60 - AUTOMATIC PROVISIONING
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
        logger.warning(f"Provisioning not available for this stack: {str(e)}")
        provisioning_error = str(e)
    except FileNotFoundError as e:
        logger.error(f"Provisioning script not found: {str(e)}")
        provisioning_error = str(e)
    except subprocess.TimeoutExpired:
        logger.error(f"Provisioning timed out after 5 minutes")
        provisioning_error = "Provisioning timed out after 5 minutes"
    except subprocess.CalledProcessError as e:
        logger.error(f"Provisioning script failed: {e.stderr}")
        provisioning_error = f"Provisioning script failed: {e.stderr}"
    except Exception as e:
        logger.error(f"Unexpected error during provisioning: {str(e)}")
        provisioning_error = f"Unexpected error: {str(e)}"

    # Return response with provisioning info
    response = {
        "success": True,
        "message": f"Stack configuration saved: {stack_description}",
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


@router.post("/{interview_id}/save-stack-async", status_code=status.HTTP_202_ACCEPTED)
async def save_interview_stack_async(
    interview_id: UUID,
    stack: StackConfiguration,
    db: Session = Depends(get_db)
):
    """
    Saves tech stack and provisions project ASYNCHRONOUSLY.

    PROMPT #65 - Async Job System (Expansion)

    This endpoint prevents UI blocking during project provisioning which can take 1-5 minutes.

    Returns:
        {
            "job_id": "...",
            "status": "pending",
            "message": "Project provisioning started. This may take 1-5 minutes."
        }
    """
    from app.services.job_manager import JobManager
    from app.models.async_job import JobType

    # Validate interview exists
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Interview {interview_id} not found"
        )

    # Validate project exists
    project = db.query(Project).filter(Project.id == interview.project_id).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )

    # Save stack configuration immediately (synchronous, fast)
    project.stack_backend = stack.backend
    project.stack_database = stack.database
    project.stack_frontend = stack.frontend
    project.stack_css = stack.css
    project.stack_mobile = stack.mobile  # PROMPT #67
    db.commit()
    db.refresh(project)

    # Build stack description
    stack_parts = [stack.backend, stack.database, stack.frontend, stack.css]
    if stack.mobile:
        stack_parts.append(stack.mobile)
    stack_description = " + ".join(stack_parts)
    logger.info(f"Stack saved for project {project.id}: {stack_description}")

    # Create async job for provisioning
    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.PROJECT_PROVISIONING,
        input_data={
            "interview_id": str(interview_id),
            "project_id": str(project.id),
            "stack": {
                "backend": stack.backend,
                "database": stack.database,
                "frontend": stack.frontend,
                "css": stack.css,
                "mobile": stack.mobile
            }
        },
        project_id=project.id,
        interview_id=interview_id
    )

    logger.info(f"Created provisioning job {job.id} for project {project.name}")

    # Execute in background
    import asyncio
    asyncio.create_task(
        _provision_project_async(
            job_id=job.id,
            project_id=project.id
        )
    )

    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": f"Project provisioning started. This may take 1-5 minutes. Poll GET /api/v1/jobs/{job.id} for progress."
    }


async def _provision_project_async(
    job_id: UUID,
    project_id: UUID
):
    """
    Background task to provision project (create files, install dependencies, etc.).

    Updates job progress at each step.
    """
    from app.database import SessionLocal
    from app.services.job_manager import JobManager

    # Create new DB session
    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        logger.info(f"🚀 Starting project provisioning for job {job_id}")

        # Get project
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            job_manager.fail_job(job_id, f"Project {project_id} not found")
            return

        provisioning_service = ProvisioningService(db)

        # STEP 1: Validate stack (0-20%)
        job_manager.update_progress(job_id, 10.0, "Validating stack configuration...")
        logger.info(f"📋 Validating stack: {project.stack}")

        is_valid, error_msg = provisioning_service.validate_stack(project.stack)
        if not is_valid:
            logger.warning(f"Stack validation failed: {error_msg}")
            job_manager.fail_job(job_id, f"Stack validation failed: {error_msg}")
            return

        job_manager.update_progress(job_id, 20.0, "Stack validated successfully")

        # STEP 2: Execute provisioning (20-90%)
        job_manager.update_progress(job_id, 30.0, f"Creating project structure for {project.name}...")
        logger.info(f"🏗️  Provisioning project {project.name}...")

        try:
            provisioning_result = provisioning_service.provision_project(project)

            if not provisioning_result or not provisioning_result.get("success"):
                error = provisioning_result.get("error", "Unknown provisioning error") if provisioning_result else "Provisioning returned no result"
                job_manager.fail_job(job_id, error)
                return

            job_manager.update_progress(job_id, 90.0, "Project created successfully")
            logger.info(f"✅ Project provisioned at: {provisioning_result.get('project_path')}")

        except ValueError as e:
            logger.warning(f"Stack not supported: {str(e)}")
            job_manager.fail_job(job_id, f"Stack combination not supported: {str(e)}")
            return
        except FileNotFoundError as e:
            logger.error(f"Provisioning script not found: {str(e)}")
            job_manager.fail_job(job_id, f"Provisioning script not found: {str(e)}")
            return
        except subprocess.TimeoutExpired:
            logger.error("Provisioning timed out after 5 minutes")
            job_manager.fail_job(job_id, "Provisioning timed out after 5 minutes. The project may be partially created.")
            return
        except subprocess.CalledProcessError as e:
            logger.error(f"Provisioning script failed: {e.stderr}")
            job_manager.fail_job(job_id, f"Provisioning script failed: {e.stderr}")
            return

        # STEP 3: Complete (90-100%)
        job_manager.update_progress(job_id, 95.0, "Finalizing project setup...")

        # Complete job with result
        job_manager.complete_job(job_id, {
            "success": True,
            "project_name": provisioning_result.get("project_name"),
            "project_path": provisioning_result.get("project_path"),
            "credentials": provisioning_result.get("credentials", {}),
            "next_steps": provisioning_result.get("next_steps", []),
            "scripts_executed": provisioning_result.get("scripts_executed", []),
            "message": f"Project '{project.name}' provisioned successfully!"
        })

        logger.info(f"✅ Provisioning job {job_id} completed successfully")

    except Exception as e:
        logger.error(f"❌ Provisioning job {job_id} failed: {str(e)}", exc_info=True)
        job_manager.fail_job(job_id, f"Unexpected error: {str(e)}")

    finally:
        db.close()


@router.post("/{interview_id}/send-message", status_code=status.HTTP_200_OK)
async def send_message_to_interview(
    interview_id: UUID,
    message: InterviewMessageCreate,
    db: Session = Depends(get_db)
):
    """
    Envia mensagem do usuário e obtém resposta da IA.

    PROMPT #68 - Dual-Mode Interview System
    PROMPT #94 FASE 2 - Subtask-Focused Mode Added:

    Routes to correct handler based on interview_mode:
    - orchestrator: Q1-Q8 conditional stack → AI contextual questions (first interview)
    - meta_prompt: Q1-Q17 fixed questions → AI contextual questions (first interview alternative)
    - requirements: Q1-Q7 stack → AI business questions (legacy)
    - task_focused: Q1 task type → AI focused questions (existing projects)
    - subtask_focused: No fixed questions → AI atomic decomposition (new in PROMPT #94)

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

    # CRITICAL FIX: Commit user message IMMEDIATELY
    db.commit()
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

    # PROMPT #91/94 / PROMPT #76 / PROMPT #68 - Route based on interview mode
    # Five modes: orchestrator, meta_prompt, requirements, task_focused, subtask_focused
    if interview.interview_mode == "orchestrator":
        # Orchestrator interview (FIRST interview - PROMPT #91/94): Q1-Q8 conditional → AI contextual questions
        return await handle_orchestrator_interview(
            interview=interview,
            project=project,
            message_count=message_count,
            db=db,
            get_orchestrator_fixed_question_func=get_orchestrator_fixed_question,
            count_fixed_questions_orchestrator_func=count_fixed_questions_orchestrator,
            is_fixed_question_complete_orchestrator_func=is_fixed_question_complete_orchestrator,
            clean_ai_response_func=clean_ai_response,
            prepare_context_func=prepare_interview_context
        )
    elif interview.interview_mode == "meta_prompt":
        # Meta Prompt interview (FIRST interview - PROMPT #76): Q1-Q17 fixed → AI contextual questions
        return await handle_meta_prompt_interview(
            interview=interview,
            project=project,
            message_count=message_count,
            project_context=project_context,
            db=db,
            get_fixed_question_meta_prompt_func=get_fixed_question_meta_prompt,
            clean_ai_response_func=clean_ai_response,
            prepare_context_func=prepare_interview_context
        )
    elif interview.interview_mode == "requirements":
        # Requirements interview (new projects): Q1-Q7 stack → AI business questions
        return await handle_requirements_interview(
            interview=interview,
            project=project,
            message_count=message_count,
            project_context=project_context,
            stack_context=stack_context,
            db=db,
            get_fixed_question_func=get_fixed_question,
            clean_ai_response_func=clean_ai_response,
            prepare_context_func=prepare_interview_context
        )
    elif interview.interview_mode == "task_focused":
        # Task-focused interview (existing projects): Q1 task type → AI focused questions
        return await handle_task_focused_interview(
            interview=interview,
            project=project,
            message_count=message_count,
            stack_context=stack_context,
            db=db,
            get_fixed_question_task_focused_func=get_fixed_question_task_focused,
            extract_task_type_func=extract_task_type_from_answer,
            build_task_focused_prompt_func=build_task_focused_prompt,
            clean_ai_response_func=clean_ai_response,
            prepare_context_func=prepare_interview_context
        )
    elif interview.interview_mode == "subtask_focused":
        # Subtask-focused interview (PROMPT #94 FASE 2): No fixed questions → AI atomic decomposition
        # TODO: Get parent_task from interview metadata when feature is fully implemented
        return await handle_subtask_focused_interview(
            interview=interview,
            project=project,
            message_count=message_count,
            db=db,
            build_subtask_focused_prompt_func=build_subtask_focused_prompt,
            clean_ai_response_func=clean_ai_response,
            prepare_context_func=prepare_interview_context,
            parent_task=None  # Will be populated in future when creating subtasks for specific task
        )
    elif interview.interview_mode == "task_orchestrated":
        # Task-orchestrated interview (PROMPT #97): Q1-Q2 fixed → AI contextual (for Tasks within Stories)
        return await handle_task_orchestrated_interview(
            interview=interview,
            project=project,
            message_count=message_count,
            db=db,
            get_task_orchestrated_fixed_question_func=get_task_orchestrated_fixed_question,
            count_fixed_questions_task_orchestrated_func=count_fixed_questions_task_orchestrated,
            is_fixed_question_complete_task_orchestrated_func=is_fixed_question_complete_task_orchestrated,
            clean_ai_response_func=clean_ai_response,
            prepare_context_func=prepare_interview_context
        )
    elif interview.interview_mode == "subtask_orchestrated":
        # Subtask-orchestrated interview (PROMPT #97): Q1-Q2 fixed → AI contextual (for Subtasks within Tasks)
        return await handle_subtask_orchestrated_interview(
            interview=interview,
            project=project,
            message_count=message_count,
            db=db,
            get_subtask_orchestrated_fixed_question_func=get_subtask_orchestrated_fixed_question,
            count_fixed_questions_subtask_orchestrated_func=count_fixed_questions_subtask_orchestrated,
            is_fixed_question_complete_subtask_orchestrated_func=is_fixed_question_complete_subtask_orchestrated,
            clean_ai_response_func=clean_ai_response,
            prepare_context_func=prepare_interview_context
        )
    elif interview.interview_mode == "card_focused":
        # Card-focused interview (PROMPT #98): Q1-Q3 fixed → AI contextual (for Story/Task/Subtask with motivation type)
        parent_card = None
        if interview.parent_task_id:
            parent_card = db.query(Task).filter(Task.id == interview.parent_task_id).first()

        return await handle_card_focused_interview(
            interview=interview,
            project=project,
            message_count=message_count,
            db=db,
            get_card_focused_fixed_question_func=get_card_focused_fixed_question,
            count_fixed_questions_card_focused_func=count_fixed_questions_card_focused,
            is_fixed_question_complete_card_focused_func=is_fixed_question_complete_card_focused,
            get_motivation_type_from_answers_func=get_motivation_type_from_answers,
            build_card_focused_prompt_func=build_card_focused_prompt,
            clean_ai_response_func=clean_ai_response,
            prepare_context_func=prepare_interview_context,
            parent_card=parent_card,
            stack_context=stack_context
        )
    else:
        # Unknown interview mode
        logger.error(f"Unknown interview_mode: {interview.interview_mode}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unknown interview mode: {interview.interview_mode}"
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
            detail="No valid title or description provided"
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
            detail="Failed to update project information"
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


@router.post("/{interview_id}/provision", status_code=status.HTTP_200_OK)
async def provision_project(
    interview_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Provision a project based on stack configuration from interview.

    PROMPT #59 - Automated Project Provisioning

    Creates complete project scaffold in ./projects/<project-name>/ using the
    stack technologies selected during interview (questions 3-7).

    Supported Stack Combinations:
    - Laravel + PostgreSQL + Tailwind CSS
    - Next.js + PostgreSQL + Tailwind CSS
    - FastAPI + React + PostgreSQL + Tailwind CSS

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
    """
    from app.services.provisioning import get_provisioning_service

    # Find interview and associated project
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

    # Validate stack is configured
    if not project.stack:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project stack not configured. Complete interview stack questions first (questions 3-6)."
        )

    logger.info(f"Provisioning project '{project.name}' with stack: {project.stack}")

    # Validate stack configuration
    provisioning_service = get_provisioning_service(db)
    is_valid, error_msg = provisioning_service.validate_stack(project.stack)

    if not is_valid:
        logger.error(f"Invalid stack for project {project.id}: {error_msg}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg
        )

    # Execute provisioning
    try:
        result = provisioning_service.provision_project(project)

        if not result.get("success"):
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


@router.post("/{interview_id}/send-message-async", status_code=status.HTTP_202_ACCEPTED)
async def send_message_async(
    interview_id: UUID,
    message: InterviewMessageCreate,
    db: Session = Depends(get_db)
):
    """
    Send message to interview and get AI response ASYNCHRONOUSLY.

    PROMPT #65 - Async Job System

    This endpoint prevents UI blocking by processing AI call in background.

    Returns:
        {
            "job_id": "...",
            "status": "pending",
            "message": "Job created, poll /jobs/{job_id} for result"
        }
    """
    from app.services.job_manager import JobManager
    from app.models.async_job import JobType

    # Validate interview exists
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Interview {interview_id} not found"
        )

    # Create async job
    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.INTERVIEW_MESSAGE,
        input_data={
            "interview_id": str(interview_id),
            "message_content": message.content
        },
        project_id=interview.project_id,
        interview_id=interview_id
    )

    logger.info(f"Created async job {job.id} for interview {interview_id}")

    # Execute in background
    import asyncio
    asyncio.create_task(
        _process_interview_message_async(
            job_id=job.id,
            interview_id=interview_id,
            message_content=message.content
        )
    )

    # Return job_id immediately
    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": f"Job created successfully. Poll GET /api/v1/jobs/{job.id} for result."
    }


async def _process_interview_message_async(
    job_id: UUID,
    interview_id: UUID,
    message_content: str
):
    """
    Background task to process AI response for interview message.

    PROMPT #65 - Async Job System
    """
    from app.database import SessionLocal
    from app.services.job_manager import JobManager
    from app.services.ai_orchestrator import AIOrchestrator

    # Create new DB session for background task
    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        logger.info(f"🚀 Background task started for job {job_id}")

        # Get interview
        interview = db.query(Interview).filter(Interview.id == interview_id).first()
        if not interview:
            job_manager.fail_job(job_id, f"Interview {interview_id} not found")
            return

        # Initialize conversation_data if empty
        if not interview.conversation_data:
            interview.conversation_data = []

        # Add user message
        user_message = {
            "role": "user",
            "content": message_content,
            "timestamp": datetime.utcnow().isoformat()
        }
        interview.conversation_data.append(user_message)
        db.commit()

        logger.info(f"Added user message to interview {interview_id}")

        # Update progress: 30%
        job_manager.update_progress(job_id, 30.0, "User message added, calling AI...")

        # Get project for context
        project = db.query(Project).filter(Project.id == interview.project_id).first()

        # Count messages
        message_count = len(interview.conversation_data)

        # Check if fixed question or AI question
        # PROMPT #97 FIX - Check interview_mode to call correct question function
        if message_count in [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34]:
            # Fixed question - route to correct function based on interview_mode
            question_map = {
                2: 2, 4: 3, 6: 4, 8: 5, 10: 6, 12: 7, 14: 8, 16: 9,
                18: 10, 20: 11, 22: 12, 24: 13, 26: 14, 28: 15, 30: 16, 32: 17, 34: 18
            }
            question_number = question_map[message_count]

            logger.info(f"Returning fixed Question {question_number} for mode={interview.interview_mode}")

            # PROMPT #97 - Call correct function based on interview_mode
            if interview.interview_mode == "meta_prompt":
                assistant_message = get_fixed_question_meta_prompt(question_number, project, db)
            elif interview.interview_mode == "orchestrator":
                # Orchestrator uses different question mapping
                prev_answers = {}  # TODO: extract from conversation if needed
                assistant_message = get_orchestrator_fixed_question(question_number, project, db, prev_answers)
            else:
                # Legacy modes (requirements, etc.)
                assistant_message = get_fixed_question(question_number, project, db)

            if not assistant_message:
                job_manager.fail_job(job_id, f"Failed to get fixed question {question_number}")
                return

            interview.conversation_data.append(assistant_message)
            db.commit()

            # Complete job
            job_manager.complete_job(job_id, {
                "success": True,
                "message": assistant_message,
                "usage": {
                    "model": "system/fixed-question",
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "total_cost_usd": 0.0
                }
            })

            logger.info(f"✅ Job {job_id} completed (fixed question)")

        elif message_count >= 36 or (interview.interview_mode not in ["meta_prompt", "orchestrator"] and message_count >= 12):
            # AI business question
            # PROMPT #97 - meta_prompt has 18 fixed questions → AI starts at count=36
            # orchestrator has 8 fixed questions → AI starts at count=18 (TODO)
            # Legacy modes have 6 fixed questions → AI starts at count=12
            logger.info(f"Calling AI for business question (message_count={message_count})")

            job_manager.update_progress(job_id, 40.0, "Preparing AI call...")

            # Build simplified system prompt
            system_prompt = """Você é um analista de requisitos de IA coletando requisitos técnicos para um projeto de software.

**Conduza em PORTUGUÊS.** Faça perguntas relevantes sobre funcionalidades, integrações, usuários, performance, etc.

**Formato de Pergunta:**
❓ Pergunta [número]: [Sua pergunta contextual]

Continue com próxima pergunta relevante!
"""

            # Prepare optimized context
            optimized_messages = prepare_interview_context(
                conversation_data=interview.conversation_data,
                max_recent=5
            )

            job_manager.update_progress(job_id, 50.0, "Calling AI...")

            # Call AI
            orchestrator = AIOrchestrator(db)
            response = await orchestrator.execute(
                usage_type="interview",
                messages=optimized_messages,
                system_prompt=system_prompt,
                max_tokens=1000,
                project_id=interview.project_id,
                interview_id=interview.id
            )

            job_manager.update_progress(job_id, 80.0, "Processing AI response...")

            # Clean AI response
            cleaned_content = clean_ai_response(response["content"])

            # Add assistant message
            assistant_message = {
                "role": "assistant",
                "content": cleaned_content,
                "timestamp": datetime.utcnow().isoformat(),
                "model": f"{response['provider']}/{response['model']}"
            }

            interview.conversation_data.append(assistant_message)
            interview.ai_model_used = response["model"]
            db.commit()

            # Complete job
            job_manager.complete_job(job_id, {
                "success": True,
                "message": assistant_message,
                "usage": response.get("usage", {})
            })

            logger.info(f"✅ Job {job_id} completed (AI question)")

        else:
            # Unexpected state
            job_manager.fail_job(job_id, f"Unexpected interview state (message_count={message_count})")

    except Exception as e:
        logger.error(f"❌ Job {job_id} failed: {str(e)}", exc_info=True)
        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()
