"""
Continuous RAG - Deep Pipeline Orchestration Endpoints

PROMPT #260 - Deep Pipeline (7-phase Claudius pipeline).
Pipeline profiles CRUD and pipeline run history/comparison.
"""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.async_job import AsyncJob, JobStatus, JobType
from app.models.project import Project
from app.services.job_manager import JobManager

router = APIRouter()


def _estimate_project_meta(db: Session, project: Project) -> dict:
    """Quick filesystem scan + existing-artifact lookups to feed quota planner."""
    import os
    n_files = 0
    try:
        if project.code_path and os.path.isdir(project.code_path):
            for root, dirs, files in os.walk(project.code_path):
                # Skip heavy dirs early
                dirs[:] = [d for d in dirs if d not in (
                    "node_modules", ".git", "vendor", "venv", ".venv",
                    "__pycache__", "dist", "build", ".next",
                )]
                for f in files:
                    ext = os.path.splitext(f)[1].lower()
                    if ext in (".py", ".ts", ".tsx", ".js", ".jsx", ".go",
                              ".rs", ".rb", ".php", ".java", ".kt", ".swift"):
                        n_files += 1
                if n_files > 2000:
                    break
    except Exception:
        n_files = 50  # fallback default
    # n_domains: use prior pipeline artifact count if exists
    n_domains = 0
    try:
        from app.models.pipeline_artifact import PipelineArtifact
        n_domains = db.query(PipelineArtifact).filter(
            PipelineArtifact.project_id == project.id,
            PipelineArtifact.phase == 2,
        ).count()
    except Exception:
        pass
    return {"n_files": max(1, n_files), "n_domains": n_domains}


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


