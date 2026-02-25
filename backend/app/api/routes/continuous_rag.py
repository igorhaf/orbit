"""
Continuous RAG Evolution API Routes

PROMPT #218 - Endpoints for managing continuous RAG processing per project.
PROMPT #252 - 4-phase pipeline with progressive button unlocking.
PROMPT #260 - Deep Pipeline (7-phase Claudio pipeline).

Provides manual scan triggers, status monitoring, file listing, and reset.
Phase endpoints: scan, extract-rules, generate-cards, generate-wiki.
Deep pipeline endpoints: deep-pipeline (run), deep-pipeline/status.
"""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query
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


@router.post("/{project_id}/rag/deep-pipeline")
async def trigger_deep_pipeline(
    project_id: UUID,
    background_tasks: BackgroundTasks,
    profile: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    PROMPT #260 - Start the 7-phase deep pipeline via Claudio.
    Phases: Scan → File Analysis (Haiku) → Rule Synthesis (Sonnet) →
    Architectural Map (Sonnet+Thinking) → Cards (Opus/Sonnet/Haiku) →
    Wiki (Opus) → QA (Sonnet+Thinking) → Gap Fill (conditional).

    Optional query param `profile`: 'economy', 'balanced', or 'quality'.
    If not provided, uses the default profile.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    if not project.code_path:
        raise HTTPException(status_code=400, detail="Projeto não tem code_path configurado")

    # Check for existing running deep pipeline or legacy pipeline
    existing = db.query(AsyncJob).filter(
        AsyncJob.project_id == project_id,
        AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
        AsyncJob.parent_job_id.is_(None),
        AsyncJob.job_type.in_([
            JobType.DEEP_PIPELINE,
            JobType.PROJECT_PIPELINE,
        ]),
    ).first()
    if existing:
        return {
            "message": "Um pipeline já está em andamento",
            "job_id": str(existing.id),
            "status": existing.status.value,
        }

    profile_name = profile  # capture for closure

    job_manager = JobManager(db)
    job = job_manager.create_job(
        job_type=JobType.DEEP_PIPELINE,
        input_data={"project_id": str(project_id), "phase": "deep_pipeline_v2", "profile": profile_name},
        project_id=project_id,
        notification_title=f"Deep Pipeline (7 fases) — {project.name or 'Projeto'}" + (f" [{profile_name}]" if profile_name else ""),
        deep_link=f"/projects/{project_id}",
    )

    async def _run_deep_pipeline(job_id, proj_id):
        from app.database import get_db as get_db_gen
        db_session = next(get_db_gen())
        try:
            from app.services.deep_pipeline import DeepPipelineService
            jm = JobManager(db_session)
            jm.start_job(job_id)

            pipeline = DeepPipelineService(db_session, profile_name=profile_name)

            async def _update_progress(phase, pct, msg):
                try:
                    overall_pct = min(99, int(pct * 0.14 + phase * 14))
                    jm.update_progress(job_id, overall_pct, f"[Fase {phase}] {msg}")
                except Exception:
                    pass

            result = await pipeline.run(proj_id, progress_callback=_update_progress)
            jm.complete_job(job_id, result)
        except Exception as e:
            try:
                db_session.rollback()
                jm.fail_job(job_id, str(e))
            except Exception:
                # Last resort: try with a fresh session
                try:
                    db_session.rollback()
                    from app.database import get_db as get_db_gen2
                    fresh = next(get_db_gen2())
                    JobManager(fresh).fail_job(job_id, str(e)[:500])
                    fresh.close()
                except Exception:
                    pass
        finally:
            db_session.close()

    background_tasks.add_task(_run_deep_pipeline, job.id, project_id)

    return {
        "message": "Deep Pipeline (7 fases) iniciado via Claudio",
        "job_id": str(job.id),
        "status": "pending",
        "pipeline_version": "v2",
        "profile": profile_name or "default",
    }


@router.get("/{project_id}/rag/deep-pipeline/status")
async def get_deep_pipeline_status(
    project_id: UUID,
    db: Session = Depends(get_db),
):
    """
    PROMPT #260 - Get detailed deep pipeline status.
    Shows per-phase progress, quality score, and artifact counts.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    # Find active or most recent deep pipeline job
    active_job = db.query(AsyncJob).filter(
        AsyncJob.project_id == project_id,
        AsyncJob.job_type == JobType.DEEP_PIPELINE,
        AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
        AsyncJob.parent_job_id.is_(None),
    ).first()

    last_completed = None
    if not active_job:
        last_completed = db.query(AsyncJob).filter(
            AsyncJob.project_id == project_id,
            AsyncJob.job_type == JobType.DEEP_PIPELINE,
            AsyncJob.status == JobStatus.COMPLETED,
        ).order_by(AsyncJob.updated_at.desc()).first()

    # Count artifacts per phase
    from app.models.pipeline_artifact import PipelineArtifact
    from sqlalchemy import func as sql_func

    artifact_counts = dict(
        db.query(PipelineArtifact.phase, sql_func.count(PipelineArtifact.id))
        .filter(PipelineArtifact.project_id == project_id)
        .group_by(PipelineArtifact.phase)
        .all()
    )

    response = {
        "pipeline_version": project.pipeline_version or "v1",
        "quality_score": project.pipeline_quality_score,
        "has_architecture": project.project_architecture is not None,
        "is_running": active_job is not None,
        "artifacts": {
            f"phase_{p}": artifact_counts.get(p, 0)
            for p in range(8)
        },
    }

    if active_job:
        response["active_job"] = {
            "id": str(active_job.id),
            "status": active_job.status.value,
            "progress_percent": active_job.progress_percent,
            "progress_message": active_job.progress_message,
            "started_at": active_job.started_at.isoformat() if active_job.started_at else None,
        }
    elif last_completed:
        response["last_completed"] = {
            "id": str(last_completed.id),
            "completed_at": last_completed.updated_at.isoformat() if last_completed.updated_at else None,
            "result": last_completed.result,
        }

    return response


# =========================================================================
# PIPELINE PROFILES & RUNS ENDPOINTS
# =========================================================================

@router.get("/pipeline/profiles")
async def list_pipeline_profiles(db: Session = Depends(get_db)):
    """List all available pipeline execution profiles."""
    from app.models.pipeline_profile import PipelineProfile
    profiles = db.query(PipelineProfile).order_by(PipelineProfile.name).all()
    return [
        {
            "id": str(p.id),
            "name": p.name,
            "description": p.description,
            "quality_threshold": p.quality_threshold,
            "is_default": p.is_default,
            "phase_configs": p.phase_configs,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        }
        for p in profiles
    ]


def _profile_to_dict(p):
    """Helper to serialize a PipelineProfile to dict."""
    return {
        "id": str(p.id),
        "name": p.name,
        "description": p.description,
        "quality_threshold": p.quality_threshold,
        "is_default": p.is_default,
        "phase_configs": p.phase_configs,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


@router.post("/pipeline/profiles")
async def create_pipeline_profile(data: dict = Body(...), db: Session = Depends(get_db)):
    """Create a new pipeline execution profile."""
    from app.models.pipeline_profile import PipelineProfile

    if not data.get("name"):
        raise HTTPException(status_code=400, detail="Name is required")

    profile = PipelineProfile(
        name=data["name"],
        description=data.get("description", ""),
        phase_configs=data.get("phase_configs", {}),
        quality_threshold=data.get("quality_threshold", 60),
        is_default=False,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return _profile_to_dict(profile)


@router.put("/pipeline/profiles/{profile_id}")
async def update_pipeline_profile(profile_id: UUID, data: dict = Body(...), db: Session = Depends(get_db)):
    """Update a pipeline execution profile."""
    from app.models.pipeline_profile import PipelineProfile

    profile = db.query(PipelineProfile).filter(PipelineProfile.id == profile_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Pipeline profile not found")

    if "name" in data:
        profile.name = data["name"]
    if "description" in data:
        profile.description = data["description"]
    if "phase_configs" in data:
        profile.phase_configs = data["phase_configs"]
    if "quality_threshold" in data:
        profile.quality_threshold = data["quality_threshold"]

    db.commit()
    db.refresh(profile)
    return _profile_to_dict(profile)


@router.delete("/pipeline/profiles/{profile_id}")
async def delete_pipeline_profile(profile_id: UUID, db: Session = Depends(get_db)):
    """Delete a pipeline execution profile."""
    from app.models.pipeline_profile import PipelineProfile

    profile = db.query(PipelineProfile).filter(PipelineProfile.id == profile_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Pipeline profile not found")
    if profile.is_default:
        raise HTTPException(status_code=400, detail="Cannot delete the default profile")

    db.delete(profile)
    db.commit()
    return {"ok": True}


@router.post("/pipeline/profiles/{profile_id}/set-default")
async def set_default_pipeline_profile(profile_id: UUID, db: Session = Depends(get_db)):
    """Set a pipeline profile as the default (unsets all others)."""
    from app.models.pipeline_profile import PipelineProfile

    profile = db.query(PipelineProfile).filter(PipelineProfile.id == profile_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Pipeline profile not found")

    db.query(PipelineProfile).update({"is_default": False})
    profile.is_default = True
    db.commit()
    db.refresh(profile)
    return _profile_to_dict(profile)


@router.get("/{project_id}/rag/deep-pipeline/runs")
async def list_pipeline_runs(
    project_id: UUID,
    limit: int = Query(default=20, le=100),
    db: Session = Depends(get_db),
):
    """List pipeline run history for a project, ordered by most recent."""
    from app.models.pipeline_run import PipelineRun
    runs = (
        db.query(PipelineRun)
        .filter(PipelineRun.project_id == project_id)
        .order_by(PipelineRun.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": str(r.id),
            "profile_name": r.profile_name,
            "version": r.version,
            "status": r.status,
            "overall_score": r.overall_score,
            "phase_scores": r.phase_scores,
            "phase_durations": r.phase_durations,
            "total_files_scanned": r.total_files_scanned,
            "total_rules_extracted": r.total_rules_extracted,
            "total_domains": r.total_domains,
            "total_cards_created": r.total_cards_created,
            "total_wiki_pages": r.total_wiki_pages,
            "total_input_tokens": r.total_input_tokens,
            "total_output_tokens": r.total_output_tokens,
            "estimated_cost_usd": float(r.estimated_cost_usd) if r.estimated_cost_usd else None,
            "reinforcement_applied": r.reinforcement_applied,
            "error": r.error,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "completed_at": r.completed_at.isoformat() if r.completed_at else None,
        }
        for r in runs
    ]


@router.get("/{project_id}/rag/deep-pipeline/runs/{run_id}")
async def get_pipeline_run_detail(
    project_id: UUID,
    run_id: UUID,
    db: Session = Depends(get_db),
):
    """Get detailed info for a specific pipeline run."""
    from app.models.pipeline_run import PipelineRun
    run = (
        db.query(PipelineRun)
        .filter(PipelineRun.id == run_id, PipelineRun.project_id == project_id)
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Pipeline run not found")

    return {
        "id": str(run.id),
        "project_id": str(run.project_id),
        "profile_id": str(run.profile_id) if run.profile_id else None,
        "profile_name": run.profile_name,
        "profile_snapshot": run.profile_snapshot,
        "version": run.version,
        "status": run.status,
        "overall_score": run.overall_score,
        "phase_scores": run.phase_scores,
        "phase_durations": run.phase_durations,
        "total_files_scanned": run.total_files_scanned,
        "total_rules_extracted": run.total_rules_extracted,
        "total_domains": run.total_domains,
        "total_cards_created": run.total_cards_created,
        "total_wiki_pages": run.total_wiki_pages,
        "total_input_tokens": run.total_input_tokens,
        "total_output_tokens": run.total_output_tokens,
        "estimated_cost_usd": float(run.estimated_cost_usd) if run.estimated_cost_usd else None,
        "reinforcement_applied": run.reinforcement_applied,
        "error": run.error,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "created_at": run.created_at.isoformat() if run.created_at else None,
    }


@router.get("/{project_id}/rag/deep-pipeline/compare")
async def compare_pipeline_runs(
    project_id: UUID,
    run1: UUID = Query(..., description="First run ID"),
    run2: UUID = Query(..., description="Second run ID"),
    db: Session = Depends(get_db),
):
    """Compare two pipeline runs side-by-side."""
    from app.models.pipeline_run import PipelineRun

    r1 = db.query(PipelineRun).filter(PipelineRun.id == run1, PipelineRun.project_id == project_id).first()
    r2 = db.query(PipelineRun).filter(PipelineRun.id == run2, PipelineRun.project_id == project_id).first()

    if not r1 or not r2:
        raise HTTPException(status_code=404, detail="One or both runs not found")

    def _run_summary(r):
        return {
            "id": str(r.id),
            "profile_name": r.profile_name,
            "status": r.status,
            "overall_score": r.overall_score,
            "phase_scores": r.phase_scores or {},
            "phase_durations": r.phase_durations or {},
            "total_cards_created": r.total_cards_created,
            "total_wiki_pages": r.total_wiki_pages,
            "total_files_scanned": r.total_files_scanned,
            "total_rules_extracted": r.total_rules_extracted,
            "estimated_cost_usd": float(r.estimated_cost_usd) if r.estimated_cost_usd else None,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "completed_at": r.completed_at.isoformat() if r.completed_at else None,
        }

    s1, s2 = _run_summary(r1), _run_summary(r2)

    # Compute diffs for phase scores
    score_diffs = {}
    all_phases = set(list((s1["phase_scores"] or {}).keys()) + list((s2["phase_scores"] or {}).keys()))
    for phase in sorted(all_phases):
        v1 = (s1["phase_scores"] or {}).get(phase, 0)
        v2 = (s2["phase_scores"] or {}).get(phase, 0)
        score_diffs[phase] = {"run1": v1, "run2": v2, "diff": v2 - v1}

    return {
        "run1": s1,
        "run2": s2,
        "score_comparison": score_diffs,
        "overall_diff": (s2.get("overall_score") or 0) - (s1.get("overall_score") or 0),
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

    # Check if full pipeline completed (marks ALL phases as done)
    full_pipeline_done = db.execute(sql_text(
        "SELECT 1 FROM async_jobs WHERE project_id = :pid "
        "AND status = 'completed' AND job_type = 'project_pipeline' "
        "AND input_data->>'phase' = 'full_pipeline' LIMIT 1"
    ), {"pid": str(project_id)}).first() is not None

    # Phase 1: completed if pipeline job OR memory_scan indexed files
    phase_1_done = full_pipeline_done or _phase_job_completed("index_files") or has_indexed_files

    pipeline_state = {
        "phase_1": "completed" if phase_1_done else "pending",
        "phase_2": "completed" if (full_pipeline_done or _phase_job_completed("extract_rules")) else "pending",
        "phase_3": "completed" if (full_pipeline_done or _phase_job_completed("generate_cards")) else "pending",
        "phase_4": "completed" if (full_pipeline_done or _phase_job_completed("generate_wiki")) else "pending",
    }

    # Check for running phase jobs (PENDING or RUNNING override to "running")
    for j in active_jobs:
        # MEMORY_SCAN jobs are Phase 1 equivalent (no "phase" key in input_data)
        if j.job_type == JobType.MEMORY_SCAN:
            pipeline_state["phase_1"] = "running"
            continue
        if j.input_data and isinstance(j.input_data, dict):
            phase = j.input_data.get("phase", "")
            # Full pipeline marks all phases as running
            if phase == "full_pipeline":
                for pk in ["phase_1", "phase_2", "phase_3", "phase_4"]:
                    if pipeline_state[pk] != "completed":
                        pipeline_state[pk] = "running"
                continue
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

    # PROMPT #260 - Deep pipeline state
    deep_pipeline_active = db.query(AsyncJob).filter(
        AsyncJob.project_id == project_id,
        AsyncJob.job_type == JobType.DEEP_PIPELINE,
        AsyncJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
    ).first()
    deep_pipeline_done = db.execute(sql_text(
        "SELECT 1 FROM async_jobs WHERE project_id = :pid "
        "AND status = 'completed' AND job_type = 'deep_pipeline' LIMIT 1"
    ), {"pid": str(project_id)}).first() is not None

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
        # PROMPT #260 - Deep Pipeline (v2) state
        "deep_pipeline_version": project.pipeline_version or "v1",
        "deep_pipeline_quality_score": project.pipeline_quality_score,
        "deep_pipeline_running": deep_pipeline_active is not None,
        "deep_pipeline_completed": deep_pipeline_done,
        "deep_pipeline_progress": {
            "percent": deep_pipeline_active.progress_percent if deep_pipeline_active else None,
            "message": deep_pipeline_active.progress_message if deep_pipeline_active else None,
        } if deep_pipeline_active else None,
    }
