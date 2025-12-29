"""
AI Executions API Router
Read-only endpoints for viewing AI execution logs
PROMPT #54 - AI Execution Logging System
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from typing import List, Optional
from uuid import UUID
from datetime import datetime, timedelta

from app.database import get_db
from app.models.ai_execution import AIExecution
from app.schemas.ai_execution import (
    AIExecutionResponse,
    AIExecutionListItem,
    AIExecutionStats
)

router = APIRouter()


@router.get("/", response_model=List[AIExecutionListItem])
async def list_ai_executions(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    usage_type: Optional[str] = Query(None, description="Filter by usage type"),
    provider: Optional[str] = Query(None, description="Filter by provider"),
    has_error: Optional[bool] = Query(None, description="Filter by error status"),
    start_date: Optional[datetime] = Query(None, description="Filter from this date"),
    end_date: Optional[datetime] = Query(None, description="Filter until this date"),
    db: Session = Depends(get_db)
):
    """
    List all AI executions with filtering options.

    - **usage_type**: Filter by usage type (interview, prompt_generation, etc)
    - **provider**: Filter by provider (anthropic, openai, google)
    - **has_error**: Filter by error status (true = only errors, false = only successful)
    - **start_date**: Filter executions from this date
    - **end_date**: Filter executions until this date
    """
    query = db.query(AIExecution)

    # Apply filters
    if usage_type:
        query = query.filter(AIExecution.usage_type == usage_type)
    if provider:
        query = query.filter(AIExecution.provider.ilike(f"%{provider}%"))
    if has_error is not None:
        if has_error:
            query = query.filter(AIExecution.error_message.isnot(None))
        else:
            query = query.filter(AIExecution.error_message.is_(None))
    if start_date:
        query = query.filter(AIExecution.created_at >= start_date)
    if end_date:
        query = query.filter(AIExecution.created_at <= end_date)

    # Order by most recent first and apply pagination
    executions = query.order_by(desc(AIExecution.created_at)).offset(skip).limit(limit).all()

    return executions


@router.get("/stats", response_model=AIExecutionStats)
async def get_execution_stats(
    start_date: Optional[datetime] = Query(None, description="Filter from this date"),
    end_date: Optional[datetime] = Query(None, description="Filter until this date"),
    db: Session = Depends(get_db)
):
    """
    Get aggregate statistics for AI executions.

    Returns total executions, token usage, breakdowns by provider/usage_type, etc.
    """
    query = db.query(AIExecution)

    # Apply date filters
    if start_date:
        query = query.filter(AIExecution.created_at >= start_date)
    if end_date:
        query = query.filter(AIExecution.created_at <= end_date)

    # Total executions
    total_executions = query.count()

    # Total tokens (only successful executions)
    successful_query = query.filter(AIExecution.error_message.is_(None))

    total_input_tokens = successful_query.with_entities(
        func.sum(AIExecution.input_tokens)
    ).scalar() or 0

    total_output_tokens = successful_query.with_entities(
        func.sum(AIExecution.output_tokens)
    ).scalar() or 0

    total_tokens = successful_query.with_entities(
        func.sum(AIExecution.total_tokens)
    ).scalar() or 0

    # Executions by provider
    provider_counts = db.query(
        AIExecution.provider,
        func.count(AIExecution.id)
    ).filter(
        AIExecution.created_at >= start_date if start_date else True,
        AIExecution.created_at <= end_date if end_date else True
    ).group_by(AIExecution.provider).all()

    executions_by_provider = {
        provider: count for provider, count in provider_counts
    }

    # Executions by usage type
    usage_type_counts = db.query(
        AIExecution.usage_type,
        func.count(AIExecution.id)
    ).filter(
        AIExecution.created_at >= start_date if start_date else True,
        AIExecution.created_at <= end_date if end_date else True
    ).group_by(AIExecution.usage_type).all()

    executions_by_usage_type = {
        usage_type: count for usage_type, count in usage_type_counts
    }

    # Average execution time
    avg_exec_time = successful_query.with_entities(
        func.avg(AIExecution.execution_time_ms)
    ).scalar()

    return AIExecutionStats(
        total_executions=total_executions,
        total_input_tokens=int(total_input_tokens),
        total_output_tokens=int(total_output_tokens),
        total_tokens=int(total_tokens),
        executions_by_provider=executions_by_provider,
        executions_by_usage_type=executions_by_usage_type,
        avg_execution_time_ms=float(avg_exec_time) if avg_exec_time else None
    )


@router.get("/{execution_id}", response_model=AIExecutionResponse)
async def get_ai_execution(
    execution_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get detailed information about a specific AI execution.

    - **execution_id**: UUID of the AI execution
    """
    execution = db.query(AIExecution).filter(AIExecution.id == execution_id).first()

    if not execution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"AI execution with id '{execution_id}' not found"
        )

    return execution


@router.delete("/{execution_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ai_execution(
    execution_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Delete a specific AI execution log.

    - **execution_id**: UUID of the execution to delete
    """
    execution = db.query(AIExecution).filter(AIExecution.id == execution_id).first()

    if not execution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"AI execution with id '{execution_id}' not found"
        )

    db.delete(execution)
    db.commit()
    return None


@router.delete("/", status_code=status.HTTP_204_NO_CONTENT)
async def delete_old_executions(
    days: int = Query(30, ge=1, le=365, description="Delete executions older than this many days"),
    db: Session = Depends(get_db)
):
    """
    Delete AI executions older than specified days.

    - **days**: Number of days to keep (default: 30, max: 365)

    Useful for cleaning up old logs and saving database space.
    """
    cutoff_date = datetime.utcnow() - timedelta(days=days)

    deleted_count = db.query(AIExecution).filter(
        AIExecution.created_at < cutoff_date
    ).delete()

    db.commit()

    return None
