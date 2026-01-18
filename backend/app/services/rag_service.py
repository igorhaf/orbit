"""
RAG (Retrieval-Augmented Generation) Service

PROMPT #83 - Phase 1: RAG Foundation

This service provides semantic search over stored knowledge using embeddings.
Uses sentence-transformers for generating 384-dimensional embeddings and PostgreSQL
for storage and similarity search.

Features:
- Store documents with embeddings
- Retrieve similar documents via semantic search
- Filter by project_id, metadata, etc.
- Future: pgvector extension for optimized vector search

Usage:
    from app.services.rag_service import RAGService

    rag = RAGService(db)

    # Store knowledge
    rag.store(
        content="User authentication implemented with JWT",
        metadata={"type": "interview_answer", "project_id": "uuid"},
        project_id=project_id
    )

    # Retrieve similar knowledge
    results = rag.retrieve(
        query="How was authentication implemented?",
        filter={"project_id": project_id},
        top_k=5
    )
"""

import json
import logging
from typing import Dict, List, Optional
from uuid import UUID

import numpy as np
from sentence_transformers import SentenceTransformer
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class RAGService:
    """
    RAG Service for semantic knowledge storage and retrieval.

    Uses sentence-transformers (all-MiniLM-L6-v2) for generating 384-dim embeddings
    and PostgreSQL for storage with cosine similarity search.
    """

    # Singleton pattern for embedding model (expensive to load)
    _embedder: Optional[SentenceTransformer] = None
    _model_name = "all-MiniLM-L6-v2"  # 384 dimensions, fast, good quality

    def __init__(self, db: Session):
        """
        Initialize RAG service.

        Args:
            db: SQLAlchemy database session
        """
        self.db = db
        self._ensure_embedder_loaded()

    @classmethod
    def _ensure_embedder_loaded(cls):
        """Load embedding model once (singleton pattern)."""
        if cls._embedder is None:
            logger.info(f"Loading embedding model: {cls._model_name}")
            cls._embedder = SentenceTransformer(cls._model_name)
            logger.info("Embedding model loaded successfully")

    def store(
        self,
        content: str,
        metadata: Optional[Dict] = None,
        project_id: Optional[UUID] = None
    ) -> UUID:
        """
        Store document in RAG with embedding.

        Args:
            content: Text content to store
            metadata: Optional metadata dict (e.g., type, source, category)
            project_id: Optional project UUID (None = global knowledge)

        Returns:
            UUID of created document

        Example:
            doc_id = rag.store(
                content="JWT authentication with refresh tokens",
                metadata={
                    "type": "interview_answer",
                    "question_number": 12,
                    "interview_id": "uuid"
                },
                project_id=project_id
            )
        """
        # Generate embedding
        embedding = self._embedder.encode(content).tolist()

        # Insert into database
        query = text("""
            INSERT INTO rag_documents (project_id, content, embedding, metadata)
            VALUES (:project_id, :content, :embedding, :metadata)
            RETURNING id
        """)

        result = self.db.execute(query, {
            "project_id": str(project_id) if project_id else None,
            "content": content,
            "embedding": embedding,
            "metadata": json.dumps(metadata or {})
        })

        doc_id = result.fetchone()[0]
        self.db.commit()

        logger.info(f"Stored document {doc_id} (project: {project_id}, content length: {len(content)})")

        return doc_id

    def retrieve(
        self,
        query: str,
        filter: Optional[Dict] = None,
        top_k: int = 5,
        similarity_threshold: float = 0.0
    ) -> List[Dict]:
        """
        Retrieve top-k most similar documents via semantic search.

        Args:
            query: Search query text
            filter: Optional filters dict
                - project_id: UUID or None (global)
                - type: metadata type filter
                - Any JSONB metadata field
            top_k: Number of results to return
            similarity_threshold: Minimum similarity score (0.0-1.0)

        Returns:
            List of dicts with: id, content, metadata, similarity, project_id

        Example:
            results = rag.retrieve(
                query="authentication method",
                filter={"project_id": project_id, "type": "interview_answer"},
                top_k=5,
                similarity_threshold=0.7
            )

            for r in results:
                print(f"Similarity: {r['similarity']:.2f}")
                print(f"Content: {r['content']}")
                print(f"Metadata: {r['metadata']}")
        """
        # Generate query embedding
        query_embedding = self._embedder.encode(query).tolist()

        # Build WHERE clause from filter
        where_clauses = ["1=1"]
        params = {
            "embedding": query_embedding,
            "k": top_k,
            "threshold": similarity_threshold
        }

        if filter:
            # Project ID filter
            if "project_id" in filter:
                if filter["project_id"] is None:
                    where_clauses.append("project_id IS NULL")
                else:
                    where_clauses.append("project_id = :project_id")
                    params["project_id"] = str(filter["project_id"])

            # Metadata type filter
            if "type" in filter:
                where_clauses.append("metadata->>'type' = :type")
                params["type"] = filter["type"]

            # Generic metadata filters (future extensibility)
            for key, value in filter.items():
                if key not in ["project_id", "type"]:
                    where_clauses.append(f"metadata->>'{key}' = :{key}")
                    params[key] = value

        # Cosine similarity using pgvector: 1 - (A <=> B)
        # <=> is the cosine distance operator (optimized with SIMD)
        # Returns similarity score between 0 and 1 (1 = identical, 0 = orthogonal)
        # PROMPT #88 - pgvector optimization (10-50x faster than manual calculation)
        # Convert embedding to string format for pgvector cast
        embedding_str = "[" + ",".join(str(x) for x in params["embedding"]) + "]"
        params["embedding_str"] = embedding_str

        # PROMPT #81 - Use CAST instead of :: to avoid SQLAlchemy bind parameter conflict
        sql = f"""
            SELECT
                id,
                project_id,
                content,
                metadata,
                created_at,
                (1 - (embedding <=> CAST(:embedding_str AS vector))) as similarity
            FROM rag_documents
            WHERE {" AND ".join(where_clauses)}
                AND (1 - (embedding <=> CAST(:embedding_str AS vector))) >= :threshold
            ORDER BY embedding <=> CAST(:embedding_str AS vector)
            LIMIT :k
        """

        results = self.db.execute(text(sql), params).fetchall()

        documents = [
            {
                "id": str(r.id),
                "project_id": str(r.project_id) if r.project_id else None,
                "content": r.content,
                "metadata": json.loads(r.metadata) if isinstance(r.metadata, str) else r.metadata,
                "created_at": r.created_at.isoformat(),
                "similarity": float(r.similarity)
            }
            for r in results
        ]

        logger.info(
            f"Retrieved {len(documents)} documents for query '{query[:50]}...' "
            f"(top_k={top_k}, threshold={similarity_threshold})"
        )

        return documents

    def search(
        self,
        query: str,
        project_id: Optional[UUID] = None,
        top_k: int = 5,
        similarity_threshold: float = 0.7
    ) -> List[Dict]:
        """
        High-level search method with sensible defaults.

        Args:
            query: Search query text
            project_id: Optional project UUID filter
            top_k: Number of results
            similarity_threshold: Minimum similarity (default: 0.7)

        Returns:
            List of similar documents

        Example:
            # Search in specific project
            results = rag.search("authentication", project_id=project_id)

            # Search globally
            results = rag.search("Laravel best practices", project_id=None)
        """
        filter_dict = {}
        if project_id is not None:
            filter_dict["project_id"] = project_id

        return self.retrieve(
            query=query,
            filter=filter_dict,
            top_k=top_k,
            similarity_threshold=similarity_threshold
        )

    def delete(self, document_id: UUID) -> bool:
        """
        Delete a document from RAG.

        Args:
            document_id: UUID of document to delete

        Returns:
            True if deleted, False if not found
        """
        query = text("DELETE FROM rag_documents WHERE id = :id")
        result = self.db.execute(query, {"id": str(document_id)})
        self.db.commit()

        deleted = result.rowcount > 0
        if deleted:
            logger.info(f"Deleted document {document_id}")
        else:
            logger.warning(f"Document {document_id} not found for deletion")

        return deleted

    def delete_by_project(self, project_id: UUID) -> int:
        """
        Delete all documents for a project.

        Args:
            project_id: UUID of project

        Returns:
            Number of documents deleted
        """
        query = text("DELETE FROM rag_documents WHERE project_id = :project_id")
        result = self.db.execute(query, {"project_id": str(project_id)})
        self.db.commit()

        count = result.rowcount
        logger.info(f"Deleted {count} documents for project {project_id}")

        return count

    def delete_by_filter(self, filter: Dict) -> int:
        """
        Delete documents matching filter criteria.

        PROMPT #97 - Used for interview question cleanup.

        Args:
            filter: Filter dict (same format as retrieve())
                - project_id: UUID or None (required for most use cases)
                - type: metadata type filter (e.g., "interview_question")
                - interview_id: specific interview UUID
                - Any JSONB metadata field

        Returns:
            Number of documents deleted

        Example:
            # Delete all interview questions for a project
            count = rag.delete_by_filter({
                "project_id": project_id,
                "type": "interview_question"
            })

            # Delete all questions from specific interview
            count = rag.delete_by_filter({
                "project_id": project_id,
                "type": "interview_question",
                "interview_id": interview_id
            })
        """
        # Build WHERE clause from filter
        where_clauses = []
        params = {}

        if not filter:
            logger.warning("delete_by_filter called with empty filter - aborting for safety")
            return 0

        # Project ID filter
        if "project_id" in filter:
            if filter["project_id"] is None:
                where_clauses.append("project_id IS NULL")
            else:
                where_clauses.append("project_id = :project_id")
                params["project_id"] = str(filter["project_id"])

        # Metadata type filter
        if "type" in filter:
            where_clauses.append("metadata->>'type' = :type")
            params["type"] = filter["type"]

        # Generic metadata filters (interview_id, etc.)
        for key, value in filter.items():
            if key not in ["project_id", "type"]:
                where_clauses.append(f"metadata->>'{key}' = :{key}")
                params[key] = str(value) if isinstance(value, UUID) else value

        if not where_clauses:
            logger.warning("delete_by_filter: No valid filter clauses - aborting for safety")
            return 0

        sql = f"DELETE FROM rag_documents WHERE {' AND '.join(where_clauses)}"
        result = self.db.execute(text(sql), params)
        self.db.commit()

        count = result.rowcount
        logger.info(f"Deleted {count} documents with filter {filter}")

        return count

    def get_stats(self, project_id: Optional[UUID] = None) -> Dict:
        """
        Get RAG statistics.

        Args:
            project_id: Optional project filter (None = all projects)

        Returns:
            Dict with document_count, avg_content_length, metadata_types
        """
        if project_id:
            where_clause = "WHERE project_id = :project_id"
            params = {"project_id": str(project_id)}
        else:
            where_clause = ""
            params = {}

        query = text(f"""
            SELECT
                COUNT(*) as document_count,
                AVG(LENGTH(content)) as avg_content_length,
                JSONB_AGG(DISTINCT metadata->>'type') as metadata_types
            FROM rag_documents
            {where_clause}
        """)

        result = self.db.execute(query, params).fetchone()

        return {
            "document_count": result.document_count or 0,
            "avg_content_length": round(result.avg_content_length or 0, 2),
            "metadata_types": result.metadata_types or []
        }
