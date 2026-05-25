"""
AI Flow Chain API Router
PROMPT #122 - AI Flow: Visual Fallback Chain Configuration
PROMPT #124 - Metrics, Animation, Analytics & Smart Reorder

CRUD operations for managing per-usage_type AI model fallback chains,
plus analytics, metrics, and smart optimization endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func, case, and_
from typing import List, Optional
from datetime import datetime, timedelta
from uuid import uuid4, UUID

from app.database import get_db
from app.models.ai_model import AIModel, AIModelUsageType
from app.models.ai_flow_chain import AIFlowChain
from app.models.ai_execution import AIExecution
from app.utils.pricing import calculate_cost, get_model_pricing
from app.models.ai_flow_profile import AIFlowProfile
from app.schemas.ai_flow_chain import (
    AIFlowChainBase,
    AIFlowChainCreate,
    AIFlowChainResponse,
    AIFlowChainWithModels,
    ModelMetrics,
    ModelMetricsResponse,
    ChainModelStats,
    ChainAnalyticsItem,
    ChainAnalyticsResponse,
    OptimizeChainRequest,
    OptimizeChainResponse,
    OptimizeModelScore,
    ChainTemplate,
    ChainTemplatesResponse,
    UTILITY_NODE_TYPES,
    AIFlowProfileCreate,
    AIFlowProfileUpdate,
    AIFlowProfileResponse,
)

import logging

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================================
# v3.0 Canvas Snapshot — full project view for the unified AI Studio canvas
# ============================================================================

# Deep Pipeline phase catalog (mirrors what runs in deep_pipeline/service.py).
# Each entry: (phase_key, label, default_model_id, description).
DEEP_PIPELINE_PHASES = [
    ("phase_0",  "Phase 0 — Structural scan",      None,                 "Filesystem scan (sem AI)"),
    ("phase_1",  "Phase 1 — File analysis",        "claude-haiku-4-5",   "Análise per-file batched"),
    ("phase_2",  "Phase 2 — Rule synthesis",       "claude-sonnet-4-6",  "Síntese cross-file por domínio"),
    ("phase_3",  "Phase 3 — Architectural map",    "claude-sonnet-4-6",  "Mapa arquitetural (extended thinking)"),
    ("phase_4a", "Phase 4a — Epics",               "claude-opus-4-7",    "Geração de Epics por domínio"),
    ("phase_4b", "Phase 4b — Stories",             "claude-opus-4-7",    "Decomposição em Stories"),
    ("phase_4c", "Phase 4c — Tasks",               "claude-sonnet-4-6",  "Decomposição em Tasks"),
    ("phase_5",  "Phase 5 — Wiki",                 "claude-sonnet-4-6",  "Wiki multi-page (overview/domínio/fluxos)"),
    ("phase_6",  "Phase 6 — QA",                   "claude-sonnet-4-6",  "Quality assurance (extended thinking)"),
]



# v3.1 — Deep Pipeline grouped into 4 logical subflows for the canvas root.
DEEP_PIPELINE_GROUPS = [
    {"id": "discovery", "label": "Discovery",
     "phase_keys": ["phase_0", "phase_1", "phase_2", "phase_3"], "order": 0},
    {"id": "cards",     "label": "Cards",
     "phase_keys": ["phase_4a", "phase_4b", "phase_4c"], "order": 1},
    {"id": "wiki",      "label": "Wiki",
     "phase_keys": ["phase_5"], "order": 2},
    {"id": "qa",        "label": "QA",
     "phase_keys": ["phase_6"], "order": 3},
]


def _merge_phase_configs(profile_phase_configs: dict, fallback_phases: list) -> dict:
    """Merge a pipeline_profile.phase_configs jsonb with the DEEP_PIPELINE_PHASES
    fallback so the snapshot always renders every phase, even if the profile
    doesn't cover all of them."""
    merged: dict = {}
    for key, label, default_model, description in fallback_phases:
        entry = {
            "label": label,
            "description": description,
            "model": default_model,
        }
        if profile_phase_configs and key in profile_phase_configs:
            user_cfg = profile_phase_configs[key] or {}
            if isinstance(user_cfg, dict):
                entry.update(user_cfg)
                # If profile sets model, prefer that
                if user_cfg.get("model"):
                    entry["model"] = user_cfg["model"]
        merged[key] = entry
    return merged


