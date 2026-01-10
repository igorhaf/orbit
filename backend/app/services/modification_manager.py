"""
Modification Manager Service

PROMPT #94 FASE 4 - Sistema de Bloqueio por Modificação

This service manages the blocking, approval, and rejection of task modifications.

Workflow:
1. AI suggests modification → similarity_detector detects >90% similarity
2. System calls block_task() → existing task gets BLOCKED status
3. User sees blocked task in "Bloqueados" Kanban column
4. User reviews the proposed modification (diff view in UI)
5. User approves → approve_modification() creates new task, archives old one
6. User rejects → reject_modification() unblocks task, discards modification

Features:
- Block task with pending modification
- Approve modification (create new task, archive old)
- Reject modification (unblock task, discard changes)
- Get all blocked tasks for a project

Usage:
    from app.services.modification_manager import (
        block_task,
        approve_modification,
        reject_modification,
        get_blocked_tasks
    )

    # When AI suggests modification (detected by similarity_detector)
    block_task(
        task=existing_task,
        proposed_modification={
            "title": "New improved title",
            "description": "New improved description",
            "similarity_score": 0.95
        },
        db=db
    )

    # User approves the modification
    new_task = approve_modification(task_id=task.id, db=db)

    # User rejects the modification
    reject_modification(task_id=task.id, db=db)
"""

import logging
from datetime import datetime
from typing import Dict, List, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.task import Task, TaskStatus

logger = logging.getLogger(__name__)


def block_task(
    task: Task,
    proposed_modification: Dict,
    db: Session,
    reason: str = "Modification suggested by AI"
) -> Task:
    """
    Block a task with a proposed modification pending user approval.

    This is called when similarity_detector detects that AI is trying to
    modify an existing task (similarity >= 90%) instead of creating a new one.

    Args:
        task: The existing task to block
        proposed_modification: Dict with proposed changes:
            {
                "title": str,
                "description": str,
                "similarity_score": float,
                "suggested_at": str (ISO timestamp),
                "interview_id": str (optional)
            }
        db: Database session
        reason: Reason for blocking (default: "Modification suggested by AI")

    Returns:
        The blocked task

    Example:
        >>> blocked_task = block_task(
        ...     task=existing_task,
        ...     proposed_modification={
        ...         "title": "Add JWT authentication with refresh tokens",
        ...         "description": "Implement JWT...",
        ...         "similarity_score": 0.95,
        ...         "suggested_at": "2026-01-09T12:34:56",
        ...         "interview_id": "uuid"
        ...     },
        ...     db=db
        ... )
        >>> print(f"Task blocked: {blocked_task.title}")
        >>> print(f"Pending modification: {blocked_task.pending_modification}")
    """
    # Add metadata to proposed modification
    proposed_modification["suggested_at"] = datetime.utcnow().isoformat()
    proposed_modification["original_title"] = task.title
    proposed_modification["original_description"] = task.description

    # Block the task
    task.status = TaskStatus.BLOCKED
    task.blocked_reason = reason
    task.pending_modification = proposed_modification

    # Update status history
    if task.status_history is None:
        task.status_history = []

    task.status_history.append({
        "from": task.status.value if hasattr(task.status, 'value') else str(task.status),
        "to": "blocked",
        "at": datetime.utcnow().isoformat(),
        "by": "system",
        "reason": reason
    })

    db.commit()
    db.refresh(task)

    logger.warning(
        f"🚨 Task BLOCKED: '{task.title}' (ID: {task.id})\n"
        f"   Reason: {reason}\n"
        f"   Proposed modification similarity: {proposed_modification.get('similarity_score', 0):.2%}\n"
        f"   User must approve/reject via UI"
    )

    return task


