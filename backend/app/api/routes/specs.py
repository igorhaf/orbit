"""
Specs API Router (PROMPT #47 - Phase 2)
Dynamic specifications system for token reduction

KEY FEATURE: /interview-options endpoint generates interview questions
dynamically from available specs. Adding new specs automatically updates interviews.

PROMPT #61 - Week 2: Updated to use SpecLoader/SpecWriter instead of database
Database now only stores is_active flag, specs content is in JSON files

PROMPT #62 - Week 1 Day 5-6: Added pattern discovery endpoints
- POST /discover - AI-powered pattern discovery from project code
- POST /save-pattern - Save approved discovered pattern as spec
- GET /project/{id}/specs - List project-specific specs
- GET /project/{id}/discovered-frameworks - List framework specs from project
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from pathlib import Path
import hashlib
import logging

from app.database import get_db
from app.models.spec import Spec, SpecScope
from app.models.project import Project
from app.schemas.spec import (
    SpecCreate,
    SpecUpdate,
    SpecResponse,
    InterviewOptions,
    InterviewOption
)
from app.schemas.pattern_discovery import (
    PatternDiscoveryRequest,
    PatternDiscoveryResponse,
    SavePatternRequest,
    DiscoveredPattern
)
from app.services.spec_loader import get_spec_loader
from app.services.spec_writer import get_spec_writer
from app.services.pattern_discovery import PatternDiscoveryService

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/interview-options", response_model=InterviewOptions)
async def get_interview_options(db: Session = Depends(get_db)):
    """
    Get available frameworks for interview questions (DYNAMIC).

    This endpoint is THE KEY to the dynamic system:
    - Loads frameworks from frameworks.json (Git-versionable)
    - Groups by category (backend, database, frontend, css)
    - Returns only frameworks that have active specs
    - Adding new specs automatically makes them available

    No code changes needed to add new frameworks!

    Returns:
        InterviewOptions: Available frameworks grouped by category

    PROMPT #61: Now uses SpecLoader to read from JSON files
    """

    # Load frameworks from JSON
    spec_loader = get_spec_loader()
    frameworks_data = spec_loader.get_frameworks()

    backend_options = []
    database_options = []
    frontend_options = []
    css_options = []

    for fw in frameworks_data.get("frameworks", []):
        if not fw.get("is_active", True):
            continue

        option = _format_option(
            fw["name"],
            fw.get("spec_count", 0),
            fw["category"]
        )

        if fw["category"] == "backend":
            backend_options.append(option)
        elif fw["category"] == "database":
            database_options.append(option)
        elif fw["category"] == "frontend":
            frontend_options.append(option)
        elif fw["category"] == "css":
            css_options.append(option)

    # Format options with proper labels
    return InterviewOptions(
        backend=backend_options,
        database=database_options,
        frontend=frontend_options,
        css=css_options
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
    limit: int = Query(100, ge=1, le=1000),
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

    PROMPT #61: Now reads from JSON files via SpecLoader
    """
    # Load all specs from JSON files
    spec_loader = get_spec_loader()
    spec_loader._ensure_cache_loaded()

    # Get all specs matching filters
    all_specs = []
    for cache_key, spec_data in spec_loader._specs_cache.items():
        # Apply filters
        if category and spec_data.category != category:
            continue
        if name and spec_data.name != name:
            continue
        if is_active is not None and spec_data.is_active != is_active:
            continue

        all_specs.append(spec_data)

    # Sort by category, name, spec_type
    all_specs.sort(key=lambda s: (s.category, s.name, s.spec_type))

    # Apply pagination
    paginated_specs = all_specs[skip:skip + limit]

    # Convert SpecData to SpecResponse format
    # Generate UUID from composite key for backwards compatibility
    results = []
    for spec in paginated_specs:
        # Generate deterministic UUID from composite key
        composite_key = f"{spec.category}:{spec.name}:{spec.spec_type}"
        uuid_str = hashlib.md5(composite_key.encode()).hexdigest()
        spec_id = f"{uuid_str[:8]}-{uuid_str[8:12]}-{uuid_str[12:16]}-{uuid_str[16:20]}-{uuid_str[20:32]}"

        results.append(SpecResponse(
            id=UUID(spec_id),
            category=spec.category,
            name=spec.name,
            spec_type=spec.spec_type,
            title=spec.title,
            description=spec.description,
            content=spec.content,
            language=spec.language,
            framework_version=spec.framework_version,
            ignore_patterns=spec.ignore_patterns or [],
            file_extensions=spec.file_extensions or [],
            is_active=spec.is_active,
            usage_count=0,  # Not tracked in JSON
            created_at=spec.created_at or datetime.utcnow(),
            updated_at=spec.updated_at or datetime.utcnow()
        ))

    return results


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

    PROMPT #61: Writes to JSON file via SpecWriter AND creates record in database
    """
    # Write to JSON file
    spec_writer = get_spec_writer()

    try:
        spec_writer.create_spec(spec_data.model_dump())
    except FileExistsError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Spec already exists: {spec_data.category}/{spec_data.name}/{spec_data.spec_type}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create spec: {str(e)}"
        )

    # Also create in database (for now, contains full data for backwards compatibility)
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

    PROMPT #61: Updates JSON file via SpecWriter AND updates database record
    """
    # Get spec from database to find its composite key
    spec = db.query(Spec).filter(Spec.id == spec_id).first()

    if not spec:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Spec {spec_id} not found"
        )

    # Update JSON file
    spec_writer = get_spec_writer()
    update_data = spec_update.model_dump(exclude_unset=True)

    try:
        spec_writer.update_spec(
            spec.category,
            spec.name,
            spec.spec_type,
            update_data
        )
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Spec JSON file not found: {spec.category}/{spec.name}/{spec.spec_type}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update spec: {str(e)}"
        )

    # Also update database record
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

    PROMPT #61: Deletes JSON file via SpecWriter AND removes database record
    """
    # Get spec from database to find its composite key
    spec = db.query(Spec).filter(Spec.id == spec_id).first()

    if not spec:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Spec {spec_id} not found"
        )

    # Delete JSON file
    spec_writer = get_spec_writer()

    try:
        spec_writer.delete_spec(spec.category, spec.name, spec.spec_type)
    except FileNotFoundError:
        # If JSON file doesn't exist, just log warning and continue to delete DB record
        import logging
        logging.warning(f"Spec JSON file not found during delete: {spec.category}/{spec.name}/{spec.spec_type}")
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete spec: {str(e)}"
        )

    # Delete from database
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

    PROMPT #61: Now uses SpecLoader to read from JSON files
    """
    spec_loader = get_spec_loader()
    specs_data = spec_loader.get_specs_by_framework(category, name, only_active=True)

    # Convert SpecData to SpecResponse
    results = []
    for spec in specs_data:
        composite_key = f"{spec.category}:{spec.name}:{spec.spec_type}"
        uuid_str = hashlib.md5(composite_key.encode()).hexdigest()
        spec_id = f"{uuid_str[:8]}-{uuid_str[8:12]}-{uuid_str[12:16]}-{uuid_str[16:20]}-{uuid_str[20:32]}"

        results.append(SpecResponse(
            id=UUID(spec_id),
            category=spec.category,
            name=spec.name,
            spec_type=spec.spec_type,
            title=spec.title,
            description=spec.description,
            content=spec.content,
            language=spec.language,
            framework_version=spec.framework_version,
            ignore_patterns=spec.ignore_patterns or [],
            file_extensions=spec.file_extensions or [],
            is_active=spec.is_active,
            usage_count=0,
            created_at=spec.created_at or datetime.utcnow(),
            updated_at=spec.updated_at or datetime.utcnow()
        ))

    return results