@router.get("/canvas-snapshot")
async def get_canvas_snapshot(db: Session = Depends(get_db)):
    """Return the full project's AI configuration as a ReactFlow-compatible
    snapshot for the v3.1 unified canvas.

    Root tab "Canvas" shows:
      - 4 SubflowNodes (Discovery → Cards → Wiki → QA), wired sequentially
      - 10 ModelNodes (3 columns: Opus / Sonnet / Haiku) with usage_type badges
      - Edges between consecutive subflows in canonical order

    Each subflow exposes its phase nodes when opened in a tab on the frontend.
    The canvas IS the Deep Pipeline — there's no separate "Deep Pipeline" subflow.
    Other chains (interview, prompt_generation, ...) appear as badges on
    ModelNodes — no extra subflows for single-model chains.
    """
    from app.models.ai_model import AIModel
    from app.models.ai_flow_chain import AIFlowChain
    from app.models.pipeline_profile import PipelineProfile

    models = db.query(AIModel).filter(AIModel.is_active == True).all()
    chains = db.query(AIFlowChain).filter(AIFlowChain.is_active == True).all()
    # Default pipeline profile (canvas-owned). Falls back to DEEP_PIPELINE_PHASES.
    profile = (
        db.query(PipelineProfile)
        .filter(PipelineProfile.is_default == True)
        .first()
    )
    profile_phase_configs = (profile.phase_configs if profile else {}) or {}
    phase_catalog = _merge_phase_configs(profile_phase_configs, DEEP_PIPELINE_PHASES)

    # Build usage_type → list of model_ids (chain[0] is the primary)
    usage_to_model_pks: dict[str, list[str]] = {}
    for ch in chains:
        usage = ch.usage_type.value if hasattr(ch.usage_type, "value") else str(ch.usage_type)
        usage_to_model_pks[usage] = [str(mid) for mid in (ch.chain or [])]
    model_pk_to_usages: dict[str, list[str]] = {}
    for usage, pks in usage_to_model_pks.items():
        for pk in pks:
            model_pk_to_usages.setdefault(pk, []).append(usage)

    nodes: list[dict] = []
    edges: list[dict] = []
    subflows: dict[str, dict] = {}

    # Build a lookup of AIModel by model_id (config.model_id) so each phase
    # can resolve its assigned model to a label/PK for the inner ModelNode.
    model_by_id: dict[str, "AIModel"] = {}
    for m in models:
        mid = (m.config or {}).get("model_id")
        if mid and mid not in model_by_id:
            model_by_id[mid] = m

    # ── 1. Subflow nodes (4 grupos do Deep Pipeline) on the root ────────
    SUBFLOW_X = 280
    SUBFLOW_Y_BASE = 80
    SUBFLOW_GAP = 130
    prev_sf_node_id: str | None = None
    # Internal layout (per subflow tab): each phase becomes a trio
    # [Entrada] → [Modelo] → [Saída], stacked vertically (one row per phase).
    PHASE_ROW_Y_BASE = 80
    PHASE_ROW_GAP = 200
    TRIO_X_IN = 80
    TRIO_X_MODEL = 360
    TRIO_X_OUT = 640
    for idx, group in enumerate(DEEP_PIPELINE_GROUPS):
        sf_node_id = f"sf-{group['id']}"
        group_phase_keys = group["phase_keys"]

        # v3.3: each phase is rendered INSIDE its subflow tab as a trio
        # of nodes — [Entrada] → [Modelo do catálogo] → [Saída].
        inner_node_ids: list[str] = []
        for p_idx, pk in enumerate(group_phase_keys):
            phase = phase_catalog.get(pk, {})
            phase_label = phase.get("label") or pk
            assigned_model_id = phase.get("model")  # e.g. "claude-sonnet-4-6"
            ai_model = model_by_id.get(assigned_model_id) if assigned_model_id else None
            row_y = PHASE_ROW_Y_BASE + p_idx * PHASE_ROW_GAP

            in_id = f"phase-{pk}-in"
            model_id_node = f"phase-{pk}-model"
            out_id = f"phase-{pk}-out"

            # [Entrada]
            nodes.append({
                "id": in_id,
                "type": "ioNode",
                "position": {"x": TRIO_X_IN, "y": row_y},
                "data": {
                    "label": f"Entrada — {phase_label}",
                    "io_kind": "input",
                    "phase_key": pk,
                    "group_id": group["id"],
                },
            })
            # [Modelo] (the configured model for this phase)
            nodes.append({
                "id": model_id_node,
                "type": "modelNode",
                "position": {"x": TRIO_X_MODEL, "y": row_y},
                "data": {
                    "label": ai_model.name if ai_model else (assigned_model_id or "(sem modelo)"),
                    "provider": "claudius",
                    "config": (ai_model.config if ai_model else {"model_id": assigned_model_id}) or {},
                    "model_id": assigned_model_id,
                    "ai_model_id": str(ai_model.id) if ai_model else None,
                    "phase_key": pk,
                    "group_id": group["id"],
                    "description": phase.get("description"),
                    "animation": "idle",
                },
            })
            # [Saída]
            nodes.append({
                "id": out_id,
                "type": "ioNode",
                "position": {"x": TRIO_X_OUT, "y": row_y},
                "data": {
                    "label": f"Saída — {phase_label}",
                    "io_kind": "output",
                    "phase_key": pk,
                    "group_id": group["id"],
                },
            })
            inner_node_ids.extend([in_id, model_id_node, out_id])
            # Trio edges: in → model → out
            edges.append({
                "id": f"edge-{in_id}-{model_id_node}",
                "source": in_id, "target": model_id_node,
                "type": "smartEdge",
                "style": {"stroke": "#0891b2", "strokeWidth": 1.6},
                "data": {"port_type": "trio_in"},
            })
            edges.append({
                "id": f"edge-{model_id_node}-{out_id}",
                "source": model_id_node, "target": out_id,
                "type": "smartEdge",
                "style": {"stroke": "#0891b2", "strokeWidth": 1.6},
                "data": {"port_type": "trio_out"},
            })
            # Sequence between phases: previous out → next in
            if p_idx > 0:
                prev_pk = group_phase_keys[p_idx - 1]
                edges.append({
                    "id": f"edge-seq-{prev_pk}-{pk}",
                    "source": f"phase-{prev_pk}-out",
                    "target": in_id,
                    "type": "smartEdge",
                    "style": {"stroke": "#3b82f6", "strokeWidth": 1.8, "strokeDasharray": "4 4"},
                    "data": {"port_type": "phase_sequence", "label": "then"},
                })

        subflows[group["id"]] = {
            "label": group["label"],
            "node_ids": inner_node_ids,
            "position": {"x": SUBFLOW_X, "y": SUBFLOW_Y_BASE + idx * SUBFLOW_GAP},
            "collapsed": True,
            "kind": "deep_pipeline_group",
            "order": group["order"],
            "phase_keys": group_phase_keys,
        }
        # SubflowNode (visible on root)
        nodes.append({
            "id": sf_node_id,
            "type": "subflowNode",
            "position": {"x": SUBFLOW_X, "y": SUBFLOW_Y_BASE + idx * SUBFLOW_GAP},
            "data": {
                "label": group["label"],
                "collapsed": True,
                "node_count": len(group_phase_keys),  # show #phases, not #inner nodes
                "kind": "deep_pipeline_group",
                "group_id": group["id"],
                "phase_keys": group_phase_keys,
            },
        })
        # Wire root subflows sequentially: Discovery → Cards → Wiki → QA
        if prev_sf_node_id is not None:
            edges.append({
                "id": f"edge-sf-{prev_sf_node_id}-{sf_node_id}",
                "source": prev_sf_node_id,
                "target": sf_node_id,
                "type": "smartEdge",
                "style": {"stroke": "#3b82f6", "strokeWidth": 2},
                "data": {"label": "then", "port_type": "subflow_sequence"},
            })
        prev_sf_node_id = sf_node_id

    # ── 3. Model catalog — sidebar items (NOT on the canvas).
    # v3.2: models live in the left sidebar. They become canvas nodes only
    # when the user drags them in (frontend creates a node with this template).
    catalog_models: list[dict] = []
    for m in models:
        cfg = m.config or {}
        mid = cfg.get("model_id") or "claude-sonnet-4-6"
        primary_usage = (m.usage_type.value if hasattr(m.usage_type, "value") else str(m.usage_type))
        usage_badges = list({primary_usage, *model_pk_to_usages.get(str(m.id), [])})
        catalog_models.append({
            "id": f"model-{m.id}",
            "type": "modelNode",
            "data": {
                "label": m.name,
                "provider": "claudius",
                "config": cfg,
                "rate_limit_requests": m.rate_limit_requests,
                "timeout_seconds": m.timeout_seconds,
                "model_id": mid,
                "usage_type": primary_usage,
                "usage_badges": sorted(usage_badges),
                "ai_model_id": str(m.id),
            },
        })

    # Utility node templates (drag from sidebar to add to canvas)
    catalog_utilities = [
        {"id": "util-cache",              "type": "cacheNode",            "data": {"label": "Cache",         "type": "cache",              "config": {}, "enabled": True}},
        {"id": "util-rag_context",        "type": "ragContextNode",       "data": {"label": "RAG Context",   "type": "rag_context",        "config": {}, "enabled": True}},
        {"id": "util-router",             "type": "routerNode",           "data": {"label": "Router",        "type": "router",             "config": {}, "enabled": True}},
        {"id": "util-retry",              "type": "retryNode",            "data": {"label": "Retry",         "type": "retry",              "config": {"max_retries": 3, "backoff_base_ms": 1000}, "enabled": True}},
        {"id": "util-validator",          "type": "validatorNode",        "data": {"label": "Validator",     "type": "validator",          "config": {}, "enabled": True}},
        {"id": "util-cost_guard",         "type": "costGuardNode",        "data": {"label": "Cost Guard",    "type": "cost_guard",         "config": {}, "enabled": True}},
        {"id": "util-rate_limiter",       "type": "rateLimiterNode",      "data": {"label": "Rate Limiter",  "type": "rate_limiter",       "config": {}, "enabled": True}},
        {"id": "util-timeout",            "type": "timeoutNode",          "data": {"label": "Timeout",       "type": "timeout",            "config": {"timeout_seconds": 120}, "enabled": True}},
        {"id": "util-prompt_transformer", "type": "promptTransformerNode","data": {"label": "Prompt Xform",  "type": "prompt_transformer", "config": {}, "enabled": True}},
    ]

    return {
        "nodes": nodes,
        "edges": edges,
        "subflows": subflows,
        # v3.2 — sidebar catalog (left top section, draggable into canvas)
        "catalog": {
            "models": catalog_models,
            "utilities": catalog_utilities,
        },
        "meta": {
            "model_count": len(models),
            "chain_count": len(chains),
            "phase_count": len(DEEP_PIPELINE_PHASES),
            "group_count": len(DEEP_PIPELINE_GROUPS),
            "profile_id": str(profile.id) if profile else None,
            "profile_name": profile.name if profile else None,
        },
    }


