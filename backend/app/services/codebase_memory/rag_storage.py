"""
RAG Storage Mixin for CodebaseMemoryService

Contains methods for indexing files into RAG, storing business rules,
and retrieving interview suggestions.

PROMPT #118 - Initial codebase scan and memory extraction
PROMPT #170 - Enhanced storage with source classification
"""

import os
import logging
from pathlib import Path
from typing import Dict, List
from uuid import UUID

from app.services.codebase_indexer import CodebaseIndexer

logger = logging.getLogger(__name__)


class RagStorageMixin:
    """Mixin providing RAG indexing, business rule storage, and interview suggestions."""

    async def _index_for_memory(
        self,
        indexer: CodebaseIndexer,
        project_id: UUID,
        root_path: Path
    ) -> Dict:
        """
        Index codebase files for memory/RAG.

        Args:
            indexer: CodebaseIndexer instance
            project_id: Project UUID
            root_path: Root path of codebase

        Returns:
            Indexing statistics
        """
        stats = {
            "files_indexed": 0,
            "errors": []
        }

        # Use full effective ignore dirs (built-in + blocklist + custom + user paths)
        # Merge indexer's effective set with memory service's effective set
        all_ignore_dirs = indexer._effective_ignore_dirs | self._effective_ignore_dirs

        for root, dirs, files in os.walk(root_path):
            # Check both leaf name AND relative path for entries with '/'
            root_rel = str(Path(root).relative_to(root_path)) if Path(root) != root_path else ""
            new_dirs = []
            for d in dirs:
                rel_dir = (root_rel + "/" + d).lstrip("/") if root_rel else d
                if d in all_ignore_dirs:
                    continue
                # Check relative path against blocklist entries with '/'
                skip = False
                for ignored in all_ignore_dirs:
                    if "/" in ignored and (rel_dir == ignored or rel_dir.startswith(ignored + "/")):
                        skip = True
                        break
                if not skip:
                    new_dirs.append(d)
            dirs[:] = new_dirs

            for filename in files:
                file_path = Path(root) / filename

                # Detect language
                language = indexer._detect_language(file_path)
                if not language:
                    continue

                try:
                    await indexer._index_file(project_id, file_path, language)
                    stats["files_indexed"] += 1
                except Exception as e:
                    stats["errors"].append(f"{file_path}: {e}")

        return stats

    async def _store_business_rules(
        self,
        project_id: UUID,
        business_rules: List[str]
    ):
        """
        Store extracted business rules in RAG for future reference.

        PROMPT #170 - Enhanced storage with source classification.

        Args:
            project_id: Project UUID
            business_rules: List of business rule strings
        """
        for i, rule in enumerate(business_rules):
            # PROMPT #170 - Classify rule source based on content
            source = "code"  # Default source

            # Check for interface/template markers
            if any(marker in rule.upper() for marker in ["SISTEMA:", "DOMÍNIO:", "<TITLE>", ".GOV.BR", ".COM.BR"]):
                source = "interface"
            elif any(marker in rule.lower() for marker in ["validação", "validator", "required", "mínimo", "máximo", "obrigatório"]):
                source = "validation"
            elif any(marker in rule.lower() for marker in ["modelo", "entidade", "tabela", "coluna", "campo"]):
                source = "model"

            self.rag.store(
                content=rule,
                metadata={
                    "type": "business_rule",
                    "project_id": str(project_id),
                    "rule_index": i,
                    "source": source,
                    "priority": "high" if source == "interface" else "normal"
                },
                project_id=project_id
            )

        logger.info(f"📋 Stored {len(business_rules)} business rules in RAG for project {project_id}")

    async def get_interview_suggestions(
        self,
        project_id: UUID
    ) -> List[str]:
        """
        Get suggested interview questions based on memorized business rules.

        Args:
            project_id: Project UUID

        Returns:
            List of suggested questions for the context interview
        """
        # Retrieve business rules from RAG
        results = self.rag.retrieve(
            query="business rules and requirements",
            filter={
                "project_id": str(project_id),
                "type": "business_rule"
            },
            top_k=10,
            similarity_threshold=0.5
        )

        suggestions = []
        for result in results:
            rule = result.get("content", "")
            if rule:
                # Generate question from rule
                suggestions.append(
                    f"Can you tell me more about this requirement: '{rule}'?"
                )

        return suggestions
