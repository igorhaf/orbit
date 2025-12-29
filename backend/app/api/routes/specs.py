"""
Specs API Router (PROMPT #47 - Phase 2)
Dynamic specifications system for token reduction

KEY FEATURE: /interview-options endpoint generates interview questions
dynamically from available specs. Adding new specs automatically updates interviews.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from uuid import UUID

from app.database import get_db
from app.models.spec import Spec
from app.schemas.spec import (
    SpecCreate,
    SpecUpdate,
    SpecResponse,
    InterviewOptions,
    InterviewOption
)

router = APIRouter()


@router.get("/interview-options", response_model=InterviewOptions)
async def get_interview_options(db: Session = Depends(get_db)):
    """
    Get available frameworks for interview questions (DYNAMIC).

    This endpoint is THE KEY to the dynamic system:
    - Queries specs table for available frameworks
    - Groups by category (backend, database, frontend, css)
    - Returns only frameworks that have active specs
    - Adding new specs automatically makes them available

    No code changes needed to add new frameworks!

    Returns:
        InterviewOptions: Available frameworks grouped by category
    """

    # Query distinct frameworks by category with spec counts
    backend_specs = db.query(
        Spec.name,
        func.count(Spec.id).label('count')
    ).filter(
        Spec.category == 'backend',
        Spec.is_active == True
    ).group_by(Spec.name).all()

    database_specs = db.query(
        Spec.name,
        func.count(Spec.id).label('count')
    ).filter(
        Spec.category == 'database',
        Spec.is_active == True
    ).group_by(Spec.name).all()

    frontend_specs = db.query(
        Spec.name,
        func.count(Spec.id).label('count')
    ).filter(
        Spec.category == 'frontend',
        Spec.is_active == True
    ).group_by(Spec.name).all()

    css_specs = db.query(
        Spec.name,
        func.count(Spec.id).label('count')
    ).filter(
        Spec.category == 'css',
        Spec.is_active == True
    ).group_by(Spec.name).all()

    # Format options with proper labels
    return InterviewOptions(
        backend=[_format_option(name, count, 'backend') for name, count in backend_specs],
        database=[_format_option(name, count, 'database') for name, count in database_specs],
        frontend=[_format_option(name, count, 'frontend') for name, count in frontend_specs],
        css=[_format_option(name, count, 'css') for name, count in css_specs]
    )


def _format_option(name: str, count: int, category: str) -> InterviewOption:
    """
    Format framework name into interview option.

    Maps internal names to user-friendly labels.
    Can be extended with more frameworks without code changes.
    """
    # Label mappings (can be moved to database later for full dynamism)
    labels = {
        # Backend
        'laravel': ('Laravel (PHP)', 'PHP framework for web artisans'),
        'django': ('Django (Python)', 'High-level Python web framework'),
        'fastapi': ('FastAPI (Python)', 'Modern Python API framework'),
        'express': ('Express.js (Node.js)', 'Fast Node.js web framework'),

        # Database
        'postgresql': ('PostgreSQL', 'Advanced open source database'),
        'mysql': ('MySQL', 'Popular open source database'),
        'mongodb': ('MongoDB', 'NoSQL document database'),
        'sqlite': ('SQLite', 'Lightweight embedded database'),

        # Frontend
        'nextjs': ('Next.js (React)', 'React framework for production'),
        'react': ('React', 'JavaScript library for UIs'),
        'vue': ('Vue.js', 'Progressive JavaScript framework'),
        'angular': ('Angular', 'Platform for web applications'),

        # CSS
        'tailwind': ('Tailwind CSS', 'Utility-first CSS framework'),
        'bootstrap': ('Bootstrap', 'Popular CSS framework'),
        'materialui': ('Material UI', 'React UI component library'),
        'custom': ('Custom CSS', 'Custom styling solution'),
    }

    label, description = labels.get(name, (name.title(), f'{category} framework'))

    return InterviewOption(
        id=name,
        label=label,
        description=description,
        specs_count=count
    )


@router.get("/", response_model=List[SpecResponse])
async def list_specs(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    category: Optional[str] = Query(None, description="Filter by category"),
    name: Optional[str] = Query(None, description="Filter by framework name"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    db: Session = Depends(get_db)
):
    """
    List all specs with optional filtering.

    - **category**: Filter by category (backend, frontend, database, css)
    - **name**: Filter by framework name
    - **is_active**: Filter by active status
    """
    query = db.query(Spec)

    if category:
        query = query.filter(Spec.category == category)
    if name:
        query = query.filter(Spec.name == name)
    if is_active is not None:
        query = query.filter(Spec.is_active == is_active)

    specs = query.order_by(Spec.category, Spec.name, Spec.spec_type).offset(skip).limit(limit).all()

    return specs


@router.get("/{spec_id}", response_model=SpecResponse)
async def get_spec(
    spec_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get a specific spec by ID.

    - **spec_id**: UUID of the spec
    """
    spec = db.query(Spec).filter(Spec.id == spec_id).first()

    if not spec:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Spec {spec_id} not found"
        )

    return spec


@router.post("/", response_model=SpecResponse, status_code=status.HTTP_201_CREATED)
async def create_spec(
    spec_data: SpecCreate,
    db: Session = Depends(get_db)
):
    """
    Create a new spec.

    Adding a new spec automatically makes it available in interviews!
    """
    spec = Spec(**spec_data.model_dump())

    db.add(spec)
    db.commit()
    db.refresh(spec)

    return spec


@router.patch("/{spec_id}", response_model=SpecResponse)
async def update_spec(
    spec_id: UUID,
    spec_update: SpecUpdate,
    db: Session = Depends(get_db)
):
    """
    Update an existing spec.

    - **spec_id**: UUID of the spec
    """
    spec = db.query(Spec).filter(Spec.id == spec_id).first()

    if not spec:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Spec {spec_id} not found"
        )

    # Update fields
    update_data = spec_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(spec, field, value)

    db.commit()
    db.refresh(spec)

    return spec


@router.delete("/{spec_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_spec(
    spec_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Delete a spec.

    Note: This will remove the spec from interview options.

    - **spec_id**: UUID of the spec to delete
    """
    spec = db.query(Spec).filter(Spec.id == spec_id).first()

    if not spec:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Spec {spec_id} not found"
        )

    db.delete(spec)
    db.commit()

    return None


@router.get("/by-stack/{category}/{name}", response_model=List[SpecResponse])
async def get_specs_by_stack(
    category: str,
    name: str,
    db: Session = Depends(get_db)
):
    """
    Get all specs for a specific stack choice.

    Used in Phase 3 to fetch specs for prompt generation.

    - **category**: Category (backend, frontend, database, css)
    - **name**: Framework name (laravel, nextjs, etc)
    """
    specs = db.query(Spec).filter(
        Spec.category == category,
        Spec.name == name,
        Spec.is_active == True
    ).order_by(Spec.spec_type).all()

    return specs