# Backward-compat: keep DEEP_PIPELINE_PHASES exported for callers
DEEP_PIPELINE_PHASES_FALLBACK = DEEP_PIPELINE_PHASES


@router.post("/canvas-save")
async def canvas_save(payload: dict, db: Session = Depends(get_db)):
    """Persist the unified canvas state.

    Payload:
      {
        "models": [ { ai_model_id, name?, config?, rate_limit_requests?, timeout_seconds? } ],
        "phase_configs": { phase_key: { model?, max_tokens?, ... } },
        "chain_overrides": { usage_type: [model_id1, model_id2, ...] }?,
        "subflows": { ... },
        "node_positions": { node_id: {x, y} }?
      }

    Returns counts of what was applied.
    """
    from app.models.ai_model import AIModel
    from app.models.pipeline_profile import PipelineProfile
    from datetime import datetime as _dt

    payload = payload or {}
    models_payload = payload.get("models") or []
    phase_configs_payload = payload.get("phase_configs") or {}
    chain_overrides = payload.get("chain_overrides") or {}

    models_updated = 0
    model_errors: list[str] = []

    # 1) Patch per-model edits
    for entry in models_payload:
        aid = entry.get("ai_model_id")
        if not aid:
            continue
        try:
            m = db.query(AIModel).filter(AIModel.id == aid).first()
            if not m:
                model_errors.append(f"model {aid} not found")
                continue
            if "name" in entry and entry["name"]:
                m.name = entry["name"]
            if "config" in entry and isinstance(entry["config"], dict):
                # Validate model_id whitelist (v2.5)
                mid = (entry["config"].get("model_id") or "").strip()
                if mid and mid not in {"claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"}:
                    model_errors.append(f"model {aid} invalid model_id={mid}")
                    continue
                m.config = entry["config"]
            if "rate_limit_requests" in entry and entry["rate_limit_requests"] is not None:
                m.rate_limit_requests = int(entry["rate_limit_requests"])
            if "timeout_seconds" in entry and entry["timeout_seconds"] is not None:
                m.timeout_seconds = int(entry["timeout_seconds"])
            m.updated_at = _dt.utcnow()
            models_updated += 1
        except Exception as e:
            model_errors.append(f"model {aid}: {type(e).__name__}: {str(e)[:80]}")

    try:
        db.commit()
    except Exception:
        db.rollback()

    # 2) UPSERT pipeline profile "Canvas" (default)
    profile_updated = False
    profile_id = None
    if phase_configs_payload:
        try:
            existing = (
                db.query(PipelineProfile)
                .filter(PipelineProfile.name == "Canvas")
                .first()
            )
            if existing:
                # Merge with current phase_configs (preserve unknown keys)
                merged = dict(existing.phase_configs or {})
                for pk, cfg in phase_configs_payload.items():
                    if isinstance(cfg, dict):
                        merged[pk] = {**(merged.get(pk) or {}), **cfg}
                existing.phase_configs = merged
                existing.updated_at = _dt.utcnow()
                # Ensure it's the default (mark others as non-default in same tx)
                db.query(PipelineProfile).filter(
                    PipelineProfile.id != existing.id,
                    PipelineProfile.is_default == True,
                ).update({"is_default": False})
                existing.is_default = True
                profile_id = str(existing.id)
                profile_updated = True
            else:
                # Demote any current default
                db.query(PipelineProfile).filter(
                    PipelineProfile.is_default == True,
                ).update({"is_default": False})
                from uuid import uuid4 as _uuid4
                new_profile = PipelineProfile(
                    id=_uuid4(),
                    name="Canvas",
                    description="Auto-managed by the AI Studio canvas",
                    phase_configs=phase_configs_payload,
                    quality_threshold=70,
                    is_default=True,
                    created_at=_dt.utcnow(),
                    updated_at=_dt.utcnow(),
                )
                db.add(new_profile)
                db.flush()
                profile_id = str(new_profile.id)
                profile_updated = True
            db.commit()
        except Exception as e:
            db.rollback()
            model_errors.append(f"pipeline_profile: {type(e).__name__}: {str(e)[:80]}")

    # 3) chain_overrides (per usage_type) — UPSERT in ai_flow_chains
    chains_updated = 0
    if chain_overrides:
        from app.models.ai_flow_chain import AIFlowChain
        from app.models.ai_model import AIModelUsageType
        for usage, model_pks in chain_overrides.items():
            try:
                # Normalize usage_type to enum value (string)
                if not isinstance(model_pks, list):
                    continue
                model_pks = [str(x) for x in model_pks if x]
                ch = (
                    db.query(AIFlowChain)
                    .filter(AIFlowChain.usage_type == usage)
                    .first()
                )
                if ch:
                    ch.chain = model_pks
                    ch.updated_at = _dt.utcnow()
                else:
                    from uuid import uuid4 as _uuid4
                    ch = AIFlowChain(
                        id=_uuid4(),
                        usage_type=AIModelUsageType(usage),
                        chain=model_pks,
                        is_active=True,
                        created_at=_dt.utcnow(),
                        updated_at=_dt.utcnow(),
                    )
                    db.add(ch)
                chains_updated += 1
            except Exception as e:
                model_errors.append(f"chain {usage}: {type(e).__name__}: {str(e)[:80]}")
        try:
            db.commit()
        except Exception:
            db.rollback()

    return {
        "models_updated": models_updated,
        "profile_updated": profile_updated,
        "profile_id": profile_id,
        "chains_updated": chains_updated,
        "errors": model_errors,
    }