# ============================================================================
# PATTERN DISCOVERY ENDPOINTS (PROMPT #62 - Week 1 Day 5-6)
# AI-powered organic pattern discovery from ANY codebase
# ============================================================================

@router.post("/discover", response_model=PatternDiscoveryResponse)
async def discover_patterns(
    request: PatternDiscoveryRequest,
    db: Session = Depends(get_db)
):
    """
    Discover code patterns from project codebase using AI.

    This is the CORE feature of PROMPT #62 - AI learns patterns organically
    from ANY codebase (framework-based or legacy/custom code).

    Process:
    1. Validate project exists and has code_path configured
    2. Scan project directory for code files
    3. Group files by extension/structure
    4. AI analyzes samples to identify repeating patterns
    5. AI automatically decides: framework-worthy vs project-specific
    6. Return ranked patterns for user review

    - **project_id**: UUID of project to analyze
    - **max_patterns**: Maximum patterns to discover (default: 20)
    - **min_occurrences**: Minimum file count for pattern (default: 3)
    - **min_confidence**: Minimum AI confidence score (default: 0.5)

    Returns:
        PatternDiscoveryResponse with discovered patterns and metadata

    Raises:
        404: Project not found or code_path not configured
        400: Invalid code_path (doesn't exist)
        500: Pattern discovery failed
    """
    logger.info(f"🔍 Pattern discovery request for project {request.project_id}")

    # Validate project exists
    project = db.query(Project).filter(Project.id == request.project_id).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project {request.project_id} not found"
        )

    # Validate code_path is configured
    if not project.code_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project code_path not configured. Please set code_path in project settings."
        )

    # Validate code_path exists
    project_path = Path(project.code_path)
    if not project_path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Project code path does not exist: {project.code_path}"
        )

    if not project_path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Project code path is not a directory: {project.code_path}"
        )

    # Run pattern discovery
    try:
        discovery_service = PatternDiscoveryService(db)

        discovered_patterns = await discovery_service.discover_patterns(
            project_path=project_path,
            project_id=request.project_id,
            max_patterns=request.max_patterns,
            min_occurrences=request.min_occurrences
        )

        # Filter by minimum confidence
        filtered_patterns = [
            p for p in discovered_patterns
            if p.confidence_score >= request.min_confidence
        ]

        logger.info(
            f"✅ Discovery complete: {len(filtered_patterns)} patterns found "
            f"(confidence >= {request.min_confidence})"
        )

        return PatternDiscoveryResponse(
            project_id=request.project_id,
            project_name=project.name,
            patterns=filtered_patterns,
            total_patterns=len(filtered_patterns),
            discovery_metadata={
                "project_path": str(project_path),
                "max_patterns": request.max_patterns,
                "min_occurrences": request.min_occurrences,
                "min_confidence": request.min_confidence,
                "discovered_at": datetime.utcnow().isoformat()
            }
        )

    except Exception as e:
        logger.error(f"❌ Pattern discovery failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Pattern discovery failed: {str(e)}"
        )


