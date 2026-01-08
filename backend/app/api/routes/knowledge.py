"""
Knowledge Search API Endpoints

PROMPT #84 - RAG Phase 2: Interview Enhancement

Semantic search across project knowledge base (interview answers, decisions, etc.)
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from pydantic import BaseModel
import logging

from app.database import get_db
from app.models.project import Project
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)

router = APIRouter()


# Response Models
class KnowledgeSearchResult(BaseModel):
    """Single search result from knowledge base."""
    id: str
    content: str
    similarity: float
    metadata: dict

    class Config:
        from_attributes = True


class KnowledgeSearchResponse(BaseModel):
    """Response for knowledge search."""
    query: str
    project_id: Optional[str]
    results: List[KnowledgeSearchResult]
    total_results: int


class KnowledgeStatsResponse(BaseModel):
    """Statistics about project knowledge base."""
    project_id: str
    total_documents: int
    interview_answers: int
    domain_templates: int
    project_specific: int


# ============================================================================
# KNOWLEDGE SEARCH ENDPOINTS
# ============================================================================

@router.get("/projects/{project_id}/knowledge/search", response_model=KnowledgeSearchResponse)
async def search_project_knowledge(
    project_id: UUID,
    query: str = Query(..., min_length=3, description="Search query"),
    include_global: bool = Query(True, description="Include global domain knowledge"),
    top_k: int = Query(5, ge=1, le=20, description="Number of results to return"),
    similarity_threshold: float = Query(0.5, ge=0.0, le=1.0, description="Minimum similarity score"),
    db: Session = Depends(get_db)
):
    """
    Search project knowledge base using semantic search.

    PROMPT #84 - RAG Phase 2: Interview Enhancement

    Performs semantic search across:
    - Interview answers from this project
    - Domain knowledge templates (if include_global=True)
    - Project-specific decisions and insights

    Args:
        project_id: UUID of the project
        query: Search query (e.g., "authentication method chosen")
        include_global: Include global domain templates in results
        top_k: Maximum number of results to return
        similarity_threshold: Minimum cosine similarity score (0.0-1.0)

    Returns:
        KnowledgeSearchResponse with matched documents ranked by relevance

    Examples:
        - "What authentication method did we choose?"
        - "Which payment gateway was selected?"
        - "What are the main user roles?"

    Raises:
        404: Project not found
        500: RAG service error
    """
    # Validate project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project {project_id} not found"
        )

    try:
        rag_service = RAGService(db)

        # Build filter
        if include_global:
            # Search both project-specific AND global knowledge
            # We'll do two searches and merge results
            project_results = rag_service.retrieve(
                query=query,
                filter={"project_id": str(project_id)},
                top_k=top_k,
                similarity_threshold=similarity_threshold
            )

            global_results = rag_service.retrieve(
                query=query,
                filter={"type": "domain_template"},
                top_k=top_k // 2,  # Half of results from global knowledge
                similarity_threshold=similarity_threshold
            )

            # Merge and re-sort by similarity
            all_results = project_results + global_results
            all_results.sort(key=lambda x: x["similarity"], reverse=True)
            results = all_results[:top_k]  # Take top_k after merging

        else:
            # Search only project-specific knowledge
            results = rag_service.retrieve(
                query=query,
                filter={"project_id": str(project_id)},
                top_k=top_k,
                similarity_threshold=similarity_threshold
            )

        logger.info(f"Knowledge search for project {project_id}: '{query}' - {len(results)} results")

        # Format response
        search_results = [
            KnowledgeSearchResult(
                id=str(r["id"]),
                content=r["content"],
                similarity=r["similarity"],
                metadata=r["metadata"]
            )
            for r in results
        ]

        return KnowledgeSearchResponse(
            query=query,
            project_id=str(project_id),
            results=search_results,
            total_results=len(search_results)
        )

    except Exception as e:
        logger.error(f"Knowledge search failed for project {project_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Knowledge search failed: {str(e)}"
        )


@router.get("/projects/{project_id}/knowledge/stats", response_model=KnowledgeStatsResponse)
async def get_project_knowledge_stats(
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get statistics about project's knowledge base.

    PROMPT #84 - RAG Phase 2: Interview Enhancement

    Returns counts of:
    - Total documents in knowledge base
    - Interview answers
    - Domain templates available
    - Project-specific documents

    Args:
        project_id: UUID of the project

    Returns:
        KnowledgeStatsResponse with document counts

    Raises:
        404: Project not found
        500: RAG service error
    """
    # Validate project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project {project_id} not found"
        )

    try:
        rag_service = RAGService(db)

        # Get overall stats
        overall_stats = rag_service.get_stats()

        # Get project-specific stats
        project_stats = rag_service.get_stats(project_id=project_id)

        # Count interview answers for this project
        from sqlalchemy import text
        query = text("""
            SELECT COUNT(*) as count
            FROM rag_documents
            WHERE project_id = :project_id
                AND metadata->>'type' = 'interview_answer'
        """)
        result = db.execute(query, {"project_id": str(project_id)})
        interview_answers_count = result.fetchone()[0]

        logger.info(f"Knowledge stats for project {project_id}: {project_stats['total_documents']} documents")

        return KnowledgeStatsResponse(
            project_id=str(project_id),
            total_documents=project_stats["total_documents"],
            interview_answers=interview_answers_count,
            domain_templates=overall_stats["global_documents"],  # All global = domain templates
            project_specific=project_stats["total_documents"]
        )

    except Exception as e:
        logger.error(f"Failed to get knowledge stats for project {project_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get knowledge stats: {str(e)}"
        )
