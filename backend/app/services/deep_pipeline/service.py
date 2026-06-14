"""
Deep Pipeline Service - 7-Phase Sequential Pipeline via Claudius

Orchestrates the complete deep analysis of a codebase:
  Phase 0: Structural scan (filesystem, no AI)
  Phase 1: Per-file analysis (Haiku, parallel)
  Phase 2: Cross-file rule synthesis (Sonnet, multi-turn)
  Phase 3: Architectural map (Sonnet + extended thinking)
  Phase 4: Hierarchical card generation (Opus/Sonnet/Haiku)
  Phase 5: Wiki generation (Opus, multi-turn)
  Phase 6: Quality assurance (Sonnet + extended thinking)
  Phase 7: Gap filling (conditional)
"""

import json
import logging
import os
from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.contracts.loader import ContractLoader
from app.models.pipeline_artifact import PipelineArtifact, ArtifactType
from app.models.pipeline_profile import PipelineProfile
from app.models.pipeline_run import PipelineRun
from app.models.project import Project
from app.services.claudius_pipeline import (
    ClaudiusPipelineService,
    ClaudiusPipelineError,
    MODEL_HAIKU,
    MODEL_SONNET,
    MODEL_OPUS,
)
from app.services.console_logger import get_console_logger

from .phases_0_to_3 import Phase0to3Mixin
from .phases_4_to_7 import Phase4to7Mixin
from .telemetry import TelemetryMixin
from .utils import UtilsMixin, _get_redis

logger = logging.getLogger(__name__)


