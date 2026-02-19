"""
Knowledge Base API Endpoints

PROMPT #84 - RAG Phase 2: Interview Enhancement
PROMPT #147 - Incremental RAG Feeding for Business Rules

Semantic search and management of project knowledge base:
- Business rules (manual, from code scan, from interviews)
- Document uploads
- Interview answers
"""

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, status
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Optional
from uuid import UUID
from pydantic import BaseModel, Field
from datetime import datetime
import logging
import json

from app.database import get_db
from app.models.project import Project
from app.services.rag_service import RAGService
from app.schemas.knowledge import (
    BusinessRuleCreate,
    BusinessRuleUpdate,
    BusinessRuleResponse,
    DocumentUploadResponse,
    KnowledgeStats
)

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
            detail=f"Projeto {project_id} não encontrado"
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
            detail=f"Falha na busca de conhecimento: {str(e)}"
        )


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
    - Cards breakdown by item_type (epic, story, task, subtask)

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
        - global_only: Stats for global documents (project_id=NULL)
    """
    try:
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

        # Get global-only stats (project_id IS NULL)
        global_query = text("""
            SELECT
                COUNT(*) as total_documents,
                COUNT(*) FILTER (WHERE metadata->>'type' LIKE 'spec_%') as framework_specs,
                COUNT(*) FILTER (WHERE metadata->>'content_type' = 'prompt_doc') as prompt_docs
            FROM rag_documents
            WHERE project_id IS NULL
        """)
        global_result = db.execute(global_query).fetchone()

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
            "global_only": {
                "total_documents": global_result.total_documents if global_result else 0,
                "framework_specs": global_result.framework_specs if global_result else 0,
                "prompt_docs": global_result.prompt_docs if global_result else 0
            }
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
            detail=f"Falha ao obter estatisticas de conhecimento: {str(e)}"
        )


# ============================================================================
# PROMPT #147 - BUSINESS RULES ENDPOINTS
# ============================================================================

@router.get("/projects/{project_id}/knowledge/rules", response_model=List[BusinessRuleResponse])
async def list_business_rules(
    project_id: UUID,
    category: Optional[str] = Query(None, description="Filter by category"),
    source: Optional[str] = Query(None, description="Filter by source"),
    source_file: Optional[str] = Query(None, description="Filter by source file path"),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db)
):
    """
    List all business rules for a project.

    PROMPT #147 - Incremental RAG Feeding

    Returns all knowledge items tagged as business_rule for this project,
    optionally filtered by category or source.
    """
    # Validate project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Projeto {project_id} não encontrado"
        )

    try:
        # Query RAG documents directly for business rules
        where_clauses = [
            "project_id = :project_id",
            "(metadata->>'content_type' = 'business_rule' OR metadata->>'type' = 'business_rule')"
        ]
        params = {"project_id": str(project_id), "limit": limit}

        if category:
            where_clauses.append("metadata->>'category' = :category")
            params["category"] = category

        if source:
            where_clauses.append("metadata->>'source' = :source")
            params["source"] = source

        if source_file:
            where_clauses.append("metadata->>'source_file' = :source_file")
            params["source_file"] = source_file

        query = text(f"""
            SELECT id, content, metadata, created_at
            FROM rag_documents
            WHERE {" AND ".join(where_clauses)}
            ORDER BY created_at DESC
            LIMIT :limit
        """)

        result = db.execute(query, params).fetchall()

        rules = []
        for row in result:
            metadata = row.metadata if isinstance(row.metadata, dict) else json.loads(row.metadata)
            rules.append(BusinessRuleResponse(
                id=str(row.id),
                title=metadata.get("title", ""),
                description=row.content,
                category=metadata.get("category", "validation"),
                source=metadata.get("source", "unknown"),
                created_at=row.created_at.isoformat()
            ))

        logger.info(f"Listed {len(rules)} business rules for project {project_id}")
        return rules

    except Exception as e:
        logger.error(f"Failed to list business rules: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Falha ao listar regras de negocio: {str(e)}"
        )


# ============================================================================
# PROMPT #238 - CODE FILES & RULES-BY-FILE ENDPOINTS
# ============================================================================

@router.get("/projects/{project_id}/knowledge/code-files")
async def list_code_files(
    project_id: UUID,
    limit: int = Query(2000, ge=1, le=5000),
    db: Session = Depends(get_db)
):
    """
    PROMPT #238 - List all code files indexed in RAG for a project.
    Used by the Code Files individual page.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Projeto {project_id} não encontrado"
        )

    try:
        query = text("""
            SELECT id, metadata, created_at
            FROM rag_documents
            WHERE project_id = :project_id
                AND (metadata->>'content_type' = 'code_file'
                     OR metadata->>'type' = 'code_file')
            ORDER BY metadata->>'source_file' ASC
            LIMIT :limit
        """)

        result = db.execute(query, {"project_id": str(project_id), "limit": limit}).fetchall()

        files = []
        for row in result:
            metadata = row.metadata if isinstance(row.metadata, dict) else json.loads(row.metadata)
            files.append({
                "id": str(row.id),
                "file_path": metadata.get("source_file") or metadata.get("file_path", ""),
                "language": metadata.get("language", "unknown"),
                "source": metadata.get("source", "unknown"),
                "created_at": row.created_at.isoformat() if row.created_at else None,
            })

        # Group count by language for sidebar
        lang_counts: dict = {}
        for f in files:
            lang = f["language"]
            lang_counts[lang] = lang_counts.get(lang, 0) + 1

        return {
            "project_id": str(project_id),
            "total": len(files),
            "by_language": lang_counts,
            "files": files,
        }

    except Exception as e:
        logger.error(f"Failed to list code files: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Falha ao listar arquivos de código: {str(e)}"
        )


