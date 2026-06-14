"""
Knowledge Statistics & Sync Endpoints

PROMPT #84 - RAG Phase 2: Knowledge Stats
PROMPT #147 - Incremental RAG Feeding: Full Stats
PROMPT #157 - Prompt Doc & Git Commit RAG Sync
PROMPT #171 - Global RAG Stats
PROMPT #172 - Per-Project RAG Stats

Global stats, project stats, full stats, and sync operations.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional
from uuid import UUID
from pydantic import BaseModel
import logging

from app.database import get_db
from app.models.project import Project
from app.services.rag_service import RAGService
from app.schemas.knowledge import KnowledgeStats

logger = logging.getLogger(__name__)

router = APIRouter()


# Response Model
class KnowledgeStatsResponse(BaseModel):
    """Statistics about project knowledge base."""
    project_id: str
    total_documents: int
    interview_answers: int
    domain_templates: int
    project_specific: int


# ============================================================================
# PROMPT #171 - GLOBAL RAG STATS ENDPOINT
# ============================================================================

@router.get("/knowledge/global-stats")
async def get_global_rag_stats(
    db: Session = Depends(get_db)
):
    """
    Get global RAG statistics for ALL projects.

    PROMPT #171 - Complete RAG storage verification.

    Returns detailed breakdown of document types stored in RAG:
    - Total document count
    - Counts by type (card, interview_answer, project_context, business_rule, etc.)
    - Cards breakdown by item_type (epic, story, task)

    This helps verify that all document types are being indexed correctly.
    """
    try:
        rag_service = RAGService(db)
        detailed_stats = rag_service.get_detailed_stats()

        logger.info(f"Global RAG stats: {detailed_stats['total_documents']} total documents")

        return {
            "success": True,
            "stats": detailed_stats
        }

    except Exception as e:
        logger.error(f"Failed to get global RAG stats: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Falha ao obter estatisticas globais do RAG: {str(e)}"
        )


# ============================================================================
# PROMPT #172 - PER-PROJECT RAG STATS FOR COMPARISON TABLE
# ============================================================================

@router.get("/knowledge/projects-stats")
async def get_all_projects_rag_stats(
    db: Session = Depends(get_db)
):
    """
    Get RAG statistics for ALL projects in a single call.

    PROMPT #172 - RAG Analytics Dashboard with project comparison.

    Returns a list of all projects with their individual RAG stats,
    plus aggregated totals. This enables the comparison table view.

    Returns:
        - projects: List of projects with their RAG stats
        - totals: Aggregated totals across all projects
    """
    try:
        # Guard: on a fresh/legacy deploy the rag_documents table may not exist
        # yet (the RAG migrations create it). Return an explicit "uninitialized"
        # payload instead of a confusing 500 that reads like a random bug.
        table_exists = db.execute(
            text("SELECT to_regclass('public.rag_documents')")
        ).scalar()
        if table_exists is None:
            return {
                "rag_uninitialized": True,
                "message": "RAG não inicializado: tabela rag_documents ausente (rode as migrations de pgvector/RAG).",
                "projects": [],
                "totals": {},
            }

        # Get all projects
        projects = db.query(Project).order_by(Project.name).all()

        # Get stats for each project using raw SQL for efficiency
        stats_query = text("""
            SELECT
                project_id,
                COUNT(*) as total_documents,
                COUNT(*) FILTER (WHERE metadata->>'content_type' = 'code_file' OR metadata->>'type' = 'code_file') as code_files,
                COUNT(*) FILTER (WHERE metadata->>'content_type' = 'card' OR metadata->>'type' = 'card') as cards,
                COUNT(*) FILTER (WHERE metadata->>'content_type' = 'business_rule' OR metadata->>'type' = 'business_rule') as business_rules,
                COUNT(*) FILTER (WHERE metadata->>'content_type' = 'interview_answer' OR metadata->>'type' = 'interview_answer') as interview_answers,
                COUNT(*) FILTER (WHERE metadata->>'content_type' = 'project_context') as project_context,
                COUNT(*) FILTER (WHERE metadata->>'content_type' = 'document') as documents
            FROM rag_documents
            WHERE project_id IS NOT NULL
            GROUP BY project_id
        """)

        stats_results = db.execute(stats_query).fetchall()
        stats_by_project = {str(row.project_id): row for row in stats_results}

        # Build response
        project_stats = []
        totals = {
            "total_documents": 0,
            "code_files": 0,
            "cards": 0,
            "business_rules": 0,
            "interview_answers": 0,
            "project_context": 0,
            "documents": 0
        }

        for project in projects:
            project_id_str = str(project.id)
            row = stats_by_project.get(project_id_str)

            if row:
                stats = {
                    "project_id": project_id_str,
                    "project_name": project.name,
                    "total_documents": row.total_documents,
                    "code_files": row.code_files,
                    "cards": row.cards,
                    "business_rules": row.business_rules,
                    "interview_answers": row.interview_answers,
                    "project_context": row.project_context,
                    "documents": row.documents
                }
                # Accumulate totals
                for key in totals:
                    totals[key] += stats.get(key, 0)
            else:
                stats = {
                    "project_id": project_id_str,
                    "project_name": project.name,
                    "total_documents": 0,
                    "code_files": 0,
                    "cards": 0,
                    "business_rules": 0,
                    "interview_answers": 0,
                    "project_context": 0,
                    "documents": 0
                }

            project_stats.append(stats)

        logger.info(f"Projects RAG stats: {len(project_stats)} projects, {totals['total_documents']} total documents")

        return {
            "success": True,
            "projects": project_stats,
            "totals": totals,
        }

    except Exception as e:
        logger.error(f"Failed to get projects RAG stats: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Falha ao obter estatisticas RAG dos projetos: {str(e)}"
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
            detail=f"Projeto {project_id} não encontrado"
        )

    try:
        rag_service = RAGService(db)

        # Get overall stats
        overall_stats = rag_service.get_stats()

        # Get project-specific stats
        project_stats = rag_service.get_stats(project_id=project_id)

        # Count interview answers for this project
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
            detail=f"Falha ao obter estatisticas de conhecimento: {str(e)}"
        )


# ============================================================================
# PROMPT #147 - KNOWLEDGE FULL STATISTICS
# ============================================================================

@router.get("/projects/{project_id}/knowledge/full-stats", response_model=KnowledgeStats)
async def get_full_knowledge_stats(
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get detailed statistics about project knowledge.

    PROMPT #147 - Incremental RAG Feeding

    Returns counts by content_type, category, and source.
    """
    # Validate project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Projeto {project_id} não encontrado"
        )

    try:
        # Total documents
        total_query = text("""
            SELECT COUNT(*) as count
            FROM rag_documents
            WHERE project_id = :project_id
        """)
        total = db.execute(total_query, {"project_id": str(project_id)}).fetchone()[0]

        # Count by content_type (check both metadata.content_type and metadata.type)
        type_query = text("""
            SELECT
                COALESCE(metadata->>'content_type', metadata->>'type', 'unknown') as content_type,
                COUNT(*) as count
            FROM rag_documents
            WHERE project_id = :project_id
            GROUP BY COALESCE(metadata->>'content_type', metadata->>'type', 'unknown')
        """)
        type_results = db.execute(type_query, {"project_id": str(project_id)}).fetchall()

        type_counts = {row.content_type: row.count for row in type_results}

        # Count by category (for business rules)
        category_query = text("""
            SELECT
                metadata->>'category' as category,
                COUNT(*) as count
            FROM rag_documents
            WHERE project_id = :project_id
                AND (metadata->>'content_type' = 'business_rule' OR metadata->>'type' = 'business_rule')
            GROUP BY metadata->>'category'
        """)
        category_results = db.execute(category_query, {"project_id": str(project_id)}).fetchall()

        # Count by source
        source_query = text("""
            SELECT
                COALESCE(metadata->>'source', 'unknown') as source,
                COUNT(*) as count
            FROM rag_documents
            WHERE project_id = :project_id
            GROUP BY metadata->>'source'
        """)
        source_results = db.execute(source_query, {"project_id": str(project_id)}).fetchall()

        return KnowledgeStats(
            total_documents=total,
            business_rules_count=type_counts.get('business_rule', 0),
            interview_answers_count=type_counts.get('interview_answer', 0),
            code_files_count=type_counts.get('code_file', 0),
            documents_count=type_counts.get('document', 0),
            by_category={row.category: row.count for row in category_results if row.category},
            by_source={row.source: row.count for row in source_results if row.source}
        )

    except Exception as e:
        logger.error(f"Failed to get full knowledge stats: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Falha ao obter estatisticas de conhecimento: {str(e)}"
        )


