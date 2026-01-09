"""
ProjectAnalyses API Router
Endpoints for uploading projects, analyzing them, and generating orchestrators
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from uuid import UUID, uuid4
from datetime import datetime
import logging

from app.database import get_db
from app.models.project_analysis import ProjectAnalysis
from app.models.project import Project
from app.schemas.project_analysis import (
    ProjectAnalysisCreate,
    ProjectAnalysisResponse,
    ProjectAnalysisDetailResponse,
    GenerateOrchestratorRequest,
    GenerateOrchestratorResponse,
    RegisterOrchestratorResponse,
    OrchestratorCodeResponse,
    AnalysisStatsResponse
)
from app.services.file_processor import FileProcessor
from app.services.stack_detector import StackDetector
from app.services.convention_extractor import ConventionExtractor
from app.services.pattern_recognizer import PatternRecognizer
from app.services.orchestrator_generator import OrchestratorGenerator
from app.services.orchestrator_manager import OrchestratorManager

logger = logging.getLogger(__name__)

router = APIRouter()


async def process_analysis_background(
    analysis_id: UUID,
    file_path: str,
    db: Session
):
    """
    Background task to process uploaded project

    Steps:
    1. Update status to 'analyzing'
    2. Extract archive
    3. Build file tree
    4. Detect stack
    5. Extract conventions (AI)
    6. Recognize patterns (AI)
    7. Update analysis with results
    8. Set status to 'completed'
    9. Cleanup temporary files
    """

    logger.info(f"Starting background processing for analysis {analysis_id}")

    # Get analysis
    analysis = db.query(ProjectAnalysis).filter(
        ProjectAnalysis.id == analysis_id
    ).first()

    if not analysis:
        logger.error(f"Analysis not found: {analysis_id}")
        return

    try:
        # Update status
        analysis.status = "analyzing"
        db.commit()

        # Initialize services
        file_processor = FileProcessor()
        stack_detector = StackDetector()
        convention_extractor = ConventionExtractor()
        pattern_recognizer = PatternRecognizer()

        # Extract archive
        logger.info(f"  Extracting archive: {file_path}")
        from pathlib import Path
        extraction_path = await file_processor.extract_archive(
            Path(file_path),
            analysis_id
        )

        analysis.extraction_path = str(extraction_path)
        db.commit()

        # Build file tree
        logger.info("  Building file tree...")
        file_structure = file_processor.build_file_tree(extraction_path)
        analysis.file_structure = file_structure
        db.commit()

        # Detect stack
        logger.info("  Detecting stack...")
        stack_result = stack_detector.detect(extraction_path)

        analysis.detected_stack = stack_result["detected_stack"]
        analysis.confidence_score = stack_result["confidence"]
        db.commit()

        logger.info(f"  Detected: {stack_result['detected_stack']} ({stack_result['confidence']}%)")

        # Extract conventions (AI)
        logger.info("  Extracting conventions with AI...")
        conventions = await convention_extractor.extract(
            extraction_path,
            stack_result["detected_stack"]
        )

        analysis.conventions = conventions
        db.commit()

        # Recognize patterns (AI)
        logger.info("  Recognizing patterns with AI...")
        patterns = await pattern_recognizer.recognize(
            extraction_path,
            stack_result["detected_stack"]
        )

        analysis.patterns = patterns
        db.commit()

        # Mark as completed
        analysis.status = "completed"
        analysis.completed_at = datetime.utcnow()
        db.commit()

        logger.info(f"✅ Analysis completed: {analysis_id}")

    except Exception as e:
        logger.error(f"❌ Analysis failed: {e}")
        analysis.status = "failed"
        analysis.error_message = str(e)
        db.commit()

    finally:
        # Cleanup temporary files
        try:
            file_processor = FileProcessor()
            file_processor.cleanup(analysis_id)
        except Exception as e:
            logger.error(f"Failed to cleanup files: {e}")


@router.post("/", response_model=ProjectAnalysisResponse, status_code=status.HTTP_201_CREATED)
async def upload_project(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    project_id: Optional[UUID] = None,
    db: Session = Depends(get_db)
):
    """
    Upload a project archive for analysis

    - Accepts .zip, .tar.gz files
    - Max size: configured in settings (default 100MB)
    - Processing happens in background
    - Returns immediately with analysis record

    **POST** `/api/v1/analyzers/`

    **Request:**
    - file: multipart/form-data
    - project_id: optional UUID (query param)

    **Response:**
    ```json
    {
        "id": "uuid",
        "status": "uploaded",
        "original_filename": "my-project.zip",
        "file_size_bytes": 12345678
    }
    ```
    """

    # Verify project exists if provided
    if project_id:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

    # Create analysis record
    analysis_id = uuid4()

    analysis = ProjectAnalysis(
        id=analysis_id,
        project_id=project_id,
        original_filename=file.filename,
        file_size_bytes=0,  # Will update after validation
        status="uploaded",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )

    db.add(analysis)
    db.commit()
    db.refresh(analysis)

    # Save file
    try:
        file_processor = FileProcessor()
        file_path = await file_processor.save_upload(file, analysis_id)

        # Update analysis
        analysis.file_size_bytes = file_path.stat().st_size
        analysis.upload_path = str(file_path)
        db.commit()

        # Start background processing
        background_tasks.add_task(
            process_analysis_background,
            analysis_id,
            str(file_path),
            db
        )

        logger.info(f"Uploaded project: {file.filename} (analysis: {analysis_id})")

        return analysis

    except HTTPException:
        # Delete analysis record if upload failed
        db.delete(analysis)
        db.commit()
        raise
    except Exception as e:
        db.delete(analysis)
        db.commit()
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@router.get("/", response_model=List[ProjectAnalysisResponse])
async def list_analyses(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    status: Optional[str] = Query(None, description="Filter by status"),
    project_id: Optional[UUID] = Query(None, description="Filter by project"),
    db: Session = Depends(get_db)
):
    """
    List all project analyses with pagination

    **GET** `/api/v1/analyzers/`

    Query params:
    - skip: Offset for pagination
    - limit: Max records to return
    - status: Filter by status (uploaded, analyzing, completed, failed)
    - project_id: Filter by project UUID
    """

    query = db.query(ProjectAnalysis)

    if status:
        query = query.filter(ProjectAnalysis.status == status)

    if project_id:
        query = query.filter(ProjectAnalysis.project_id == project_id)

    query = query.order_by(ProjectAnalysis.created_at.desc())

    analyses = query.offset(skip).limit(limit).all()
    return analyses


@router.get("/{analysis_id}", response_model=ProjectAnalysisDetailResponse)
async def get_analysis(
    analysis_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get a specific analysis by ID

    **GET** `/api/v1/analyzers/{analysis_id}`

    Returns detailed analysis including:
    - File structure
    - Detected stack and confidence
    - Extracted conventions
    - Recognized patterns
    - Orchestrator status
    """

    analysis = db.query(ProjectAnalysis).filter(
        ProjectAnalysis.id == analysis_id
    ).first()

    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")

    return analysis


