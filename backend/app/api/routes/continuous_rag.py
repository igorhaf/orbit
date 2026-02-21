"""
Continuous RAG Evolution API Routes

PROMPT #218 - Endpoints for managing continuous RAG processing per project.
PROMPT #252 - 4-phase pipeline with progressive button unlocking.

Provides manual scan triggers, status monitoring, file listing, and reset.
Phase endpoints: scan, extract-rules, generate-cards, generate-wiki.
"""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.async_job import AsyncJob, JobStatus, JobType
from app.models.project import Project
from app.models.rag_file_state import FileProcessingStatus, RAGFileState
from app.services.continuous_rag_service import ContinuousRAGService
from app.services.job_manager import JobManager

router = APIRouter()


@router.post("/{project_id}/rag/scan")
async def trigger_rag_scan(
    project_id: UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    PROMPT #252 - Phase 1: Index files in RAG (embedding only, no AI).
    Scans filesystem and embeds all files via Nomic. Files go PENDING → INDEXED.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    if not project.code_path:
        raise HTTPException(status_code=400, detail="Projeto não tem code_path configurado")

    # Check for existing pending/running scan
    existing = db.query(AsyncJob).filter(
        AsyncJob.job_type == JobType.RAG_CONTINUOUS_SCAN,
        AsyncJob.project_id == project_id,
        AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
        AsyncJob.parent_job_id.is_(None),
    ).first()

    if existing:
        return {
            "message": "Uma operação RAG já está em andamento",
            "job_id": str(existing.id),
            "status": existing.status.value,
        }

    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.RAG_CONTINUOUS_SCAN,
        input_data={"project_id": str(project_id), "phase": "index_files"},
        project_id=project_id,
        notification_title=f"Fase 1: Indexando arquivos — {project.name or 'Projeto'}",
        deep_link=f"/projects/{project_id}",
    )

    async def _run_phase_1(job_id, proj_id):
        from app.database import get_db as get_db_gen
        db_session = next(get_db_gen())
        try:
            from app.services.rag_pipeline import RagPipelineService
            jm = JobManager(db_session)
            jm.start_job(job_id)
            pipeline = RagPipelineService(db_session)
            result = await pipeline.phase_1_index_files(proj_id, job_id)
            jm.complete_job(job_id, result)
        except Exception as e:
            try:
                jm.fail_job(job_id, str(e))
                from app.services.rag_pipeline import _get_redis
                rc = _get_redis()
                if rc:
                    rc.hset(f"rag:pipeline:{proj_id}", "phase_1_status", "failed")
            except Exception:
                pass
        finally:
            db_session.close()

    background_tasks.add_task(_run_phase_1, job.id, project_id)

    return {
        "message": "Fase 1: Indexação de arquivos iniciada",
        "job_id": str(job.id),
        "status": "pending",
    }


@router.post("/{project_id}/rag/extract-rules")
async def trigger_extract_rules(
    project_id: UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    PROMPT #252 - Phase 2: Extract business rules via AI (usage_type=task_execution).
    Requires Phase 1 (index) to be completed first.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    # Verify Phase 1 is complete (has indexed files)
    indexed_count = db.query(RAGFileState).filter(
        RAGFileState.project_id == project_id,
        RAGFileState.status == FileProcessingStatus.INDEXED,
    ).count()
    if indexed_count == 0:
        from sqlalchemy import text as sql_text
        code_files = db.execute(sql_text(
            "SELECT COUNT(*) FROM rag_documents WHERE project_id = :pid "
            "AND (metadata->>'type' = 'code_file')"
        ), {"pid": str(project_id)}).scalar() or 0
        if code_files == 0:
            raise HTTPException(status_code=400, detail="Fase 1 (Scan) precisa ser executada primeiro")

    # Check for existing running RAG pipeline job
    existing = db.query(AsyncJob).filter(
        AsyncJob.job_type == JobType.RAG_CONTINUOUS_SCAN,
        AsyncJob.project_id == project_id,
        AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
        AsyncJob.parent_job_id.is_(None),
    ).first()
    if existing:
        return {"message": "Uma operação já está em andamento", "job_id": str(existing.id), "status": existing.status.value}

    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.RAG_CONTINUOUS_SCAN,
        input_data={"project_id": str(project_id), "phase": "extract_rules"},
        project_id=project_id,
        notification_title=f"Fase 2: Extraindo regras — {project.name or 'Projeto'}",
        deep_link=f"/projects/{project_id}",
    )

    async def _run_phase_2(job_id, proj_id):
        from app.database import get_db as get_db_gen
        db_session = next(get_db_gen())
        try:
            from app.services.rag_pipeline import RagPipelineService
            jm = JobManager(db_session)
            jm.start_job(job_id)
            pipeline = RagPipelineService(db_session)
            result = await pipeline.phase_2_extract_rules(proj_id, job_id)
            jm.complete_job(job_id, result)
        except Exception as e:
            try:
                jm.fail_job(job_id, str(e))
                # Clean Redis state on failure
                from app.services.rag_pipeline import _get_redis
                rc = _get_redis()
                if rc:
                    rc.hset(f"rag:pipeline:{proj_id}", "phase_2_status", "failed")
            except Exception:
                pass
        finally:
            db_session.close()

    background_tasks.add_task(_run_phase_2, job.id, project_id)

    return {"message": "Fase 2: Extração de regras iniciada", "job_id": str(job.id), "status": "pending"}


