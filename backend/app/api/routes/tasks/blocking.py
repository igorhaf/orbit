"""
Tasks Blocking Router
Blocking system endpoints: approve/reject modifications, blocking analytics.

PROMPT #94 FASE 4 - Blocking System for Modification Detection
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel

from app.database import get_db
from app.models.task import Task, TaskStatus, ItemType, PriorityLevel
from app.schemas.task import TaskResponse

import logging

logger = logging.getLogger(__name__)

router = APIRouter()


class RejectModificationRequest(BaseModel):
    """Request model for rejecting a proposed modification."""
    rejection_reason: Optional[str] = None


class BlockingAnalytics(BaseModel):
    """Analytics data for the blocking system."""
    # Current state
    total_blocked: int
    total_approved: int
    total_rejected: int

    # Rates
    approval_rate: float  # % of resolved modifications that were approved
    rejection_rate: float  # % of resolved modifications that were rejected
    blocking_rate: float  # % of all tasks that got blocked

    # Similarity metrics
    avg_similarity_score: float
    similarity_distribution: Dict[str, int]  # {"90+": X, "80-90": Y, ...}

    # Timeline
    blocked_by_date: List[Dict[str, Any]]  # [{"date": "2026-01-09", "count": 5}, ...]

    # Project breakdown
    blocked_by_project: List[Dict[str, Any]]  # [{"project_name": "X", "count": Y}, ...]


# ============================================================================
# PROMPT #94 FASE 4 - BLOCKING SYSTEM FOR MODIFICATION DETECTION
# ============================================================================

@router.post("/{task_id}/approve-modification", response_model=TaskResponse)
async def approve_task_modification(
    task_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Approve a proposed modification - creates new task with modifications.

    PROMPT #94 FASE 4 - Blocking System Approval:

    When user approves:
    1. Create new task with the proposed modifications
    2. Mark old task as DONE (archived, not deleted for traceability)
    3. Add comment to old task: "Replaced by new task [link]"
    4. Clear pending_modification field

    POST /api/v1/tasks/{task_id}/approve-modification
    """
    from app.services.modification_manager import approve_modification

    try:
        new_task = approve_modification(task_id=task_id, db=db, approved_by="user")

        logger.info(
            f"✅ Modification approved for task {task_id}\n"
            f"   New task created: {new_task.id}"
        )

        return new_task

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post("/{task_id}/reject-modification", response_model=TaskResponse)
async def reject_task_modification(
    task_id: UUID,
    request: Optional[RejectModificationRequest] = None,
    db: Session = Depends(get_db)
):
    """
    Reject a proposed modification - unblocks task and discards changes.

    PROMPT #94 FASE 4 - Blocking System Rejection:

    When user rejects:
    1. Unblock the task (restore to original status, likely BACKLOG or TODO)
    2. Clear pending_modification field
    3. Add comment explaining rejection
    4. Task continues as originally defined

    POST /api/v1/tasks/{task_id}/reject-modification
    """
    from app.services.modification_manager import reject_modification

    try:
        rejection_reason = request.rejection_reason if request else None

        unblocked_task = reject_modification(
            task_id=task_id,
            db=db,
            rejected_by="user",
            rejection_reason=rejection_reason
        )

        logger.info(
            f"❌ Modification rejected for task {task_id}\n"
            f"   Task unblocked (restored to: {unblocked_task.status.value})\n"
            f"   Reason: {rejection_reason or 'Not specified'}"
        )

        return unblocked_task

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


# PROMPT #97 - BLOCKING ANALYTICS DASHBOARD
# ============================================================================