@router.post("/{analysis_id}/generate-orchestrator", response_model=GenerateOrchestratorResponse)
async def generate_orchestrator(
    analysis_id: UUID,
    request: GenerateOrchestratorRequest,
    db: Session = Depends(get_db)
):
    """
    Generate orchestrator from completed analysis

    **POST** `/api/v1/analyzers/{analysis_id}/generate-orchestrator`

    **Request:**
    ```json
    {
        "orchestrator_key": "my_custom_orchestrator"  // optional
    }
    ```

    Generates Python orchestrator class and saves to file system.
    """

    analysis = db.query(ProjectAnalysis).filter(
        ProjectAnalysis.id == analysis_id
    ).first()

    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")

    if analysis.status != "completed":
        raise HTTPException(
            status_code=400,
            detail=f"Analysis must be completed first (current status: {analysis.status})"
        )

    if analysis.orchestrator_generated:
        raise HTTPException(
            status_code=400,
            detail="Orchestrator already generated for this analysis"
        )

    # Generate orchestrator key
    orchestrator_key = request.orchestrator_key
    if not orchestrator_key:
        # Auto-generate from stack and timestamp
        stack = analysis.detected_stack or "custom"
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        orchestrator_key = f"{stack}_{timestamp}"

    # Check if key already exists
    existing = db.query(ProjectAnalysis).filter(
        ProjectAnalysis.orchestrator_key == orchestrator_key
    ).first()

    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Orchestrator key already exists: {orchestrator_key}"
        )

    # Generate orchestrator
    try:
        generator = OrchestratorGenerator()

        analysis_data = {
            "detected_stack": analysis.detected_stack,
            "confidence_score": analysis.confidence_score,
            "conventions": analysis.conventions or {},
            "patterns": analysis.patterns or {},
            "dependencies": analysis.dependencies or {}
        }

        result = await generator.generate(analysis_data, orchestrator_key)

        # Update analysis
        analysis.orchestrator_generated = True
        analysis.orchestrator_key = orchestrator_key
        analysis.orchestrator_code = result["orchestrator_code"]
        db.commit()

        logger.info(f"Generated orchestrator: {orchestrator_key}")

        return GenerateOrchestratorResponse(
            success=True,
            orchestrator_key=orchestrator_key,
            orchestrator_code=result["orchestrator_code"],
            class_name=result["class_name"],
            message=f"Orchestrator '{orchestrator_key}' generated successfully"
        )

    except Exception as e:
        logger.error(f"Failed to generate orchestrator: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate orchestrator: {str(e)}"
        )