@router.post("/{project_id}/rag/generate-cards")
async def trigger_generate_cards(
    project_id: UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    PROMPT #252 - Phase 3: Generate cards from business rules (closed status).
    Requires Phase 2 (rules) to be completed first.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    # Verify Phase 2 is complete (has business rules)
    from sqlalchemy import text as sql_text
    rule_count = db.execute(sql_text(
        "SELECT COUNT(*) FROM rag_documents WHERE project_id = :pid "
        "AND (metadata->>'type' = 'business_rule' OR metadata->>'content_type' = 'business_rule')"
    ), {"pid": str(project_id)}).scalar() or 0
    if rule_count == 0:
        raise HTTPException(status_code=400, detail="Fase 2 (Extração de Regras) precisa ser executada primeiro")

    # Check for existing running cards generation job
    existing = db.query(AsyncJob).filter(
        AsyncJob.job_type == JobType.CARDS_FROM_MEMORY,
        AsyncJob.project_id == project_id,
        AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
        AsyncJob.parent_job_id.is_(None),
    ).first()
    if existing:
        return {"message": "Uma operação já está em andamento", "job_id": str(existing.id), "status": existing.status.value}

    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.CARDS_FROM_MEMORY,
        input_data={"project_id": str(project_id), "phase": "generate_cards"},
        project_id=project_id,
        notification_title=f"Fase 3: Gerando cards — {project.name or 'Projeto'}",
        deep_link=f"/projects/{project_id}",
    )

    async def _run_phase_3(job_id, proj_id):
        from app.database import get_db as get_db_gen
        db_session = next(get_db_gen())
        try:
            from app.services.rag_pipeline import RagPipelineService
            jm = JobManager(db_session)
            jm.start_job(job_id)
            pipeline = RagPipelineService(db_session)
            result = await pipeline.phase_3_generate_cards(proj_id, job_id)
            jm.complete_job(job_id, result)
        except Exception as e:
            try:
                jm.fail_job(job_id, str(e))
                from app.services.rag_pipeline import _get_redis
                rc = _get_redis()
                if rc:
                    rc.hset(f"rag:pipeline:{proj_id}", "phase_3_status", "failed")
            except Exception:
                pass
        finally:
            db_session.close()

    background_tasks.add_task(_run_phase_3, job.id, project_id)

    return {"message": "Fase 3: Geração de cards iniciada", "job_id": str(job.id), "status": "pending"}


@router.post("/{project_id}/rag/generate-wiki")
async def trigger_generate_wiki(
    project_id: UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    PROMPT #252 - Phase 4: Generate wiki + title + description (1 AI call).
    Requires Phase 3 (cards) to be completed first.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    # Verify Phase 3 is complete (has cards)
    from app.models.task import Task
    card_count = db.query(Task).filter(Task.project_id == project_id).count()
    if card_count == 0:
        raise HTTPException(status_code=400, detail="Fase 3 (Geração de Cards) precisa ser executada primeiro")

    # Check for existing running wiki generation job
    existing = db.query(AsyncJob).filter(
        AsyncJob.job_type == JobType.WIKI_GENERATION,
        AsyncJob.project_id == project_id,
        AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
        AsyncJob.parent_job_id.is_(None),
    ).first()
    if existing:
        return {"message": "Uma operação já está em andamento", "job_id": str(existing.id), "status": existing.status.value}

    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.WIKI_GENERATION,
        input_data={"project_id": str(project_id), "phase": "generate_wiki"},
        project_id=project_id,
        notification_title=f"Fase 4: Gerando wiki — {project.name or 'Projeto'}",
        deep_link=f"/projects/{project_id}",
    )

    async def _run_phase_4(job_id, proj_id):
        from app.database import get_db as get_db_gen
        db_session = next(get_db_gen())
        try:
            from app.services.rag_pipeline import RagPipelineService
            jm = JobManager(db_session)
            jm.start_job(job_id)
            pipeline = RagPipelineService(db_session)
            result = await pipeline.phase_4_generate_wiki(proj_id, job_id)
            jm.complete_job(job_id, result)
        except Exception as e:
            try:
                jm.fail_job(job_id, str(e))
                from app.services.rag_pipeline import _get_redis
                rc = _get_redis()
                if rc:
                    rc.hset(f"rag:pipeline:{proj_id}", "phase_4_status", "failed")
            except Exception:
                pass
        finally:
            db_session.close()

    background_tasks.add_task(_run_phase_4, job.id, project_id)

    return {"message": "Fase 4: Geração de wiki iniciada", "job_id": str(job.id), "status": "pending"}