@router.get("/analytics/blocking", response_model=BlockingAnalytics)
async def get_blocking_analytics(
    project_id: Optional[UUID] = Query(None, description="Filter by project ID (optional)"),
    days: int = Query(30, ge=1, le=365, description="Number of days to analyze"),
    db: Session = Depends(get_db)
):
    """
    Get analytics and metrics for the blocking system.

    PROMPT #97 - Blocking Analytics Dashboard.

    GET /api/v1/tasks/analytics/blocking?project_id={uuid}&days=30
    """
    from datetime import timedelta
    from app.models.project import Project
    from sqlalchemy import func, and_, or_

    # Calculate date range
    end_date = datetime.utcnow()
    start_date = end_date - timedelta(days=days)

    # Base query for all tasks in the time range
    base_query = db.query(Task)

    if project_id:
        base_query = base_query.filter(Task.project_id == project_id)

    # CURRENT BLOCKED TASKS
    currently_blocked = base_query.filter(
        Task.status == TaskStatus.BLOCKED,
        Task.pending_modification.isnot(None)
    ).count()

    # APPROVED MODIFICATIONS
    total_approved = 0
    approved_tasks_with_history = base_query.filter(
        Task.status_history.isnot(None),
        Task.created_at >= start_date
    ).all()
    for task in approved_tasks_with_history:
        if task.status_history:
            for transition in task.status_history:
                if (transition.get('from') == 'blocked' and
                    transition.get('to') != 'blocked' and
                    'approved' in transition.get('reason', '').lower()):
                    total_approved += 1
                    break

    # REJECTED MODIFICATIONS
    rejected_tasks = []
    all_tasks_with_history = base_query.filter(
        Task.status_history.isnot(None),
        Task.created_at >= start_date
    ).all()

    for task in all_tasks_with_history:
        if task.status_history:
            for i, transition in enumerate(task.status_history):
                if (transition.get('from') == 'blocked' and
                    transition.get('to') != 'blocked' and
                    transition.get('by') == 'system' and
                    'rejected' in transition.get('reason', '').lower()):
                    rejected_tasks.append(task)
                    break

    total_rejected = len(rejected_tasks)

    # RATES CALCULATION
    total_resolved = total_approved + total_rejected
    approval_rate = total_approved / total_resolved if total_resolved > 0 else 0.0
    rejection_rate = total_rejected / total_resolved if total_resolved > 0 else 0.0

    # Blocking rate = (blocked + approved + rejected) / total tasks
    total_tasks = base_query.filter(Task.created_at >= start_date).count()
    total_blocking_events = currently_blocked + total_approved + total_rejected
    blocking_rate = total_blocking_events / total_tasks if total_tasks > 0 else 0.0

    # SIMILARITY METRICS
    tasks_with_modifications = base_query.filter(
        Task.pending_modification.isnot(None)
    ).all()

    similarity_scores = []
    similarity_distribution = {
        "90+": 0,
        "80-90": 0,
        "70-80": 0,
        "<70": 0
    }

    for task in tasks_with_modifications:
        score = None

        if task.pending_modification and isinstance(task.pending_modification, dict):
            score = task.pending_modification.get('similarity_score')

        if score and isinstance(score, (int, float)):
            similarity_scores.append(score)

            percentage = score * 100
            if percentage >= 90:
                similarity_distribution["90+"] += 1
            elif percentage >= 80:
                similarity_distribution["80-90"] += 1
            elif percentage >= 70:
                similarity_distribution["70-80"] += 1
            else:
                similarity_distribution["<70"] += 1

    avg_similarity_score = sum(similarity_scores) / len(similarity_scores) if similarity_scores else 0.0

    # TIMELINE DATA
    blocked_by_date_data = {}

    for task in tasks_with_modifications:
        task_date = task.created_at.date().isoformat()
        blocked_by_date_data[task_date] = blocked_by_date_data.get(task_date, 0) + 1

    blocked_by_date = [
        {"date": date, "count": count}
        for date, count in sorted(blocked_by_date_data.items(), reverse=True)
    ]

    # PROJECT BREAKDOWN
    if not project_id:
        project_counts = {}

        for task in tasks_with_modifications:
            if task.project_id:
                if task.project_id not in project_counts:
                    project = db.query(Project).filter(Project.id == task.project_id).first()
                    project_counts[task.project_id] = {
                        "project_id": str(task.project_id),
                        "project_name": project.name if project else "Unknown",
                        "count": 0
                    }
                project_counts[task.project_id]["count"] += 1

        blocked_by_project = sorted(
            project_counts.values(),
            key=lambda x: x["count"],
            reverse=True
        )
    else:
        project = db.query(Project).filter(Project.id == project_id).first()
        blocked_by_project = [{
            "project_id": str(project_id),
            "project_name": project.name if project else "Unknown",
            "count": len(tasks_with_modifications)
        }]

    logger.info(
        f"📊 Blocking Analytics Generated:\n"
        f"   Project: {project_id or 'All projects'}\n"
        f"   Days: {days}\n"
        f"   Currently Blocked: {currently_blocked}\n"
        f"   Approved: {total_approved}\n"
        f"   Rejected: {total_rejected}\n"
        f"   Approval Rate: {approval_rate:.1%}\n"
        f"   Avg Similarity: {avg_similarity_score:.2%}"
    )

    return BlockingAnalytics(
        total_blocked=currently_blocked,
        total_approved=total_approved,
        total_rejected=total_rejected,
        approval_rate=approval_rate,
        rejection_rate=rejection_rate,
        blocking_rate=blocking_rate,
        avg_similarity_score=avg_similarity_score,
        similarity_distribution=similarity_distribution,
        blocked_by_date=blocked_by_date,
        blocked_by_project=blocked_by_project
    )
