"""Demais executors — wrappers leves dos services existentes do orbit.

Cobre os 15+ kinds restantes do catálogo: discovery (file_type/semantic
classifiers, change_detector), processing (domain_grouper, dedup, chunker,
hierarchy_builder), AI helpers (quota_probe, health_check, model_selector,
token_cost, exec_logger, batch_call), observability (telemetry, job_child),
specs (loader, filter).

Maioria é stateless ou só lê DB.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any
from uuid import uuid4

from .executor import NodeExecutor, NodeExecutionError, ExecutionContext, registry

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Discovery wrappers
# ─────────────────────────────────────────────────────────────────────────────

@registry.register("file_type_classifier")
class FileTypeClassifierExecutor(NodeExecutor):
    """Classifica path de arquivo em tipo arquitetural.

    Inputs: `files` (list) ou single `file` (dict com `path`).
    Outputs: `classified` (mesma lista com `file_type` adicionado).
    """

    _PATTERNS: list[tuple[str, list[str]]] = [
        ("migration",     ["migration", "alembic", "migrate"]),
        ("test",          ["test", "spec", "__test__", "/tests/"]),
        ("model",         ["model", "schema", "entity"]),
        ("route",         ["route", "controller", "endpoint", "/api/"]),
        ("ui",            ["component", "page", "view", "template"]),
        ("config",        ["config", "setting", ".env"]),
        ("infrastructure",["middleware", "guard", "interceptor"]),
        ("domain_logic",  ["service", "usecase", "interactor"]),
    ]

    def _classify(self, path: str) -> str:
        p = path.lower()
        for ftype, needles in self._PATTERNS:
            if any(n in p for n in needles):
                return ftype
        return "domain_logic"

    async def execute(self, inputs, config, ctx):
        files = inputs.get("files") or inputs.get("file")
        if not files:
            return {"classified": []}
        if isinstance(files, dict):
            files = [files]
        result = []
        for f in files:
            if isinstance(f, dict):
                ft = self._classify(f.get("path", ""))
                result.append({**f, "file_type": ft})
            elif isinstance(f, str):
                result.append({"path": f, "file_type": self._classify(f)})
        return {"classified": result}


@registry.register("semantic_layer_classifier")
class SemanticLayerClassifierExecutor(NodeExecutor):
    """Classifica em camada semântica: Schema/Routes/Logic/Presentation/Config.

    Inputs: `files` (list com `path`).
    Outputs: `layered` (lista com `semantic_layer` adicionado).
    """

    _LAYER_PATTERNS: list[tuple[str, list[str]]] = [
        ("Schema",       ["model", "schema", "entity", "migration"]),
        ("Routes",       ["route", "controller", "endpoint", "/api/"]),
        ("Presentation", ["component", "page", "view", "template", ".tsx", ".vue"]),
        ("Config",       ["config", "setting", ".env", ".yml", ".yaml"]),
        ("Logic",        ["service", "usecase", "interactor", "handler"]),
    ]

    def _classify(self, path: str) -> str:
        p = path.lower()
        for layer, needles in self._LAYER_PATTERNS:
            if any(n in p for n in needles):
                return layer
        return "Logic"

    async def execute(self, inputs, config, ctx):
        files = inputs.get("files") or inputs.get("file") or []
        if isinstance(files, dict):
            files = [files]
        result = []
        for f in files:
            if isinstance(f, dict):
                result.append({**f, "semantic_layer": self._classify(f.get("path", ""))})
        return {"layered": result}


@registry.register("change_detector")
class ChangeDetectorExecutor(NodeExecutor):
    """Compara files com baseline (hashes) → produz diff {new, modified, deleted}.

    Inputs: `files` (list com `path`+`size`), `baseline` (opcional, dict
        path → size).
    Outputs: `diff` (dict).
    """

    async def execute(self, inputs, config, ctx):
        files = inputs.get("files") or []
        baseline = inputs.get("baseline") or {}
        current = {f.get("path"): f.get("size") for f in files if isinstance(f, dict)}
        new = [p for p in current if p not in baseline]
        modified = [p for p, sz in current.items() if p in baseline and baseline[p] != sz]
        deleted = [p for p in baseline if p not in current]
        return {"diff": {
            "new": new,
            "modified": modified,
            "deleted": deleted,
            "has_changes": bool(new or modified or deleted),
        }}


# ─────────────────────────────────────────────────────────────────────────────
# Processing wrappers
# ─────────────────────────────────────────────────────────────────────────────

@registry.register("domain_grouper")
class DomainGrouperExecutor(NodeExecutor):
    """Agrupa items por `domain_classification` (ou campo configurável).

    Inputs: `items` (list de dicts).
    Outputs: `by_domain` (dict[domain] → list).

    Config: `key` (default 'domain_classification' ou 'domain' fallback)
    """

    async def execute(self, inputs, config, ctx):
        items = inputs.get("items") or inputs.get("data") or []
        if not isinstance(items, list):
            items = [items] if items else []
        key = config.get("key") or "domain_classification"
        groups: dict[str, list] = {}
        for it in items:
            if not isinstance(it, dict):
                continue
            domain = it.get(key) or it.get("domain") or "unknown"
            groups.setdefault(domain, []).append(it)
        return {"by_domain": groups}


@registry.register("epic_deduplicator")
class EpicDeduplicatorExecutor(NodeExecutor):
    """Remove epics duplicadas por substring overlap >threshold no key_field.

    Inputs: `epics` (list de dicts).
    Outputs: `epics` (dedup list), `removed` (count).

    Config: similarity_threshold (default 0.8), key_field (default 'title')
    """

    async def execute(self, inputs, config, ctx):
        epics = inputs.get("epics") or []
        if not isinstance(epics, list):
            return {"epics": [], "removed": 0}
        threshold = float(config.get("similarity_threshold", 0.8))
        key = config.get("key_field", "title")

        unique: list = []
        seen_keys: list[str] = []
        for ep in epics:
            if not isinstance(ep, dict):
                continue
            txt = str(ep.get(key) or "").lower().strip()
            if not txt:
                unique.append(ep)
                continue
            is_dup = False
            for prev in seen_keys:
                # Substring overlap simples
                shorter = min(len(txt), len(prev))
                if shorter == 0:
                    continue
                # Conta chars iguais nas primeiras N posições
                overlap = sum(1 for i in range(shorter) if i < len(txt) and i < len(prev) and txt[i] == prev[i])
                ratio = overlap / shorter
                if ratio >= threshold:
                    is_dup = True
                    break
            if not is_dup:
                unique.append(ep)
                seen_keys.append(txt)
        return {"epics": unique, "removed": len(epics) - len(unique)}


@registry.register("card_hierarchy_builder")
class CardHierarchyBuilderExecutor(NodeExecutor):
    """Monta Epic→Story→Task tree no DB (Task table com parent_id).

    Inputs: `cards` (dict {epics?, stories?, tasks?}).
    Outputs: `hierarchy` (dict com counts + ids).

    NOTA: Implementação minimal — só normaliza shape e retorna counts.
    Inserção real via Task model fica pra iteração futura quando o engine
    rodar o pipeline real.
    """
    side_effecting = True

    async def execute(self, inputs, config, ctx):
        cards = inputs.get("cards") if "cards" in inputs else (inputs or {})
        if not isinstance(cards, dict):
            cards = {}
        epics = cards.get("epics") or []
        stories = cards.get("stories") or []
        tasks = cards.get("tasks") or []
        return {
            "hierarchy": {
                "epics_count": len(epics),
                "stories_count": len(stories),
                "tasks_count": len(tasks),
                "total": len(epics) + len(stories) + len(tasks),
            },
        }


@registry.register("text_chunker")
class TextChunkerExecutor(NodeExecutor):
    """Quebra texto longo em chunks com overlap.

    Inputs: `text` (string).
    Outputs: `chunks` (list de strings).
    Config: chunk_size (default 1500), overlap (default 200)
    """

    async def execute(self, inputs, config, ctx):
        text = inputs.get("text") or ""
        if not isinstance(text, str):
            text = str(text)
        chunk_size = int(config.get("chunk_size", 1500))
        overlap = int(config.get("overlap", 200))
        if len(text) <= chunk_size:
            return {"chunks": [text] if text else []}
        chunks = []
        start = 0
        step = max(1, chunk_size - overlap)
        while start < len(text):
            chunks.append(text[start:start + chunk_size])
            start += step
        return {"chunks": chunks}


@registry.register("git_commit_fetcher")
class GitCommitFetcherExecutor(NodeExecutor):
    """Roda git log no project.code_path.

    Inputs: `project` (opcional — usa ctx.project se ausente).
    Outputs: `commits` (list de {hash, subject, date}).
    Config: max_commits (default 50)
    """

    async def execute(self, inputs, config, ctx):
        import subprocess
        import os as _os
        code_path = None
        proj = inputs.get("project")
        if isinstance(proj, dict):
            code_path = proj.get("code_path")
        if not code_path and ctx.project is not None:
            code_path = getattr(ctx.project, "code_path", None)
        if not code_path or not _os.path.isdir(code_path):
            return {"commits": []}
        max_commits = int(config.get("max_commits", 50))
        try:
            out = subprocess.run(
                ["git", "log", f"-{max_commits}", "--pretty=format:%H|%s|%ai"],
                cwd=code_path, capture_output=True, text=True, timeout=10,
            )
            if out.returncode != 0:
                return {"commits": []}
            commits = []
            for line in out.stdout.splitlines():
                parts = line.split("|", 2)
                if len(parts) >= 3:
                    commits.append({"hash": parts[0], "subject": parts[1], "date": parts[2]})
            return {"commits": commits}
        except Exception:
            return {"commits": []}


@registry.register("prompt_context_compressor")
class PromptContextCompressorExecutor(NodeExecutor):
    """Comprime contexto hierárquico (cards + history + RAG) pra caber em budget.

    Inputs: `context` (dict).
    Outputs: `compressed` (dict).
    Config: token_budget (default 4000)
    """

    async def execute(self, inputs, config, ctx):
        context = inputs.get("context") or inputs or {}
        if not isinstance(context, dict):
            return {"compressed": {}}
        budget = int(config.get("token_budget", 4000))
        # Heurística simples: ~4 chars por token; trunca strings longas
        max_chars = budget * 4

        def _shrink(v: Any, remaining: int) -> tuple[Any, int]:
            if remaining <= 0:
                return None, 0
            if isinstance(v, str):
                if len(v) <= remaining:
                    return v, remaining - len(v)
                return v[:remaining] + "…", 0
            if isinstance(v, list):
                out = []
                for item in v:
                    if remaining <= 0:
                        break
                    sub, remaining = _shrink(item, remaining)
                    out.append(sub)
                return out, remaining
            if isinstance(v, dict):
                out = {}
                for k, val in v.items():
                    if remaining <= 0:
                        break
                    out[k], remaining = _shrink(val, remaining)
                return out, remaining
            return v, remaining

        compressed, _ = _shrink(context, max_chars)
        return {"compressed": compressed or {}}


# ─────────────────────────────────────────────────────────────────────────────
# AI helpers
# ─────────────────────────────────────────────────────────────────────────────

@registry.register("claudius_batch_call")
class ClaudiusBatchCallExecutor(NodeExecutor):
    """Múltiplas chamadas Claudius em paralelo.

    Inputs: `prompts` (list de dicts {system, user} ou strings).
    Outputs: `responses` (list de dicts), `errors` (list de dicts).
    Config: model, max_tokens, max_concurrency (default 10), abort_on_quota
    """
    cost_bearing = True

    async def execute(self, inputs, config, ctx):
        prompts = inputs.get("prompts") or []
        if not isinstance(prompts, list):
            return {"responses": [], "errors": [{"index": 0, "message": "prompts must be list"}]}
        if not prompts:
            return {"responses": [], "errors": []}

        model = config.get("model", "claude-sonnet-4-6")
        max_tokens = int(config.get("max_tokens", 4000))
        concurrency = int(config.get("max_concurrency", 10))
        abort_on_quota = bool(config.get("abort_on_quota", True))

        try:
            from app.services.claudius_pipeline import (
                ClaudiusPipelineService, ClaudiusPipelineError, ClaudiusQuotaExhaustedError,
            )
            # db is the 2nd ctor param — passing ctx.db positionally landed it in
            # `base_url`, then `.rstrip("/")` crashed (Session has no rstrip),
            # making every engine Claudius executor inoperant. Pass by keyword +
            # a usage_type so quota logging isn't silently disabled (CLAUDE.md §5).
            cp = ClaudiusPipelineService(
                db=ctx.db, default_usage_type="ai_flow",
                cache_service=getattr(ctx, "cache_service", None),
            )
        except Exception as e:
            return {"responses": [], "errors": [{"index": 0, "message": str(e)}]}

        # Build request list (cacheable: identical prompt reuses the response).
        requests = []
        for p in prompts:
            if isinstance(p, str):
                requests.append({"system_prompt": "Respond concisely.", "user_prompt": p,
                                 "model": model, "max_tokens": max_tokens, "cacheable": True})
            elif isinstance(p, dict):
                requests.append({
                    "system_prompt": p.get("system") or "Respond concisely.",
                    "user_prompt": p.get("user") or "",
                    "model": p.get("model") or model,
                    "max_tokens": int(p.get("max_tokens", max_tokens)),
                    "cacheable": True,
                })

        try:
            results = await cp.call_batch(requests, max_concurrency=concurrency)
        except ClaudiusQuotaExhaustedError as e:
            if abort_on_quota:
                return {"responses": [], "errors": [{"index": -1, "message": f"quota_exhausted: {e}"}]}
            results = []
        except Exception as e:
            return {"responses": [], "errors": [{"index": -1, "message": f"{type(e).__name__}: {e}"}]}

        responses = []
        errors = []
        for i, r in enumerate(results):
            if isinstance(r, Exception):
                errors.append({"index": i, "message": str(r)})
            else:
                resp_dict = r if isinstance(r, dict) else {"text": str(r)}
                usage = resp_dict.get("usage") or {}
                ctx.tokens_in += int(usage.get("input_tokens", 0) or 0)
                ctx.tokens_out += int(usage.get("output_tokens", 0) or 0)
                responses.append(resp_dict)

        return {"responses": responses, "errors": errors}


@registry.register("quota_probe")
class QuotaProbeExecutor(NodeExecutor):
    """Consulta quota Anthropic via ClaudiusPipelineService.

    Outputs: status (dict), available (bool).
    Config: mode ('status' | 'probe' | 'plan')
    """

    async def execute(self, inputs, config, ctx):
        mode = config.get("mode", "status")
        try:
            from app.services.claudius_pipeline import ClaudiusPipelineService
            # db is the 2nd ctor param — passing ctx.db positionally landed it in
            # `base_url`, then `.rstrip("/")` crashed (Session has no rstrip),
            # making every engine Claudius executor inoperant. Pass by keyword +
            # a usage_type so quota logging isn't silently disabled (CLAUDE.md §5).
            cp = ClaudiusPipelineService(db=ctx.db, default_usage_type="ai_flow")
            if mode == "probe":
                status = await cp.quota_probe()
            elif mode == "plan":
                status = await cp.quota_plan({"requests": 1})
            else:
                status = await cp.quota_status()
            avail = bool(status.get("available") if isinstance(status, dict) else True)
            return {"status": status if isinstance(status, dict) else {}, "available": avail}
        except Exception as e:
            logger.warning(f"quota_probe failed: {e}")
            return {"status": {}, "available": True}  # fail-open


@registry.register("provider_health_check")
class ProviderHealthCheckExecutor(NodeExecutor):
    """Health check do Claudius com retries+backoff.

    Outputs: healthy (bool).
    Config: retries (default 3), backoff ('linear'|'exponential')
    """

    async def execute(self, inputs, config, ctx):
        import asyncio
        retries = int(config.get("retries", 3))
        backoff = config.get("backoff", "exponential")
        try:
            from app.services.claudius_pipeline import ClaudiusPipelineService
            # db is the 2nd ctor param — passing ctx.db positionally landed it in
            # `base_url`, then `.rstrip("/")` crashed (Session has no rstrip),
            # making every engine Claudius executor inoperant. Pass by keyword +
            # a usage_type so quota logging isn't silently disabled (CLAUDE.md §5).
            cp = ClaudiusPipelineService(db=ctx.db, default_usage_type="ai_flow")
            for attempt in range(retries):
                try:
                    ok = await cp.health_check()
                    if ok:
                        return {"healthy": True}
                except Exception:
                    pass
                # backoff
                delay = (2 ** attempt) if backoff == "exponential" else (attempt + 1)
                await asyncio.sleep(min(delay, 15))
            return {"healthy": False}
        except Exception:
            return {"healthy": False}


@registry.register("model_selector")
class ModelSelectorExecutor(NodeExecutor):
    """Escolhe modelo a partir do usage_type via ai_orchestrator.model_selector.

    Inputs: usage_type (string, opcional — usa config).
    Outputs: model (string).
    """

    async def execute(self, inputs, config, ctx):
        usage = inputs.get("usage_type") or config.get("usage_type", "general")
        prefer_chain = bool(config.get("prefer_chain", True))
        try:
            from app.services.ai_orchestrator.model_selector import choose_model
            model_cfg = choose_model(usage_type=usage, db=ctx.db) if prefer_chain else None
            if isinstance(model_cfg, dict):
                return {"model": model_cfg.get("model_id") or "claude-sonnet-4-6"}
        except Exception as e:
            logger.warning(f"model_selector fallback: {e}")
        # fallback: por usage_type comum
        fallbacks = {
            "general":          "claude-sonnet-4-6",
            "interview":        "claude-sonnet-4-6",
            "pattern_discovery":"claude-haiku-4-5",
            "rag_extraction":   "claude-opus-4-7",
            "content_generation":"claude-opus-4-7",
        }
        return {"model": fallbacks.get(usage, "claude-sonnet-4-6")}


@registry.register("token_cost_calculator")
class TokenCostCalculatorExecutor(NodeExecutor):
    """Calcula custo USD a partir de TokenUsage (input/output/model).

    Inputs: usage (dict {input_tokens, output_tokens, model}).
    Outputs: cost (float USD).
    """

    async def execute(self, inputs, config, ctx):
        usage = inputs.get("usage") or {}
        if not isinstance(usage, dict):
            return {"cost": 0.0}
        try:
            from app.utils.pricing import calculate_cost
            cost = calculate_cost(
                input_tokens=int(usage.get("input_tokens", 0) or 0),
                output_tokens=int(usage.get("output_tokens", 0) or 0),
                model=usage.get("model") or "claude-sonnet-4-6",
            )
            if isinstance(cost, dict):
                ctx.cost_usd += float(cost.get("total_cost") or 0.0)
                return {"cost": float(cost.get("total_cost") or 0.0)}
            ctx.cost_usd += float(cost or 0.0)
            return {"cost": float(cost or 0.0)}
        except Exception:
            return {"cost": 0.0}


@registry.register("ai_execution_logger")
class AIExecutionLoggerExecutor(NodeExecutor):
    """Loga AI call em ai_executions table (telemetria).

    Inputs: call (dict {text, thinking, usage}).
    Outputs: logged (bool).
    """
    side_effecting = True

    async def execute(self, inputs, config, ctx):
        call = inputs.get("call") or {}
        if not isinstance(call, dict):
            return {"logged": False}
        try:
            from app.models.ai_execution import AIExecution
            row = AIExecution(
                id=uuid4(),
                provider="claudius",
                model_used=call.get("model") or "unknown",
                input_tokens=int((call.get("usage") or {}).get("input_tokens", 0) or 0),
                output_tokens=int((call.get("usage") or {}).get("output_tokens", 0) or 0),
                # Best-effort — colunas opcionais
            )
            if bool(config.get("include_system_prompt", False)):
                row.prompt = (call.get("system_prompt") or "")[:8000]
            ctx.db.add(row)
            ctx.db.commit()
            return {"logged": True}
        except Exception as e:
            ctx.db.rollback()
            logger.warning(f"ai_execution_logger failed: {e}")
            return {"logged": False}


# ─────────────────────────────────────────────────────────────────────────────
# Specs
# ─────────────────────────────────────────────────────────────────────────────

@registry.register("spec_loader")
class SpecLoaderExecutor(NodeExecutor):
    """Carrega specs (project_specs table) ativos do project.

    Outputs: specs (list de dicts).
    Config: active_only (default True), categories (lista filtro)
    """

    async def execute(self, inputs, config, ctx):
        pid = ctx.project_id or (ctx.project.id if ctx.project else None)
        if not pid:
            return {"specs": []}
        try:
            from app.models.project_spec import ProjectSpec
            q = ctx.db.query(ProjectSpec).filter(ProjectSpec.project_id == pid)
            if bool(config.get("active_only", True)):
                q = q.filter(ProjectSpec.is_active == True)
            cats = config.get("categories") or []
            if cats:
                q = q.filter(ProjectSpec.category.in_(cats))
            specs = q.all()
            return {"specs": [
                {"id": str(s.id), "name": s.name, "category": s.category,
                 "content": s.content, "type": getattr(s, "spec_type", None)}
                for s in specs
            ]}
        except Exception as e:
            logger.warning(f"spec_loader: {e}")
            return {"specs": []}


@registry.register("spec_relevance_filter")
class SpecRelevanceFilterExecutor(NodeExecutor):
    """Filtra specs por keywords (best-effort substring match), limita por categoria.

    Inputs: specs (list), keywords (list opcional).
    Outputs: filtered (list).
    Config: max_per_category (default 3)
    """

    async def execute(self, inputs, config, ctx):
        specs = inputs.get("specs") or []
        keywords = inputs.get("keywords") or []
        if not isinstance(specs, list):
            return {"filtered": []}
        max_per_cat = int(config.get("max_per_category", 3))

        # Score por keyword match (case-insensitive)
        kws_lower = [str(k).lower() for k in keywords if k]
        def _score(spec: dict) -> int:
            if not kws_lower:
                return 0
            text = (str(spec.get("name", "")) + " " + str(spec.get("content", ""))).lower()
            return sum(1 for kw in kws_lower if kw in text)

        scored = sorted(specs, key=lambda s: -_score(s) if isinstance(s, dict) else 0)
        by_cat: dict[str, list] = {}
        for s in scored:
            if not isinstance(s, dict):
                continue
            cat = s.get("category") or "default"
            by_cat.setdefault(cat, [])
            if len(by_cat[cat]) < max_per_cat:
                by_cat[cat].append(s)
        filtered = [s for items in by_cat.values() for s in items]
        return {"filtered": filtered}


# ─────────────────────────────────────────────────────────────────────────────
# Validation helpers (que faltam)
# ─────────────────────────────────────────────────────────────────────────────

@registry.register("local_qa")
class LocalQAExecutor(NodeExecutor):
    """QA heurístico sem AI — scores baseados em counts/distribuição.

    Inputs: artifacts (dict {rules?, cards?, wiki?}).
    Outputs: result (dict {overall_score, breakdown}).
    """

    async def execute(self, inputs, config, ctx):
        art = inputs.get("artifacts") or inputs or {}
        if not isinstance(art, dict):
            return {"result": {"overall_score": 0, "breakdown": {}}}

        weights = config.get("weights") or {"rules": 0.4, "cards": 0.3, "wiki": 0.3}

        # Score por dimensão (heurística: ter > min_count = score alto)
        rules_count = len(art.get("rules") or []) if isinstance(art.get("rules"), list) else int(art.get("rules", 0) or 0)
        cards_count = len(art.get("cards") or []) if isinstance(art.get("cards"), list) else int(art.get("cards", 0) or 0)
        wiki_count  = len(art.get("wiki") or [])  if isinstance(art.get("wiki"), list)  else int(art.get("wiki", 0) or 0)

        def _score(n: int, ideal: int) -> int:
            if n <= 0:
                return 0
            return min(100, int(100 * n / ideal))

        breakdown = {
            "rules": _score(rules_count, 20),
            "cards": _score(cards_count, 30),
            "wiki":  _score(wiki_count, 5),
        }
        overall = sum(breakdown[k] * float(weights.get(k, 0)) for k in breakdown)
        return {"result": {
            "overall_score": int(overall),
            "breakdown": breakdown,
            "counts": {"rules": rules_count, "cards": cards_count, "wiki": wiki_count},
        }}


@registry.register("phase_score_calculator")
class PhaseScoreCalculatorExecutor(NodeExecutor):
    """Calcula score 0-100 de uma phase a partir de dados.

    Inputs: phase_data (dict com counts, quality_indicators).
    Outputs: score (number 0-100).
    """

    async def execute(self, inputs, config, ctx):
        data = inputs.get("phase_data") or inputs or {}
        if not isinstance(data, dict):
            return {"score": 0}
        # Heurística: peso por chave conhecida
        score = 0
        # Tem itens?
        for key, weight in [("rules", 30), ("cards", 30), ("epics", 20), ("stories", 10), ("pages", 10)]:
            v = data.get(key)
            if isinstance(v, list) and v:
                score += min(weight, len(v) * 2)
            elif isinstance(v, int) and v > 0:
                score += min(weight, v * 2)
        # Tem QA pass?
        if data.get("qa_passed") or data.get("valid"):
            score = min(100, score + 10)
        return {"score": min(100, score)}


# ─────────────────────────────────────────────────────────────────────────────
# Observability
# ─────────────────────────────────────────────────────────────────────────────

@registry.register("telemetry_emitter")
class TelemetryEmitterExecutor(NodeExecutor):
    """Emite evento de telemetria (WS broadcast + log).

    Inputs: event (dict — payload arbitrário).
    Outputs: emitted (bool).
    Config: sinks (list — informational; sempre vai WS e log)
    """
    side_effecting = True

    async def execute(self, inputs, config, ctx):
        event = inputs.get("event") if "event" in inputs else (inputs or {})
        if not isinstance(event, dict):
            event = {"value": event}
        sinks = config.get("sinks") or ["ws", "log"]
        # WS via ws_emit
        if "ws" in sinks:
            await ctx.emit("telemetry_event", {
                "run_id": str(ctx.run_id),
                **event,
            })
        if "log" in sinks:
            logger.info(f"[telemetry] {event}")
        return {"emitted": True}


# ─────────────────────────────────────────────────────────────────────────────
# Legacy utility nodes — implementações simples
# ─────────────────────────────────────────────────────────────────────────────

@registry.register("cache")
class CacheExecutor(NodeExecutor):
    """In-memory cache check (passa-direto se miss).
    Inputs: key. Outputs: hit (bool), value (Any).
    """
    _CACHE: dict[str, Any] = {}

    async def execute(self, inputs, config, ctx):
        key = str(inputs.get("key") or "")
        if not key:
            return {"hit": False, "value": None}
        v = self._CACHE.get(key)
        return {"hit": v is not None, "value": v}


@registry.register("rag_context")
class RAGContextExecutor(NodeExecutor):
    """RAG retrieval formatado pra prompt (texto único concatenado).
    Inputs: query. Outputs: context (string).
    Config: top_k (default 5), max_chars (default 3000)
    """

    async def execute(self, inputs, config, ctx):
        query = inputs.get("query") or ""
        if not isinstance(query, str) or not query.strip():
            return {"context": ""}
        try:
            from app.services.rag_service import RAGService
            rag = RAGService(ctx.db)
            docs = rag.retrieve(query=query, top_k=int(config.get("top_k", 5)))
            chunks = []
            for d in docs or []:
                if isinstance(d, dict):
                    chunks.append(d.get("content") or d.get("text") or "")
            text = "\n\n".join(c for c in chunks if c)
            max_chars = int(config.get("max_chars", 3000))
            return {"context": text[:max_chars]}
        except Exception as e:
            # NOT silent: a RAG failure (table missing, Ollama down, timeout)
            # would otherwise leave the downstream LLM with no context and no
            # trace — the §1(A) fail-silent anti-pattern. Log it; the sibling
            # rag_query executor raises, this one degrades but at least records.
            logger.error("rag_context retrieve failed (returning empty context): %s", e)
            return {"context": "", "_rag_error": str(e)}


@registry.register("router")
class RouterExecutor(NodeExecutor):
    """Roteamento simples — apenas marca a rota escolhida.
    Inputs: payload. Outputs: route (string).
    Config: condition (path string), default_route
    """

    async def execute(self, inputs, config, ctx):
        # Heurística minimal: usa primeiro valor ou retorna 'default'
        payload = inputs.get("payload") if "payload" in inputs else (
            next(iter(inputs.values())) if inputs else None
        )
        if isinstance(payload, dict):
            route = payload.get("route") or payload.get("kind") or config.get("default_route", "default")
        else:
            route = config.get("default_route", "default")
        return {"route": str(route)}


@registry.register("retry")
class RetryExecutor(NodeExecutor):
    """Pass-through — semântica de retry executada pelo engine, não pelo node.
    No futuro, refactor: GraphExecutor entende retry envolvendo um sub-graph.
    """

    async def execute(self, inputs, config, ctx):
        result = inputs.get("operation") if "operation" in inputs else (
            next(iter(inputs.values())) if inputs else None
        )
        return {"result": result, "error": None}


@registry.register("validator")
class ValidatorExecutor(NodeExecutor):
    """Validação genérica (truthy check)."""

    async def execute(self, inputs, config, ctx):
        payload = inputs.get("payload") if "payload" in inputs else (
            next(iter(inputs.values())) if inputs else None
        )
        return {"valid": bool(payload)}


@registry.register("cost_guard")
class CostGuardExecutor(NodeExecutor):
    """Verifica se custo cumulativo está abaixo do budget configurado.
    Inputs: cost. Outputs: allowed (bool).
    Config: max_cost_per_call (default 0.10), daily_budget (default 10.0)
    """

    async def execute(self, inputs, config, ctx):
        cost = inputs.get("cost") if "cost" in inputs else (
            next(iter(inputs.values())) if inputs else 0
        )
        try:
            c = float(cost or 0)
        except (TypeError, ValueError):
            c = 0
        max_call = float(config.get("max_cost_per_call", 0.10))
        daily = float(config.get("daily_budget", 10.0))
        allowed = c <= max_call and ctx.cost_usd <= daily
        return {"allowed": allowed}


@registry.register("rate_limiter")
class RateLimiterExecutor(NodeExecutor):
    """Pass-through (rate limiting real é responsabilidade do Claudius layer).
    Outputs: allowed (sempre True nesta versão).
    """

    async def execute(self, inputs, config, ctx):
        return {"allowed": True}


@registry.register("timeout")
class TimeoutExecutor(NodeExecutor):
    """Pass-through (engine usa asyncio.wait_for em runs longos).
    Outputs: result, timed_out (False).
    """

    async def execute(self, inputs, config, ctx):
        result = inputs.get("operation") if "operation" in inputs else (
            next(iter(inputs.values())) if inputs else None
        )
        return {"result": result, "timed_out": False}


@registry.register("prompt_transformer")
class PromptTransformerExecutor(NodeExecutor):
    """Transforma prompt: compress (resume input) ou enrich (adiciona context).
    Inputs: prompt. Outputs: prompt.
    Config: transformation ('compress'|'enrich'|'noop'), max_tokens
    """

    async def execute(self, inputs, config, ctx):
        prompt = inputs.get("prompt") if "prompt" in inputs else (
            next(iter(inputs.values())) if inputs else None
        )
        mode = config.get("transformation", "noop")
        if mode == "compress" and isinstance(prompt, dict):
            user = prompt.get("user") or ""
            max_chars = int(config.get("max_tokens", 4000)) * 4
            if len(user) > max_chars:
                prompt = {**prompt, "user": user[:max_chars] + "…"}
        return {"prompt": prompt}


@registry.register("job_child_creator")
class JobChildCreatorExecutor(NodeExecutor):
    """Cria child AsyncJob como filho do current run job.

    Inputs: parent_job (não usado — usa ctx.job_id), payload (dict).
    Outputs: job_id (string).
    Config: job_type (string), phase_label (string opcional)
    """
    side_effecting = True

    async def execute(self, inputs, config, ctx):
        if not ctx.job_id:
            return {"job_id": ""}
        payload = inputs.get("payload") or {}
        if not isinstance(payload, dict):
            payload = {"value": payload}

        job_type_str = config.get("job_type") or "generic"
        try:
            from app.models.async_job import JobType, AsyncJob
            from app.services.job_manager import JobManager
            try:
                jt = JobType(job_type_str)
            except ValueError:
                jt = JobType.AI_FLOW_RUN  # fallback
            jm = JobManager(ctx.db)
            job = jm.create_job(
                job_type=jt,
                input_data={**payload, "parent_run_id": str(ctx.run_id)},
                project_id=ctx.project_id,
                parent_job_id=ctx.job_id,
                phase_label=config.get("phase_label"),
            )
            return {"job_id": str(job.id)}
        except Exception as e:
            logger.warning(f"job_child_creator failed: {e}")
            return {"job_id": ""}


__all__ = [
    "FileTypeClassifierExecutor",
    "SemanticLayerClassifierExecutor",
    "ChangeDetectorExecutor",
    "DomainGrouperExecutor",
    "EpicDeduplicatorExecutor",
    "CardHierarchyBuilderExecutor",
    "TextChunkerExecutor",
    "GitCommitFetcherExecutor",
    "PromptContextCompressorExecutor",
    "ClaudiusBatchCallExecutor",
    "QuotaProbeExecutor",
    "ProviderHealthCheckExecutor",
    "ModelSelectorExecutor",
    "TokenCostCalculatorExecutor",
    "AIExecutionLoggerExecutor",
    "SpecLoaderExecutor",
    "SpecRelevanceFilterExecutor",
    "LocalQAExecutor",
    "PhaseScoreCalculatorExecutor",
    "TelemetryEmitterExecutor",
    "JobChildCreatorExecutor",
]
