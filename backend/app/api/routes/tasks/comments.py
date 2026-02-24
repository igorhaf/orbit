"""
Tasks Comments Router
Comment endpoints: create, list, update, delete comments on tasks.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import datetime

from app.database import get_db
from app.models.task import Task
from app.models.task_comment import TaskComment, CommentType
from app.schemas.task import (
    CommentCreate,
    CommentUpdate,
    CommentResponse,
)

import logging

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================================
# JIRA TRANSFORMATION - COMMENT ENDPOINTS
# ============================================================================

@router.post("/{task_id}/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
async def create_comment(
    task_id: UUID,
    comment_data: CommentCreate,
    db: Session = Depends(get_db)
):
    """
    Add a comment to a task.

    POST /api/v1/tasks/{task_id}/comments
    Body: {"author": "username", "content": "comment text", "comment_type": "comment"}

    Comment types:
    - comment: Regular comment
    - system: System-generated comment
    - ai_insight: AI-generated insight
    - validation: Validation message
    - code_snippet: Code snippet
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")

    from uuid import uuid4
    comment = TaskComment(
        id=uuid4(),
        task_id=task_id,
        author=comment_data.author,
        content=comment_data.content,
        comment_type=comment_data.comment_type,
        comment_metadata=comment_data.comment_metadata,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )

    db.add(comment)
    db.commit()
    db.refresh(comment)

    return comment


@router.get("/{task_id}/comments", response_model=List[CommentResponse])
async def get_task_comments(
    task_id: UUID,
    comment_type: Optional[CommentType] = Query(None, description="Filter by comment type"),
    db: Session = Depends(get_db)
):
    """
    Get all comments for a task.

    GET /api/v1/tasks/{task_id}/comments?comment_type=comment

    Optionally filter by comment_type.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")

    query = db.query(TaskComment).filter(TaskComment.task_id == task_id)

    if comment_type:
        query = query.filter(TaskComment.comment_type == comment_type)

    comments = query.order_by(TaskComment.created_at).all()

    return comments


@router.patch("/comments/{comment_id}", response_model=CommentResponse)
async def update_comment(
    comment_id: UUID,
    comment_data: CommentUpdate,
    db: Session = Depends(get_db)
):
    """
    Update a comment.

    PATCH /api/v1/tasks/comments/{comment_id}
    Body: {"content": "updated text", "metadata": {...}}

    Only content and metadata can be updated.
    """
    comment = db.query(TaskComment).filter(TaskComment.id == comment_id).first()

    if not comment:
        raise HTTPException(status_code=404, detail="Comentário não encontrado")

    if comment_data.content is not None:
        comment.content = comment_data.content
    if comment_data.comment_metadata is not None:
        comment.comment_metadata = comment_data.comment_metadata

    comment.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(comment)

    return comment


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    comment_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Delete a comment.

    DELETE /api/v1/tasks/comments/{comment_id}

    Returns 204 No Content on success.
    """
    comment = db.query(TaskComment).filter(TaskComment.id == comment_id).first()

    if not comment:
        raise HTTPException(status_code=404, detail="Comentário não encontrado")

    db.delete(comment)
    db.commit()

    return None
