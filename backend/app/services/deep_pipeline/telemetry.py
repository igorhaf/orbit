"""
Deep Pipeline - Telemetry Mixin.

Handles pipeline telemetry emission, phase scoring, reinforcement learning,
and cleanup of previous pipeline runs.
"""

import json
import logging
from typing import Any, Dict, Optional
from uuid import UUID

from app.models.pipeline_artifact import PipelineArtifact
from app.models.pipeline_run import PipelineRun
from app.models.task import Task
from app.models.wiki_page import WikiPage
from app.utils.pricing import calculate_cost

from .utils import _get_redis

logger = logging.getLogger(__name__)


# ── Reinforcement rules: when a phase score is below threshold, adjust next run
REINFORCEMENT_RULES = {
    "phase_1": {
        "threshold": 70,
        "adjustments": {"max_tokens": 8000},
        "reason": "Low parse success rate — doubling max_tokens for deeper analysis",
    },
    "phase_2": {
        "threshold": 60,
        "adjustments": {"multi_turn_threshold": 10, "max_tokens": 24000},
        "reason": "Low rule density — enabling multi-turn for more domains",
    },
    "phase_4a": {
        "threshold": 50,
        "adjustments": {"max_tokens": 80000},
        "reason": "Low hierarchy ratio — increasing epic generation budget",
    },
    "phase_5b": {
        "threshold": 60,
        "adjustments": {"max_tokens": 80000},
        "reason": "Thin wiki pages — increasing wiki generation budget",
    },
}


