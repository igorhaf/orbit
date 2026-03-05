"""
RAG (Retrieval-Augmented Generation) Service

PROMPT #83 - Phase 1: RAG Foundation
PROMPT #250 - Migrated from MiniLM to Nomic Embed Text via Ollama (768 dims)

This service provides semantic search over stored knowledge using embeddings.
Uses Nomic Embed Text (via Ollama) for generating 768-dimensional embeddings
and PostgreSQL with pgvector for storage and similarity search.

Features:
- Store documents with embeddings
- Retrieve similar documents via semantic search
- Filter by project_id, metadata, etc.
- pgvector extension for optimized vector search

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
import os
from typing import Dict, List, Optional
from uuid import UUID

import requests
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Ollama configuration for Nomic Embed Text
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://172.27.144.1:11434")
NOMIC_MODEL = "nomic-embed-text"
NOMIC_DIMS = 768


class RAGService:
    """
    RAG Service for semantic knowledge storage and retrieval.

    Uses Nomic Embed Text via Ollama for generating 768-dim embeddings
    and PostgreSQL with pgvector for cosine similarity search.
    """

    def __init__(self, db: Session):
        """
        Initialize RAG service.

        Args:
            db: SQLAlchemy database session
        """
        self.db = db

    @staticmethod
    def _generate_embedding(text_content: str) -> List[float]:
        """Generate embedding via Nomic Embed Text (Ollama API).

        Args:
            text_content: Text to embed

        Returns:
            List of 768 floats

        Raises:
            RuntimeError: If Ollama is unreachable or model unavailable
        """
        try:
            resp = requests.post(
                f"{OLLAMA_HOST}/api/embeddings",
                json={"model": NOMIC_MODEL, "prompt": text_content},
                timeout=30,
            )
            resp.raise_for_status()
            embedding = resp.json()["embedding"]
            if len(embedding) != NOMIC_DIMS:
                logger.warning(f"Unexpected embedding dims: {len(embedding)} (expected {NOMIC_DIMS})")
            return embedding
        except Exception as e:
            logger.error(f"Nomic embedding failed: {e}")
            raise RuntimeError(f"Failed to generate embedding via Ollama ({OLLAMA_HOST}): {e}")

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
        # Generate embedding via Nomic Embed Text
        embedding = self._generate_embedding(content)

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
        # Generate query embedding via Nomic Embed Text
        query_embedding = self._generate_embedding(query)

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

            # PROMPT #229 - Type inclusion/exclusion filters for RAG optimization
            if "type__in" in filter:
                types_list = filter["type__in"]
                type_in_placeholders = ", ".join([f":type_in_{i}" for i in range(len(types_list))])
                where_clauses.append(f"metadata->>'type' IN ({type_in_placeholders})")
                for i, t in enumerate(types_list):
                    params[f"type_in_{i}"] = t

            if "type__not_in" in filter:
                types_list = filter["type__not_in"]
                type_notin_placeholders = ", ".join([f":type_notin_{i}" for i in range(len(types_list))])
                where_clauses.append(f"metadata->>'type' NOT IN ({type_notin_placeholders})")
                for i, t in enumerate(types_list):
                    params[f"type_notin_{i}"] = t

            # Generic metadata filters (future extensibility)
            for key, value in filter.items():
                if key not in ["project_id", "type", "type__in", "type__not_in"]:
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

    def get_detailed_stats(self, project_id: Optional[UUID] = None) -> Dict:
        """
        Get detailed RAG statistics by document type.

        PROMPT #171 - Complete RAG storage verification.

        Args:
            project_id: Optional project filter (None = all projects)

        Returns:
            Dict with counts by document type (cards, interview_answers, project_context, etc.)
        """
        if project_id:
            where_clause = "WHERE project_id = :project_id"
            params = {"project_id": str(project_id)}
        else:
            where_clause = ""
            params = {}

        # Get counts by type
        query = text(f"""
            SELECT
                COALESCE(metadata->>'type', 'unknown') as doc_type,
                COUNT(*) as count
            FROM rag_documents
            {where_clause}
            GROUP BY COALESCE(metadata->>'type', 'unknown')
            ORDER BY count DESC
        """)

        result = self.db.execute(query, params).fetchall()

        # Build type counts dict
        type_counts = {}
        total = 0
        for row in result:
            type_counts[row.doc_type] = row.count
            total += row.count

        # Get card counts by item_type
        card_query = text(f"""
            SELECT
                COALESCE(metadata->>'item_type', 'unknown') as item_type,
                COUNT(*) as count
            FROM rag_documents
            WHERE metadata->>'type' = 'card'
            {' AND project_id = :project_id' if project_id else ''}
            GROUP BY COALESCE(metadata->>'item_type', 'unknown')
        """)

        card_result = self.db.execute(card_query, params if project_id else {}).fetchall()
        card_breakdown = {row.item_type: row.count for row in card_result}

        return {
            "total_documents": total,
            "by_type": type_counts,
            "cards_breakdown": card_breakdown,
            "project_id": str(project_id) if project_id else None
        }

    # ========================================================================
    # PROMPT #162 - Card RAG Integration
    # ========================================================================

    def store_card(
        self,
        card_id: UUID,
        title: str,
        description: Optional[str],
        generated_prompt: Optional[str],
        item_type: str,
        parent_id: Optional[UUID],
        labels: Optional[List[str]],
        workflow_state: str,
        project_id: UUID
    ) -> UUID:
        """
        Store a card (Epic/Story/Task/Subtask) in RAG for semantic search.

        PROMPT #162 - RAG as Central Memory: Index cards at creation/activation.

        Args:
            card_id: Card UUID
            title: Card title
            description: Card description (human-readable)
            generated_prompt: Semantic prompt for AI consumption
            item_type: epic, story, task, subtask
            parent_id: Parent card UUID (None for root cards)
            labels: Card labels
            workflow_state: draft, open, in_progress, done
            project_id: Project UUID

        Returns:
            UUID of RAG document

        Usage:
            rag.store_card(
                card_id=card.id,
                title=card.title,
                description=card.description,
                generated_prompt=card.generated_prompt,
                item_type=card.item_type.value,
                parent_id=card.parent_id,
                labels=card.labels,
                workflow_state=card.workflow_state,
                project_id=card.project_id
            )
        """
        # Build searchable content (combine title + description + prompt)
        content_parts = [title]
        if description:
            content_parts.append(description)
        if generated_prompt:
            content_parts.append(generated_prompt)

        content = "\n\n".join(content_parts)

        metadata = {
            "type": "card",
            "item_type": item_type,
            "card_id": str(card_id),
            "parent_id": str(parent_id) if parent_id else None,
            "labels": labels or [],
            "workflow_state": workflow_state
        }

        doc_id = self.store(
            content=content,
            metadata=metadata,
            project_id=project_id
        )

        logger.info(
            f"📇 Stored card in RAG: {title} "
            f"(type={item_type}, workflow={workflow_state}, doc_id={doc_id})"
        )

        return doc_id

    def find_similar_cards(
        self,
        title: str,
        description: Optional[str],
        project_id: UUID,
        item_type: Optional[str] = None,
        similarity_threshold: float = 0.85,
        top_k: int = 3
    ) -> List[Dict]:
        """
        Find similar cards in RAG to detect potential duplicates.

        PROMPT #162 - Auto-skip silencioso: Check before creating new cards.

        Args:
            title: New card title to check
            description: New card description (optional)
            project_id: Project UUID
            item_type: Filter by item_type (optional)
            similarity_threshold: Minimum similarity (0.85 = 85%)
            top_k: Max results to return

        Returns:
            List of similar cards (empty if no duplicates found)

        Usage:
            duplicates = rag.find_similar_cards(
                title="User Authentication Module",
                description="Implement login with OAuth",
                project_id=project.id,
                item_type="story",
                similarity_threshold=0.85
            )

            if duplicates:
                # Skip creation - card similar already exists
                logger.info(f"Skipping: similar to '{duplicates[0]['title']}'")
        """
        # Build query from title + description
        query_parts = [title]
        if description:
            query_parts.append(description)
        query = " ".join(query_parts)

        # Build filter
        filter_dict = {
            "project_id": str(project_id),
            "type": "card"
        }
        if item_type:
            filter_dict["item_type"] = item_type

        results = self.retrieve(
            query=query,
            filter=filter_dict,
            top_k=top_k,
            similarity_threshold=similarity_threshold
        )

        # Extract card info from results
        similar_cards = []
        for r in results:
            metadata = r.get("metadata", {})
            similar_cards.append({
                "card_id": metadata.get("card_id"),
                "title": r["content"].split("\n")[0],  # First line is title
                "item_type": metadata.get("item_type"),
                "workflow_state": metadata.get("workflow_state"),
                "similarity": r["similarity"]
            })

        if similar_cards:
            logger.info(
                f"🔍 Found {len(similar_cards)} similar cards for '{title[:50]}...' "
                f"(threshold={similarity_threshold})"
            )

        return similar_cards

    def update_card(
        self,
        card_id: UUID,
        title: str,
        description: Optional[str],
        generated_prompt: Optional[str],
        workflow_state: str,
        project_id: UUID
    ) -> Optional[UUID]:
        """
        Update a card's RAG entry (delete old + create new).

        Args:
            card_id: Card UUID
            title: Updated title
            description: Updated description
            generated_prompt: Updated prompt
            workflow_state: Updated state
            project_id: Project UUID

        Returns:
            New RAG document UUID, or None if card not found in RAG
        """
        # Delete old entry
        deleted = self.delete_by_filter({
            "project_id": str(project_id),
            "type": "card",
            "card_id": str(card_id)
        })

        if deleted == 0:
            logger.warning(f"Card {card_id} not found in RAG for update")

        # Re-index with updated content
        # Note: We don't have all metadata here, so we store minimal
        content_parts = [title]
        if description:
            content_parts.append(description)
        if generated_prompt:
            content_parts.append(generated_prompt)

        content = "\n\n".join(content_parts)

        doc_id = self.store(
            content=content,
            metadata={
                "type": "card",
                "card_id": str(card_id),
                "workflow_state": workflow_state
            },
            project_id=project_id
        )

        logger.info(f"📇 Updated card in RAG: {title} (doc_id={doc_id})")

        return doc_id

    def delete_card(self, card_id: UUID, project_id: UUID) -> int:
        """
        Delete a card from RAG.

        Args:
            card_id: Card UUID
            project_id: Project UUID

        Returns:
            Number of documents deleted (0 or 1)
        """
        return self.delete_by_filter({
            "project_id": str(project_id),
            "type": "card",
            "card_id": str(card_id)
        })

    # ========================================================================
    # PROMPT #162 - Context RAG Integration
    # ========================================================================

    def store_project_context(
        self,
        project_id: UUID,
        context_semantic: str,
        context_human: str
    ) -> tuple:
        """
        Store project context in RAG for cross-project learning.

        PROMPT #162 - Context indexed when locked.

        Args:
            project_id: Project UUID
            context_semantic: Semantic context (AI-optimized)
            context_human: Human-readable context

        Returns:
            Tuple of (semantic_doc_id, human_doc_id)
        """
        # Delete existing context entries first
        self.delete_by_filter({
            "project_id": str(project_id),
            "type": "project_context"
        })

        # Store semantic context
        semantic_doc_id = self.store(
            content=context_semantic,
            metadata={
                "type": "project_context",
                "context_type": "semantic"
            },
            project_id=project_id
        )

        # Store human context
        human_doc_id = self.store(
            content=context_human,
            metadata={
                "type": "project_context",
                "context_type": "human"
            },
            project_id=project_id
        )

        logger.info(
            f"🔒 Stored project context in RAG (project={project_id}, "
            f"semantic={len(context_semantic)} chars, human={len(context_human)} chars)"
        )

        return (semantic_doc_id, human_doc_id)

    def get_relevant_interview_answers(
        self,
        query: str,
        project_id: UUID,
        top_k: int = 5,
        similarity_threshold: float = 0.6
    ) -> List[Dict]:
        """
        Retrieve relevant interview answers for context.

        PROMPT #162 - Use orphaned interview answers for card generation.

        Args:
            query: Context query (e.g., card title being generated)
            project_id: Project UUID
            top_k: Max results
            similarity_threshold: Minimum similarity

        Returns:
            List of relevant answers with content and similarity

        Usage:
            # When generating a card about authentication
            answers = rag.get_relevant_interview_answers(
                query="User Authentication and Login",
                project_id=project.id
            )

            if answers:
                context = "User mentioned:\n"
                for a in answers:
                    context += f"- {a['content']}\n"
        """
        results = self.retrieve(
            query=query,
            filter={
                "project_id": str(project_id),
                "type": "interview_answer"
            },
            top_k=top_k,
            similarity_threshold=similarity_threshold
        )

        if results:
            logger.info(
                f"📝 Found {len(results)} relevant interview answers for '{query[:50]}...'"
            )

        return results

    # ========================================================================
    # PROMPT #170 - Business Rules High-Priority Retrieval
    # ========================================================================

    def get_business_rules(
        self,
        project_id: UUID,
        query: Optional[str] = None,
        top_k: int = 20,
        similarity_threshold: float = 0.5
    ) -> List[Dict]:
        """
        Retrieve business rules from codebase memory scan.

        PROMPT #170 - High-priority context for card generation.

        Business rules extracted from code (interfaces, validations, migrations)
        should influence ALL card generation: Context, Epics, Stories, Tasks, Subtasks.

        Args:
            project_id: Project UUID
            query: Optional query to filter relevant rules (None = all rules)
            top_k: Max number of rules to return
            similarity_threshold: Minimum similarity (lower = more inclusive)

        Returns:
            List of business rules sorted by priority:
            1. Interface-derived rules (HTML, templates) - highest priority
            2. Code-derived rules (validations, models)
            3. Generic rules

        Usage:
            # Get all business rules for a project
            rules = rag.get_business_rules(project_id=project.id)

            # Get rules relevant to a specific topic
            rules = rag.get_business_rules(
                project_id=project.id,
                query="authentication login"
            )

            # Format for prompt injection
            rules_text = rag.format_business_rules_for_prompt(rules)
        """
        if query:
            # Semantic search for relevant rules
            results = self.retrieve(
                query=query,
                filter={
                    "project_id": str(project_id),
                    "type": "business_rule"
                },
                top_k=top_k,
                similarity_threshold=similarity_threshold
            )
        else:
            # Get ALL business rules for project (no semantic filter)
            sql = """
                SELECT id, project_id, content, metadata, created_at
                FROM rag_documents
                WHERE project_id = :project_id
                AND metadata->>'type' = 'business_rule'
                ORDER BY
                    CASE
                        WHEN metadata->>'source' = 'interface' THEN 1
                        WHEN metadata->>'source' = 'template' THEN 2
                        WHEN metadata->>'source' = 'validation' THEN 3
                        WHEN metadata->>'source' = 'model' THEN 4
                        WHEN metadata->>'source' = 'migration' THEN 5
                        WHEN metadata->>'source' = 'git_commit' THEN 6
                        ELSE 7
                    END,
                    created_at DESC
                LIMIT :limit
            """

            raw_results = self.db.execute(
                text(sql),
                {"project_id": str(project_id), "limit": top_k}
            ).fetchall()

            results = [
                {
                    "id": str(r.id),
                    "project_id": str(r.project_id),
                    "content": r.content,
                    "metadata": json.loads(r.metadata) if isinstance(r.metadata, str) else r.metadata,
                    "created_at": r.created_at.isoformat(),
                    "similarity": 1.0  # All rules equally matched when no query
                }
                for r in raw_results
            ]

        if results:
            logger.info(
                f"📋 Retrieved {len(results)} business rules for project {project_id}"
            )

        return results

    def get_interface_rules(
        self,
        project_id: UUID,
        top_k: int = 10
    ) -> List[Dict]:
        """
        Get business rules specifically from interface analysis (highest priority).

        PROMPT #170 - Interface-derived rules are the most valuable because they
        represent explicit user-facing behavior defined in templates/views.

        Args:
            project_id: Project UUID
            top_k: Max rules to return

        Returns:
            List of interface-derived rules (titles, domains, form validations)
        """
        sql = """
            SELECT id, project_id, content, metadata, created_at
            FROM rag_documents
            WHERE project_id = :project_id
            AND metadata->>'type' = 'business_rule'
            AND (
                metadata->>'source' IN ('interface', 'template', 'view')
                OR metadata->>'source_file' LIKE '%%.blade.php'
                OR metadata->>'source_file' LIKE '%%.html'
                OR metadata->>'source_file' LIKE '%%.vue'
                OR metadata->>'source_file' LIKE '%%.tsx'
                OR metadata->>'source_file' LIKE '%%.jsx'
            )
            ORDER BY created_at DESC
            LIMIT :limit
        """

        raw_results = self.db.execute(
            text(sql),
            {"project_id": str(project_id), "limit": top_k}
        ).fetchall()

        results = [
            {
                "id": str(r.id),
                "project_id": str(r.project_id),
                "content": r.content,
                "metadata": json.loads(r.metadata) if isinstance(r.metadata, str) else r.metadata,
                "created_at": r.created_at.isoformat(),
                "priority": "high"
            }
            for r in raw_results
        ]

        if results:
            logger.info(
                f"🖥️ Retrieved {len(results)} interface rules for project {project_id}"
            )

        return results

    def format_business_rules_for_prompt(
        self,
        rules: List[Dict],
        max_chars: int = 4000
    ) -> str:
        """
        Format business rules for injection into AI prompts.

        PROMPT #170 - Formatted output for prompt injection.

        Args:
            rules: List of business rules from get_business_rules()
            max_chars: Maximum characters (to respect token limits)

        Returns:
            Formatted string ready for prompt injection

        Example output:
            ## REGRAS DE NEGÓCIO DO PROJETO (ALTA PRIORIDADE)

            As seguintes regras de negócio foram extraídas do código existente.
            TODAS as entregas devem respeitar estas regras:

            ### Regras de Interface (Prioridade Máxima)
            1. Sistema: SEI Contas - título oficial encontrado em templates
            2. Domínio: sei.pe.gov.br - sistema do Governo de Pernambuco
            3. Autenticação via LDAP é obrigatória

            ### Regras de Validação
            4. Senha deve ter mínimo 8 caracteres
            5. Email deve ser único por usuário
            ...
        """
        if not rules:
            return ""

        # Group rules by priority/source
        interface_rules = []
        validation_rules = []
        model_rules = []
        other_rules = []

        for rule in rules:
            metadata = rule.get("metadata", {})
            source = metadata.get("source", "")
            content = rule.get("content", "")

            if source in ("interface", "template", "view") or \
               "SISTEMA:" in content.upper() or \
               "DOMÍNIO:" in content.upper() or \
               "<title>" in content.lower():
                interface_rules.append(content)
            elif source in ("validation", "validator", "request"):
                validation_rules.append(content)
            elif source in ("model", "entity", "migration"):
                model_rules.append(content)
            else:
                other_rules.append(content)

        # Build formatted output
        lines = [
            "## REGRAS DE NEGÓCIO DO PROJETO (ALTA PRIORIDADE)",
            "",
            "As seguintes regras de negócio foram extraídas do código existente.",
            "TODAS as entregas (épicos, stories, tasks) DEVEM respeitar estas regras:",
            ""
        ]

        rule_number = 1

        if interface_rules:
            lines.append("### Regras de Interface (Prioridade Máxima)")
            for rule in interface_rules:
                lines.append(f"{rule_number}. {rule}")
                rule_number += 1
            lines.append("")

        if validation_rules:
            lines.append("### Regras de Validação")
            for rule in validation_rules:
                lines.append(f"{rule_number}. {rule}")
                rule_number += 1
            lines.append("")

        if model_rules:
            lines.append("### Regras de Modelo/Entidade")
            for rule in model_rules:
                lines.append(f"{rule_number}. {rule}")
                rule_number += 1
            lines.append("")

        if other_rules:
            lines.append("### Outras Regras")
            for rule in other_rules:
                lines.append(f"{rule_number}. {rule}")
                rule_number += 1
            lines.append("")

        result = "\n".join(lines)

        # Truncate if too long
        if len(result) > max_chars:
            result = result[:max_chars-50] + "\n\n... (regras truncadas por limite de tokens)"

        return result

    def store_business_rule(
        self,
        content: str,
        project_id: UUID,
        source: str = "code",
        source_file: Optional[str] = None,
        rule_type: Optional[str] = None,
        priority: str = "normal",
        entity: Optional[str] = None,
        evidence: Optional[str] = None,
        domain: Optional[str] = None,
        fully_coded: bool = True,
    ) -> UUID:
        """
        Store a single business rule in RAG with rich metadata.

        PROMPT #170 - Enhanced business rule storage.

        Args:
            content: The business rule text
            project_id: Project UUID
            source: Where rule came from (interface, template, validation, model, migration, code)
            source_file: File path where rule was found
            rule_type: Type of rule (domain, validation, constraint, workflow)
            priority: Rule priority (high, normal, low)
            entity: Main entity/class involved in this rule
            evidence: Code snippet that proves the rule
            domain: Business module/domain (e.g. "Autenticacao", "Pagamentos")

        Returns:
            UUID of stored document

        Example:
            # Store interface rule (high priority)
            rag.store_business_rule(
                content="Sistema: SEI Contas - Gestão LDAP Governo PE",
                project_id=project.id,
                source="interface",
                source_file="resources/views/layouts/app.blade.php",
                rule_type="domain",
                priority="high"
            )

            # Store validation rule
            rag.store_business_rule(
                content="Senha deve ter mínimo 8 caracteres",
                project_id=project.id,
                source="validation",
                source_file="app/Http/Requests/ResetPasswordRequest.php",
                rule_type="validation",
                priority="normal"
            )
        """
        metadata = {
            "type": "business_rule",
            "source": source,
            "rule_type": rule_type or "general",
            "priority": priority,
            "fully_coded": fully_coded,
        }

        if source_file:
            metadata["source_file"] = source_file
        if entity:
            metadata["entity"] = entity
        if evidence:
            metadata["evidence"] = evidence
        if domain:
            metadata["domain"] = domain

        doc_id = self.store(
            content=content,
            metadata=metadata,
            project_id=project_id
        )

        logger.info(
            f"📋 Stored business rule: '{content[:50]}...' "
            f"(source={source}, priority={priority})"
        )

        return doc_id
