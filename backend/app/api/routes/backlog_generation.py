"""
Backlog Generation API Router
AI-powered Epic/Story/Task generation from interviews and decomposition
JIRA Transformation - Phase 2
PROMPT #108 - Moved to background queue
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Dict, List, Any
from uuid import UUID, uuid4
from datetime import datetime
from pydantic import BaseModel

from app.database import get_db
from app.models.task import Task, ItemType, PriorityLevel
from app.models.interview import Interview
from app.models.async_job import JobType
from app.schemas.task import (
    BacklogGenerationResponse,
    TaskCreate,
    TaskResponse
)
from app.services.backlog_generator import BacklogGeneratorService
from app.services.job_manager import JobManager
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


# PROMPT #108 - Response model for background job
class BacklogJobResponse(BaseModel):
    """Response model for async backlog generation job."""
    job_id: str
    status: str
    message: str


@router.post("/interview/{interview_id}/generate-epic", response_model=BacklogJobResponse)
async def generate_epic_from_interview(
    interview_id: UUID,
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Generate Epic suggestion from Interview conversation using AI - ASYNC.

    PROMPT #108 - Moved to background queue

    POST /api/v1/backlog/interview/{interview_id}/generate-epic?project_id={project_id}

    This endpoint now runs asynchronously in the background.
    Poll GET /api/v1/jobs/{job_id} for progress and result.

    Returns immediately:
    {
        "job_id": "uuid",
        "status": "pending",
        "message": "Epic generation started. Poll GET /api/v1/jobs/{job_id} for progress."
    }

    Poll /api/v1/jobs/{job_id} to get:
    - status: "completed" with result (BacklogGenerationResponse format)
    - status: "failed" with error message
    """
    # Create job
    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.BACKLOG_GENERATION,
        input_data={
            "operation": "generate_epic",
            "interview_id": str(interview_id),
            "project_id": str(project_id)
        },
        project_id=project_id,
        interview_id=interview_id
    )

    logger.info(f"Created backlog job {job.id} for Epic generation from interview {interview_id}")

    # Execute in background
    import asyncio
    asyncio.create_task(
        _generate_epic_async(
            job_id=job.id,
            interview_id=interview_id,
            project_id=project_id
        )
    )

    # Return job_id immediately
    return BacklogJobResponse(
        job_id=str(job.id),
        status="pending",
        message=f"Epic generation started. Poll GET /api/v1/jobs/{job.id} for progress."
    )


@router.post("/epic/{epic_id}/generate-stories", response_model=BacklogJobResponse)
async def generate_stories_from_epic(
    epic_id: UUID,
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Decompose Epic into Story suggestions using AI - ASYNC.

    PROMPT #108 - Moved to background queue

    POST /api/v1/backlog/epic/{epic_id}/generate-stories?project_id={project_id}

    This endpoint now runs asynchronously in the background.
    Poll GET /api/v1/jobs/{job_id} for progress and result.

    Returns immediately:
    {
        "job_id": "uuid",
        "status": "pending",
        "message": "Story generation started. Poll GET /api/v1/jobs/{job_id} for progress."
    }
    """
    # Verify epic exists
    epic = db.query(Task).filter(Task.id == epic_id).first()
    if not epic:
        raise HTTPException(status_code=404, detail=f"Epic {epic_id} not found")

    # Create job
    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.BACKLOG_GENERATION,
        input_data={
            "operation": "generate_stories",
            "epic_id": str(epic_id),
            "project_id": str(project_id)
        },
        project_id=project_id
    )

    logger.info(f"Created backlog job {job.id} for Story generation from Epic {epic_id}")

    # Execute in background
    import asyncio
    asyncio.create_task(
        _generate_stories_async(
            job_id=job.id,
            epic_id=epic_id,
            project_id=project_id
        )
    )

    # Return job_id immediately
    return BacklogJobResponse(
        job_id=str(job.id),
        status="pending",
        message=f"Story generation started. Poll GET /api/v1/jobs/{job.id} for progress."
    )


@router.post("/story/{story_id}/generate-tasks", response_model=BacklogJobResponse)
async def generate_tasks_from_story(
    story_id: UUID,
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Decompose Story into Task suggestions using AI with Spec context - ASYNC.

    PROMPT #108 - Moved to background queue

    POST /api/v1/backlog/story/{story_id}/generate-tasks?project_id={project_id}

    This endpoint now runs asynchronously in the background.
    Poll GET /api/v1/jobs/{job_id} for progress and result.

    Returns immediately:
    {
        "job_id": "uuid",
        "status": "pending",
        "message": "Task generation started. Poll GET /api/v1/jobs/{job_id} for progress."
    }
    """
    # Verify story exists
    story = db.query(Task).filter(Task.id == story_id).first()
    if not story:
        raise HTTPException(status_code=404, detail=f"Story {story_id} not found")

    # Create job
    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.BACKLOG_GENERATION,
        input_data={
            "operation": "generate_tasks",
            "story_id": str(story_id),
            "project_id": str(project_id)
        },
        project_id=project_id
    )

    logger.info(f"Created backlog job {job.id} for Task generation from Story {story_id}")

    # Execute in background
    import asyncio
    asyncio.create_task(
        _generate_tasks_async(
            job_id=job.id,
            story_id=story_id,
            project_id=project_id
        )
    )

    # Return job_id immediately
    return BacklogJobResponse(
        job_id=str(job.id),
        status="pending",
        message=f"Task generation started. Poll GET /api/v1/jobs/{job.id} for progress."
    )