def approve_modification(
    task_id: UUID,
    db: Session,
    approved_by: str = "user"
) -> Task:
    """
    Approve a proposed modification - creates new task with modifications.

    When user approves:
    1. Create new task with the proposed modifications
    2. Mark old task as DONE (archived, not deleted for traceability)
    3. Add comment to old task: "Replaced by new task [link]"
    4. Clear pending_modification field

    Args:
        task_id: UUID of the blocked task
        db: Database session
        approved_by: Who approved (default: "user")

    Returns:
        The newly created task (with modifications applied)

    Raises:
        ValueError: If task not found or not blocked

    Example:
        >>> new_task = approve_modification(task_id=blocked_task.id, db=db)
        >>> print(f"New task created: {new_task.title}")
        >>> print(f"Old task archived: {blocked_task.status == TaskStatus.DONE}")
    """
    # Get the blocked task
    task = db.query(Task).filter(Task.id == task_id).first()

    if not task:
        raise ValueError(f"Task {task_id} not found")

    if task.status != TaskStatus.BLOCKED:
        raise ValueError(f"Task {task_id} is not blocked (status: {task.status})")

    if not task.pending_modification:
        raise ValueError(f"Task {task_id} has no pending modification")

    # Get proposed modification data
    modification = task.pending_modification

    # Create new task with modifications
    new_task = Task(
        title=modification.get("title", task.title),
        description=modification.get("description", task.description),
        project_id=task.project_id,
        status=TaskStatus.BACKLOG,  # Start in backlog
        item_type=task.item_type,
        parent_id=task.parent_id,
        priority=task.priority,
        type=task.type,
        entity=task.entity,
        complexity=task.complexity,
        depends_on=task.depends_on,
        labels=task.labels,
        components=task.components,
        # Traceability
        comments=[{
            "text": f"Created from approved modification of task: {task.title}",
            "created_at": datetime.utcnow().isoformat(),
            "created_by": "system"
        }]
    )

    db.add(new_task)
    db.flush()  # Get new_task.id

    # Archive old task (mark as DONE, not delete)
    task.status = TaskStatus.DONE
    task.workflow_state = "closed"
    task.resolution = None  # Not a bug resolution
    task.blocked_reason = None  # Clear blocking

    # Add comment to old task
    if task.comments is None:
        task.comments = []

    task.comments.append({
        "text": f"This task was replaced by a modified version (Task ID: {new_task.id})",
        "created_at": datetime.utcnow().isoformat(),
        "created_by": "system",
        "approved_by": approved_by
    })

    # Update status history
    if task.status_history is None:
        task.status_history = []

    task.status_history.append({
        "from": "blocked",
        "to": "done",
        "at": datetime.utcnow().isoformat(),
        "by": approved_by,
        "reason": f"Modification approved - replaced by task {new_task.id}"
    })

    # Clear pending modification
    task.pending_modification = None

    db.commit()
    db.refresh(task)
    db.refresh(new_task)

    logger.info(
        f"✅ Modification APPROVED for task '{task.title}' (ID: {task.id})\n"
        f"   New task created: '{new_task.title}' (ID: {new_task.id})\n"
        f"   Old task archived (status: DONE)\n"
        f"   Approved by: {approved_by}"
    )

    return new_task


