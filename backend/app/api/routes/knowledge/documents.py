"""
Knowledge Document Endpoints

PROMPT #147 - Incremental RAG Feeding for Documents
PROMPT #243 - Orbit Knowledge Upload (Disk + RAG)

Document upload, listing, and deletion for the knowledge base.
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List
from uuid import UUID
from pydantic import BaseModel
from datetime import datetime
import logging

from app.database import get_db
from app.models.project import Project
from app.services.rag_service import RAGService
from app.schemas.knowledge import DocumentUploadResponse

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================================
# HELPER
# ============================================================================

def _chunk_document(text_content: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
    """
    Split document into overlapping chunks for better retrieval.

    Args:
        text_content: Full document text
        chunk_size: Target size for each chunk (in characters)
        overlap: Characters of overlap between chunks

    Returns:
        List of text chunks
    """
    if len(text_content) <= chunk_size:
        return [text_content]

    chunks = []
    start = 0

    while start < len(text_content):
        end = start + chunk_size

        # Try to break at sentence/paragraph boundary
        if end < len(text_content):
            # Look for paragraph break first
            para_break = text_content.rfind('\n\n', start, end)
            if para_break > start + chunk_size // 2:
                end = para_break + 2
            else:
                # Look for sentence break
                for sep in ['. ', '! ', '? ', '\n']:
                    sentence_break = text_content.rfind(sep, start, end)
                    if sentence_break > start + chunk_size // 2:
                        end = sentence_break + len(sep)
                        break

        chunk = text_content[start:end].strip()
        if chunk:
            chunks.append(chunk)

        start = end - overlap

    return chunks


# ============================================================================
# PROMPT #147 - DOCUMENT UPLOAD
# ============================================================================

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
        text_content = content.decode('utf-8')

        # Chunk document
        chunks = _chunk_document(text_content, chunk_size=500, overlap=50)

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
            total_chars=len(text_content)
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


# ============================================================================
# PROMPT #243 - ORBIT KNOWLEDGE UPLOAD (DISK + RAG)
# ============================================================================


class OrbitKnowledgeUploadResponse(BaseModel):
    filename: str
    file_path: str
    size_bytes: int
    chunks_indexed: int
    orbit_path: str


class OrbitKnowledgeFile(BaseModel):
    filename: str
    size_bytes: int
    modified_at: str


@router.post(
    "/projects/{project_id}/knowledge/upload-orbit",
    response_model=OrbitKnowledgeUploadResponse,
)
async def upload_orbit_knowledge(
    project_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """
    Upload a document to .orbit/docs/ on disk AND index in RAG.

    PROMPT #243 - Orbit Knowledge Upload

    Saves the file to {code_path}/.orbit/docs/{filename} and also
    chunks + indexes the content in the RAG for semantic search.
    Accepts text files: .md, .txt, .rst, .yaml, .yml, .json, .pdf
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Projeto {project_id} não encontrado",
        )

    if not project.code_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Projeto não tem code_path configurado",
        )

    # Validate file type
    allowed_extensions = [".md", ".txt", ".rst", ".yaml", ".yml", ".json"]
    filename = file.filename or "unknown"
    ext = "." + filename.split(".")[-1].lower() if "." in filename else ""

    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Tipo de arquivo não permitido. Permitidos: {', '.join(allowed_extensions)}",
        )

    try:
        content = await file.read()

        # 1. Save to .orbit/docs/ on disk
        from app.services.orbit_folder import OrbitFolderService

        orbit_service = OrbitFolderService(db)
        disk_result = orbit_service.upload_knowledge(project, filename, content)

        # 2. Index in RAG
        text_content = content.decode("utf-8")
        chunks = _chunk_document(text_content, chunk_size=500, overlap=50)

        rag_service = RAGService(db)
        for i, chunk in enumerate(chunks):
            rag_service.store(
                content=chunk,
                metadata={
                    "content_type": "knowledge",
                    "filename": disk_result["filename"],
                    "chunk_index": i,
                    "total_chunks": len(chunks),
                    "source": "orbit_knowledge",
                    "file_path": disk_result["file_path"],
                    "uploaded_at": datetime.utcnow().isoformat(),
                },
                project_id=project_id,
            )

        logger.info(
            f"Uploaded orbit knowledge '{disk_result['filename']}' "
            f"({disk_result['size_bytes']} bytes, {len(chunks)} RAG chunks) "
            f"for project {project_id}"
        )

        return OrbitKnowledgeUploadResponse(
            filename=disk_result["filename"],
            file_path=disk_result["file_path"],
            size_bytes=disk_result["size_bytes"],
            chunks_indexed=len(chunks),
            orbit_path=disk_result["orbit_path"],
        )

    except UnicodeDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O arquivo deve ser texto codificado em UTF-8",
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        logger.error(f"Failed to upload orbit knowledge: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Falha ao enviar arquivo de conhecimento: {str(e)}",
        )


@router.get("/projects/{project_id}/knowledge/orbit-files")
async def list_orbit_knowledge_files(
    project_id: UUID,
    db: Session = Depends(get_db),
):
    """
    List all files in .orbit/docs/ on disk.

    PROMPT #243 - Orbit Knowledge Upload
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Projeto {project_id} não encontrado",
        )

    if not project.code_path:
        return {"files": [], "total": 0}

    from app.services.orbit_folder import OrbitFolderService

    orbit_service = OrbitFolderService(db)
    files = orbit_service.list_knowledge_files(project)

    return {"files": files, "total": len(files)}


@router.delete("/projects/{project_id}/knowledge/orbit-files/{filename}")
async def delete_orbit_knowledge_file(
    project_id: UUID,
    filename: str,
    db: Session = Depends(get_db),
):
    """
    Delete a file from .orbit/docs/ on disk and remove its RAG chunks.

    PROMPT #243 - Orbit Knowledge Upload
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Projeto {project_id} não encontrado",
        )

    from app.services.orbit_folder import OrbitFolderService

    orbit_service = OrbitFolderService(db)
    deleted = orbit_service.delete_knowledge_file(project, filename)

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Arquivo '{filename}' não encontrado em .orbit/docs/",
        )

    # Also remove RAG chunks for this file
    try:
        safe_name = __import__("pathlib").Path(filename).name
        query = text("""
            DELETE FROM rag_documents
            WHERE project_id = :project_id
                AND metadata->>'source' = 'orbit_knowledge'
                AND metadata->>'filename' = :filename
        """)
        result = db.execute(
            query,
            {"project_id": str(project_id), "filename": safe_name},
        )
        db.commit()
        chunks_deleted = result.rowcount
    except Exception as e:
        logger.warning(f"Failed to delete RAG chunks for {filename}: {e}")
        chunks_deleted = 0

    logger.info(
        f"Deleted orbit knowledge file '{filename}' "
        f"({chunks_deleted} RAG chunks) from project {project_id}"
    )

    return {
        "status": "deleted",
        "filename": filename,
        "chunks_deleted": chunks_deleted,
    }


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