@router.post("/approve-epic", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def approve_and_create_epic(
    suggestion: Dict[str, Any],
    project_id: UUID,
    interview_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Approve Epic suggestion and create it in database.

    POST /api/v1/backlog/approve-epic?project_id={project_id}&interview_id={interview_id}
    Body: {Epic suggestion JSON from generate-epic endpoint}

    User can edit the suggestion before approving.
    Creates Epic with all interview insights and traceability.
    """
    try:
        # Create Epic from approved suggestion
        # PROMPT #85 - Include generated_prompt (semantic output prompt)
        epic = Task(
            id=uuid4(),
            project_id=project_id,
            title=suggestion["title"],
            description=suggestion["description"],
            item_type=ItemType.EPIC,
            priority=PriorityLevel[suggestion["priority"].upper()],
            story_points=suggestion.get("story_points"),
            acceptance_criteria=suggestion.get("acceptance_criteria", []),
            interview_insights=suggestion.get("interview_insights", {}),
            interview_question_ids=suggestion.get("interview_question_ids", []),
            generation_context=suggestion.get("_metadata", {}),
            generated_prompt=suggestion.get("generated_prompt"),  # PROMPT #85
            reporter="system",
            workflow_state="backlog",
            order=0,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )

        db.add(epic)
        db.commit()
        db.refresh(epic)

        logger.info(f"✅ Created Epic {epic.id}: {epic.title}")

        return epic

    except Exception as e:
        logger.error(f"Failed to create Epic: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create Epic: {str(e)}"
        )


@router.post("/approve-stories", response_model=List[TaskResponse], status_code=status.HTTP_201_CREATED)
async def approve_and_create_stories(
    suggestions: List[Dict[str, Any]],
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Approve Story suggestions and create them in database.

    POST /api/v1/backlog/approve-stories?project_id={project_id}
    Body: [Story suggestion JSONs from generate-stories endpoint]

    User can edit suggestions before approving.
    Creates all Stories linked to parent Epic.
    """
    try:
        created_stories = []

        for i, suggestion in enumerate(suggestions):
            # PROMPT #85 - Include generated_prompt (semantic output prompt)
            story = Task(
                id=uuid4(),
                project_id=project_id,
                parent_id=UUID(suggestion["parent_id"]) if suggestion.get("parent_id") else None,
                title=suggestion["title"],
                description=suggestion["description"],
                item_type=ItemType.STORY,
                priority=PriorityLevel[suggestion["priority"].upper()],
                story_points=suggestion.get("story_points"),
                acceptance_criteria=suggestion.get("acceptance_criteria", []),
                interview_insights=suggestion.get("interview_insights", {}),
                generation_context=suggestion.get("_metadata", {}),
                generated_prompt=suggestion.get("generated_prompt"),  # PROMPT #85
                reporter="system",
                workflow_state="backlog",
                order=i,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )

            db.add(story)
            created_stories.append(story)

        db.commit()

        for story in created_stories:
            db.refresh(story)

        logger.info(f"✅ Created {len(created_stories)} Stories")

        return created_stories

    except Exception as e:
        db.rollback()
        logger.error(f"Failed to create Stories: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create Stories: {str(e)}"
        )


@router.post("/approve-tasks", response_model=List[TaskResponse], status_code=status.HTTP_201_CREATED)
async def approve_and_create_tasks(
    suggestions: List[Dict[str, Any]],
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Approve Task suggestions and create them in database.

    POST /api/v1/backlog/approve-tasks?project_id={project_id}
    Body: [Task suggestion JSONs from generate-tasks endpoint]

    User can edit suggestions before approving.
    Creates all Tasks linked to parent Story.
    """
    try:
        # PROMPT #94 FASE 4 - Get existing tasks for similarity detection
        from app.services.similarity_detector import detect_modification_attempt
        from app.services.modification_manager import block_task

        existing_tasks = db.query(Task).filter(
            Task.project_id == project_id,
            Task.status != TaskStatus.DONE  # Don't compare with archived tasks
        ).all()

        created_tasks = []
        blocked_tasks_count = 0

        for i, suggestion in enumerate(suggestions):
            # PROMPT #94 FASE 4 - Check for modification attempts
            is_modification, similar_task, similarity_score = detect_modification_attempt(
                new_task_title=suggestion["title"],
                new_task_description=suggestion["description"],
                existing_tasks=existing_tasks,
                threshold=0.90
            )

            if is_modification:
                # Block existing task instead of creating new one
                logger.warning(
                    f"🚨 MODIFICATION DETECTED (similarity: {similarity_score:.2%})\n"
                    f"   Blocking existing task: {similar_task.title}\n"
                    f"   Proposed modification: {suggestion['title']}"
                )

                blocked_task = block_task(
                    task=similar_task,
                    proposed_modification={
                        "title": suggestion["title"],
                        "description": suggestion["description"],
                        "story_points": suggestion.get("story_points"),
                        "priority": suggestion.get("priority", "medium"),
                        "acceptance_criteria": suggestion.get("acceptance_criteria", []),
                        "similarity_score": similarity_score
                    },
                    db=db,
                    reason=f"AI suggested modification detected (similarity: {similarity_score:.2%})"
                )

                created_tasks.append(blocked_task)  # Add blocked task to result
                blocked_tasks_count += 1
                continue

            # No modification detected - create new task normally
            # PROMPT #85 - Include generated_prompt (semantic output prompt)
            task = Task(
                id=uuid4(),
                project_id=project_id,
                parent_id=UUID(suggestion["parent_id"]) if suggestion.get("parent_id") else None,
                title=suggestion["title"],
                description=suggestion["description"],
                item_type=ItemType.TASK,
                priority=PriorityLevel[suggestion["priority"].upper()],
                story_points=suggestion.get("story_points"),
                acceptance_criteria=suggestion.get("acceptance_criteria", []),
                generation_context=suggestion.get("_metadata", {}),
                generated_prompt=suggestion.get("generated_prompt"),  # PROMPT #85
                reporter="system",
                workflow_state="backlog",
                order=i,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )

            db.add(task)
            created_tasks.append(task)

        db.commit()

        for task in created_tasks:
            db.refresh(task)

        # PROMPT #94 FASE 4 - Log blocked tasks
        new_tasks_count = len(created_tasks) - blocked_tasks_count
        if blocked_tasks_count > 0:
            logger.info(
                f"✅ Processed {len(created_tasks)} Tasks: "
                f"{new_tasks_count} created, {blocked_tasks_count} blocked for approval"
            )
        else:
            logger.info(f"✅ Created {len(created_tasks)} Tasks")

        return created_tasks

    except Exception as e:
        db.rollback()
        logger.error(f"Failed to create Tasks: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create Tasks: {str(e)}"
        )


@router.post("/migrate-descriptions", status_code=status.HTTP_200_OK)
async def migrate_semantic_to_human_descriptions(
    project_id: UUID = None,
    db: Session = Depends(get_db)
):
    """
    PROMPT #86 - Migrate existing cards to use proper human-readable descriptions.

    POST /api/v1/backlog/migrate-descriptions?project_id={project_id}

    This endpoint re-processes the description field for all cards that have:
    - generated_prompt (semantic markdown)
    - interview_insights.semantic_map

    It applies the improved _convert_semantic_to_human function to create
    clean, human-readable descriptions.

    Parameters:
    - project_id: Optional. If provided, only migrates cards from this project.

    Returns:
    - total_processed: Number of cards processed
    - updated: Number of cards updated
    - skipped: Number of cards skipped (no semantic_map)
    """
    from app.services.backlog_generator import _convert_semantic_to_human

    try:
        # Query cards with generated_prompt
        query = db.query(Task).filter(Task.generated_prompt.isnot(None))

        if project_id:
            query = query.filter(Task.project_id == project_id)

        cards = query.all()

        total_processed = 0
        updated = 0
        skipped = 0

        for card in cards:
            total_processed += 1

            # Get semantic_map from interview_insights
            semantic_map = None
            if card.interview_insights and isinstance(card.interview_insights, dict):
                semantic_map = card.interview_insights.get("semantic_map")

            if not semantic_map:
                skipped += 1
                continue

            # Re-apply conversion with improved function
            new_description = _convert_semantic_to_human(
                card.generated_prompt,
                semantic_map
            )

            # Update only if description changed
            if new_description != card.description:
                card.description = new_description
                card.updated_at = datetime.utcnow()
                updated += 1
                logger.info(f"✅ Updated description for {card.item_type} '{card.title}' (ID: {card.id})")

        db.commit()

        logger.info(
            f"📋 Migration complete: {total_processed} processed, "
            f"{updated} updated, {skipped} skipped"
        )

        return {
            "total_processed": total_processed,
            "updated": updated,
            "skipped": skipped,
            "message": f"Successfully migrated {updated} cards to human-readable descriptions"
        }

    except Exception as e:
        db.rollback()
        logger.error(f"Migration failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Migration failed: {str(e)}"
        )


# ============================================================================
# PROMPT #108 - BACKGROUND TASK FUNCTIONS
# ============================================================================

async def _generate_epic_async(
    job_id: UUID,
    interview_id: UUID,
    project_id: UUID
):
    """
    Background task to generate Epic from interview.

    PROMPT #108 - Background queue for prompt executions
    """
    from app.database import SessionLocal

    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        logger.info(f"🚀 Starting Epic generation job {job_id} from interview {interview_id}")

        job_manager.update_progress(job_id, 10.0, "Analyzing interview conversation...")

        generator = BacklogGeneratorService(db)
        epic_suggestion = await generator.generate_epic_from_interview(
            interview_id=interview_id,
            project_id=project_id
        )

        job_manager.update_progress(job_id, 90.0, "Epic generation complete!")

        logger.info(f"✅ Epic generation job {job_id} completed")

        # Complete job with result (BacklogGenerationResponse format)
        job_manager.complete_job(job_id, {
            "suggestions": [epic_suggestion],
            "metadata": epic_suggestion.get("_metadata", {})
        })

    except Exception as e:
        logger.error(f"❌ Epic generation job {job_id} failed: {e}")
        job_manager = JobManager(db)
        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()


async def _generate_stories_async(
    job_id: UUID,
    epic_id: UUID,
    project_id: UUID
):
    """
    Background task to generate Stories from Epic.

    PROMPT #108 - Background queue for prompt executions
    """
    from app.database import SessionLocal

    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        logger.info(f"🚀 Starting Story generation job {job_id} from Epic {epic_id}")

        job_manager.update_progress(job_id, 10.0, "Decomposing Epic into Stories...")

        generator = BacklogGeneratorService(db)
        stories_suggestions = await generator.decompose_epic_to_stories(
            epic_id=epic_id,
            project_id=project_id
        )

        job_manager.update_progress(job_id, 90.0, f"Generated {len(stories_suggestions)} stories!")

        logger.info(f"✅ Story generation job {job_id} completed with {len(stories_suggestions)} stories")

        # Extract metadata from first story
        metadata = stories_suggestions[0].get("_metadata", {}) if stories_suggestions else {}

        # Complete job with result
        job_manager.complete_job(job_id, {
            "suggestions": stories_suggestions,
            "metadata": metadata
        })

    except Exception as e:
        logger.error(f"❌ Story generation job {job_id} failed: {e}")
        job_manager = JobManager(db)
        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()


async def _generate_tasks_async(
    job_id: UUID,
    story_id: UUID,
    project_id: UUID
):
    """
    Background task to generate Tasks from Story.

    PROMPT #108 - Background queue for prompt executions
    """
    from app.database import SessionLocal

    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        logger.info(f"🚀 Starting Task generation job {job_id} from Story {story_id}")

        job_manager.update_progress(job_id, 10.0, "Decomposing Story into Tasks...")

        generator = BacklogGeneratorService(db)
        tasks_suggestions = await generator.decompose_story_to_tasks(
            story_id=story_id,
            project_id=project_id
        )

        job_manager.update_progress(job_id, 90.0, f"Generated {len(tasks_suggestions)} tasks!")

        logger.info(f"✅ Task generation job {job_id} completed with {len(tasks_suggestions)} tasks")

        # Extract metadata from first task
        metadata = tasks_suggestions[0].get("_metadata", {}) if tasks_suggestions else {}

        # Complete job with result
        job_manager.complete_job(job_id, {
            "suggestions": tasks_suggestions,
            "metadata": metadata
        })

    except Exception as e:
        logger.error(f"❌ Task generation job {job_id} failed: {e}")
        job_manager = JobManager(db)
        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()
