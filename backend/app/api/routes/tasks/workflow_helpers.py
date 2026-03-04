"""
Async background task functions for workflow operations.

PROMPT #108 - Background queue for prompt executions.
PROMPT #211 - Cascade ancestor activation.
PROMPT #127 - On-demand children generation.
"""

from uuid import UUID
from app.models.task import ItemType

import logging

logger = logging.getLogger(__name__)


async def activate_item_async(
    job_id: UUID,
    task_id: UUID,
    item_type: ItemType
):
    """
    Background task to activate a suggested item (Epic, Story, Task).

    PROMPT #108 - Background queue for prompt executions
    PROMPT #211 - Cascade ancestor activation: when activating a child item,
                  all unactivated ancestors are activated first (root to child).
    """
    from app.database import SessionLocal
    from app.services.job_manager import JobManager
    from app.services.context_generator import ContextGeneratorService
    from app.services.task_hierarchy import TaskHierarchyService

    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)
        logger.info(f"🚀 Starting activation job {job_id} for {item_type.value} {task_id}")

        context_service = ContextGeneratorService(db)
        hierarchy_service = TaskHierarchyService(db)

        # PROMPT #211 - Cascade: activate unactivated ancestors first (root to child)
        ancestors = hierarchy_service.get_all_ancestors(task_id)
        unactivated_ancestors = [
            a for a in ancestors
            if (a.labels and "suggested" in a.labels) or a.workflow_state == "draft"
        ]
        unactivated_ancestors = list(reversed(unactivated_ancestors))

        total_steps = len(unactivated_ancestors) + 1
        progress_per_step = 80.0 / total_steps

        for i, ancestor in enumerate(unactivated_ancestors):
            ancestor_progress = 10.0 + (i * progress_per_step)
            job_manager.update_progress(
                job_id, ancestor_progress,
                f"Activating ancestor {ancestor.item_type.value}: {ancestor.title[:40]}..."
            )
            logger.info(f"   ↳ Cascade activating ancestor {ancestor.item_type.value}: {ancestor.title}")

            if ancestor.item_type == ItemType.EPIC:
                await context_service.activate_suggested_epic(epic_id=ancestor.id)
            elif ancestor.item_type == ItemType.STORY:
                await context_service.activate_suggested_story(story_id=ancestor.id)
            elif ancestor.item_type == ItemType.TASK:
                await context_service.activate_suggested_task(task_id=ancestor.id)

        # Now activate the target item
        target_progress = 10.0 + (len(unactivated_ancestors) * progress_per_step)
        item_type_messages = {
            ItemType.EPIC: "Gerando conteúdo do epic...",
            ItemType.STORY: "Gerando conteúdo da story...",
            ItemType.TASK: "Gerando conteúdo da tarefa...",
        }
        start_msg = item_type_messages.get(item_type, "Processando...")

        job_manager.update_progress(job_id, target_progress, start_msg)

        if item_type == ItemType.EPIC:
            result = await context_service.activate_suggested_epic(epic_id=task_id)
        elif item_type == ItemType.STORY:
            result = await context_service.activate_suggested_story(story_id=task_id)
        elif item_type == ItemType.TASK:
            result = await context_service.activate_suggested_task(task_id=task_id)
        else:
            result = await context_service.activate_suggested_epic(epic_id=task_id)

        job_manager.update_progress(job_id, 90.0, "Ativacao concluida!")

        children_count = result.get('children_generated', 0)
        ancestors_activated = len(unactivated_ancestors)

        if ancestors_activated > 0:
            result['ancestors_activated'] = ancestors_activated
            logger.info(
                f"✅ Activation job {job_id} completed for {item_type.value} {task_id}\n"
                f"   Title: {result['title']}\n"
                f"   Ancestors auto-activated: {ancestors_activated}\n"
                f"   Children Generated: {children_count}"
            )
        else:
            logger.info(
                f"✅ Activation job {job_id} completed for {item_type.value} {task_id}\n"
                f"   Title: {result['title']}\n"
                f"   Description: {len(result.get('description', ''))} chars\n"
                f"   Generated Prompt: {len(result.get('generated_prompt', ''))} chars\n"
                f"   Children Generated: {children_count}"
            )

        job_manager.complete_job(job_id, result)

    except Exception as e:
        logger.error(f"❌ Activation job {job_id} failed: {e}")
        job_manager = JobManager(db)
        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()


async def generate_children_async(
    job_id: UUID,
    parent_id: UUID,
    count: int
):
    """
    PROMPT #127 - Background task to generate draft children for a parent item.
    """
    from app.database import SessionLocal
    from app.services.job_manager import JobManager
    from app.services.context_generator import ContextGeneratorService

    db = SessionLocal()

    try:
        job_manager = JobManager(db)
        job_manager.start_job(job_id)

        from app.models.async_job import AsyncJob
        job_obj = db.query(AsyncJob).filter(AsyncJob.id == job_id).first()
        child_type = "items"
        if job_obj and job_obj.input_data:
            child_type = job_obj.input_data.get("child_type", "items")

        job_manager.update_progress(job_id, 10.0, f"Gerando {count} {child_type}...")

        context_service = ContextGeneratorService(db)
        result = await context_service.generate_children(parent_id=parent_id, count=count)

        job_manager.update_progress(job_id, 90.0, "Geração concluida!")

        children_count = result.get("children_generated", 0)
        logger.info(f"✅ Children generation job {job_id} completed: {children_count} {child_type}")

        job_manager.complete_job(job_id, result)

    except Exception as e:
        logger.error(f"❌ Children generation job {job_id} failed: {e}")
        job_manager = JobManager(db)
        job_manager.fail_job(job_id, str(e))

    finally:
        db.close()
