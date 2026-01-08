"""
Cost Analytics API Routes
Endpoints for cost analysis and tracking

PROMPT #54.2 - Phase 2: Cost Analytics Dashboard
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from typing import Optional
from datetime import datetime, timedelta

from app.database import get_db
from app.models.ai_execution import AIExecution
from app.schemas.cost_analytics import (
    CostAnalyticsResponse,
    CostSummary,
    CostByProvider,
    CostByUsageType,
    DailyCost,
    AIExecutionWithCost
)
from app.utils.pricing import calculate_cost
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/analytics", response_model=CostAnalyticsResponse)
async def get_cost_analytics(
    start_date: Optional[datetime] = Query(None, description="Start date for filtering"),
    end_date: Optional[datetime] = Query(None, description="End date for filtering"),
    provider: Optional[str] = Query(None, description="Filter by provider"),
    usage_type: Optional[str] = Query(None, description="Filter by usage type"),
    db: Session = Depends(get_db)
):
    """
    Get aggregated cost analytics

    PROMPT #54.2 - Phase 2: Main cost analytics endpoint

    Returns:
        - Summary (total cost, tokens, executions)
        - Breakdown by provider
        - Breakdown by usage type
        - Daily cost trend
    """
    # Build base query
    query = db.query(AIExecution)

    # Apply filters
    filters = []
    if start_date:
        filters.append(AIExecution.created_at >= start_date)
    if end_date:
        filters.append(AIExecution.created_at <= end_date)
    if provider:
        filters.append(AIExecution.provider == provider)
    if usage_type:
        filters.append(AIExecution.usage_type == usage_type)

    if filters:
        query = query.filter(and_(*filters))

    # Get all executions
    executions = query.all()

    # Calculate costs for all executions
    total_cost = 0.0
    total_input_tokens = 0
    total_output_tokens = 0
    total_tokens = 0

    provider_stats = {}
    usage_type_stats = {}
    daily_stats = {}

    for execution in executions:
        # Calculate cost
        cost_data = calculate_cost(
            execution.input_tokens or 0,
            execution.output_tokens or 0,
            execution.model_name or ""
        )
        cost = cost_data["total_cost"]

        # Aggregate totals
        total_cost += cost
        total_input_tokens += execution.input_tokens or 0
        total_output_tokens += execution.output_tokens or 0
        total_tokens += execution.total_tokens or 0

        # Aggregate by provider
        prov = execution.provider or "unknown"
        if prov not in provider_stats:
            provider_stats[prov] = {
                "total_cost": 0.0,
                "input_tokens": 0,
                "output_tokens": 0,
                "total_tokens": 0,
                "execution_count": 0
            }
        provider_stats[prov]["total_cost"] += cost
        provider_stats[prov]["input_tokens"] += execution.input_tokens or 0
        provider_stats[prov]["output_tokens"] += execution.output_tokens or 0
        provider_stats[prov]["total_tokens"] += execution.total_tokens or 0
        provider_stats[prov]["execution_count"] += 1

        # Aggregate by usage type
        utype = execution.usage_type or "unknown"
        if utype not in usage_type_stats:
            usage_type_stats[utype] = {
                "total_cost": 0.0,
                "input_tokens": 0,
                "output_tokens": 0,
                "total_tokens": 0,
                "execution_count": 0
            }
        usage_type_stats[utype]["total_cost"] += cost
        usage_type_stats[utype]["input_tokens"] += execution.input_tokens or 0
        usage_type_stats[utype]["output_tokens"] += execution.output_tokens or 0
        usage_type_stats[utype]["total_tokens"] += execution.total_tokens or 0
        usage_type_stats[utype]["execution_count"] += 1

        # Aggregate by day
        day = execution.created_at.date().isoformat()
        if day not in daily_stats:
            daily_stats[day] = {
                "total_cost": 0.0,
                "input_tokens": 0,
                "output_tokens": 0,
                "total_tokens": 0,
                "execution_count": 0
            }
        daily_stats[day]["total_cost"] += cost
        daily_stats[day]["input_tokens"] += execution.input_tokens or 0
        daily_stats[day]["output_tokens"] += execution.output_tokens or 0
        daily_stats[day]["total_tokens"] += execution.total_tokens or 0
        daily_stats[day]["execution_count"] += 1

    # Build summary
    summary = CostSummary(
        total_cost=round(total_cost, 4),
        total_input_tokens=total_input_tokens,
        total_output_tokens=total_output_tokens,
        total_tokens=total_tokens,
        total_executions=len(executions),
        avg_cost_per_execution=round(total_cost / len(executions), 4) if executions else 0.0,
        date_range_start=min((e.created_at for e in executions), default=None),
        date_range_end=max((e.created_at for e in executions), default=None)
    )

    # Build provider breakdown
    by_provider = [
        CostByProvider(
            provider=prov,
            total_cost=round(stats["total_cost"], 4),
            input_tokens=stats["input_tokens"],
            output_tokens=stats["output_tokens"],
            total_tokens=stats["total_tokens"],
            execution_count=stats["execution_count"]
        )
        for prov, stats in provider_stats.items()
    ]
    by_provider.sort(key=lambda x: x.total_cost, reverse=True)

    # Build usage type breakdown
    by_usage_type = [
        CostByUsageType(
            usage_type=utype,
            total_cost=round(stats["total_cost"], 4),
            input_tokens=stats["input_tokens"],
            output_tokens=stats["output_tokens"],
            total_tokens=stats["total_tokens"],
            execution_count=stats["execution_count"],
            avg_cost_per_execution=round(
                stats["total_cost"] / stats["execution_count"],
                4
            ) if stats["execution_count"] > 0 else 0.0
        )
        for utype, stats in usage_type_stats.items()
    ]
    by_usage_type.sort(key=lambda x: x.total_cost, reverse=True)

    # Build daily breakdown (sorted by date)
    daily_costs = [
        DailyCost(
            date=day,
            total_cost=round(stats["total_cost"], 4),
            input_tokens=stats["input_tokens"],
            output_tokens=stats["output_tokens"],
            total_tokens=stats["total_tokens"],
            execution_count=stats["execution_count"]
        )
        for day, stats in daily_stats.items()
    ]
    daily_costs.sort(key=lambda x: x.date)

    return CostAnalyticsResponse(
        summary=summary,
        by_provider=by_provider,
        by_usage_type=by_usage_type,
        daily_costs=daily_costs
    )


@router.get("/executions-with-cost", response_model=list[AIExecutionWithCost])
async def get_executions_with_cost(
    limit: int = Query(50, ge=1, le=1000, description="Number of executions to return"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    provider: Optional[str] = Query(None, description="Filter by provider"),
    usage_type: Optional[str] = Query(None, description="Filter by usage type"),
    db: Session = Depends(get_db)
):
    """
    Get recent AI executions with calculated costs

    PROMPT #54.2 - Phase 2: Execution list with cost calculation
    """
    # Build query
    query = db.query(AIExecution)

    # Apply filters
    if provider:
        query = query.filter(AIExecution.provider == provider)
    if usage_type:
        query = query.filter(AIExecution.usage_type == usage_type)

    # Order by most recent
    query = query.order_by(AIExecution.created_at.desc())

    # Pagination
    executions = query.offset(offset).limit(limit).all()

    # Add cost calculations
    result = []
    for execution in executions:
        cost_data = calculate_cost(
            execution.input_tokens or 0,
            execution.output_tokens or 0,
            execution.model_name or ""
        )

        result.append(AIExecutionWithCost(
            id=str(execution.id),
            usage_type=execution.usage_type or "unknown",
            provider=execution.provider or "unknown",
            model_name=execution.model_name,
            input_tokens=execution.input_tokens or 0,
            output_tokens=execution.output_tokens or 0,
            total_tokens=execution.total_tokens or 0,
            execution_time_ms=execution.execution_time_ms,
            status=execution.status or "unknown",
            created_at=execution.created_at,
            cost=cost_data["total_cost"],
            input_cost=cost_data["input_cost"],
            output_cost=cost_data["output_cost"]
        ))

    return result


@router.get("/rag-stats")
async def get_rag_stats(
    start_date: Optional[datetime] = Query(None, description="Start date for filtering"),
    end_date: Optional[datetime] = Query(None, description="End date for filtering"),
    usage_type: Optional[str] = Query(None, description="Filter by usage type"),
    db: Session = Depends(get_db)
):
    """
    Get RAG (Retrieval-Augmented Generation) statistics

    PROMPT #89 - RAG Monitoring & Analytics

    Returns:
        - Overall hit rate (% of executions with RAG hits)
        - Total executions with RAG enabled
        - Average similarity scores
        - Average retrieval times
        - Breakdown by usage type
    """
    # Build base query - only executions with RAG enabled
    query = db.query(AIExecution).filter(AIExecution.rag_enabled == True)

    # Apply filters
    filters = []
    if start_date:
        filters.append(AIExecution.created_at >= start_date)
    if end_date:
        filters.append(AIExecution.created_at <= end_date)
    if usage_type:
        filters.append(AIExecution.usage_type == usage_type)

    if filters:
        query = query.filter(and_(*filters))

    # Get all RAG-enabled executions
    executions = query.all()

    if not executions:
        return {
            "total_rag_enabled": 0,
            "total_rag_hits": 0,
            "hit_rate": 0.0,
            "avg_results_count": 0.0,
            "avg_top_similarity": 0.0,
            "avg_retrieval_time_ms": 0.0,
            "by_usage_type": []
        }

    # Calculate overall stats
    total_rag_enabled = len(executions)
    total_rag_hits = sum(1 for e in executions if e.rag_hit)
    hit_rate = (total_rag_hits / total_rag_enabled) * 100 if total_rag_enabled > 0 else 0.0

    # Calculate averages (only for hits)
    hits = [e for e in executions if e.rag_hit]
    avg_results_count = sum(e.rag_results_count or 0 for e in hits) / len(hits) if hits else 0.0
    avg_top_similarity = sum(e.rag_top_similarity or 0 for e in hits) / len(hits) if hits else 0.0
    avg_retrieval_time_ms = sum(e.rag_retrieval_time_ms or 0 for e in executions) / len(executions) if executions else 0.0

    # Breakdown by usage type
    usage_type_stats = {}
    for e in executions:
        utype = e.usage_type
        if utype not in usage_type_stats:
            usage_type_stats[utype] = {
                "total": 0,
                "hits": 0,
                "results_sum": 0,
                "similarity_sum": 0,
                "similarity_count": 0,
                "retrieval_time_sum": 0
            }

        stats = usage_type_stats[utype]
        stats["total"] += 1
        stats["retrieval_time_sum"] += e.rag_retrieval_time_ms or 0

        if e.rag_hit:
            stats["hits"] += 1
            stats["results_sum"] += e.rag_results_count or 0
            if e.rag_top_similarity is not None:
                stats["similarity_sum"] += e.rag_top_similarity
                stats["similarity_count"] += 1

    # Build usage type breakdown
    by_usage_type = [
        {
            "usage_type": utype,
            "total": stats["total"],
            "hits": stats["hits"],
            "hit_rate": round((stats["hits"] / stats["total"]) * 100, 1) if stats["total"] > 0 else 0.0,
            "avg_results_count": round(stats["results_sum"] / stats["hits"], 1) if stats["hits"] > 0 else 0.0,
            "avg_top_similarity": round(stats["similarity_sum"] / stats["similarity_count"], 3) if stats["similarity_count"] > 0 else 0.0,
            "avg_retrieval_time_ms": round(stats["retrieval_time_sum"] / stats["total"], 1) if stats["total"] > 0 else 0.0
        }
        for utype, stats in usage_type_stats.items()
    ]
    by_usage_type.sort(key=lambda x: x["total"], reverse=True)

    return {
        "total_rag_enabled": total_rag_enabled,
        "total_rag_hits": total_rag_hits,
        "hit_rate": round(hit_rate, 1),
        "avg_results_count": round(avg_results_count, 1),
        "avg_top_similarity": round(avg_top_similarity, 3),
        "avg_retrieval_time_ms": round(avg_retrieval_time_ms, 1),
        "by_usage_type": by_usage_type
    }