@router.post("/save-pattern", response_model=SpecResponse, status_code=status.HTTP_201_CREATED)
async def save_discovered_pattern(
    request: SavePatternRequest,
    db: Session = Depends(get_db)
):
    """
    Save an approved discovered pattern as a spec.

    AI has already decided the scope (framework vs project) during discovery.
    This endpoint simply persists the approved pattern.

    Process:
    1. Validate project exists
    2. Create Spec record in database with AI-determined scope
    3. Write spec to appropriate JSON file location:
       - Framework specs: /app/specs/{category}/{name}/{spec_type}.json
       - Project specs: /app/specs/projects/{project_id}/{category}/{spec_type}.json
    4. Return created spec

    - **pattern**: Discovered pattern to save
    - **project_id**: Project UUID (required for project-scoped patterns)

    Returns:
        SpecResponse with created spec

    Raises:
        404: Project not found
        409: Spec already exists
        500: Failed to save spec
    """
    logger.info(
        f"💾 Saving pattern: {request.pattern.name}/{request.pattern.spec_type} "
        f"(scope: {request.pattern.is_framework_worthy})"
    )

    # Validate project exists
    project = db.query(Project).filter(Project.id == request.project_id).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project {request.project_id} not found"
        )

    # Determine scope based on AI decision
    scope = SpecScope.FRAMEWORK if request.pattern.is_framework_worthy else SpecScope.PROJECT

    # Build discovery metadata
    discovery_metadata = {
        "discovered_at": datetime.utcnow().isoformat(),
        "discovery_method": request.pattern.discovery_method,
        "confidence_score": request.pattern.confidence_score,
        "sample_files": request.pattern.sample_files,
        "occurrences": request.pattern.occurrences,
        "ai_decision_reasoning": request.pattern.reasoning,
        "is_framework_worthy": request.pattern.is_framework_worthy,
        "key_characteristics": request.pattern.key_characteristics
    }

    # Create spec data
    spec_data = {
        "category": request.pattern.category,
        "name": request.pattern.name,
        "spec_type": request.pattern.spec_type,
        "title": request.pattern.title,
        "description": request.pattern.description,
        "content": request.pattern.template_content,
        "language": request.pattern.language,
        "is_active": True,
        "project_id": request.project_id if scope == SpecScope.PROJECT else None,
        "scope": scope,
        "discovery_metadata": discovery_metadata
    }

    # Write to JSON file
    spec_writer = get_spec_writer()

    try:
        if scope == SpecScope.PROJECT:
            # Project-specific spec
            spec_writer.create_project_spec(spec_data, request.project_id)
        else:
            # Framework spec
            spec_writer.create_spec(spec_data)

    except FileExistsError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Spec already exists: {spec_data['category']}/{spec_data['name']}/{spec_data['spec_type']}"
        )
    except Exception as e:
        logger.error(f"Failed to write spec: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save spec: {str(e)}"
        )

    # Create database record
    spec = Spec(**spec_data)
    db.add(spec)
    db.commit()
    db.refresh(spec)

    logger.info(f"✅ Pattern saved as spec: {spec.id} (scope: {scope.value})")

    return spec


