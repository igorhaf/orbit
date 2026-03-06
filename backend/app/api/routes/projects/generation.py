"""
Projects API - Generation endpoints.
Wiki enrichment, card generation, hierarchy generation.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from uuid import UUID
import logging

from app.database import get_db
from app.models.project import Project
from app.models.async_job import AsyncJob, JobType, JobStatus
from app.services.job_manager import JobManager
from app.services.project_service import (
    _enrich_context_from_rag,
    _process_cards_from_memory_async,
    _process_full_hierarchy_async,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/{project_id}/enrich-wiki")
async def enrich_wiki(
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    PROMPT #284 - Re-run wiki enrichment from RAG data.

    Re-generates all wiki pages from current RAG data (business rules,
    interview answers, scan summary, features). Useful after a re-scan
    when RAG has new data that should be reflected in the wiki.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto nao encontrado")

    try:
        result = await _enrich_context_from_rag(db, project_id)
        if result:
            return {"status": "enriched", "message": "Paginas wiki regeneradas a partir dos dados RAG"}
        else:
            return {"status": "skipped", "message": "Nenhum dado RAG disponivel para expansao"}
    except Exception as e:
        logger.error(f"Wiki enrichment failed for {project_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Expansao wiki falhou: {str(e)[:200]}")

@router.post("/{project_id}/generate-cards")
async def generate_cards_from_memory(
    project_id: UUID,
    body: Optional[dict] = None,
    db: Session = Depends(get_db)
):
    """
    Generate cards (epics and business rules) from memory scan.

    PROMPT #153 - Manual trigger for card generation

    This endpoint manually triggers the generation of:
    1. Business rule cards (closed) - rules verified in existing code
    2. Suggested epics (drafts) - new functionality to develop

    This is useful when:
    - User abandoned the wizard before cards were generated
    - Cards need to be regenerated after a new memory scan
    - Testing/debugging card generation

    **POST** `/api/v1/projects/{project_id}/generate-cards`

    **Response:**
    ```json
    {
        "job_id": "uuid",
        "status": "pending",
        "message": "Geracao de cards iniciada em segundo plano"
    }
    ```

    **After completion, job result contains:**
    ```json
    {
        "success": true,
        "business_rule_cards": [...],
        "suggested_epics": [...]
    }
    ```

    **Errors:**
    - 400: If project has no memory context
    - 404: If project not found
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto nao encontrado")

    # PROMPT #242 - Check if RAG indexing is complete (not just memory context)
    if not project.initial_scan_complete:
        raise HTTPException(
            status_code=400,
            detail="A indexacao RAG ainda nao foi concluida. Aguarde o scan completar."
        )

    # PROMPT #242 - Block if RAG re-indexing is in progress
    active_rag = db.query(AsyncJob).filter(
        AsyncJob.project_id == project_id,
        AsyncJob.job_type == JobType.RAG_CONTINUOUS_SCAN,
        AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
    ).first()
    if active_rag:
        raise HTTPException(
            status_code=400,
            detail="Indexacao RAG em andamento. Aguarde a conclusao antes de gerar cards."
        )

    # Extract epic_count from request body (default: 10)
    epic_count = 10
    if body and isinstance(body, dict) and "epic_count" in body:
        epic_count = max(1, min(30, int(body["epic_count"])))

    # Create background job
    job_manager = JobManager(db)

    job = job_manager.create_job(
        job_type=JobType.CARDS_FROM_MEMORY,
        input_data={
            "project_id": str(project_id),
            "manual_trigger": True,
            "epic_count": epic_count
        },
        project_id=project_id,
        deep_link=f"/projects/{project_id}/backlog",
        notification_title=f"Gerando {epic_count} epicos para '{project.name}'..."
    )

    # Launch card generation in background via priority queue
    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(job.priority, _process_cards_from_memory_async, job.id, project_id)

    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": "Geracao de cards iniciada em segundo plano. Uma notificacao aparecera quando concluir.",
        "deep_link": f"/projects/{project_id}/backlog"
    }

@router.post("/{project_id}/generate-hierarchy")
async def generate_full_hierarchy(
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    PROMPT #237 - Generate full card hierarchy from project knowledge.

    One-click generation of the complete project backlog:
    Epics -> Stories -> Tasks -> Subtasks

    Each level is processed sequentially, with individual items
    activated via the existing context_generator functions.

    No parameters needed -- uses all project knowledge (memory context,
    RAG-extracted business rules, detected stack) to generate the hierarchy.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto nao encontrado")

    # PROMPT #242 - Check if RAG indexing is complete
    if not project.initial_scan_complete:
        raise HTTPException(
            status_code=400,
            detail="A indexacao RAG ainda nao foi concluida. Aguarde o scan completar."
        )

    # PROMPT #242 - Block if RAG re-indexing is in progress
    active_rag = db.query(AsyncJob).filter(
        AsyncJob.project_id == project_id,
        AsyncJob.job_type == JobType.RAG_CONTINUOUS_SCAN,
        AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
    ).first()
    if active_rag:
        raise HTTPException(
            status_code=400,
            detail="Indexacao RAG em andamento. Aguarde a conclusao antes de gerar cards."
        )

    # Check for existing epics (exclude business_rule epics from system)
    from app.models.task import Task, ItemType
    existing_epics = db.query(Task).filter(
        Task.project_id == project_id,
        Task.item_type == ItemType.EPIC,
        ~Task.labels.contains(["business_rule"]),
    ).count()
    if existing_epics > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Projeto ja possui {existing_epics} epics. Delete-os antes de gerar novamente."
        )

    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.CARDS_FROM_MEMORY,
        input_data={
            "project_id": str(project_id),
            "full_hierarchy": True,
        },
        project_id=project_id,
        deep_link=f"/projects/{project_id}",
        notification_title=f"Gerando hierarquia - '{project.name}'"
    )

    from app.services.job_executor import PriorityJobExecutor
    executor = PriorityJobExecutor.get_instance()
    await executor.submit(job.priority, _process_full_hierarchy_async, job.id, project_id)

    return {
        "job_id": str(job.id),
        "status": "pending",
        "message": "Geracao de hierarquia iniciada. Acompanhe pelo sininho de notificacoes.",
    }