@router.post("/{analysis_id}/register-orchestrator", response_model=RegisterOrchestratorResponse)
async def register_orchestrator(
    analysis_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Register generated orchestrator in the system

    **POST** `/api/v1/analyzers/{analysis_id}/register-orchestrator`

    Makes the orchestrator available for use with tasks.
    """

    analysis = db.query(ProjectAnalysis).filter(
        ProjectAnalysis.id == analysis_id
    ).first()

    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")

    if not analysis.orchestrator_generated:
        raise HTTPException(
            status_code=400,
            detail="Must generate orchestrator first"
        )

    try:
        manager = OrchestratorManager(db)
        result = await manager.register_from_analysis(str(analysis_id))

        return RegisterOrchestratorResponse(**result)

    except Exception as e:
        logger.error(f"Failed to register orchestrator: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to register orchestrator: {str(e)}"
        )


@router.get("/{analysis_id}/orchestrator-code", response_model=OrchestratorCodeResponse)
async def get_orchestrator_code(
    analysis_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get generated orchestrator code for review

    **GET** `/api/v1/analyzers/{analysis_id}/orchestrator-code`
    """

    analysis = db.query(ProjectAnalysis).filter(
        ProjectAnalysis.id == analysis_id
    ).first()

    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")

    if not analysis.orchestrator_generated:
        raise HTTPException(
            status_code=404,
            detail="Orchestrator not generated for this analysis"
        )

    # Extract class name from code
    class_name = "Unknown"
    if analysis.orchestrator_code:
        import re
        match = re.search(r'class\s+(\w+)\(', analysis.orchestrator_code)
        if match:
            class_name = match.group(1)

    return OrchestratorCodeResponse(
        orchestrator_key=analysis.orchestrator_key,
        orchestrator_code=analysis.orchestrator_code,
        class_name=class_name,
        generated_at=analysis.completed_at or analysis.updated_at
    )


@router.delete("/{analysis_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_analysis(
    analysis_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Delete an analysis and cleanup files

    **DELETE** `/api/v1/analyzers/{analysis_id}`

    Note: Also unregisters orchestrator if it was registered.
    """

    analysis = db.query(ProjectAnalysis).filter(
        ProjectAnalysis.id == analysis_id
    ).first()

    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")

    # Unregister orchestrator if exists
    if analysis.orchestrator_key:
        try:
            manager = OrchestratorManager(db)
            await manager.unregister(analysis.orchestrator_key)
        except Exception as e:
            logger.warning(f"Failed to unregister orchestrator: {e}")

    # Cleanup files
    try:
        file_processor = FileProcessor()
        file_processor.cleanup(analysis_id)
    except Exception as e:
        logger.warning(f"Failed to cleanup files: {e}")

    # Delete record
    db.delete(analysis)
    db.commit()

    return None


@router.get("/stats/summary", response_model=AnalysisStatsResponse)
async def get_analysis_stats(
    db: Session = Depends(get_db)
):
    """
    Get statistics about all analyses

    **GET** `/api/v1/analyzers/stats/summary`
    """

    total = db.query(ProjectAnalysis).count()

    completed = db.query(ProjectAnalysis).filter(
        ProjectAnalysis.status == "completed"
    ).count()

    analyzing = db.query(ProjectAnalysis).filter(
        ProjectAnalysis.status == "analyzing"
    ).count()

    failed = db.query(ProjectAnalysis).filter(
        ProjectAnalysis.status == "failed"
    ).count()

    orchestrators = db.query(ProjectAnalysis).filter(
        ProjectAnalysis.orchestrator_generated == True
    ).count()

    # Group by detected stack
    stack_counts = db.query(
        ProjectAnalysis.detected_stack,
        func.count(ProjectAnalysis.id).label('count')
    ).filter(
        ProjectAnalysis.detected_stack.isnot(None)
    ).group_by(ProjectAnalysis.detected_stack).all()

    stacks_detected = {
        stack: count for stack, count in stack_counts
    }

    return AnalysisStatsResponse(
        total_analyses=total,
        completed=completed,
        analyzing=analyzing,
        failed=failed,
        orchestrators_generated=orchestrators,
        stacks_detected=stacks_detected
    )
