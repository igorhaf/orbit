"""
Projects API - Description endpoints.
AI-powered title and description generation, expansion, summarization, rephrasing.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from uuid import UUID
import logging

from app.database import get_db
from app.models.async_job import JobType
from app.services.job_manager import JobManager
from app.services.project_service import _process_description_async

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/generate-title")
async def generate_project_title(
    body: dict,
    db: Session = Depends(get_db),
):
    """
    PROMPT #239 -- Generate/reformulate a project title from the description using AI.

    **POST** `/api/v1/projects/generate-title`
    Body: `{"description": "...", "current_title": "..." (optional)}`
    Response: `{"title": "Generated title..."}`
    """
    desc = (body.get("description") or "").strip()
    if not desc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Campo 'description' e obrigatorio",
        )

    try:
        from app.prompts.loader import PromptLoader
        from app.services.ai_orchestrator import AIOrchestrator

        loader = PromptLoader()
        variables = {"description": desc}
        current_title = (body.get("current_title") or "").strip()
        if current_title:
            variables["current_title"] = current_title

        system_prompt, user_prompt = loader.render(
            "projects/generate_title", variables
        )

        orchestrator = AIOrchestrator(db)
        response = await orchestrator.execute(
            usage_type="general",
            messages=[{"role": "user", "content": user_prompt}],
            system_prompt=system_prompt,
            max_tokens=500,
            metadata={"skip_context_build": True},
            disable_tools=True,
        )

        title = (response.get("content") or "").strip().strip('"').strip("'")
        return {"title": title}

    except Exception as e:
        logger.error(f"Failed to generate title: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Falha ao gerar titulo: {str(e)}",
        )


@router.post("/generate-description")
async def generate_project_description(
    body: dict,
    db: Session = Depends(get_db),
):
    """
    PROMPT #239 / #241 -- Generate a short project description from the title using AI.
    Now uses PriorityJobExecutor (async job queue) with NORMAL priority.

    **POST** `/api/v1/projects/generate-description`
    Body: `{"title": "My Project", "project_id": "optional-uuid"}`
    Response: `{"job_id": "...", "status": "pending", ...}`
    """
    title = (body.get("title") or "").strip()
    project_id = body.get("project_id")
    if not title:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Campo 'title' e obrigatorio",
        )

    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.DESCRIPTION_GENERATION,
        input_data={
            "action": "generate",
            "title": title,
            "project_id": project_id,
        },
        project_id=UUID(project_id) if project_id else None,
        notification_title=f"Gerando descricao -- '{title[:40]}'"
    )

    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(
        job.priority,
        _process_description_async,
        job.id, "generate", title, None, project_id, 2000,
    )

    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": "Geracao de descricao enfileirada.",
    }


@router.post("/expand-description")
async def expand_project_description(
    body: dict,
    db: Session = Depends(get_db),
):
    """
    PROMPT #241 -- Expand/detail an existing project description using AI.
    Now uses PriorityJobExecutor (async job queue) with NORMAL priority.

    **POST** `/api/v1/projects/expand-description`
    Body: `{"title": "...", "current_description": "...", "project_id": "optional-uuid"}`
    Response: `{"job_id": "...", "status": "pending", ...}`
    """
    title = (body.get("title") or "").strip()
    current_description = (body.get("current_description") or "").strip()
    project_id = body.get("project_id")
    pinned_fragments = body.get("pinned_fragments") or []
    if not current_description:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Campo 'current_description' e obrigatorio",
        )

    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.DESCRIPTION_GENERATION,
        input_data={
            "action": "expand",
            "title": title,
            "current_description": current_description,
            "project_id": project_id,
            "pinned_fragments": pinned_fragments,
        },
        project_id=UUID(project_id) if project_id else None,
        notification_title=f"Detalhando descricao -- '{title[:40]}'"
    )

    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(
        job.priority,
        _process_description_async,
        job.id, "expand", title, current_description, project_id, 3000,
        pinned_fragments,
    )

    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": "Expansao de descricao enfileirada.",
    }


@router.post("/summarize-description")
async def summarize_project_description(
    body: dict,
    db: Session = Depends(get_db),
):
    """
    PROMPT #241 -- Summarize/condense an existing project description using AI.
    Now uses PriorityJobExecutor (async job queue) with NORMAL priority.

    **POST** `/api/v1/projects/summarize-description`
    Body: `{"title": "...", "current_description": "...", "project_id": "optional-uuid"}`
    Response: `{"job_id": "...", "status": "pending", ...}`
    """
    title = (body.get("title") or "").strip()
    current_description = (body.get("current_description") or "").strip()
    project_id = body.get("project_id")
    pinned_fragments = body.get("pinned_fragments") or []
    if not current_description:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Campo 'current_description' e obrigatorio",
        )

    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.DESCRIPTION_GENERATION,
        input_data={
            "action": "summarize",
            "title": title,
            "current_description": current_description,
            "project_id": project_id,
            "pinned_fragments": pinned_fragments,
        },
        project_id=UUID(project_id) if project_id else None,
        notification_title=f"Resumindo descricao -- '{title[:40]}'"
    )

    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(
        job.priority,
        _process_description_async,
        job.id, "summarize", title, current_description, project_id, 1000,
        pinned_fragments,
    )

    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": "Resumo de descricao enfileirado.",
    }


@router.post("/rephrase-description")
async def rephrase_project_description(
    body: dict,
    db: Session = Depends(get_db),
):
    """
    PROMPT #244 -- Rephrase/reformulate an existing project description using AI.
    Keeps the same length and meaning but uses different wording.

    **POST** `/api/v1/projects/rephrase-description`
    Body: `{"title": "...", "current_description": "...", "project_id": "optional-uuid"}`
    Response: `{"job_id": "...", "status": "pending", ...}`
    """
    title = (body.get("title") or "").strip()
    current_description = (body.get("current_description") or "").strip()
    project_id = body.get("project_id")
    pinned_fragments = body.get("pinned_fragments") or []
    if not current_description:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Campo 'current_description' e obrigatorio",
        )

    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.DESCRIPTION_GENERATION,
        input_data={
            "action": "rephrase",
            "title": title,
            "current_description": current_description,
            "project_id": project_id,
            "pinned_fragments": pinned_fragments,
        },
        project_id=UUID(project_id) if project_id else None,
        notification_title=f"Reformulando descricao -- '{title[:40]}'"
    )

    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(
        job.priority,
        _process_description_async,
        job.id, "rephrase", title, current_description, project_id, 2000,
        pinned_fragments,
    )

    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": "Reformulacao de descricao enfileirada.",
    }