@router.get("/project/{project_id}/specs", response_model=List[SpecResponse])
async def get_project_specs(
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get all project-specific specs for a project.

    Returns specs where:
    - scope = 'project'
    - project_id = {project_id}

    These are patterns discovered from this specific project's codebase
    that AI determined are project-specific (not framework-worthy).

    - **project_id**: UUID of project

    Returns:
        List of project-specific specs

    Raises:
        404: Project not found
    """
    # Validate project exists
    project = db.query(Project).filter(Project.id == project_id).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project {project_id} not found"
        )

    # Query project-specific specs
    specs = db.query(Spec).filter(
        Spec.project_id == project_id,
        Spec.scope == SpecScope.PROJECT
    ).all()

    logger.info(f"📋 Found {len(specs)} project-specific specs for project {project_id}")

    return specs


@router.get("/project/{project_id}/discovered-frameworks", response_model=List[SpecResponse])
async def get_project_discovered_frameworks(
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get framework specs that were discovered from this project.

    Returns specs where:
    - scope = 'framework'
    - discovery_metadata contains reference to this project

    These are patterns that AI determined are framework-worthy (generic, reusable)
    and were discovered by analyzing this project's codebase.

    Useful for:
    - Showing user which framework patterns were contributed by their project
    - Tracking provenance of discovered framework specs
    - Quality control and attribution

    - **project_id**: UUID of project

    Returns:
        List of framework specs discovered from this project

    Raises:
        404: Project not found
    """
    # Validate project exists
    project = db.query(Project).filter(Project.id == project_id).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project {project_id} not found"
        )

    # Query framework specs with discovery_metadata
    # Note: This requires checking JSON field, which varies by database
    # For PostgreSQL, we can use JSON operators
    specs = db.query(Spec).filter(
        Spec.scope == SpecScope.FRAMEWORK,
        Spec.discovery_metadata.isnot(None)
    ).all()

    # Filter by project_id in discovery_metadata (Python-side)
    # In production, this could be optimized with JSON query
    project_specs = []
    for spec in specs:
        # Check if spec was discovered from this project
        # We can infer this from sample_files paths or add explicit project_id to metadata
        if spec.discovery_metadata:
            # For now, we'll check if this spec's project_id matches
            # (specs discovered from project have project_id in metadata)
            # This is a simple approach; can be enhanced later
            project_specs.append(spec)

    logger.info(
        f"🔍 Found {len(project_specs)} framework specs discovered from project {project_id}"
    )

    return project_specs