# ============================================================================
# PROMPT #122 - Chain CRUD
# ============================================================================

def _resolve_chain_models(db: Session, chain_ids: List[str]) -> List[dict]:
    """Resolve list of model UUIDs to full model objects for frontend display."""
    models = []
    for model_id in chain_ids:
        model = db.query(AIModel).filter(AIModel.id == model_id).first()
        if model:
            models.append({
                "id": str(model.id),
                "name": model.name,
                "provider": model.provider,
                "usage_type": model.usage_type.value if hasattr(model.usage_type, "value") else model.usage_type,
                "is_active": model.is_active,
                "config": model.config or {},
                "rate_limit_requests": model.rate_limit_requests,
                "rate_limit_window_seconds": model.rate_limit_window_seconds,
            })
        else:
            models.append({
                "id": model_id,
                "name": "Desconhecido (excluido)",
                "provider": "unknown",
                "usage_type": "general",
                "is_active": False,
                "config": {},
                "rate_limit_requests": None,
                "rate_limit_window_seconds": None,
            })
    return models


def _chain_to_dict(chain: AIFlowChain, models: List[dict]) -> dict:
    return {
        "id": chain.id,
        "usage_type": chain.usage_type.value if hasattr(chain.usage_type, "value") else chain.usage_type,
        "chain": chain.chain,
        "node_positions": chain.node_positions,
        "utility_nodes": chain.utility_nodes,
        "is_active": chain.is_active,
        "created_at": chain.created_at,
        "updated_at": chain.updated_at,
        "models": models,
    }


@router.get("/chains", response_model=List[AIFlowChainWithModels])
async def list_chains(db: Session = Depends(get_db)):
    """List all flow chains with their associated model details."""
    chains = db.query(AIFlowChain).order_by(AIFlowChain.usage_type).all()
    result = []
    for chain in chains:
        models = _resolve_chain_models(db, chain.chain or [])
        result.append(_chain_to_dict(chain, models))
    return result


@router.get("/chains/{usage_type}", response_model=AIFlowChainWithModels)
async def get_chain(usage_type: AIModelUsageType, db: Session = Depends(get_db)):
    """Get chain for specific usage_type."""
    chain = db.query(AIFlowChain).filter(AIFlowChain.usage_type == usage_type).first()
    if not chain:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Nenhuma cadeia configurada para o tipo de uso '{usage_type.value}'",
        )
    models = _resolve_chain_models(db, chain.chain or [])
    return _chain_to_dict(chain, models)