class TelemetryMixin:
    """Mixin for pipeline telemetry, scoring, reinforcement, and cleanup."""

    async def _emit_telemetry(
        self,
        phase: str,
        action: str,
        item_name: str,
        item_index: int,
        item_total: int,
        model_name: str = "",
        result: dict = None,
        duration_ms: int = 0,
    ):
        """Emit a microscopic telemetry event via ConsoleLogger and update Redis live state."""
        input_tokens = 0
        output_tokens = 0
        cost_usd = 0.0

        if result and isinstance(result, dict):
            usage = result.get("usage", {})
            input_tokens = usage.get("input_tokens", 0) or 0
            output_tokens = usage.get("output_tokens", 0) or 0
            if input_tokens or output_tokens:
                cost_data = calculate_cost(input_tokens, output_tokens, model_name or result.get("model", ""))
                cost_usd = cost_data.get("total_cost", 0.0)

        self._run_tokens_in += input_tokens
        self._run_tokens_out += output_tokens
        self._run_cost += cost_usd

        try:
            await self._console.log_pipeline_activity(
                project_id=self._telemetry_project_id,
                trace_id=self._telemetry_trace_id,
                phase=phase,
                action=action,
                item_name=item_name,
                item_index=item_index,
                item_total=item_total,
                model_name=model_name,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cost_usd=cost_usd,
                duration_ms=duration_ms,
                cumulative_tokens_in=self._run_tokens_in,
                cumulative_tokens_out=self._run_tokens_out,
                cumulative_cost=self._run_cost,
                phase_scores=self._phase_scores,
                job_id=self._telemetry_job_id,
            )
        except Exception as e:
            logger.debug(f"Telemetry emit failed: {e}")

        # Update Redis live state (best-effort)
        try:
            r = _get_redis()
            if r:
                import time as _t
                pct = round((item_index / item_total) * 100, 1) if item_total > 0 else 0
                r.hset(f"pipeline:live:{self._telemetry_project_id}", mapping={
                    "status": "running",
                    "current_phase": phase,
                    "current_action": action,
                    "current_item": item_name[:200],
                    "items_done": str(item_index),
                    "items_total": str(item_total),
                    "phase_progress_pct": str(pct),
                    "tokens_in": str(self._run_tokens_in),
                    "tokens_out": str(self._run_tokens_out),
                    "cost_usd": f"{self._run_cost:.6f}",
                    "model_active": model_name,
                    "phase_scores": json.dumps(self._phase_scores),
                    "started_at": str(self._run_started_at),
                })
                r.expire(f"pipeline:live:{self._telemetry_project_id}", 3600)
        except Exception:
            pass

    def _load_contract(self, name: str, variables: dict = None) -> tuple[str, str]:
        """Load a contract and render with variables."""
        try:
            return self._contract_loader.render(f"pipeline/{name}", variables or {})
        except Exception as e:
            logger.warning(f"Failed to load contract 'pipeline/{name}': {e}")
            return ("", "")

    # ── Phase Scoring (heuristic, no AI) ─────────────────────────────────────

    @staticmethod
    def _compute_phase_score(phase_key: str, data: dict) -> int:
        """Compute a 0-100 quality score for a phase based on heuristic metrics."""
        if phase_key == "phase_0":
            files = data.get("files_found", 0)
            return min(100, int(files / 5 * 10)) if files > 0 else 0

        if phase_key == "phase_1":
            total = data.get("files_total", 1)
            analyzed = data.get("files_analyzed", 0)
            rate = analyzed / max(total, 1) * 100
            return min(100, int(rate))

        if phase_key == "phase_2":
            rules = data.get("total_rules", 0)
            domains = data.get("domains", 1)
            density = rules / max(domains, 1)
            # 10+ rules per domain = 100, <3 = poor
            return min(100, int(density * 10))

        if phase_key == "phase_3":
            arch = data.get("arch_map", {})
            fields = ["domains", "cross_domain_flows", "tech_stack", "patterns"]
            filled = sum(1 for f in fields if arch.get(f))
            return min(100, int(filled / len(fields) * 100))

        if phase_key == "phase_4":
            epics = data.get("epics", 0)
            stories = data.get("stories", 0)
            tasks = data.get("tasks", 0)
            if epics == 0:
                return 0
            # Healthy ratio: ~3 stories per epic, ~3 tasks per story
            story_ratio = min(1.0, stories / max(epics * 2, 1))
            task_ratio = min(1.0, tasks / max(stories * 2, 1))
            return min(100, int((story_ratio * 50 + task_ratio * 50)))

        if phase_key == "phase_5":
            pages = data.get("total_pages", 0)
            avg_chars = data.get("avg_chars_per_page", 0)
            page_score = min(50, pages * 5)
            richness = min(50, int(avg_chars / 100 * 10))
            return min(100, page_score + richness)

        if phase_key == "phase_6":
            return data.get("overall_score", 50)

        return 50  # unknown phase

    def _cleanup_previous_runs(self, project_id: UUID, current_run_id: UUID):
        """Remove AI-generated data from previous pipeline runs before starting a new one.
        REGRA #0: human-edited data (description_edited_by='human', source='manual'/'enrichment') is NEVER deleted.
        """
        # Delete pipeline-generated tasks (not human-edited)
        old_tasks = self.db.query(Task).filter(
            Task.project_id == project_id,
            Task.pipeline_run_id.isnot(None),
            Task.pipeline_run_id != current_run_id,
        ).all()
        human_preserved = 0
        deleted_tasks = 0
        for t in old_tasks:
            if t.description_edited_by == "human":
                human_preserved += 1
                continue
            self.db.delete(t)
            deleted_tasks += 1

        # Delete pipeline-generated wiki pages (not human-edited)
        old_wiki = self.db.query(WikiPage).filter(
            WikiPage.project_id == project_id,
            WikiPage.pipeline_run_id.isnot(None),
            WikiPage.pipeline_run_id != current_run_id,
            WikiPage.source == "ai_generated",
        ).all()
        deleted_wiki = 0
        for w in old_wiki:
            self.db.delete(w)
            deleted_wiki += 1

        # Delete old pipeline artifacts
        deleted_artifacts = self.db.query(PipelineArtifact).filter(
            PipelineArtifact.project_id == project_id,
            PipelineArtifact.run_id != current_run_id,
        ).delete(synchronize_session="fetch")

        # Delete old pipeline runs (keep current)
        deleted_runs = self.db.query(PipelineRun).filter(
            PipelineRun.project_id == project_id,
            PipelineRun.id != current_run_id,
        ).delete(synchronize_session="fetch")

        self.db.commit()

        if deleted_tasks or deleted_wiki or deleted_artifacts or deleted_runs:
            logger.info(
                f"Pre-run cleanup: {deleted_tasks} tasks, {deleted_wiki} wiki pages, "
                f"{deleted_artifacts} artifacts, {deleted_runs} old runs deleted. "
                f"{human_preserved} human-edited tasks preserved (REGRA #0)."
            )

    def _apply_reinforcement(self, project_id: UUID) -> dict:
        """Check previous run scores and apply reinforcement adjustments."""
        prev_run = (
            self.db.query(PipelineRun)
            .filter(PipelineRun.project_id == project_id, PipelineRun.status == "completed")
            .order_by(PipelineRun.created_at.desc())
            .first()
        )
        if not prev_run or not prev_run.phase_scores:
            return {}

        adjustments = {}
        for phase_key, rule in REINFORCEMENT_RULES.items():
            score = prev_run.phase_scores.get(phase_key, 100)
            if score < rule["threshold"]:
                logger.info(f"Reinforcement: {phase_key} score was {score} (< {rule['threshold']}). {rule['reason']}")
                # Apply adjustments to current profile config
                if phase_key in self._phase_configs:
                    self._phase_configs[phase_key].update(rule["adjustments"])
                adjustments[phase_key] = {
                    "previous_score": score,
                    "threshold": rule["threshold"],
                    "applied": rule["adjustments"],
                    "reason": rule["reason"],
                }
        return adjustments