class DeepPipelineService(Phase0to3Mixin, Phase4to7Mixin, TelemetryMixin, UtilsMixin):
    """Orchestrates the 7-phase deep pipeline via Claudius (v2.5: claudius-only)."""

    def __init__(self, db: Session, profile_name: str = None):
        self.db = db
        self._contract_loader = ContractLoader(db)
        self._profile = self._load_profile(profile_name)
        self._phase_configs = self._profile.phase_configs if self._profile else {}

        # v2.5: claudius-only lockdown. Ollama path removed.
        self._provider = "claudius"
        self.claudius = ClaudiusPipelineService(db=db, default_usage_type="content_generation")

        # ── PROMPT #237: Pipeline telemetry ────
        self._console = get_console_logger()
        self._telemetry_trace_id: str = ""
        self._telemetry_project_id: str = ""
        self._telemetry_job_id: str | None = None
        self._run_tokens_in: int = 0
        self._run_tokens_out: int = 0
        self._run_cost: float = 0.0
        self._phase_scores: Dict[str, int] = {}

    @staticmethod
    def _model_label(model_name: str) -> str:
        """Extract a human-readable label from a Claude model name.
        'claude-sonnet-4-6' -> 'Sonnet'
        """
        if "-" in model_name and model_name.startswith("claude"):
            return model_name.split("-")[1].title()
        return model_name.title()

    def _load_profile(self, profile_name: str = None) -> Optional[PipelineProfile]:
        """Load a named profile or the default one."""
        if profile_name:
            profile = self.db.query(PipelineProfile).filter(PipelineProfile.name == profile_name).first()
            if profile:
                return profile
            logger.warning(f"Profile '{profile_name}' not found, falling back to default")
        # Try default
        profile = self.db.query(PipelineProfile).filter(PipelineProfile.is_default == True).first()
        if profile:
            return profile
        # Try economy as last resort
        return self.db.query(PipelineProfile).filter(PipelineProfile.name == "economy").first()

    def _get_phase_config(self, phase_key: str, field: str, default=None):
        """Get a config value for a phase from the loaded profile."""
        cfg = self._phase_configs.get(phase_key, {})
        return cfg.get(field, default)

    def _get_model(self, phase_key: str, default: str = MODEL_SONNET) -> str:
        """Get model for a phase from profile config."""
        return self._get_phase_config(phase_key, "model", default)

    def _get_max_tokens(self, phase_key: str, default: int = 8000) -> int:
        """Get max_tokens for a phase from profile config."""
        return self._get_phase_config(phase_key, "max_tokens", default)

    def _get_concurrency(self, phase_key: str, default: int = 5) -> int:
        """Get concurrency for a phase from profile config."""
        return self._get_phase_config(phase_key, "concurrency", default)

    def _get_contract_name(self, phase_key: str, default: str = None) -> Optional[str]:
        """Get contract name for a phase from profile config."""
        return self._get_phase_config(phase_key, "contract", default)

    def _is_phase_enabled(self, phase_key: str) -> bool:
        """Check if a phase is enabled in the current profile."""
        return self._get_phase_config(phase_key, "enabled", True)

    def _ollama_kwargs(self, phase_key: str) -> dict:
        """v2.5: Ollama removed; preserved for call-site compat returning {}."""
        return {}

    # =========================================================================
    # MAIN ORCHESTRATOR
    # =========================================================================

    async def run(
        self,
        project_id: UUID,
        progress_callback: Any = None,
    ) -> Dict[str, Any]:
        """
        Execute the complete 7-phase deep pipeline.

        Args:
            project_id: UUID of the project to analyze
            progress_callback: Optional async callable(phase, pct, message)

        Returns:
            Dict with pipeline results and quality score
        """
        import time as _time

        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        if not project.code_path or not os.path.isdir(project.code_path):
            raise ValueError(f"Invalid code_path: {project.code_path}")

        profile_name = self._profile.name if self._profile else "quality"

        # ── Check for interrupted run with checkpoint (resume support) ──
        existing_run = self.db.query(PipelineRun).filter(
            PipelineRun.project_id == project.id,
            PipelineRun.status == "interrupted",
            PipelineRun.checkpoint_state.isnot(None),
        ).order_by(PipelineRun.created_at.desc()).first()

        if existing_run:
            run_id = existing_run.id
            pipeline_run = existing_run
            pipeline_run.status = "running"
            self.db.commit()
            logger.info(f"Resuming interrupted pipeline run {run_id} for project '{project.name}' "
                         f"(checkpoint: {len(existing_run.checkpoint_state.get('completed_files', []))} files done)")
        else:
            run_id = uuid4()
            logger.info(f"Starting deep pipeline for project '{project.name}' "
                         f"(run_id={run_id}, profile={profile_name})")

        # ── PROMPT #237: Initialize telemetry context ────
        self._telemetry_trace_id = str(run_id)
        self._telemetry_project_id = str(project_id)
        self._run_tokens_in = 0
        self._run_tokens_out = 0
        self._run_cost = 0.0
        self._phase_scores = {}
        import time as _t_init
        self._run_started_at = int(_t_init.time() * 1000)  # epoch ms for frontend elapsed calc

        if not existing_run:
            # ── Create NEW PipelineRun record ────────────────────────────
            pipeline_run = PipelineRun(
                id=run_id,
                project_id=project.id,
                profile_id=self._profile.id if self._profile else None,
                profile_name=profile_name,
                profile_snapshot=self._phase_configs,
                version="v2",
                status="running",
                phase_scores={},
                phase_durations={},
                started_at=datetime.utcnow(),
            )
            self.db.add(pipeline_run)
            self.db.commit()

            # ── Cleanup data from previous pipeline runs ──────────────────
            # Removes AI-generated cards and wiki pages from old runs.
            # REGRA #0: human-edited data is NEVER deleted.
            self._cleanup_previous_runs(project.id, run_id)

        # ── Apply reinforcement from previous run ────────────────────────
        reinforcement = self._apply_reinforcement(project.id)
        if reinforcement:
            pipeline_run.reinforcement_applied = reinforcement
            self.db.commit()

        quality_threshold = self._profile.quality_threshold if self._profile else 60

        async def _progress(phase: int, pct: float, msg: str):
            logger.info(f"[Phase {phase}] {pct:.0f}% - {msg}")
            if progress_callback:
                try:
                    await progress_callback(phase, pct, msg)
                except Exception:
                    pass

        # v2.5: claudius-only health check
        healthy = await self.claudius.health_check()
        if not healthy:
            pipeline_run.status = "failed"
            pipeline_run.error = f"Claudius not reachable at {self.claudius.base_url}"
            pipeline_run.completed_at = datetime.utcnow()
            self.db.commit()
            raise ClaudiusPipelineError(
                f"Claudius is not reachable at {self.claudius.base_url}. Start it first."
            )

        results = {}
        phase_scores = {}
        phase_durations = {}

        def _phase_timer():
            return _time.monotonic()

        # ── Resume support: determine which phase to start from ──
        checkpoint = (pipeline_run.checkpoint_state or {}) if pipeline_run else {}
        resume_from_phase = checkpoint.get("last_completed_phase", -1) + 1
        if resume_from_phase > 0:
            logger.info(f"Resuming pipeline from phase {resume_from_phase} (phases 0-{resume_from_phase - 1} already done)")
            # Restore saved scores/durations from previous run
            phase_scores = dict(pipeline_run.phase_scores or {})
            phase_durations = dict(pipeline_run.phase_durations or {})

        def _save_phase_checkpoint(phase_num: int):
            """Save checkpoint after each completed phase for resume capability."""
            cp = pipeline_run.checkpoint_state or {}
            cp["last_completed_phase"] = phase_num
            pipeline_run.checkpoint_state = cp
            pipeline_run.phase_scores = phase_scores
            pipeline_run.phase_durations = phase_durations
            pipeline_run.total_input_tokens = self._run_tokens_in
            pipeline_run.total_output_tokens = self._run_tokens_out
            pipeline_run.estimated_cost_usd = self._run_cost
            self.db.commit()

        def _cleanup_partial_phase(phase_num: int):
            """Remove escritas parciais da mesma run_id ao retomar uma fase que foi interrompida.
            Evita duplicatas quando fase parcial (ex: 3 epics de 5) precisa ser re-executada."""
            from app.models.task import Task
            from app.models.wiki_page import WikiPage
            if phase_num in (1, 2):
                self.db.query(PipelineArtifact).filter(
                    PipelineArtifact.run_id == run_id,
                    PipelineArtifact.phase == phase_num,
                ).delete(synchronize_session=False)
            elif phase_num == 4:
                self.db.query(Task).filter(Task.pipeline_run_id == run_id).delete(synchronize_session=False)
            elif phase_num == 5:
                self.db.query(WikiPage).filter(WikiPage.pipeline_run_id == run_id).delete(synchronize_session=False)
            self.db.commit()
            logger.info(f"Cleanup parcial fase {phase_num} concluido para run {run_id}")

        try:
            # Phase 0: Structural Scan (0-5%)
            # Always re-run phase 0 (fast, no AI)
            t0 = _phase_timer()
            await _progress(0, 0, "Iniciando scan estrutural...")
            file_inventory = await self._phase0_structural_scan(project)
            results["phase0"] = {"files_found": len(file_inventory)}
            phase_scores["phase_0"] = self._compute_phase_score("phase_0", results["phase0"])
            self._phase_scores = dict(phase_scores)
            phase_durations["phase_0"] = int((_phase_timer() - t0) * 1000)
            await self._emit_telemetry("phase_0", "structural_scan", f"Scan completo: {len(file_inventory)} arquivos", len(file_inventory), len(file_inventory), duration_ms=phase_durations["phase_0"])
            await _progress(0, 100, f"Scan completo: {len(file_inventory)} arquivos (score: {phase_scores['phase_0']})")
            _save_phase_checkpoint(0)

            # Phase 1: Per-file Analysis (5-25%)
            if resume_from_phase <= 1:
                if resume_from_phase == 1:
                    _cleanup_partial_phase(1)
                t0 = _phase_timer()
                model_1 = self._get_model("phase_1", MODEL_HAIKU)
                await _progress(1, 0, f"Analisando {len(file_inventory)} arquivos com {self._model_label(model_1)}...")
                file_analyses = await self._phase1_file_analysis(
                    project, file_inventory, run_id, _progress, pipeline_run
                )
                p1_data = {
                    "files_analyzed": len(file_analyses),
                    "files_total": len(file_inventory),
                    "domains_found": len(set(a.get("domain_classification", "?") for a in file_analyses)),
                }
                results["phase1"] = p1_data
                phase_scores["phase_1"] = self._compute_phase_score("phase_1", p1_data)
                self._phase_scores = dict(phase_scores)
                phase_durations["phase_1"] = int((_phase_timer() - t0) * 1000)
                await _progress(1, 100, f"Analise completa: {len(file_analyses)} arquivos (score: {phase_scores['phase_1']})")
                _save_phase_checkpoint(1)
            else:
                # Reload Phase 1 results from DB artifacts
                await _progress(1, 100, "Fase 1 ja concluida -- carregando do banco...")
                file_analyses = self._reload_phase1_artifacts(project.id, run_id)
                logger.info(f"Resumed Phase 1: {len(file_analyses)} file analyses loaded from DB")

            # Phase 2: Cross-file Rule Synthesis (25-40%)
            if resume_from_phase <= 2:
                if resume_from_phase == 2:
                    _cleanup_partial_phase(2)
                t0 = _phase_timer()
                model_2 = self._get_model("phase_2", MODEL_SONNET)
                await _progress(2, 0, f"Sintetizando regras cross-file com {self._model_label(model_2)}...")
                domain_rules = await self._phase2_rule_synthesis(
                    project, file_analyses, run_id, _progress
                )
                total_rules = sum(len(d.get("consolidated_rules", [])) for d in domain_rules.values())
                p2_data = {"domains": len(domain_rules), "total_rules": total_rules}
                results["phase2"] = p2_data
                phase_scores["phase_2"] = self._compute_phase_score("phase_2", p2_data)
                self._phase_scores = dict(phase_scores)
                phase_durations["phase_2"] = int((_phase_timer() - t0) * 1000)
                await _progress(2, 100, f"Sintese completa: {total_rules} regras em {len(domain_rules)} dominios (score: {phase_scores['phase_2']})")
                _save_phase_checkpoint(2)
            else:
                await _progress(2, 100, "Fase 2 ja concluida -- carregando do banco...")
                domain_rules = self._reload_phase2_artifacts(project.id, run_id)
                total_rules = sum(len(d.get("consolidated_rules", [])) for d in domain_rules.values())
                logger.info(f"Resumed Phase 2: {len(domain_rules)} domains, {total_rules} rules loaded from DB")

            # Phase 3: Architectural Map (40-45%)
            if resume_from_phase <= 3:
                t0 = _phase_timer()
                if self._is_phase_enabled("phase_3"):
                    await _progress(3, 0, "Construindo mapa arquitetural com Extended Thinking...")
                    arch_map = await self._phase3_architectural_map(
                        project, domain_rules, file_inventory, run_id
                    )
                    p3_data = {
                        "domains": len(arch_map.get("domains", [])),
                        "cross_domain_flows": len(arch_map.get("cross_domain_flows", [])),
                        "arch_map": arch_map,
                    }
                    results["phase3"] = {"domains": p3_data["domains"], "cross_domain_flows": p3_data["cross_domain_flows"]}
                    phase_scores["phase_3"] = self._compute_phase_score("phase_3", p3_data)
                    self._phase_scores = dict(phase_scores)
                    project.project_architecture = arch_map
                    project.pipeline_version = "v2"
                    self.db.commit()
                    await _progress(3, 100, f"Mapa arquitetural construido (score: {phase_scores['phase_3']})")
                else:
                    arch_map = self._build_local_arch_map(domain_rules, file_inventory, project)
                    results["phase3"] = {"domains": len(arch_map.get("domains", [])), "cross_domain_flows": 0, "skipped": True}
                    phase_scores["phase_3"] = 50
                    project.project_architecture = arch_map
                    project.pipeline_version = "v2"
                    self.db.commit()
                    await _progress(3, 100, "Mapa arquitetural construido localmente (fase desabilitada)")
                phase_durations["phase_3"] = int((_phase_timer() - t0) * 1000)
                _save_phase_checkpoint(3)
            else:
                await _progress(3, 100, "Fase 3 ja concluida -- carregando do banco...")
                arch_map = project.project_architecture or self._build_local_arch_map(domain_rules, file_inventory, project)
                logger.info(f"Resumed Phase 3: arch_map loaded from project")

            # Phase 4: Card Generation (45-70%)
            if resume_from_phase <= 4:
                if resume_from_phase == 4:
                    _cleanup_partial_phase(4)
                t0 = _phase_timer()
                await _progress(4, 0, "Gerando cards hierarquicos...")
                card_stats = await self._phase4_card_generation(
                    project, arch_map, domain_rules, run_id, _progress
                )
                results["phase4"] = card_stats
                phase_scores["phase_4"] = self._compute_phase_score("phase_4", card_stats)
                self._phase_scores = dict(phase_scores)
                phase_durations["phase_4"] = int((_phase_timer() - t0) * 1000)
                await _progress(4, 100, f"Cards gerados: {card_stats.get('total_cards', 0)} (score: {phase_scores['phase_4']})")
                _save_phase_checkpoint(4)
            else:
                await _progress(4, 100, "Fase 4 ja concluida -- carregando stats...")
                card_stats = self._reload_card_stats(project.id, run_id)
                logger.info(f"Resumed Phase 4: {card_stats.get('total_cards', 0)} cards")

            # Phase 5: Wiki Generation (70-85%)
            if resume_from_phase <= 5:
                if resume_from_phase == 5:
                    _cleanup_partial_phase(5)
                t0 = _phase_timer()
                await _progress(5, 0, "Gerando wiki...")
                wiki_stats = await self._phase5_wiki_generation(
                    project, arch_map, domain_rules, card_stats, run_id, _progress
                )
                results["phase5"] = wiki_stats
                phase_scores["phase_5"] = self._compute_phase_score("phase_5", wiki_stats)
                self._phase_scores = dict(phase_scores)
                phase_durations["phase_5"] = int((_phase_timer() - t0) * 1000)
                await _progress(5, 100, f"Wiki gerada: {wiki_stats.get('total_pages', 0)} paginas (score: {phase_scores['phase_5']})")
                _save_phase_checkpoint(5)
            else:
                await _progress(5, 100, "Fase 5 ja concluida -- carregando stats...")
                wiki_stats = self._reload_wiki_stats(project.id, run_id)
                logger.info(f"Resumed Phase 5: {wiki_stats.get('total_pages', 0)} pages")

            # Phase 6: Quality Assurance (85-95%)
            if resume_from_phase <= 6:
                t0 = _phase_timer()
                if self._is_phase_enabled("phase_6"):
                    await _progress(6, 0, "Executando Quality Assurance com Thinking...")
                    qa_result = await self._phase6_quality_assurance(
                        project, arch_map, domain_rules, card_stats, wiki_stats, run_id
                    )
                else:
                    await _progress(6, 0, "Executando Quality Assurance local...")
                    qa_result = self._phase6_local_qa(
                        domain_rules, card_stats, wiki_stats, run_id, project
                    )
                results["phase6"] = qa_result
                phase_scores["phase_6"] = self._compute_phase_score("phase_6", qa_result)
                self._phase_scores = dict(phase_scores)
                phase_durations["phase_6"] = int((_phase_timer() - t0) * 1000)
                project.pipeline_quality_score = str(qa_result.get("overall_score", 0))
                self.db.commit()
                await _progress(6, 100, f"QA completo. Score: {qa_result.get('overall_score', 0)}/100")
                _save_phase_checkpoint(6)
            else:
                await _progress(6, 100, "Fase 6 ja concluida -- carregando resultado...")
                qa_result = self._reload_qa_result(project.id, run_id)
                logger.info(f"Resumed Phase 6: score={qa_result.get('overall_score', 0)}")

            # Phase 7: Gap Filling (95-100%) - conditional
            t0 = _phase_timer()
            if qa_result.get("overall_score", 100) < quality_threshold:
                await _progress(7, 0, f"Score < {quality_threshold} - executando correcao de gaps...")
                gap_result = await self._phase7_gap_filling(
                    project, qa_result, arch_map, domain_rules, run_id
                )
                results["phase7"] = gap_result
                await _progress(7, 100, "Correcao de gaps concluida")
            else:
                results["phase7"] = {"skipped": True, "reason": f"Score >= {quality_threshold}"}
                await _progress(7, 100, f"Score >= {quality_threshold} - gap filling nao necessario")
            phase_durations["phase_7"] = int((_phase_timer() - t0) * 1000)

            # ── Post-pipeline: Project Enrichment (description + context_semantic) ──
            await self._enrich_project_fields(
                project, arch_map, domain_rules, file_inventory,
                total_rules, card_stats, wiki_stats, _progress,
            )

            # ── Post-pipeline: Mark cards as DONE (code already exists) ──────
            await self._mark_cards_as_done(project, run_id, _progress)

            # ── Update PipelineRun with final results ────────────────────
            pipeline_run.status = "completed"
            pipeline_run.overall_score = qa_result.get("overall_score", 0)
            pipeline_run.phase_scores = phase_scores
            pipeline_run.phase_durations = phase_durations
            pipeline_run.total_files_scanned = len(file_inventory)
            pipeline_run.total_rules_extracted = total_rules
            pipeline_run.total_domains = len(domain_rules)
            pipeline_run.total_cards_created = card_stats.get("total_cards", 0)
            pipeline_run.total_wiki_pages = wiki_stats.get("total_pages", 0)
            pipeline_run.total_input_tokens = self._run_tokens_in
            pipeline_run.total_output_tokens = self._run_tokens_out
            pipeline_run.estimated_cost_usd = self._run_cost
            pipeline_run.completed_at = datetime.utcnow()
            self.db.commit()

            # PROMPT #237: Mark pipeline as completed in Redis
            try:
                r = _get_redis()
                if r:
                    r.hset(f"pipeline:live:{self._telemetry_project_id}", mapping={
                        "status": "completed",
                        "tokens_in": str(self._run_tokens_in),
                        "tokens_out": str(self._run_tokens_out),
                        "cost_usd": f"{self._run_cost:.6f}",
                        "phase_scores": json.dumps(phase_scores),
                    })
                    r.expire(f"pipeline:live:{self._telemetry_project_id}", 3600)
            except Exception:
                pass

            # PROMPT #247: Broadcast pipeline completion via WebSocket
            try:
                await self._console.log_pipeline_activity(
                    project_id=self._telemetry_project_id,
                    trace_id=self._telemetry_trace_id,
                    phase="completed",
                    action="pipeline_completed",
                    item_name=f"Pipeline concluido. Score: {qa_result.get('overall_score', 0)}/100",
                    item_index=1,
                    item_total=1,
                    cumulative_tokens_in=self._run_tokens_in,
                    cumulative_tokens_out=self._run_tokens_out,
                    cumulative_cost=self._run_cost,
                    phase_scores=phase_scores,
                    job_id=self._telemetry_job_id,
                    details={"pipeline_status": "completed", "overall_score": qa_result.get("overall_score", 0)},
                )
            except Exception:
                pass

        except Exception as e:
            logger.error(f"Deep pipeline failed at run {run_id}: {e}", exc_info=True)
            results["error"] = str(e)
            # Detectar tipo do erro pra UX especifica (cota vs erro generico)
            from app.services.claudius_pipeline import ClaudiusQuotaExhaustedError
            is_quota_error = isinstance(e, ClaudiusQuotaExhaustedError)
            quota_resets_at = None
            if is_quota_error:
                import re
                m = re.search(r"resets?\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*[ap]m\s*\([A-Z]+\))", str(e), re.IGNORECASE)
                if m:
                    quota_resets_at = m.group(1)
            # Always mark as "interrupted" so user can resume from last completed phase
            try:
                pipeline_run.status = "interrupted"
                pipeline_run.error = str(e)[:1000]
                pipeline_run.phase_scores = phase_scores
                pipeline_run.phase_durations = phase_durations
                pipeline_run.total_input_tokens = self._run_tokens_in
                pipeline_run.total_output_tokens = self._run_tokens_out
                pipeline_run.estimated_cost_usd = self._run_cost
                pipeline_run.completed_at = datetime.utcnow()
                # Marcar tipo de interrupcao no checkpoint_state pra UI distinguir
                cp = pipeline_run.checkpoint_state or {}
                cp["interruption_reason"] = "quota_exhausted" if is_quota_error else "error"
                if quota_resets_at:
                    cp["quota_resets_at"] = quota_resets_at
                cp["interrupted_at"] = datetime.utcnow().isoformat()
                pipeline_run.checkpoint_state = cp
                self.db.commit()
                logger.info(f"Pipeline interrupted ({'quota' if is_quota_error else 'error'}) -- can be resumed from phase {(pipeline_run.checkpoint_state or {}).get('last_completed_phase', -1) + 1}")
            except Exception:
                self.db.rollback()
            raise
        finally:
            await self.claudius.close()

        # Clear checkpoint on successful completion
        pipeline_run.checkpoint_state = None
        self.db.commit()

        logger.info(f"Deep pipeline completed for project '{project.name}' "
                     f"(run_id={run_id}, profile={profile_name}, "
                     f"score={pipeline_run.overall_score})")
        results["run_id"] = str(run_id)
        results["profile"] = profile_name
        results["phase_scores"] = phase_scores
        return results

    # =========================================================================
    # RESUME HELPERS: Reload phase outputs from DB
    # =========================================================================

    def _reload_phase1_artifacts(self, project_id: UUID, run_id: UUID) -> list:
        """Reload Phase 1 file analyses from pipeline_artifacts table."""
        artifacts = self.db.query(PipelineArtifact).filter(
            PipelineArtifact.project_id == project_id,
            PipelineArtifact.run_id == run_id,
            PipelineArtifact.artifact_type == ArtifactType.file_analysis,
        ).all()
        return [a.content for a in artifacts if a.content]

    def _reload_phase2_artifacts(self, project_id: UUID, run_id: UUID) -> dict:
        """Reload Phase 2 domain rules from pipeline_artifacts table."""
        artifacts = self.db.query(PipelineArtifact).filter(
            PipelineArtifact.project_id == project_id,
            PipelineArtifact.run_id == run_id,
            PipelineArtifact.artifact_type == ArtifactType.synthesized_rules,
        ).all()
        domain_rules = {}
        for a in artifacts:
            if a.domain and a.content:
                domain_rules[a.domain] = a.content
        return domain_rules

    def _reload_card_stats(self, project_id: UUID, run_id: UUID) -> dict:
        """Reload Phase 4 card stats by counting tasks created for this run."""
        from app.models.task import Task, ItemType
        epics = self.db.query(Task).filter(
            Task.project_id == project_id,
            Task.pipeline_run_id == run_id,
            Task.item_type == ItemType.EPIC,
        ).count()
        stories = self.db.query(Task).filter(
            Task.project_id == project_id,
            Task.pipeline_run_id == run_id,
            Task.item_type == ItemType.STORY,
        ).count()
        tasks = self.db.query(Task).filter(
            Task.project_id == project_id,
            Task.pipeline_run_id == run_id,
            Task.item_type == ItemType.TASK,
        ).count()
        return {"epics": epics, "stories": stories, "tasks": tasks, "total_cards": epics + stories + tasks}

    def _reload_wiki_stats(self, project_id: UUID, run_id: UUID) -> dict:
        """Reload Phase 5 wiki stats for THIS run only.

        Previously counted ALL WikiPages of the project, ignoring run_id — so on
        a resume it inflated card_coverage (25% of the QA score), could spuriously
        trigger/skip Phase 7, and double-counted wiki across runs. Mirror the
        run_id filter that _reload_card_stats already applies.
        """
        from app.models.wiki_page import WikiPage
        pages = self.db.query(WikiPage).filter(
            WikiPage.project_id == project_id,
            WikiPage.pipeline_run_id == run_id,
        ).count()
        return {"total_pages": pages, "total_words": 0}

    def _reload_qa_result(self, project_id: UUID, run_id: UUID) -> dict:
        """Reload Phase 6 QA result from artifacts."""
        artifact = self.db.query(PipelineArtifact).filter(
            PipelineArtifact.project_id == project_id,
            PipelineArtifact.run_id == run_id,
            PipelineArtifact.artifact_type == ArtifactType.quality_report,
        ).first()
        if artifact and artifact.content:
            return artifact.content
        # Fallback: return a passing score to avoid blocking
        return {"overall_score": 70, "resumed": True}