@router.put("/chains/{usage_type}", response_model=AIFlowChainResponse)
async def upsert_chain(
    usage_type: AIModelUsageType,
    data: AIFlowChainBase,
    db: Session = Depends(get_db),
):
    """Create or update chain for a usage_type (upsert)."""
    for model_id in data.chain:
        model = db.query(AIModel).filter(AIModel.id == model_id).first()
        if not model:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Modelo de IA '{model_id}' não encontrado",
            )

    existing = db.query(AIFlowChain).filter(AIFlowChain.usage_type == usage_type).first()

    if existing:
        existing.chain = data.chain
        existing.node_positions = data.node_positions
        existing.utility_nodes = data.utility_nodes
        existing.is_active = data.is_active
        existing.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(existing)
        return existing
    else:
        new_chain = AIFlowChain(
            id=uuid4(),
            usage_type=usage_type,
            chain=data.chain,
            node_positions=data.node_positions,
            utility_nodes=data.utility_nodes,
            is_active=data.is_active,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(new_chain)
        db.commit()
        db.refresh(new_chain)
        return new_chain


@router.delete("/chains/{usage_type}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chain(usage_type: AIModelUsageType, db: Session = Depends(get_db)):
    """Delete chain for a usage_type."""
    chain = db.query(AIFlowChain).filter(AIFlowChain.usage_type == usage_type).first()
    if not chain:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Nenhuma cadeia configurada para o tipo de uso '{usage_type.value}'",
        )
    db.delete(chain)
    db.commit()
    return None


# ============================================================================
# PROMPT #124 - Feature 1: Model Metrics
# ============================================================================

@router.get("/model-metrics", response_model=ModelMetricsResponse)
async def get_model_metrics(
    model_ids: str = Query(..., description="Comma-separated model UUIDs"),
    days: int = Query(7, description="Lookback window in days"),
    db: Session = Depends(get_db),
):
    """Get execution metrics for specific models (health, success rate, latency, cost)."""
    uuid_list = [uid.strip() for uid in model_ids.split(",") if uid.strip()]
    cutoff = datetime.utcnow() - timedelta(days=days)

    results = db.query(
        AIExecution.ai_model_id,
        AIExecution.model_name,
        AIExecution.provider,
        func.count(AIExecution.id).label("total"),
        func.count(case((AIExecution.error_message.is_(None), 1))).label("successes"),
        func.count(case((AIExecution.error_message.isnot(None), 1))).label("failures"),
        func.avg(AIExecution.execution_time_ms).label("avg_latency"),
        func.sum(AIExecution.input_tokens).label("sum_input"),
        func.sum(AIExecution.output_tokens).label("sum_output"),
        func.max(AIExecution.created_at).label("last_exec"),
        func.count(case((AIExecution.chain_position > 1, 1))).label("fallback_count"),
    ).filter(
        AIExecution.ai_model_id.in_([UUID(uid) for uid in uuid_list]),
        AIExecution.created_at >= cutoff,
    ).group_by(
        AIExecution.ai_model_id,
        AIExecution.model_name,
        AIExecution.provider,
    ).all()

    metrics_list = []
    for row in results:
        total = row.total or 0
        successes = row.successes or 0
        success_rate = (successes / total * 100) if total > 0 else 100.0

        if success_rate >= 95:
            health = "green"
        elif success_rate >= 80:
            health = "yellow"
        else:
            health = "red"

        sum_input = row.sum_input or 0
        sum_output = row.sum_output or 0
        model_name = row.model_name or ""
        cost_info = calculate_cost(sum_input, sum_output, model_name)
        avg_cost = cost_info["total_cost"] / total if total > 0 else 0.0

        metrics_list.append(ModelMetrics(
            model_id=str(row.ai_model_id),
            model_name=model_name,
            provider=row.provider or "",
            total_executions=total,
            successful_executions=successes,
            failed_executions=row.failures or 0,
            success_rate=round(success_rate, 1),
            health=health,
            avg_latency_ms=round(row.avg_latency or 0, 1),
            avg_cost_per_call=round(avg_cost, 6),
            last_execution_at=row.last_exec,
            fallback_count=row.fallback_count or 0,
        ))

    # Add empty metrics for models with no executions
    found_ids = {m.model_id for m in metrics_list}
    for uid in uuid_list:
        if uid not in found_ids:
            model = db.query(AIModel).filter(AIModel.id == UUID(uid)).first()
            metrics_list.append(ModelMetrics(
                model_id=uid,
                model_name=model.name if model else "Unknown",
                provider=model.provider if model else "unknown",
            ))

    return ModelMetricsResponse(metrics=metrics_list, lookback_days=days)


# ============================================================================
# PROMPT #124 - Feature 3: Chain Analytics
# ============================================================================

@router.get("/chain-analytics", response_model=ChainAnalyticsResponse)
async def get_chain_analytics(
    usage_type: Optional[str] = Query(None, description="Filter by usage_type"),
    days: int = Query(30, description="Lookback window in days"),
    db: Session = Depends(get_db),
):
    """Get chain execution analytics: fallback rates, costs, failing models."""
    cutoff = datetime.utcnow() - timedelta(days=days)

    base_filter = [
        AIExecution.chain_usage_type.isnot(None),
        AIExecution.created_at >= cutoff,
    ]
    if usage_type:
        base_filter.append(AIExecution.usage_type == usage_type)

    # Per usage_type aggregation
    usage_stats = db.query(
        AIExecution.usage_type,
        func.count(AIExecution.id).label("total"),
        func.count(case((and_(AIExecution.chain_fallback == True, AIExecution.error_message.is_(None)), 1))).label("fallback_successes"),
        func.avg(AIExecution.chain_position).label("avg_depth"),
        func.sum(AIExecution.input_tokens).label("sum_input"),
        func.sum(AIExecution.output_tokens).label("sum_output"),
    ).filter(*base_filter).group_by(AIExecution.usage_type).all()

    # Per model aggregation
    model_stats = db.query(
        AIExecution.usage_type,
        AIExecution.ai_model_id,
        AIExecution.model_name,
        AIExecution.provider,
        func.count(AIExecution.id).label("total"),
        func.count(case((AIExecution.error_message.isnot(None), 1))).label("failures"),
        func.avg(AIExecution.execution_time_ms).label("avg_latency"),
        func.sum(AIExecution.input_tokens).label("sum_input"),
        func.sum(AIExecution.output_tokens).label("sum_output"),
        func.count(case((AIExecution.chain_position == 1, 1))).label("as_primary"),
        func.count(case((AIExecution.chain_position > 1, 1))).label("as_fallback"),
    ).filter(*base_filter).group_by(
        AIExecution.usage_type,
        AIExecution.ai_model_id,
        AIExecution.model_name,
        AIExecution.provider,
    ).all()

    # Build model stats lookup
    model_stats_by_usage = {}
    worst_model = None
    worst_failure_rate = 0

    for ms in model_stats:
        ut = ms.usage_type
        total = ms.total or 0
        failures = ms.failures or 0
        failure_rate = (failures / total * 100) if total > 0 else 0.0
        sum_in = ms.sum_input or 0
        sum_out = ms.sum_output or 0
        cost_info = calculate_cost(sum_in, sum_out, ms.model_name or "")
        avg_cost = cost_info["total_cost"] / total if total > 0 else 0.0

        stats = ChainModelStats(
            model_id=str(ms.ai_model_id) if ms.ai_model_id else "",
            model_name=ms.model_name or "",
            provider=ms.provider or "",
            total_attempts=total,
            failures=failures,
            failure_rate=round(failure_rate, 1),
            avg_cost=round(avg_cost, 6),
            avg_latency_ms=round(ms.avg_latency or 0, 1),
            times_as_primary=ms.as_primary or 0,
            times_as_fallback=ms.as_fallback or 0,
        )

        model_stats_by_usage.setdefault(ut, []).append(stats)

        if failure_rate > worst_failure_rate and total >= 3:
            worst_failure_rate = failure_rate
            worst_model = stats

    # Build analytics items
    analytics = []
    total_cost_all = 0.0
    total_savings = 0.0

    for us in usage_stats:
        total = us.total or 0
        fallback_successes = us.fallback_successes or 0
        fallback_rate = (fallback_successes / total * 100) if total > 0 else 0.0
        sum_in = us.sum_input or 0
        sum_out = us.sum_output or 0

        # Use first model in list for cost estimation
        models_for_ut = model_stats_by_usage.get(us.usage_type, [])
        total_cost = 0.0
        for m in models_for_ut:
            total_cost += m.avg_cost * m.total_attempts

        total_cost_all += total_cost

        # Primary success rate
        primary_total = sum(m.times_as_primary for m in models_for_ut)
        primary_failures = sum(m.failures for m in models_for_ut if m.times_as_primary > 0)
        primary_success = ((primary_total - primary_failures) / primary_total * 100) if primary_total > 0 else 100.0

        analytics.append(ChainAnalyticsItem(
            usage_type=us.usage_type,
            total_executions=total,
            total_cost=round(total_cost, 4),
            fallback_rate=round(fallback_rate, 1),
            avg_chain_depth=round(us.avg_depth or 1, 2),
            primary_success_rate=round(primary_success, 1),
            models=models_for_ut,
            cost_savings=0.0,
        ))

    return ChainAnalyticsResponse(
        analytics=analytics,
        most_failing_model=worst_model,
        total_cost_all_chains=round(total_cost_all, 4),
        total_fallback_savings=round(total_savings, 4),
        lookback_days=days,
    )


# ============================================================================
# PROMPT #124 - Feature 4: Smart Reorder + Templates
# ============================================================================

# Model quality tiers (higher = better)
MODEL_QUALITY_TIERS = {
    "opus": 100, "claude-opus": 100, "claude-4-opus": 100,
    "sonnet": 80, "claude-sonnet": 80, "claude-4-sonnet": 80, "gpt-4o": 80, "gpt-4": 80,
    "gemini-1.5-pro": 75, "gemini-pro": 75, "command-r-plus": 75,
    "haiku": 50, "claude-haiku": 50, "gemini-1.5-flash": 50, "gemini-flash": 50,
    "gpt-3.5": 40, "command-r": 40, "command-light": 30,
    # PROMPT #289 - Ollama local model quality tiers
    "deepseek-r1:14b": 88, "deepseek-r1": 85,
    "qwen2.5-coder:14b": 86, "qwen2.5-coder": 82,
    "qwen3:14b": 85, "qwen3:8b": 70, "qwen3": 75,
    "gemma3:12b": 82, "gemma3": 78,
    "phi4:14b": 75, "phi4": 72,
    "codestral:22b": 80, "codestral": 78,
    "qwen2.5:32b": 83, "qwen2.5:14b": 78, "qwen2.5": 75,
}


def _get_quality_tier(model_name: str) -> float:
    """Get quality tier score for a model name (0-100)."""
    name_lower = model_name.lower()
    for key, score in MODEL_QUALITY_TIERS.items():
        if key in name_lower:
            return score
    return 60  # default


@router.post("/optimize-chain/{usage_type}", response_model=OptimizeChainResponse)
async def optimize_chain(
    usage_type: AIModelUsageType,
    data: OptimizeChainRequest = OptimizeChainRequest(),
    db: Session = Depends(get_db),
):
    """Analyze execution history and recommend optimal chain order."""
    chain = db.query(AIFlowChain).filter(AIFlowChain.usage_type == usage_type).first()
    if not chain or not chain.chain:
        raise HTTPException(status_code=404, detail="Nenhuma cadeia configurada para este tipo de uso")

    cutoff = datetime.utcnow() - timedelta(days=data.days)
    model_uuids = [UUID(mid) for mid in chain.chain]

    # Get per-model stats
    stats = db.query(
        AIExecution.ai_model_id,
        AIExecution.model_name,
        AIExecution.provider,
        func.count(AIExecution.id).label("total"),
        func.count(case((AIExecution.error_message.is_(None), 1))).label("successes"),
        func.avg(AIExecution.execution_time_ms).label("avg_latency"),
        func.sum(AIExecution.input_tokens).label("sum_input"),
        func.sum(AIExecution.output_tokens).label("sum_output"),
    ).filter(
        AIExecution.ai_model_id.in_(model_uuids),
        AIExecution.created_at >= cutoff,
    ).group_by(
        AIExecution.ai_model_id, AIExecution.model_name, AIExecution.provider,
    ).all()

    stats_map = {}
    for s in stats:
        stats_map[str(s.ai_model_id)] = s

    # Strategy weights
    weights = {
        "reliability": (0.6, 0.1, 0.2, 0.1),
        "cost": (0.2, 0.5, 0.1, 0.2),
        "quality": (0.2, 0.1, 0.5, 0.2),
        "balanced": (0.3, 0.25, 0.25, 0.2),
    }
    w_rel, w_cost, w_qual, w_lat = weights.get(data.strategy, weights["balanced"])

    # Calculate scores
    model_scores = []
    for mid in chain.chain:
        model = db.query(AIModel).filter(AIModel.id == UUID(mid)).first()
        if not model:
            continue

        s = stats_map.get(mid)
        if s and s.total and s.total > 0:
            success_rate = (s.successes / s.total) * 100
            avg_latency = s.avg_latency or 0
            sum_in = s.sum_input or 0
            sum_out = s.sum_output or 0
            cost_info = calculate_cost(sum_in, sum_out, s.model_name or "")
            avg_cost = cost_info["total_cost"] / s.total
        else:
            # No history — use defaults
            success_rate = 95.0
            avg_latency = 2000
            _, out_price = get_model_pricing(model.config.get("model_id", ""))
            avg_cost = out_price / 1_000_000 * 500  # estimate 500 output tokens

        quality = _get_quality_tier(model.config.get("model_id", model.name))

        # Normalize scores (0-100)
        rel_score = success_rate
        cost_score = max(0, 100 - (avg_cost * 100000))  # lower cost = higher score
        qual_score = quality
        lat_score = max(0, 100 - (avg_latency / 50))  # lower latency = higher score

        total_score = rel_score * w_rel + cost_score * w_cost + qual_score * w_qual + lat_score * w_lat

        reasoning = f"{success_rate:.1f}% success, ${avg_cost:.4f}/call, {avg_latency:.0f}ms avg"

        model_scores.append(OptimizeModelScore(
            model_id=mid,
            model_name=model.name,
            provider=model.provider,
            score=round(total_score, 2),
            reasoning=reasoning,
        ))

    # Sort by score descending
    model_scores.sort(key=lambda m: m.score, reverse=True)
    recommended = [m.model_id for m in model_scores]

    return OptimizeChainResponse(
        current_order=chain.chain,
        recommended_order=recommended,
        strategy=data.strategy,
        models=model_scores,
        estimated_improvement={},
    )


# PROMPT #209 - Recommended utility nodes per template strategy
TEMPLATE_UTILITY_NODES = {
    "high_reliability": [
        {
            "id": "retry-tmpl-1",
            "type": "retry",
            "label": "Retry",
            "enabled": True,
            "config": {"max_retries": 3, "backoff_base_ms": 1000, "backoff_multiplier": 2.0, "retry_on": ["timeout", "rate_limit", "server_error"]},
            "position": None,
        },
        {
            "id": "timeout-tmpl-1",
            "type": "timeout",
            "label": "Timeout",
            "enabled": True,
            "config": {"timeout_seconds": 120},
            "position": None,
        },
        {
            "id": "validator-tmpl-1",
            "type": "validator",
            "label": "Validator",
            "enabled": True,
            "config": {"validation_type": "not_empty", "schema": {}, "max_length": 0, "required_keywords": [], "retry_on_fail": True},
            "position": None,
        },
    ],
    "cost_optimized": [
        {
            "id": "cache-tmpl-1",
            "type": "cache",
            "label": "Cache",
            "enabled": True,
            "config": {"ttl_seconds": 86400, "cache_level": "exact", "enabled": True},
            "position": None,
        },
        {
            "id": "cost_guard-tmpl-1",
            "type": "cost_guard",
            "label": "Cost Guard",
            "enabled": True,
            "config": {"max_cost_per_call": 0.10, "daily_budget": 10.0, "monthly_budget": 100.0, "action_on_exceed": "block"},
            "position": None,
        },
        {
            "id": "prompt_transformer-tmpl-1",
            "type": "prompt_transformer",
            "label": "Prompt Transformer",
            "enabled": True,
            "config": {"transformation": "compress", "max_tokens": 4000, "language": "auto", "override_max_tokens": None, "override_temperature": None},
            "position": None,
        },
    ],
    # v2.5: 'nave' profile (Ollama-only) removed
    "high_quality": [
        {
            "id": "rag_context-tmpl-1",
            "type": "rag_context",
            "label": "RAG Context",
            "enabled": True,
            "config": {"max_results": 5, "similarity_threshold": 0.7, "include_metadata": True},
            "position": None,
        },
        {
            "id": "validator-tmpl-2",
            "type": "validator",
            "label": "Validator",
            "enabled": True,
            "config": {"validation_type": "not_empty", "schema": {}, "max_length": 0, "required_keywords": [], "retry_on_fail": True},
            "position": None,
        },
        {
            "id": "prompt_transformer-tmpl-2",
            "type": "prompt_transformer",
            "label": "Prompt Transformer",
            "enabled": True,
            "config": {"transformation": "compress", "max_tokens": 4000, "language": "auto", "override_max_tokens": None, "override_temperature": None},
            "position": None,
        },
    ],
}


@router.get("/chain-templates/{usage_type}", response_model=ChainTemplatesResponse)
async def get_chain_templates(
    usage_type: AIModelUsageType,
    db: Session = Depends(get_db),
):
    """Get pre-built chain templates for a usage_type."""
    # Get all active models for this usage_type + general
    models = db.query(AIModel).filter(
        AIModel.is_active == True,
        AIModel.usage_type.in_([usage_type, AIModelUsageType.GENERAL]),
    ).all()

    if not models:
        return ChainTemplatesResponse(templates=[])

    def model_info(m):
        return {"id": str(m.id), "name": m.name, "provider": m.provider, "model_id": m.config.get("model_id", "")}

    # Template 1: High Reliability — sort by quality tier (most capable first)
    reliability_sorted = sorted(models, key=lambda m: _get_quality_tier(m.config.get("model_id", m.name)), reverse=True)

    # Template 2: Cost Optimized — cheapest first
    def model_cost(m):
        _, out_price = get_model_pricing(m.config.get("model_id", ""))
        return out_price
    cost_sorted = sorted(models, key=model_cost)

    # Template 3: High Quality — top tier only, then rest
    quality_sorted = sorted(models, key=lambda m: _get_quality_tier(m.config.get("model_id", m.name)), reverse=True)

    templates = [
        ChainTemplate(
            id="high_reliability",
            name="Alta Confiabilidade",
            description="Modelos mais capazes primeiro, fallback para mais rápidos",
            chain=[str(m.id) for m in reliability_sorted],
            models=[model_info(m) for m in reliability_sorted],
            utility_nodes=TEMPLATE_UTILITY_NODES["high_reliability"],
        ),
        ChainTemplate(
            id="cost_optimized",
            name="Custo Mínimo",
            description="Modelos mais baratos primeiro, escalando para caros se necessário",
            chain=[str(m.id) for m in cost_sorted],
            models=[model_info(m) for m in cost_sorted],
            utility_nodes=TEMPLATE_UTILITY_NODES["cost_optimized"],
        ),
        ChainTemplate(
            id="high_quality",
            name="Alta Qualidade",
            description="Melhores modelos no topo da chain",
            chain=[str(m.id) for m in quality_sorted],
            models=[model_info(m) for m in quality_sorted],
            utility_nodes=TEMPLATE_UTILITY_NODES["high_quality"],
        ),
    ]

    # v2.5: template 'nave' (Ollama-only) removed — claudius-only lockdown.

    return ChainTemplatesResponse(templates=templates)


# ============================================================================
# PROMPT #204 - Utility Node Types Catalog
# ============================================================================

UTILITY_NODE_CATALOG = {
    "cache": {
        "type": "cache",
        "label": "Cache",
        "description": "Verifica cache Redis antes de chamar modelos de IA. Retorna resposta em cache se disponível.",
        "icon": "database",
        "color": "#8b5cf6",
        "default_config": {
            "ttl_seconds": 86400,
            "cache_level": "exact",
            "enabled": True,
        },
    },
    "rag_context": {
        "type": "rag_context",
        "label": "RAG Context",
        "description": "Expande o prompt com contexto semântico do RAG vector store. PROMPT #229: filtragem por tipo, deduplicacao, compressao de contexto e reranking.",
        "icon": "search",
        "color": "#06b6d4",
        "default_config": {
            "max_results": 5,
            "similarity_threshold": 0.7,
            "include_metadata": True,
            "filter_types": None,
            "exclude_types": None,
            "dedupe_threshold": 0.95,
            "max_context_chars": 6000,
            "compression_strategy": "key_sentences",
            "rerank_top_k": 3,
        },
    },
    "prompt_transformer": {
        "type": "prompt_transformer",
        "label": "Prompt Transformer",
        "description": "Aplica transformacoes ao prompt antes de enviar para IA (compressao, traducao, etc.). Pode sobrescrever max_tokens (limitado pelo modelo) e temperature (livre).",
        "icon": "wand",
        "color": "#f59e0b",
        "default_config": {
            "transformation": "compress",
            "max_tokens": 4000,
            "language": "auto",
            "override_max_tokens": None,
            "override_temperature": None,
        },
    },
    "router": {
        "type": "router",
        "label": "Router",
        "description": "Roteia requisicoes para diferentes cadeias de modelos baseado em condições (complexidade, custo, tópico). PROMPT #231: le query_classification dos metadados para pular modelos baratos em consultas complexas.",
        "icon": "git-branch",
        "color": "#10b981",
        "default_config": {
            "condition": "complexity",
            "tier_mapping": {
                "fast": 0,
                "balanced": "middle",
                "strong": "last",
            },
            "routes": {},
        },
    },
    "retry": {
        "type": "retry",
        "label": "Retry",
        "description": "Tenta novamente o mesmo modelo com backoff exponencial em falhas transitorias. Pulo inteligente: erros permanentes (401, 404) nunca são tentados novamente.",
        "icon": "refresh-cw",
        "color": "#3b82f6",
        "default_config": {
            "max_retries": 3,
            "backoff_base_ms": 1000,
            "backoff_multiplier": 2.0,
            "retry_on": ["timeout", "rate_limit", "server_error"],
            "skip_permanent_errors": True,
        },
    },
    "validator": {
        "type": "validator",
        "label": "Validator",
        "description": "Válida saída de IA contra regras (JSON schema, comprimento, palavras-chave, formato). Auto-reparo: tenta corrigir JSON antes de acionar retry. PROMPT #231: tipo interview_score com pontuacao estrutural 0.0-1.0.",
        "icon": "check-circle",
        "color": "#22c55e",
        "default_config": {
            "validation_type": "json",
            "schema": {},
            "max_length": 0,
            "required_keywords": [],
            "retry_on_fail": True,
            "auto_repair_json": True,
            "min_score": 0.5,
        },
    },
    "cost_guard": {
        "type": "cost_guard",
        "label": "Cost Guard",
        "description": "Bloqueia requisicoes que excederiam um limite de orçamento (por chamada ou cumulativo).",
        "icon": "shield",
        "color": "#ef4444",
        "default_config": {
            "max_cost_per_call": 0.10,
            "daily_budget": 10.0,
            "monthly_budget": 100.0,
            "action_on_exceed": "block",
        },
    },
    "rate_limiter": {
        "type": "rate_limiter",
        "label": "Rate Limiter",
        "description": "Limita o número de requisicoes por janela de tempo usando um algoritmo de janela deslizante.",
        "icon": "clock",
        "color": "#ec4899",
        "default_config": {
            "max_requests": 60,
            "window_seconds": 60,
            "action_on_exceed": "queue",
        },
    },
    "timeout": {
        "type": "timeout",
        "label": "Timeout",
        "description": "Define timeout de chamada de API em segundos. Sobrescreve padrões do modelo e do sistema. Hierarquia: No Timeout → AI Model timeout → System Settings padrão.",
        "icon": "timer",
        "color": "#f97316",
        "default_config": {
            "timeout_seconds": 120,
        },
    },
    "prompt_queue": {
        "type": "prompt_queue",
        "label": "Prompt Queue",
        "description": "Fila de prioridade de orquestracao. Ordena prompts por hierarquia, prioridade, dependencias e idade. Garante que cards pais executem antes dos filhos para consistencia de código.",
        "icon": "list-ordered",
        "color": "#8b5cf6",
        "default_config": {
            "strategy": "balanced",
            "max_concurrent": 1,
            "auto_populate": True,
        },
    },
    "prompt_node": {
        "type": "prompt_node",
        "label": "Prompt Node",
        "description": "Prompt estruturado reutilizável para ORBIT AI. Armazena referência a arquivo YAML com instruções que podem ser executadas manualmente ou via automação.",
        "icon": "file-text",
        "color": "#6366f1",
        "default_config": {
            "prompt_yaml": "",
            "repeat": 1,
            "description": "",
        },
    },
}


@router.get("/utility-node-types")
async def list_utility_node_types():
    """List all available utility node types with their default configurations."""
    return {"node_types": list(UTILITY_NODE_CATALOG.values())}


# ============================================================================
# AI Flow Profiles - Named, Versioned Flow Configurations
# ============================================================================

@router.get("/profiles", response_model=List[AIFlowProfileResponse])
async def list_profiles(db: Session = Depends(get_db)):
    """List all AI Flow profiles."""
    profiles = db.query(AIFlowProfile).order_by(
        AIFlowProfile.is_active.desc(),
        AIFlowProfile.updated_at.desc(),
    ).all()
    return profiles


@router.post("/profiles", response_model=AIFlowProfileResponse, status_code=status.HTTP_201_CREATED)
async def create_profile(
    data: AIFlowProfileCreate,
    db: Session = Depends(get_db),
):
    """Create a new AI Flow profile."""
    profile = AIFlowProfile(
        id=uuid4(),
        name=data.name,
        usage_type=data.usage_type,
        version=1,
        chain=data.chain or [],
        utility_nodes=data.utility_nodes,
        node_positions=data.node_positions,
        subflows={k: v.model_dump() for k, v in (data.subflows or {}).items()},
        is_active=False,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    logger.info(f"✅ Created AI Flow profile: {profile.name} ({profile.usage_type})")
    return profile


@router.put("/profiles/{profile_id}", response_model=AIFlowProfileResponse)
async def update_profile(
    profile_id: UUID,
    data: AIFlowProfileUpdate,
    db: Session = Depends(get_db),
):
    """Update an AI Flow profile. Increments version automatically."""
    profile = db.query(AIFlowProfile).filter(AIFlowProfile.id == profile_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    if data.name is not None:
        profile.name = data.name
    if data.usage_type is not None:
        profile.usage_type = data.usage_type
    if data.chain is not None:
        profile.chain = data.chain
    if data.utility_nodes is not None:
        profile.utility_nodes = data.utility_nodes
    if data.node_positions is not None:
        profile.node_positions = data.node_positions
    if data.subflows is not None:
        profile.subflows = {k: v.model_dump() for k, v in data.subflows.items()}

    profile.version += 1
    db.commit()
    db.refresh(profile)
    logger.info(f"✅ Updated AI Flow profile: {profile.name} v{profile.version}")
    return profile


@router.delete("/profiles/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_profile(
    profile_id: UUID,
    db: Session = Depends(get_db),
):
    """Delete an AI Flow profile."""
    profile = db.query(AIFlowProfile).filter(AIFlowProfile.id == profile_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    db.delete(profile)
    db.commit()
    logger.info(f"🗑️ Deleted AI Flow profile: {profile.name}")


@router.post("/profiles/{profile_id}/activate", response_model=AIFlowProfileResponse)
async def activate_profile(
    profile_id: UUID,
    db: Session = Depends(get_db),
):
    """Activate a profile. Deactivates all other profiles with the same usage_type."""
    profile = db.query(AIFlowProfile).filter(AIFlowProfile.id == profile_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    # Deactivate all other profiles with the same usage_type
    db.query(AIFlowProfile).filter(
        AIFlowProfile.usage_type == profile.usage_type,
        AIFlowProfile.id != profile_id,
    ).update({"is_active": False})

    profile.is_active = True
    db.commit()
    db.refresh(profile)

    # Also sync to ai_flow_chains for backward compatibility
    existing_chain = db.query(AIFlowChain).filter(
        AIFlowChain.usage_type == profile.usage_type
    ).first()
    if existing_chain:
        existing_chain.chain = profile.chain
        existing_chain.utility_nodes = profile.utility_nodes
        existing_chain.node_positions = profile.node_positions
        existing_chain.is_active = True
        db.commit()

    logger.info(f"✅ Activated AI Flow profile: {profile.name} ({profile.usage_type})")
    return profile
