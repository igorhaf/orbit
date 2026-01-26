"""
Discovery Queue API Router
Manages projects queued for pattern discovery.

Project-Specific Specs: When a task is executed without specs,
the project is added to this queue for manual validation.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from pathlib import Path
import logging

from app.database import get_db
from app.models.discovery_queue import DiscoveryQueue, DiscoveryQueueStatus
from app.models.project import Project
from app.services.pattern_discovery import PatternDiscoveryService

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/")
async def list_discovery_queue(
    status: Optional[str] = Query(None, description="Filter by status (pending, processing, completed, dismissed)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(50, ge=1, le=100, description="Maximum number of records to return"),
    db: Session = Depends(get_db)
):
    """
    List all items in the discovery queue.

    **GET** `/api/v1/discovery-queue`

    **Query Parameters:**
    - `status`: Filter by status (optional)
    - `skip`: Pagination offset (default: 0)
    - `limit`: Pagination limit (default: 50)

    **Response:**
    ```json
    {
        "total": 5,
        "pending_count": 3,
        "items": [
            {
                "id": "uuid",
                "project_id": "uuid",
                "project_name": "My Project",
                "reason": "task_execution_without_specs",
                "status": "pending",
                "created_at": "2026-01-18T10:00:00Z"
            }
        ]
    }
    ```
    """
    query = db.query(DiscoveryQueue)

    # Apply status filter
    if status:
        try:
            status_enum = DiscoveryQueueStatus(status)
            query = query.filter(DiscoveryQueue.status == status_enum)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status. Must be one of: {[s.value for s in DiscoveryQueueStatus]}"
            )

    # Get total count before pagination
    total = query.count()

    # Get pending count
    pending_count = db.query(DiscoveryQueue).filter(
        DiscoveryQueue.status == DiscoveryQueueStatus.PENDING
    ).count()

    # Order by created_at descending and apply pagination
    items = query.order_by(DiscoveryQueue.created_at.desc()).offset(skip).limit(limit).all()

    return {
        "total": total,
        "pending_count": pending_count,
        "items": [
            {
                "id": str(item.id),
                "project_id": str(item.project_id),
                "project_name": item.project.name if item.project else "Unknown",
                "task_id": str(item.task_id) if item.task_id else None,
                "task_title": item.task.title if item.task else None,
                "reason": item.reason,
                "status": item.status.value,
                "created_at": item.created_at.isoformat() if item.created_at else None,
                "processed_at": item.processed_at.isoformat() if item.processed_at else None
            }
            for item in items
        ]
    }


@router.get("/{item_id}")
async def get_queue_item(
    item_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get a specific discovery queue item.

    **GET** `/api/v1/discovery-queue/{item_id}`
    """
    item = db.query(DiscoveryQueue).filter(DiscoveryQueue.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Queue item not found")

    return {
        "id": str(item.id),
        "project_id": str(item.project_id),
        "project_name": item.project.name if item.project else "Unknown",
        "project_code_path": item.project.code_path if item.project else None,
        "task_id": str(item.task_id) if item.task_id else None,
        "task_title": item.task.title if item.task else None,
        "reason": item.reason,
        "status": item.status.value,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "processed_at": item.processed_at.isoformat() if item.processed_at else None
    }


@router.post("/{item_id}/process")
async def process_queue_item(
    item_id: UUID,
    max_patterns: int = Query(20, ge=1, le=50, description="Maximum patterns to discover"),
    min_occurrences: int = Query(3, ge=2, le=10, description="Minimum file occurrences"),
    db: Session = Depends(get_db)
):
    """
    Process a queue item by running pattern discovery.

    **POST** `/api/v1/discovery-queue/{item_id}/process`

    **Query Parameters:**
    - `max_patterns`: Maximum patterns to discover (default: 20)
    - `min_occurrences`: Minimum file occurrences for a pattern (default: 3)

    **Response:**
    ```json
    {
        "id": "uuid",
        "status": "completed",
        "discovered_count": 15,
        "patterns": [...]
    }
    ```
    """
    # Find queue item
    item = db.query(DiscoveryQueue).filter(DiscoveryQueue.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Queue item not found")

    if item.status != DiscoveryQueueStatus.PENDING:
        raise HTTPException(
            status_code=400,
            detail=f"Queue item is not pending. Current status: {item.status.value}"
        )

    # Get project
    project = item.project
    if not project:
        raise HTTPException(status_code=404, detail="Associated project not found")

    # Check code_path
    if not project.code_path:
        raise HTTPException(
            status_code=400,
            detail="Project code_path not configured"
        )

    code_path = Path(project.code_path)
    if not code_path.exists():
        raise HTTPException(
            status_code=400,
            detail=f"Code path does not exist: {project.code_path}"
        )

    # Mark as processing
    item.status = DiscoveryQueueStatus.PROCESSING
    db.commit()

    try:
        # Run pattern discovery
        discovery_service = PatternDiscoveryService(db)
        patterns = await discovery_service.discover_patterns(
            project_path=code_path,
            project_id=project.id,
            max_patterns=max_patterns,
            min_occurrences=min_occurrences
        )

        # Mark as completed
        item.status = DiscoveryQueueStatus.COMPLETED
        item.processed_at = datetime.utcnow()
        db.commit()

        return {
            "id": str(item.id),
            "status": "completed",
            "discovered_count": len(patterns),
            "patterns": [
                {
                    "title": p.title,
                    "category": p.category,
                    "confidence": p.confidence_score
                }
                for p in patterns
            ]
        }

    except Exception as e:
        logger.error(f"Pattern discovery failed for queue item {item_id}: {e}")

        # Mark as failed
        item.status = DiscoveryQueueStatus.FAILED
        item.processed_at = datetime.utcnow()
        db.commit()

        raise HTTPException(
            status_code=500,
            detail=f"Pattern discovery failed: {str(e)}"
        )


@router.post("/{item_id}/dismiss")
async def dismiss_queue_item(
    item_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Dismiss a queue item without running discovery.

    **POST** `/api/v1/discovery-queue/{item_id}/dismiss`

    **Response:**
    ```json
    {
        "id": "uuid",
        "status": "dismissed"
    }
    ```
    """
    # Find queue item
    item = db.query(DiscoveryQueue).filter(DiscoveryQueue.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Queue item not found")

    if item.status not in [DiscoveryQueueStatus.PENDING, DiscoveryQueueStatus.FAILED]:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot dismiss item with status: {item.status.value}"
        )

    # Mark as dismissed
    item.status = DiscoveryQueueStatus.DISMISSED
    item.processed_at = datetime.utcnow()
    db.commit()

    return {
        "id": str(item.id),
        "status": "dismissed"
    }


@router.delete("/{item_id}")
async def delete_queue_item(
    item_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Delete a queue item.

    **DELETE** `/api/v1/discovery-queue/{item_id}`

    **Response:**
    ```json
    {
        "deleted": true,
        "id": "uuid"
    }
    ```
    """
    # Find queue item
    item = db.query(DiscoveryQueue).filter(DiscoveryQueue.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Queue item not found")

    db.delete(item)
    db.commit()

    return {
        "deleted": True,
        "id": str(item_id)
    }


@router.delete("/")
async def clear_completed_items(
    db: Session = Depends(get_db)
):
    """
    Delete all completed and dismissed items from the queue.

    **DELETE** `/api/v1/discovery-queue`

    **Response:**
    ```json
    {
        "deleted_count": 15
    }
    ```
    """
    deleted_count = db.query(DiscoveryQueue).filter(
        DiscoveryQueue.status.in_([
            DiscoveryQueueStatus.COMPLETED,
            DiscoveryQueueStatus.DISMISSED
        ])
    ).delete(synchronize_session=False)

    db.commit()

    return {
        "deleted_count": deleted_count
    }
