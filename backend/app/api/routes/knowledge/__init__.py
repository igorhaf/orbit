"""
Knowledge Base API Endpoints - Package

PROMPT #84 - RAG Phase 2: Interview Enhancement
PROMPT #147 - Incremental RAG Feeding for Business Rules
PROMPT #157 - Prompt Doc & Git Commit RAG Sync
PROMPT #171 - Global RAG Stats
PROMPT #172 - Per-Project RAG Stats
PROMPT #238 - Code Files & Rules-by-File
PROMPT #243 - Orbit Knowledge Upload

Semantic search and management of project knowledge base:
- Business rules (manual, from code scan, from interviews)
- Document uploads
- Interview answers
- Statistics and sync operations
"""

from fastapi import APIRouter

from app.api.routes.knowledge.search import router as search_router
from app.api.routes.knowledge.rules import router as rules_router
from app.api.routes.knowledge.documents import router as documents_router
from app.api.routes.knowledge.stats import router as stats_router

# Re-export response models for backward compatibility
from app.api.routes.knowledge.search import (
    KnowledgeSearchResult,
    KnowledgeSearchResponse,
)
from app.api.routes.knowledge.stats import KnowledgeStatsResponse

router = APIRouter()

router.include_router(search_router)
router.include_router(rules_router)
router.include_router(documents_router)
router.include_router(stats_router)
