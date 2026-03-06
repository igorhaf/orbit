"""
Knowledge Business Rules Endpoints

PROMPT #147 - Incremental RAG Feeding for Business Rules
PROMPT #238 - Code Files & Rules-by-File Endpoints

CRUD operations for business rules in the RAG knowledge base.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Optional
from uuid import UUID
from datetime import datetime
import logging
import json

from app.database import get_db
from app.models.project import Project
from app.services.rag_service import RAGService
from app.schemas.knowledge import (
    BusinessRuleCreate,
    BusinessRuleResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


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
