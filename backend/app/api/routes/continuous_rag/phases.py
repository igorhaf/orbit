"""
Continuous RAG - Phase Trigger Endpoints

PROMPT #252 - 4-phase pipeline with progressive button unlocking.
Phase endpoints: scan, extract-rules, generate-cards, generate-wiki, run-pipeline.
"""

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.async_job import AsyncJob, JobStatus, JobType
from app.models.project import Project
from app.models.rag_file_state import FileProcessingStatus, RAGFileState
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
    Scans filesystem and embeds all files via Nomic. Files go PENDING -> INDEXED.
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
                db_session.rollback()
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
                db_session.rollback()
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
                db_session.rollback()
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


@router.post("/{project_id}/rag/run-pipeline")
async def trigger_full_pipeline(
    project_id: UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Run the FULL 4-phase pipeline as a single job.
    Progress is split evenly: 0-25% (index), 25-50% (rules),
    50-75% (cards), 75-100% (wiki).
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    if not project.code_path:
        raise HTTPException(status_code=400, detail="Projeto não tem code_path configurado")

    # Check for any running pipeline/RAG/cards/wiki job
    existing = db.query(AsyncJob).filter(
        AsyncJob.project_id == project_id,
        AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
        AsyncJob.parent_job_id.is_(None),
        AsyncJob.job_type.in_([
            JobType.RAG_CONTINUOUS_SCAN,
            JobType.CARDS_FROM_MEMORY,
            JobType.WIKI_GENERATION,
            JobType.PROJECT_PIPELINE,
        ]),
    ).first()
    if existing:
        return {
            "message": "Uma operação já está em andamento",
            "job_id": str(existing.id),
            "status": existing.status.value,
        }

    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.PROJECT_PIPELINE,
        input_data={"project_id": str(project_id), "phase": "full_pipeline"},
        project_id=project_id,
        notification_title=f"Pipeline completo — {project.name or 'Projeto'}",
        deep_link=f"/projects/{project_id}",
    )

    async def _run_full_pipeline(job_id, proj_id):
        from app.database import get_db as get_db_gen
        db_session = next(get_db_gen())
        try:
            from app.services.rag_pipeline import RagPipelineService
            jm = JobManager(db_session)
            jm.start_job(job_id)
            pipeline = RagPipelineService(db_session)
            result = await pipeline.run_full_pipeline(proj_id, job_id)
            jm.complete_job(job_id, result)
        except Exception as e:
            try:
                db_session.rollback()
                jm.fail_job(job_id, str(e))
            except Exception:
                pass
        finally:
            db_session.close()

    background_tasks.add_task(_run_full_pipeline, job.id, project_id)

    return {
        "message": "Pipeline completo iniciado (4 fases, 25% cada)",
        "job_id": str(job.id),
        "status": "pending",
    }


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
                db_session.rollback()
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
