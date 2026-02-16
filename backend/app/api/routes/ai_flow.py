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
)

import logging

logger = logging.getLogger(__name__)

router = APIRouter()


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
    # PROMPT #289 - Nave profile: maximum quality, local-only, unlimited time
    "nave": [
        {
            "id": "rag_context-tmpl-nave-1",
            "type": "rag_context",
            "label": "RAG Context",
            "enabled": True,
            "config": {"max_results": 5, "similarity_threshold": 0.7, "include_metadata": True},
            "position": None,
        },
        {
            "id": "timeout-tmpl-nave-1",
            "type": "timeout",
            "label": "Timeout",
            "enabled": True,
            "config": {"timeout_seconds": 600},
            "position": None,
        },
        {
            "id": "validator-tmpl-nave-1",
            "type": "validator",
            "label": "Validator",
            "enabled": True,
            "config": {"validation_type": "not_empty", "schema": {}, "max_length": 0, "required_keywords": [], "retry_on_fail": True},
            "position": None,
        },
        {
            "id": "retry-tmpl-nave-1",
            "type": "retry",
            "label": "Retry",
            "enabled": True,
            "config": {"max_retries": 3, "backoff_base_ms": 3000, "backoff_multiplier": 2.0, "retry_on": ["timeout", "server_error"]},
            "position": None,
        },
    ],
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

    # PROMPT #289 - Template 4: Nave — Maximum quality, local-only, unlimited time
    ollama_models = [m for m in models if m.provider == "ollama"]
    if ollama_models:
        nave_sorted = sorted(
            ollama_models,
            key=lambda m: _get_quality_tier(m.config.get("model_id", m.name)),
            reverse=True,
        )
        templates.append(
            ChainTemplate(
                id="nave",
                name="Nave (Qualidade Máxima)",
                description="Qualidade máxima, apenas Ollama local, tempo ilimitado, custo zero",
                chain=[str(m.id) for m in nave_sorted],
                models=[model_info(m) for m in nave_sorted],
                utility_nodes=TEMPLATE_UTILITY_NODES["nave"],
            )
        )

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
        "description": "Enriquece o prompt com contexto semântico do RAG vector store. PROMPT #229: filtragem por tipo, deduplicacao, compressao de contexto e reranking.",
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
}


@router.get("/utility-node-types")
async def list_utility_node_types():
    """List all available utility node types with their default configurations."""
    return {"node_types": list(UTILITY_NODE_CATALOG.values())}