def reject_modification(
    task_id: UUID,
    db: Session,
    rejected_by: str = "user",
    rejection_reason: Optional[str] = None
) -> Task:
    """
    Reject a proposed modification - unblocks task and discards changes.

    When user rejects:
    1. Unblock the task (restore to original status, likely BACKLOG or TODO)
    2. Clear pending_modification field
    3. Add comment explaining rejection
    4. Task continues as originally defined

    Args:
        task_id: UUID of the blocked task
        db: Database session
        rejected_by: Who rejected (default: "user")
        rejection_reason: Optional reason for rejection

    Returns:
        The unblocked task (restored to original state)

    Raises:
        ValueError: If task not found or not blocked

    Example:
        >>> unblocked_task = reject_modification(
        ...     task_id=blocked_task.id,
        ...     db=db,
        ...     rejection_reason="AI suggested changes are not needed"
        ... )
        >>> print(f"Task unblocked: {unblocked_task.status}")
    """
    # Get the blocked task
    task = db.query(Task).filter(Task.id == task_id).first()

    if not task:
        raise ValueError(f"Task {task_id} not found")

    if task.status != TaskStatus.BLOCKED:
        raise ValueError(f"Task {task_id} is not blocked (status: {task.status})")

    if not task.pending_modification:
        raise ValueError(f"Task {task_id} has no pending modification")

    # Determine previous status (likely BACKLOG)
    previous_status = TaskStatus.BACKLOG
    if task.status_history:
        # Find the last status before "blocked"
        for entry in reversed(task.status_history):
            if entry.get("to") == "blocked":
                previous_status = TaskStatus(entry.get("from", "backlog"))
                break

    # Unblock the task
    task.status = previous_status
    task.blocked_reason = None

    # Add rejection comment
    if task.comments is None:
        task.comments = []

    comment_text = "Proposed modification was rejected by user"
    if rejection_reason:
        comment_text += f": {rejection_reason}"

    task.comments.append({
        "text": comment_text,
        "created_at": datetime.utcnow().isoformat(),
        "created_by": "system",
        "rejected_by": rejected_by
    })

    # Update status history
    if task.status_history is None:
        task.status_history = []

    task.status_history.append({
        "from": "blocked",
        "to": previous_status.value,
        "at": datetime.utcnow().isoformat(),
        "by": rejected_by,
        "reason": f"Modification rejected: {rejection_reason or 'No reason provided'}"
    })

    # Clear pending modification
    task.pending_modification = None

    db.commit()
    db.refresh(task)

    logger.info(
        f"❌ Modification REJECTED for task '{task.title}' (ID: {task.id})\n"
        f"   Task unblocked (restored to: {previous_status.value})\n"
        f"   Rejected by: {rejected_by}\n"
        f"   Reason: {rejection_reason or 'Not specified'}"
    )

    return task


def get_blocked_tasks(
    project_id: UUID,
    db: Session
) -> List[Task]:
    """
    Get all blocked tasks for a project (for "Bloqueados" Kanban column).

    Args:
        project_id: UUID of the project
        db: Database session

    Returns:
        List of blocked tasks with pending modifications

    Example:
        >>> blocked = get_blocked_tasks(project_id=project.id, db=db)
        >>> for task in blocked:
        ...     print(f"Blocked: {task.title}")
        ...     print(f"Proposed: {task.pending_modification['title']}")
        ...     print(f"Similarity: {task.pending_modification['similarity_score']:.2%}")
    """
    tasks = db.query(Task).filter(
        Task.project_id == project_id,
        Task.status == TaskStatus.BLOCKED
    ).all()

    logger.debug(f"Found {len(tasks)} blocked tasks for project {project_id}")

    return tasks


def get_modification_summary(task: Task) -> Optional[Dict]:
    """
    Get a summary of the pending modification for UI display.

    Args:
        task: The blocked task

    Returns:
        Dict with modification summary or None if not blocked

    Example:
        >>> summary = get_modification_summary(blocked_task)
        >>> print(summary)
        {
            "original_title": "Create user auth",
            "proposed_title": "Add JWT authentication",
            "similarity_score": 0.95,
            "suggested_at": "2026-01-09T12:34:56",
            "changes": {
                "title_changed": True,
                "description_changed": True
            }
        }
    """
    if task.status != TaskStatus.BLOCKED or not task.pending_modification:
        return None

    modification = task.pending_modification

    return {
        "original_title": modification.get("original_title", task.title),
        "original_description": modification.get("original_description", task.description),
        "proposed_title": modification.get("title"),
        "proposed_description": modification.get("description"),
        "similarity_score": modification.get("similarity_score"),
        "suggested_at": modification.get("suggested_at"),
        "interview_id": modification.get("interview_id"),
        "changes": {
            "title_changed": modification.get("title") != modification.get("original_title"),
            "description_changed": modification.get("description") != modification.get("original_description")
        }
    }