@router.get("/{project_id}/rag/status")
async def get_rag_status(
    project_id: UUID,
    db: Session = Depends(get_db),
):
    """
    Get continuous RAG evolution status for a project.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    service = ContinuousRAGService(db)
    stats = await service.get_project_stats(project_id)

    # Check if a scan is currently running
    active_job = db.query(AsyncJob).filter(
        AsyncJob.job_type == JobType.RAG_CONTINUOUS_SCAN,
        AsyncJob.project_id == project_id,
        AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING])
    ).first()

    stats["is_scanning"] = active_job is not None
    if active_job:
        stats["active_job"] = {
            "id": str(active_job.id),
            "status": active_job.status.value,
            "progress_percent": active_job.progress_percent,
            "progress_message": active_job.progress_message,
        }

    return stats


@router.get("/{project_id}/rag/files")
async def list_rag_files(
    project_id: UUID,
    status: Optional[str] = Query(None, description="Filter by status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """
    List tracked files with their processing status (paginated).
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    query = db.query(RAGFileState).filter(RAGFileState.project_id == project_id)

    if status:
        try:
            status_enum = FileProcessingStatus(status)
            query = query.filter(RAGFileState.status == status_enum)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Status inválido: {status}")

    total = query.count()
    files = (
        query
        .order_by(RAGFileState.updated_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
        "files": [f.to_dict() for f in files],
    }


@router.delete("/{project_id}/rag/reset")
async def reset_rag_state(
    project_id: UUID,
    db: Session = Depends(get_db),
):
    """
    Clear all file tracking state and continuous scan RAG documents.
    Next scan will re-process all files from scratch.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    service = ContinuousRAGService(db)
    result = await service.reset_project(project_id)

    return {
        "message": "Estado do RAG continuo redefinido com sucesso",
        **result,
    }


@router.get("/{project_id}/rag/enrichment-status")
async def get_enrichment_status(
    project_id: UUID,
    db: Session = Depends(get_db),
):
    """
    PROMPT #239 - Get background enrichment status for a project.
    PROMPT #301 - Expanded to check ALL active job types (not just RAG_CONTINUOUS_SCAN).
    Used by the frontend to show enrichment progress indicator.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    # PROMPT #301 - Check ALL active jobs for this project (scan, wiki, cards, RAG, etc.)
    active_jobs = db.query(AsyncJob).filter(
        AsyncJob.project_id == project_id,
        AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
        AsyncJob.parent_job_id.is_(None),  # Only top-level jobs
    ).all()

    # PROMPT #241 - Count auto-discovered cards
    from app.models.task import Task, ItemType
    from sqlalchemy import func as sql_func, cast
    from sqlalchemy.dialects.postgresql import ARRAY
    auto_discovered_count = db.query(sql_func.count(Task.id)).filter(
        Task.project_id == project_id,
        Task.reporter == "watchdog",
    ).scalar() or 0

    # PROMPT #237 - RAG completion status + epic count for "Gerar Cards" button
    is_enriching = len(active_jobs) > 0
    pending_files = db.query(sql_func.count(RAGFileState.id)).filter(
        RAGFileState.project_id == project_id,
        RAGFileState.status == FileProcessingStatus.PENDING,
    ).scalar() or 0
    completed_files = db.query(sql_func.count(RAGFileState.id)).filter(
        RAGFileState.project_id == project_id,
        RAGFileState.status == FileProcessingStatus.COMPLETED,
    ).scalar() or 0
    # PROMPT #239 - Exclude business_rule epics (system-generated, not user hierarchy)
    epic_count = db.query(sql_func.count(Task.id)).filter(
        Task.project_id == project_id,
        Task.item_type == ItemType.EPIC,
        ~Task.labels.contains(["business_rule"]),
    ).scalar() or 0

    # PROMPT #251 - Check if project has RAG documents (scan was done)
    from sqlalchemy import text as sql_text
    rag_doc_count = db.execute(
        sql_text("SELECT COUNT(*) FROM rag_documents WHERE project_id = :pid"),
        {"pid": str(project_id)},
    ).scalar() or 0

    # PROMPT #252 - Pipeline state: derive from DB (Redis fallback)
    # Phase 1: has code_file docs in RAG
    code_file_count = db.execute(sql_text(
        "SELECT COUNT(*) FROM rag_documents WHERE project_id = :pid "
        "AND (metadata->>'type' = 'code_file')"
    ), {"pid": str(project_id)}).scalar() or 0
    has_indexed_files = code_file_count > 0

    # Phase 2: has business_rule docs in RAG
    rule_count = db.execute(sql_text(
        "SELECT COUNT(*) FROM rag_documents WHERE project_id = :pid "
        "AND (metadata->>'type' = 'business_rule' OR metadata->>'content_type' = 'business_rule')"
    ), {"pid": str(project_id)}).scalar() or 0
    has_business_rules = rule_count > 0

    # Phase 3: has cards
    has_cards = auto_discovered_count > 0 or epic_count > 0

    # Phase 4: has wiki pages
    has_wiki = False
    try:
        from app.services import wiki_fs
        if project.code_path:
            wiki_pages = wiki_fs.list_pages(project.code_path)
            has_wiki = bool(wiki_pages) and len(wiki_pages) > 0
    except Exception:
        pass

    # Determine pipeline phase statuses.
    # Phase completion is determined by COMPLETED pipeline jobs (not old data).
    # Phases 2-4: also accept DB evidence (rules/cards/wiki exist).
    # Phase 1: ONLY completed if a Phase 1 pipeline job finished OR Redis confirms.
    # This prevents Phase 2 from unlocking based on stale initial_scan_complete.

    # Check for completed pipeline jobs per phase
    def _phase_job_completed(phase_name: str) -> bool:
        return db.execute(sql_text(
            "SELECT 1 FROM async_jobs WHERE project_id = :pid "
            "AND status = 'completed' AND job_type = 'rag_continuous_scan' "
            "AND input_data->>'phase' = :phase LIMIT 1"
        ), {"pid": str(project_id), "phase": phase_name}).first() is not None

    # Phase 1: completed if pipeline job OR memory_scan indexed files
    phase_1_done = _phase_job_completed("index_files") or has_indexed_files

    pipeline_state = {
        "phase_1": "completed" if phase_1_done else "pending",
        "phase_2": "completed" if _phase_job_completed("extract_rules") else "pending",
        "phase_3": "completed" if _phase_job_completed("generate_cards") else "pending",
        "phase_4": "completed" if _phase_job_completed("generate_wiki") else "pending",
    }

    # Check for running phase jobs (PENDING or RUNNING override to "running")
    for j in active_jobs:
        # MEMORY_SCAN jobs are Phase 1 equivalent (no "phase" key in input_data)
        if j.job_type == JobType.MEMORY_SCAN:
            pipeline_state["phase_1"] = "running"
            continue
        if j.input_data and isinstance(j.input_data, dict):
            phase = j.input_data.get("phase", "")
            phase_map = {
                "index_files": "phase_1",
                "extract_rules": "phase_2",
                "generate_cards": "phase_3",
                "generate_wiki": "phase_4",
            }
            key = phase_map.get(phase)
            if key:
                pipeline_state[key] = "running"

    # Redis pipeline state: only trust "completed"/"failed" from Redis.
    # "running" from Redis can be stale (cancelled/cleaned jobs); active_jobs check above is authoritative.
    try:
        from app.services.rag_pipeline import _get_redis
        redis_client = _get_redis()
        if redis_client:
            rstate = redis_client.hgetall(f"rag:pipeline:{project_id}")
            for k, v in rstate.items():
                if k.startswith("phase_") and k.endswith("_status"):
                    phase_key = k.replace("_status", "")
                    # Only accept completed/failed from Redis; running is determined from active_jobs
                    if v in ("completed", "failed") and pipeline_state.get(phase_key) == "pending":
                        pipeline_state[phase_key] = v
    except Exception:
        pass

    return {
        "is_enriching": is_enriching,
        "active_jobs": [
            {
                "id": str(j.id),
                "type": j.job_type.value if j.job_type else None,
                "status": j.status.value if j.status else None,
                "progress_percent": j.progress_percent,
                "progress_message": j.progress_message,
            }
            for j in active_jobs
        ],
        "context_locked": project.context_locked or False,
        "has_description": bool(project.description),
        "has_context": bool(project.context_human),
        "auto_discovered_cards": auto_discovered_count,
        "initial_scan_complete": bool(project.initial_scan_complete),
        "rag_completed": bool(project.initial_scan_complete) and not is_enriching,
        "has_epics": epic_count > 0,
        "total_files_processed": completed_files,
        "has_completed_scan": rag_doc_count > 0,
        # PROMPT #252 - Pipeline progressive state
        "has_indexed_files": has_indexed_files,
        "has_business_rules": has_business_rules,
        "has_cards": has_cards,
        "has_wiki": has_wiki,
        "pipeline_phase_1": pipeline_state["phase_1"],
        "pipeline_phase_2": pipeline_state["phase_2"],
        "pipeline_phase_3": pipeline_state["phase_3"],
        "pipeline_phase_4": pipeline_state["phase_4"],
    }