@router.get("/projects/{project_id}/knowledge/rules-by-file")
async def list_rules_by_file(
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    PROMPT #238 - Get business rules grouped by source file.
    Used by the Business Rules individual page sidebar.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Projeto {project_id} não encontrado"
        )

    try:
        query = text("""
            SELECT
                COALESCE(metadata->>'source_file', '(sem arquivo)') as source_file,
                COUNT(*) as rules_count
            FROM rag_documents
            WHERE project_id = :project_id
                AND (metadata->>'content_type' = 'business_rule'
                     OR metadata->>'type' = 'business_rule')
            GROUP BY COALESCE(metadata->>'source_file', '(sem arquivo)')
            ORDER BY COUNT(*) DESC
        """)

        result = db.execute(query, {"project_id": str(project_id)}).fetchall()

        files = [
            {"source_file": row.source_file, "rules_count": row.rules_count}
            for row in result
        ]
        total_rules = sum(f["rules_count"] for f in files)

        return {
            "project_id": str(project_id),
            "total_rules": total_rules,
            "total_files": len(files),
            "files": files,
        }

    except Exception as e:
        logger.error(f"Failed to list rules by file: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Falha ao listar regras por arquivo: {str(e)}"
        )


@router.post("/projects/{project_id}/knowledge/rules", response_model=dict)
async def add_business_rule(
    project_id: UUID,
    rule: BusinessRuleCreate,
    db: Session = Depends(get_db)
):
    """
    Add a business rule manually.

    PROMPT #147 - Incremental RAG Feeding

    Stores a new business rule in the RAG with proper metadata.
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

        # Store with proper metadata
        doc_id = rag_service.store(
            content=f"{rule.title}: {rule.description}",
            metadata={
                "content_type": "business_rule",
                "title": rule.title,
                "category": rule.category,
                "source": "manual",
                "added_at": datetime.utcnow().isoformat()
            },
            project_id=project_id
        )

        logger.info(f"Added business rule '{rule.title}' to project {project_id}")

        return {
            "id": str(doc_id),
            "status": "created",
            "message": f"Regra de negocio '{rule.title}' adicionada com sucesso"
        }

    except Exception as e:
        logger.error(f"Failed to add business rule: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Falha ao adicionar regra de negocio: {str(e)}"
        )


@router.delete("/projects/{project_id}/knowledge/rules/{rule_id}")
async def delete_business_rule(
    project_id: UUID,
    rule_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Delete a business rule.

    PROMPT #147 - Incremental RAG Feeding
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
        deleted = rag_service.delete(rule_id)

        if deleted:
            logger.info(f"Deleted business rule {rule_id} from project {project_id}")
            return {"status": "deleted", "id": str(rule_id)}
        else:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Regra de negocio {rule_id} não encontrada"
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete business rule: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Falha ao excluir regra de negocio: {str(e)}"
        )


# ============================================================================
# PROMPT #147 - DOCUMENT UPLOAD ENDPOINTS
# ============================================================================

def _chunk_document(text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
    """
    Split document into overlapping chunks for better retrieval.

    Args:
        text: Full document text
        chunk_size: Target size for each chunk (in characters)
        overlap: Characters of overlap between chunks

    Returns:
        List of text chunks
    """
    if len(text) <= chunk_size:
        return [text]

    chunks = []
    start = 0

    while start < len(text):
        end = start + chunk_size

        # Try to break at sentence/paragraph boundary
        if end < len(text):
            # Look for paragraph break first
            para_break = text.rfind('\n\n', start, end)
            if para_break > start + chunk_size // 2:
                end = para_break + 2
            else:
                # Look for sentence break
                for sep in ['. ', '! ', '? ', '\n']:
                    sentence_break = text.rfind(sep, start, end)
                    if sentence_break > start + chunk_size // 2:
                        end = sentence_break + len(sep)
                        break

        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)

        start = end - overlap

    return chunks


@router.post("/projects/{project_id}/knowledge/upload", response_model=DocumentUploadResponse)
async def upload_document(
    project_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """
    Upload and index a document.

    PROMPT #147 - Incremental RAG Feeding

    Accepts MD, TXT, and other text files. Splits into chunks and indexes
    each chunk in the RAG for semantic search.
    """
    # Validate project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Projeto {project_id} não encontrado"
        )

    # Validate file type
    allowed_extensions = ['.md', '.txt', '.rst', '.yaml', '.yml', '.json']
    filename = file.filename or "unknown"
    ext = '.' + filename.split('.')[-1].lower() if '.' in filename else ''

    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Tipo de arquivo não permitido. Permitidos: {', '.join(allowed_extensions)}"
        )

    try:
        content = await file.read()
        text = content.decode('utf-8')

        # Chunk document
        chunks = _chunk_document(text, chunk_size=500, overlap=50)

        # Store each chunk
        rag_service = RAGService(db)
        for i, chunk in enumerate(chunks):
            rag_service.store(
                content=chunk,
                metadata={
                    "content_type": "document",
                    "filename": filename,
                    "chunk_index": i,
                    "total_chunks": len(chunks),
                    "source": "upload",
                    "uploaded_at": datetime.utcnow().isoformat()
                },
                project_id=project_id
            )

        logger.info(f"Uploaded document '{filename}' with {len(chunks)} chunks to project {project_id}")

        return DocumentUploadResponse(
            filename=filename,
            chunks_indexed=len(chunks),
            total_chars=len(text)
        )

    except UnicodeDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O arquivo deve ser texto codificado em UTF-8"
        )
    except Exception as e:
        logger.error(f"Failed to upload document: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Falha ao enviar documento: {str(e)}"
        )


@router.get("/projects/{project_id}/knowledge/documents")
async def list_documents(
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    List all uploaded documents for a project.

    PROMPT #147 - Incremental RAG Feeding

    Groups chunks by filename and returns document info.
    """
    # Validate project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Projeto {project_id} não encontrado"
        )

    try:
        query = text("""
            SELECT
                metadata->>'filename' as filename,
                COUNT(*) as chunks,
                MIN(created_at) as uploaded_at
            FROM rag_documents
            WHERE project_id = :project_id
                AND metadata->>'content_type' = 'document'
            GROUP BY metadata->>'filename'
            ORDER BY MIN(created_at) DESC
        """)

        result = db.execute(query, {"project_id": str(project_id)}).fetchall()

        documents = [
            {
                "filename": row.filename,
                "chunks": row.chunks,
                "uploaded_at": row.uploaded_at.isoformat() if row.uploaded_at else None
            }
            for row in result
        ]

        return {"documents": documents, "total": len(documents)}

    except Exception as e:
        logger.error(f"Failed to list documents: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Falha ao listar documentos: {str(e)}"
        )


@router.delete("/projects/{project_id}/knowledge/documents/{filename}")
async def delete_document(
    project_id: UUID,
    filename: str,
    db: Session = Depends(get_db)
):
    """
    Delete all chunks of a document.

    PROMPT #147 - Incremental RAG Feeding
    """
    # Validate project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Projeto {project_id} não encontrado"
        )

    try:
        query = text("""
            DELETE FROM rag_documents
            WHERE project_id = :project_id
                AND metadata->>'content_type' = 'document'
                AND metadata->>'filename' = :filename
        """)

        result = db.execute(query, {
            "project_id": str(project_id),
            "filename": filename
        })
        db.commit()

        deleted_count = result.rowcount

        if deleted_count > 0:
            logger.info(f"Deleted document '{filename}' ({deleted_count} chunks) from project {project_id}")
            return {
                "status": "deleted",
                "filename": filename,
                "chunks_deleted": deleted_count
            }
        else:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Documento '{filename}' não encontrado"
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete document: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Falha ao excluir documento: {str(e)}"
        )


# ============================================================================
# PROMPT #147 - KNOWLEDGE STATISTICS
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
