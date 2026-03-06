"""
Continuous RAG Evolution API Routes (Package)

PROMPT #218 - Endpoints for managing continuous RAG processing per project.
PROMPT #252 - 4-phase pipeline with progressive button unlocking.
PROMPT #260 - Deep Pipeline (7-phase Claudio pipeline).

Refactored from a single file into a package with sub-modules:
  - phases.py: Phase trigger endpoints (scan, extract-rules, generate-cards, generate-wiki, run-pipeline)
  - deep_pipeline.py: Deep pipeline orchestration endpoints (start, status, profiles, runs, compare)
  - status.py: Status/monitoring endpoints (status, files, reset, pipeline-live, enrichment-status)
"""

from fastapi import APIRouter

from .phases import router as phases_router
from .deep_pipeline import router as deep_pipeline_router
from .status import router as status_router

router = APIRouter()
router.include_router(phases_router)
router.include_router(deep_pipeline_router)
router.include_router(status_router)
