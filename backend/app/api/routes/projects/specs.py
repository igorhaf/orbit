"""
Projects API - Specs endpoints.
Specs discovery, listing, toggling.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from uuid import UUID
from datetime import datetime
from pathlib import Path
import logging

from app.database import get_db
from app.models.project import Project
from app.models.spec import Spec, SpecScope
from app.services.pattern_discovery import PatternDiscoveryService
from app.services.project_service import (
    MAX_SPECS_PER_PROJECT,
    _effective_max_patterns,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/{project_id}/discover-specs")
async def discover_project_specs(
    project_id: UUID,
    replace_existing: bool = Query(False, description="Delete existing specs before discovery"),
    max_patterns: Optional[int] = Query(None, ge=1, le=100, description="Maximum patterns to discover (uses system setting if not provided)"),
    min_occurrences: int = Query(3, ge=2, le=10, description="Minimum file occurrences for a pattern"),
    db: Session = Depends(get_db)
):
    """
    Discover and save project-specific code patterns.

    Project-Specific Specs: AI-powered pattern discovery

    Scans the project codebase, identifies repeating patterns,
    and saves them to the specs table for use during task execution.

    **POST** `/api/v1/projects/{project_id}/discover-specs`

    **Query Parameters:**
    - `replace_existing`: Delete existing specs before discovery (default: false)
    - `max_patterns`: Maximum patterns to discover (default: 20)
    - `min_occurrences`: Minimum file count to consider a pattern (default: 3)

    **Response:**
    ```json
    {
        "project_id": "uuid",
        "discovered_count": 15,
        "patterns": [
            {
                "title": "Controller Pattern",
                "category": "api",
                "confidence": 0.85
            }
        ]
    }
    ```
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto nao encontrado")

    # Check if project has code_path configured
    if not project.code_path:
        raise HTTPException(
            status_code=400,
            detail="code_path do projeto nao configurado. Configure o code_path antes de executar a descoberta."
        )

    # Verify code_path exists
    code_path = Path(project.code_path)
    if not code_path.exists():
        raise HTTPException(
            status_code=400,
            detail=f"Caminho do codigo nao existe: {project.code_path}"
        )

    # Delete existing specs if requested
    if replace_existing:
        deleted_count = db.query(Spec).filter(
            Spec.project_id == project_id,
            Spec.scope == SpecScope.PROJECT
        ).delete()
        db.commit()
        logger.info(f"Deleted {deleted_count} existing specs for project {project_id}")

    # Calculate effective max patterns (cap at 50 per project)
    if max_patterns is None:
        effective_max = _effective_max_patterns(db, project_id)
    else:
        existing_count = db.query(Spec).filter(Spec.project_id == project_id).count()
        effective_max = max(0, min(max_patterns, MAX_SPECS_PER_PROJECT - existing_count))

    if effective_max <= 0:
        return {
            "project_id": str(project_id),
            "discovered_count": 0,
            "patterns": [],
            "message": f"Projeto ja possui {MAX_SPECS_PER_PROJECT} specs (maximo atingido)"
        }

    # Run pattern discovery
    discovery_service = PatternDiscoveryService(db)

    try:
        patterns = await discovery_service.discover_patterns(
            project_path=code_path,
            project_id=project_id,
            max_patterns=effective_max,
            min_occurrences=min_occurrences
        )

        # Sync discovered specs to RAG
        try:
            from app.services.spec_rag_sync import SpecRAGSync
            spec_sync = SpecRAGSync(db)
            sync_result = spec_sync.sync_all_framework_specs()
            logger.info(f"Specs synced to RAG after manual discovery")
        except Exception as e:
            logger.warning(f"RAG sync after discovery failed: {e}")

        return {
            "project_id": str(project_id),
            "discovered_count": len(patterns),
            "patterns_saved": len(patterns),
            "patterns": [
                {
                    "title": p.title,
                    "category": p.category,
                    "spec_type": p.spec_type,
                    "confidence": p.confidence_score,
                    "occurrences": p.occurrences,
                    "is_framework_worthy": p.is_framework_worthy
                }
                for p in patterns
            ]
        }

    except Exception as e:
        logger.error(f"Pattern discovery failed for project {project_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Descoberta de padroes falhou: {str(e)}"
        )

@router.get("/{project_id}/specs")
async def get_project_specs(
    project_id: UUID,
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    category: Optional[str] = Query(None, description="Filter by category"),
    db: Session = Depends(get_db)
):
    """
    Get all discovered specs for a project.

    Project-Specific Specs: List patterns stored in database

    **GET** `/api/v1/projects/{project_id}/specs`

    **Query Parameters:**
    - `is_active`: Filter by active status (optional)
    - `category`: Filter by category (optional)

    **Response:**
    ```json
    {
        "project_id": "uuid",
        "specs_count": 15,
        "specs": [
            {
                "id": "uuid",
                "title": "Controller Pattern",
                "category": "api",
                "spec_type": "controller",
                "language": "php",
                "is_active": true,
                "confidence": 0.85,
                "occurrences": 12,
                "created_at": "2026-01-18T10:00:00Z"
            }
        ]
    }
    ```
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto nao encontrado")

    # Build query
    query = db.query(Spec).filter(
        Spec.project_id == project_id,
        Spec.scope == SpecScope.PROJECT
    )

    # Apply filters
    if is_active is not None:
        query = query.filter(Spec.is_active == is_active)
    if category:
        query = query.filter(Spec.category == category)

    # Order by created_at descending
    specs = query.order_by(Spec.created_at.desc()).all()

    return {
        "project_id": str(project_id),
        "specs_count": len(specs),
        "specs": [
            {
                "id": str(s.id),
                "title": s.title,
                "description": s.description,
                "category": s.category,
                "name": s.name,
                "spec_type": s.spec_type,
                "language": s.language,
                "is_active": s.is_active,
                "usage_count": s.usage_count,
                "confidence": s.discovery_metadata.get("confidence_score", 0) if s.discovery_metadata else 0,
                "occurrences": s.discovery_metadata.get("occurrences", 0) if s.discovery_metadata else 0,
                "key_characteristics": s.discovery_metadata.get("key_characteristics", []) if s.discovery_metadata else [],
                "created_at": s.created_at.isoformat() if s.created_at else None,
                "updated_at": s.updated_at.isoformat() if s.updated_at else None
            }
            for s in specs
        ]
    }

@router.patch("/{project_id}/specs/{spec_id}/toggle")
async def toggle_spec_active(
    project_id: UUID,
    spec_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Toggle a spec's active status.

    **PATCH** `/api/v1/projects/{project_id}/specs/{spec_id}/toggle`

    **Response:**
    ```json
    {
        "id": "uuid",
        "title": "Controller Pattern",
        "is_active": false
    }
    ```
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto nao encontrado")

    # Find spec
    spec = db.query(Spec).filter(
        Spec.id == spec_id,
        Spec.project_id == project_id
    ).first()

    if not spec:
        raise HTTPException(status_code=404, detail="Spec nao encontrada")

    # Toggle active status
    spec.is_active = not spec.is_active
    spec.updated_at = datetime.utcnow()
    db.commit()

    return {
        "id": str(spec.id),
        "title": spec.title,
        "is_active": spec.is_active
    }