# ============================================================================
# PROMPT #157 - PROMPT DOC & GIT COMMIT RAG SYNC
# ============================================================================

@router.post("/knowledge/sync-prompt-docs")
async def sync_prompt_docs(db: Session = Depends(get_db)):
    """
    Scan the project root for PROMPT_*.md files and index any that are not
    yet in RAG.  These become global (project_id=NULL) knowledge so the AI
    can retrieve architectural decisions and bug-fix rationale.

    PROMPT #157 - Prompt Doc + Git Commit RAG Sync
    """
    from app.services.prompt_doc_rag_sync import PromptDocRAGSync

    try:
        syncer = PromptDocRAGSync(db)
        result = syncer.sync_all()
        logger.info(f"PROMPT doc sync: {result}")
        return {"status": "ok", **result}
    except Exception as e:
        logger.error(f"PROMPT doc sync failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Falha na sincronização de documentos PROMPT: {str(e)}"
        )


@router.post("/projects/{project_id}/knowledge/sync-git-commits")
async def sync_git_commits(
    project_id: UUID,
    max_commits: int = Query(100, ge=1, le=500, description="Max commits to read from git log"),
    db: Session = Depends(get_db)
):
    """
    Read the last N commits from the project's code_path git repo and index
    any that are not yet in RAG.  Stored per-project so the AI has a
    timeline of changes when reasoning about that codebase.

    PROMPT #157 - Prompt Doc + Git Commit RAG Sync
    """
    from app.services.prompt_doc_rag_sync import GitCommitRAGSync

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Projeto {project_id} não encontrado"
        )

    if not project.code_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Projeto não tem code_path configurado"
        )

    try:
        syncer = GitCommitRAGSync(db, project_id, project.code_path)
        result = syncer.sync(max_commits=max_commits)
        logger.info(f"Git commit sync for project {project_id}: {result}")
        return {"status": "ok", "project_id": str(project_id), **result}
    except Exception as e:
        logger.error(f"Git commit sync failed for project {project_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Falha na sincronização de commits git: {str(e)}"
        )
