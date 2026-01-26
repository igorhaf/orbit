"""
Spec-RAG Synchronization Service
PROMPT #110 - RAG Evolution Phase 2

Synchronizes specs from database to RAG index for semantic search.
Framework specs become searchable knowledge for task execution and interviews.

Features:
- Sync all FRAMEWORK specs to RAG
- Sync individual specs on create/update
- Delete from RAG when spec deleted
- Avoid duplicates via metadata tracking
"""

import logging
from typing import Dict, List, Optional
from uuid import UUID

from sqlalchemy.orm import Session
from sqlalchemy import text

from app.models.spec import Spec, SpecScope
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)


class SpecRAGSync:
    """
    Service for synchronizing specs with RAG index.

    Enables semantic search over framework specifications,
    enriching context for task execution and interviews.
    """

    def __init__(self, db: Session):
        """
        Initialize SpecRAGSync service.

        Args:
            db: SQLAlchemy database session
        """
        self.db = db
        self.rag_service = RAGService(db)

    def sync_all_framework_specs(self) -> Dict:
        """
        Sync all FRAMEWORK specs to RAG index.

        Indexes all active framework specs that aren't already in RAG.
        Uses spec_id in metadata to avoid duplicates.

        Returns:
            Dict with sync results:
                - total: Total framework specs
                - synced: Newly synced specs
                - skipped: Already indexed specs
                - errors: Specs that failed to sync
        """
        logger.info("Starting sync of all framework specs to RAG...")

        # Get all active framework specs
        specs = self.db.query(Spec).filter(
            Spec.scope == SpecScope.FRAMEWORK,
            Spec.is_active == True
        ).all()

        logger.info(f"Found {len(specs)} active framework specs")

        results = {
            "total": len(specs),
            "synced": 0,
            "skipped": 0,
            "errors": 0,
            "error_details": []
        }

        for spec in specs:
            try:
                # Check if already indexed
                if self._is_spec_indexed(spec.id):
                    results["skipped"] += 1
                    logger.debug(f"Spec {spec.id} already indexed, skipping")
                    continue

                # Index the spec
                self._index_spec(spec)
                results["synced"] += 1
                logger.info(f"Indexed spec: {spec.name}/{spec.spec_type}")

            except Exception as e:
                results["errors"] += 1
                results["error_details"].append({
                    "spec_id": str(spec.id),
                    "name": spec.name,
                    "error": str(e)
                })
                logger.error(f"Failed to index spec {spec.id}: {e}")

        logger.info(
            f"Sync complete: {results['synced']} synced, "
            f"{results['skipped']} skipped, {results['errors']} errors"
        )

        return results

    def sync_spec(self, spec_id: UUID) -> bool:
        """
        Sync a single spec to RAG.

        Used when a spec is created or updated.

        Args:
            spec_id: UUID of spec to sync

        Returns:
            True if synced, False if not found or error
        """
        spec = self.db.query(Spec).filter(Spec.id == spec_id).first()

        if not spec:
            logger.warning(f"Spec {spec_id} not found for sync")
            return False

        if not spec.is_active:
            logger.info(f"Spec {spec_id} is inactive, removing from RAG if present")
            self.remove_spec(spec_id)
            return True

        try:
            # Remove old version if exists
            self.remove_spec(spec_id)

            # Index new version
            self._index_spec(spec)
            logger.info(f"Synced spec: {spec.name}/{spec.spec_type}")
            return True

        except Exception as e:
            logger.error(f"Failed to sync spec {spec_id}: {e}")
            return False

    def remove_spec(self, spec_id: UUID) -> int:
        """
        Remove a spec from RAG index.

        Used when a spec is deleted or deactivated.

        Args:
            spec_id: UUID of spec to remove

        Returns:
            Number of documents removed
        """
        count = self.rag_service.delete_by_filter({
            "spec_id": str(spec_id)
        })

        if count > 0:
            logger.info(f"Removed {count} RAG documents for spec {spec_id}")

        return count

    def get_sync_status(self) -> Dict:
        """
        Get sync status between specs and RAG.

        Returns:
            Dict with:
                - total_framework_specs: Total active framework specs
                - indexed_specs: Specs currently in RAG
                - pending_specs: Specs not yet indexed
        """
        # Count active framework specs
        total_specs = self.db.query(Spec).filter(
            Spec.scope == SpecScope.FRAMEWORK,
            Spec.is_active == True
        ).count()

        # Count specs in RAG (by metadata type)
        query = text("""
            SELECT COUNT(DISTINCT metadata->>'spec_id') as count
            FROM rag_documents
            WHERE metadata->>'type' LIKE 'spec_%'
        """)
        result = self.db.execute(query).fetchone()
        indexed_count = result.count if result else 0

        return {
            "total_framework_specs": total_specs,
            "indexed_specs": indexed_count,
            "pending_specs": max(0, total_specs - indexed_count),
            "sync_percentage": round((indexed_count / total_specs * 100) if total_specs > 0 else 0, 1)
        }

    def _is_spec_indexed(self, spec_id: UUID) -> bool:
        """
        Check if a spec is already indexed in RAG.

        Args:
            spec_id: UUID of spec to check

        Returns:
            True if indexed, False otherwise
        """
        query = text("""
            SELECT COUNT(*) as count
            FROM rag_documents
            WHERE metadata->>'spec_id' = :spec_id
        """)
        result = self.db.execute(query, {"spec_id": str(spec_id)}).fetchone()
        return result.count > 0 if result else False

    def _index_spec(self, spec: Spec) -> UUID:
        """
        Index a single spec in RAG.

        Creates a rich content representation including:
        - Title and description
        - Category, name, spec_type
        - Actual specification content

        Args:
            spec: Spec model instance

        Returns:
            UUID of created RAG document
        """
        # Build rich content for embedding
        content_parts = [
            f"# {spec.title}",
            f"Category: {spec.category}",
            f"Framework: {spec.name}",
            f"Type: {spec.spec_type}",
        ]

        if spec.description:
            content_parts.append(f"\n## Description\n{spec.description}")

        if spec.language:
            content_parts.append(f"Language: {spec.language}")

        if spec.framework_version:
            content_parts.append(f"Version: {spec.framework_version}")

        content_parts.append(f"\n## Specification\n{spec.content}")

        content = "\n".join(content_parts)

        # Build metadata
        metadata = {
            "type": f"spec_{spec.category}",
            "spec_id": str(spec.id),
            "category": spec.category,
            "name": spec.name,
            "spec_type": spec.spec_type,
            "title": spec.title,
            "scope": spec.scope.value if spec.scope else "framework"
        }

        if spec.language:
            metadata["language"] = spec.language

        if spec.framework_version:
            metadata["version"] = spec.framework_version

        # Store in RAG (project_id=None for global/framework specs)
        doc_id = self.rag_service.store(
            content=content,
            metadata=metadata,
            project_id=spec.project_id  # None for framework specs
        )

        return doc_id


def get_spec_rag_sync(db: Session) -> SpecRAGSync:
    """
    Factory function to get SpecRAGSync instance.

    Args:
        db: Database session

    Returns:
        SpecRAGSync instance
    """
    return SpecRAGSync(db)
