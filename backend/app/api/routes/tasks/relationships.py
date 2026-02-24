"""
Tasks Relationships Router
Task relationship endpoints: create, list, delete relationships.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID
from datetime import datetime

from app.database import get_db
from app.models.task import Task
from app.models.task_relationship import TaskRelationship, RelationshipType
from app.schemas.task import (
    RelationshipCreate,
    RelationshipResponse,
)

import logging

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================================
# JIRA TRANSFORMATION - RELATIONSHIP ENDPOINTS
# ============================================================================

@router.post("/{task_id}/relationships", response_model=RelationshipResponse, status_code=status.HTTP_201_CREATED)
async def create_relationship(
    task_id: UUID,
    relationship_data: RelationshipCreate,
    db: Session = Depends(get_db)
):
    """
    Create a task relationship (blocks, depends_on, relates_to, etc.).

    POST /api/v1/tasks/{task_id}/relationships
    Body: {"source_task_id": "uuid", "target_task_id": "uuid", "relationship_type": "blocks"}

    Relationship types:
    - blocks: This task blocks the target
    - blocked_by: This task is blocked by the target
    - depends_on: This task depends on the target
    - relates_to: This task relates to the target
    - duplicates: This task duplicates the target
    - clones: This task clones the target
    """
    # Verify both tasks exist
    source_task = db.query(Task).filter(Task.id == relationship_data.source_task_id).first()
    target_task = db.query(Task).filter(Task.id == relationship_data.target_task_id).first()

    if not source_task:
        raise HTTPException(status_code=404, detail=f"Tarefa de origem {relationship_data.source_task_id} não encontrada")
    if not target_task:
        raise HTTPException(status_code=404, detail=f"Tarefa de destino {relationship_data.target_task_id} não encontrada")

    # Check for existing relationship
    existing = db.query(TaskRelationship).filter(
        TaskRelationship.source_task_id == relationship_data.source_task_id,
        TaskRelationship.target_task_id == relationship_data.target_task_id,
        TaskRelationship.relationship_type == relationship_data.relationship_type
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="Relacionamento ja existe")

    # Create relationship
    from uuid import uuid4
    relationship = TaskRelationship(
        id=uuid4(),
        source_task_id=relationship_data.source_task_id,
        target_task_id=relationship_data.target_task_id,
        relationship_type=relationship_data.relationship_type,
        created_at=datetime.utcnow()
    )

    db.add(relationship)
    db.commit()
    db.refresh(relationship)

    return relationship


@router.get("/{task_id}/relationships", response_model=List[RelationshipResponse])
async def get_task_relationships(
    task_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get all relationships for a task (both as source and target).

    GET /api/v1/tasks/{task_id}/relationships

    Returns all relationships where task is either source or target.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")

    # Get relationships where task is source OR target
    relationships = db.query(TaskRelationship).filter(
        (TaskRelationship.source_task_id == task_id) |
        (TaskRelationship.target_task_id == task_id)
    ).all()

    return relationships


@router.delete("/relationships/{relationship_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_relationship(
    relationship_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Delete a task relationship.

    DELETE /api/v1/tasks/relationships/{relationship_id}

    Returns 204 No Content on success.
    """
    relationship = db.query(TaskRelationship).filter(TaskRelationship.id == relationship_id).first()

    if not relationship:
        raise HTTPException(status_code=404, detail="Relacionamento não encontrado")

    db.delete(relationship)
    db.commit()

    return None
