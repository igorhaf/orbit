"""
RAG Pipeline Phase 1: Index files (embedding only, no AI).

Scans filesystem, embeds all files via Nomic into RAG.
Files go from PENDING -> INDEXED status.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, TYPE_CHECKING
from uuid import UUID

from app.models.project import Project
from app.models.rag_file_state import RAGFileState, FileProcessingStatus
from app.services.job_manager import JobManager

from .utils import _detect_language

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


class Phase1Mixin:
    """Mixin providing phase_1_index_files method."""

    async def phase_1_index_files(self, project_id: UUID, job_id: UUID,
                                   pmin: float = 0.0, pmax: float = 100.0) -> Dict[str, Any]:
        """
        Phase 1: Scan filesystem and embed all files via Nomic (no AI calls).
        Files go from PENDING -> INDEXED status.
        pmin/pmax: progress range for this phase (default 0-100 for standalone).
        """
        self._set_phase_status(project_id, 1, "running")
        jm = JobManager(self.db)
        _p = lambda local: self._map_progress(local, pmin, pmax)

        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.code_path:
            raise ValueError("Project not found or missing code_path")

        # Step 1: Scan for changes (detect new/modified/deleted files)
        jm.update_progress(job_id, _p(5), "Fase 1/4: Detectando arquivos...")
        scan_result = await self.continuous_rag.scan_for_changes(project_id)
        logger.info(f"Phase 1 scan: {scan_result}")

        # Step 2: Process deleted files
        await self.continuous_rag.process_deleted_files(project_id)

        # Step 3: Embed each PENDING file (no AI)
        pending_files = self.db.query(RAGFileState).filter(
            RAGFileState.project_id == project_id,
            RAGFileState.status == FileProcessingStatus.PENDING,
        ).all()

        # Apply project-relative ignore patterns (PROMPT #253)
        ignore_patterns = self._load_ignore_patterns(project)
        files_before = len(pending_files)
        pending_files = [
            f for f in pending_files
            if not self._is_path_ignored(f.file_path, ignore_patterns)
        ]
        if files_before != len(pending_files):
            logger.info(
                f"Phase 1: Filtered {files_before - len(pending_files)} ignored files "
                f"({len(pending_files)} remaining of {files_before})"
            )

        total = len(pending_files)
        indexed = 0
        errors = 0

        for i, file_state in enumerate(pending_files):
            try:
                file_path = os.path.join(project.code_path, file_state.file_path)
                if not os.path.isfile(file_path):
                    continue

                # Read file content
                try:
                    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                        content = f.read()
                except Exception:
                    continue

                if not content or len(content.strip()) < 10:
                    file_state.status = FileProcessingStatus.INDEXED
                    indexed += 1
                    continue

                # Truncate large files for embedding
                max_chars = 8000
                if len(content) > max_chars:
                    content = content[:max_chars]

                # Store in RAG as code_file (embedding only)
                doc_id = self.rag.store(
                    content=content,
                    metadata={
                        "type": "code_file",
                        "source": "continuous_scan",
                        "source_file": file_state.file_path,
                        "language": _detect_language(file_state.file_path),
                        "layer": file_state.file_layer.value if file_state.file_layer else "unknown",
                    },
                    project_id=project_id,
                )

                file_state.status = FileProcessingStatus.INDEXED
                file_state.rag_document_ids = [str(doc_id)]
                indexed += 1

                # Progress update
                local_pct = 10 + (80 * (i + 1) / max(total, 1))
                if (i + 1) % 20 == 0 or i == total - 1:
                    jm.update_progress(job_id, _p(local_pct),
                                       f"Fase 1/4: Indexando arquivos... ({i + 1}/{total})")
                    self.db.commit()

            except Exception as e:
                logger.error(f"Phase 1 error indexing {file_state.file_path}: {e}")
                file_state.status = FileProcessingStatus.FAILED
                file_state.error_message = str(e)[:500]
                errors += 1

        self.db.commit()
        self._set_phase_status(project_id, 1, "completed")

        result = {
            "phase": "index_files",
            "total_files": total,
            "indexed": indexed,
            "errors": errors,
            "scan": scan_result,
        }
        jm.update_progress(job_id, _p(95), f"Fase 1/4: Concluida -- {indexed} arquivos indexados")
        return result