@router.post("/{project_id}/rag/deep-pipeline")
async def trigger_deep_pipeline(
    project_id: UUID,
    background_tasks: BackgroundTasks,
    profile: Optional[str] = None,
    mode: Optional[str] = "balanced",
    force: bool = False,
    db: Session = Depends(get_db),
):
    """
    PROMPT #260 - Start the 7-phase deep pipeline via Claudius.
    Phases: Scan -> File Analysis (Haiku) -> Rule Synthesis (Sonnet) ->
    Architectural Map (Sonnet+Thinking) -> Cards (Opus/Sonnet/Haiku) ->
    Wiki (Opus) -> QA (Sonnet+Thinking) -> Gap Fill (conditional).

    Optional query params:
      - profile: name of the pipeline profile to use (default: 'economy')
      - mode: 'aggressive' | 'balanced' (default) | 'conservative'
              Drives quota validation; ignored when force=true.
      - force: skip quota pre-flight check and proceed anyway.

    If mode != 'aggressive' and !force, checks /api/quota/plan first.
    Returns HTTP 409 with plan body when quota is insufficient.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    if not project.code_path:
        raise HTTPException(status_code=400, detail="Projeto não tem code_path configurado")

    # v2.4: quota pre-flight
    mode = (mode or "balanced").lower()
    if mode not in ("aggressive", "balanced", "conservative"):
        mode = "balanced"
    plan_result = None
    if not force and mode != "aggressive":
        try:
            from app.services.claudius_pipeline import ClaudiusPipelineService
            client = ClaudiusPipelineService()
            try:
                # Estimate project size from filesystem (cheap)
                project_meta = _estimate_project_meta(db, project)
                plan_result = await client.quota_plan(project_meta, mode=mode)
            finally:
                await client.close()
            if plan_result and plan_result.get("recommendation") == "wait":
                raise HTTPException(
                    status_code=409,
                    detail={
                        "message": "Cota Claude insuficiente pra rodar nesse modo agora",
                        "plan": plan_result,
                        "hint": "Use force=true pra disparar mesmo assim, ou aguarde o reset da janela.",
                    },
                )
        except HTTPException:
            raise
        except Exception:
            # Quota check is best-effort. Never block on its failure.
            pass

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

            # Set actual model name from pipeline profile (not from ai_models table)
            try:
                from app.models.async_job import AsyncJob
                job_record = db_session.query(AsyncJob).filter(AsyncJob.id == job_id).first()
                if job_record:
                    p1_model = pipeline._get_model("phase_1", "unknown")
                    provider = pipeline._provider or "claudius"
                    label = pipeline._model_label(p1_model)
                    job_record.ai_model_name = f"{label} ({provider})"
                    db_session.commit()
            except Exception:
                pass

            # Phase-aware progress weights reflecting actual time distribution
            # Phase 1 (file analysis) takes ~90% of total time, so it gets 60% of the bar
            _PHASE_OFFSETS = {
                0: (0, 5),     # Phase 0: 0-5%   (quick filesystem scan)
                1: (5, 60),    # Phase 1: 5-65%  (heavy per-file analysis)
                2: (65, 5),    # Phase 2: 65-70% (synthesis)
                3: (70, 7),    # Phase 3: 70-77% (architecture)
                4: (77, 7),    # Phase 4: 77-84% (cards)
                5: (84, 7),    # Phase 5: 84-91% (wiki)
                6: (91, 8),    # Phase 6: 91-99% (QA)
            }

            # v3.1: map phase int → phase_key string for clean WS payloads
            # (canvas animation consumes phase_key instead of parsing message text)
            _PHASE_INT_TO_KEY = {
                0: "phase_0", 1: "phase_1", 2: "phase_2", 3: "phase_3",
                4: "phase_4a", 5: "phase_5", 6: "phase_6",
            }

            async def _update_progress(phase, pct, msg, phase_key=None, status=None):
                try:
                    start, weight = _PHASE_OFFSETS.get(phase, (0, 14))
                    overall_pct = min(99, int(start + pct / 100 * weight))
                    # If phase_key not explicit, infer from phase int + msg
                    if phase_key is None:
                        phase_key = _PHASE_INT_TO_KEY.get(phase)
                        # Detect 4a/b/c from message (legacy code sends `phase=4` for all)
                        if phase == 4 and msg:
                            low = msg.lower()
                            if "story" in low or "decomp" in low: phase_key = "phase_4b"
                            elif "task" in low: phase_key = "phase_4c"
                            else: phase_key = "phase_4a"
                    # Status derivation from pct + msg
                    if status is None:
                        if pct >= 100: status = "completed"
                        elif pct > 0: status = "running"
                        else: status = "starting"
                    jm.update_progress(
                        job_id, overall_pct, f"[Fase {phase}] {msg}",
                        extra={"phase_key": phase_key, "phase_status": status, "phase_pct": pct},
                    )
                except Exception:
                    pass

            result = await pipeline.run(proj_id, progress_callback=_update_progress)
            jm.complete_job(job_id, result)
        except Exception as e:
            # Detect quota error pra UX especifica + notification_title clara
            from app.services.claudius_pipeline import ClaudiusQuotaExhaustedError
            is_quota = isinstance(e, ClaudiusQuotaExhaustedError)
            err_msg = ("[QUOTA] " if is_quota else "") + str(e)
            try:
                db_session.rollback()
                jm.fail_job(job_id, err_msg)
                # Atualizar notification_title pra mensagem amigavel
                try:
                    from app.models.async_job import AsyncJob
                    jr = db_session.query(AsyncJob).filter(AsyncJob.id == job_id).first()
                    if jr:
                        if is_quota:
                            jr.notification_title = "Cota Claude esgotada — pipeline pausado, retome quando resetar"
                        db_session.commit()
                except Exception:
                    db_session.rollback()
            except Exception:
                # Last resort: try with a fresh session
                try:
                    db_session.rollback()
                    from app.database import get_db as get_db_gen2
                    fresh = next(get_db_gen2())
                    JobManager(fresh).fail_job(job_id, err_msg[:500])
                    fresh.close()
                except Exception:
                    pass
        finally:
            db_session.close()

    background_tasks.add_task(_run_deep_pipeline, job.id, project_id)

    return {
        "message": "Deep Pipeline (7 fases) iniciado via Claudius",
        "job_id": str(job.id),
        "status": "pending",
        "pipeline_version": "v2",
        "profile": profile_name or "default",
        "mode": mode,
        "quota_plan": plan_result,  # null if force=true or aggressive
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


@router.get("/claudius/quota-probe")
async def claudius_quota_probe():
    """Ping minimo em Claudius pra detectar disponibilidade da cota Claude.

    Usado pelo botao 'Retomar pipeline' na UI: antes de re-disparar, verifica
    se a cota voltou. Custa ~5-10 tokens.

    Retorna:
        - available: bool (false se cota esgotada ou claudius unreachable)
        - reason: "ok" | "quota_exhausted" | "http_error" | "unreachable"
        - resets_at: string parseado da mensagem (ex: "5:10am (UTC)") ou null
        - raw: texto bruto da resposta pra debug
    """
    from app.services.claudius_pipeline import ClaudiusPipelineService
    client = ClaudiusPipelineService()
    try:
        return await client.quota_probe()
    finally:
        await client.close()


# =========================================================================
# PIPELINE PROFILES ENDPOINTS
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


# =========================================================================
# PIPELINE RUNS ENDPOINTS
# =========================================================================

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
