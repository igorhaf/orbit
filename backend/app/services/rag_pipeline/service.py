"""
RAG Pipeline Service - Main orchestrator class.

4-Phase Sequential Pipeline with Redis State:
  Phase 1: Index files in RAG (embedding only, no AI)
  Phase 2: Extract business rules via AI (usage_type=task_execution)
  Phase 3: Generate cards from business rules (closed status)
  Phase 4: Generate wiki + project title + description (1 AI call)

State stored in Redis: rag:pipeline:{project_id}
"""

from __future__ import annotations

import fnmatch
import logging
from pathlib import Path
from typing import Any, Dict, Set
from uuid import UUID

from sqlalchemy.orm import Session
from sqlalchemy import text as sql_text

from app.models.project import Project
from app.contracts.loader import ContractLoader
from app.services.job_manager import JobManager
from app.services.rag_service import RAGService
from app.services.continuous_rag_service import ContinuousRAGService

from .utils import _get_redis, PIPELINE_KEY_PREFIX
from .phase1_index import Phase1Mixin
from .phase2_rules import Phase2Mixin
from .phase3_cards import Phase3Mixin
from .phase4_wiki import Phase4Mixin

logger = logging.getLogger(__name__)


class RagPipelineService(Phase1Mixin, Phase2Mixin, Phase3Mixin, Phase4Mixin):
    """Orchestrates the 4-phase RAG pipeline with Redis state tracking."""

    def __init__(self, db: Session):
        self.db = db
        self.redis = _get_redis()
        self.rag = RAGService(db)
        self.continuous_rag = ContinuousRAGService(db)
        self._contract_loader = ContractLoader(db)

    def _load_contract_prompt(self, contract_name: str, fallback: str = "") -> str:
        """PROMPT #258 - Load system_prompt from ContractLoader with fallback."""
        try:
            system_prompt, _ = self._contract_loader.render(contract_name)
            return system_prompt
        except Exception as e:
            logger.warning(f"Failed to load contract '{contract_name}', using fallback: {e}")
            return fallback

    @staticmethod
    def _map_progress(local_pct: float, pmin: float, pmax: float) -> float:
        """Map a local 0-100 percentage to a global [pmin, pmax] range."""
        return pmin + (pmax - pmin) * local_pct / 100.0

    # =========================================================================
    # IGNORE PATTERNS -- project-relative path filtering (PROMPT #253)
    #
    # Loads ignore patterns from:
    #   1. Built-in IGNORE_DIRECTORIES (from CodebaseMemoryService)
    #   2. Project.custom_ignore_patterns (AI-detected)
    #   3. Project.ignore_paths (user-editable)
    #   4. .gitignore from project root
    # Applied in ALL phases when loading files from DB.
    # =========================================================================

    def _load_ignore_patterns(self, project: Project) -> Dict[str, Set[str]]:
        """Load all ignore patterns for a project.

        Returns dict with 'dirs' (directory names/paths) and 'files' (file globs).
        """
        from app.services.codebase_memory import CodebaseMemoryService

        dirs: Set[str] = set(CodebaseMemoryService.IGNORE_DIRECTORIES)
        files: Set[str] = set(CodebaseMemoryService.IGNORE_FILE_PATTERNS)

        # AI-detected custom patterns (PROMPT #223)
        if project.custom_ignore_patterns:
            custom_dirs = project.custom_ignore_patterns.get("directories", [])
            if custom_dirs:
                dirs.update(custom_dirs)

        # User-editable ignore paths (PROMPT #241)
        if project.ignore_paths and isinstance(project.ignore_paths, list):
            dirs.update(project.ignore_paths)

        # .gitignore patterns
        if project.code_path:
            gitignore_path = Path(project.code_path) / ".gitignore"
            if gitignore_path.exists():
                try:
                    content = gitignore_path.read_text(encoding="utf-8", errors="ignore")
                    for line in content.splitlines():
                        line = line.strip()
                        if not line or line.startswith("#") or line.startswith("!"):
                            continue
                        if line.endswith("/"):
                            line = line[:-1]
                        dirs.add(line)
                except Exception:
                    pass

        return {"dirs": dirs, "files": files}

    @staticmethod
    def _is_path_ignored(source_file: str, ignore_patterns: Dict[str, Set[str]]) -> bool:
        """Check if a source_file path (relative) should be ignored.

        Mirrors the logic in CodebaseMemoryService._should_ignore_path but
        operates on string paths from DB metadata (no filesystem access needed).
        """
        if not source_file:
            return False

        dirs = ignore_patterns.get("dirs", set())
        files = ignore_patterns.get("files", set())
        parts = Path(source_file).parts
        name = Path(source_file).name

        # Check if any directory component is in ignore list
        for part in parts[:-1]:  # exclude filename
            if part in dirs:
                return True

        # Check relative path against blocklist entries with '/'
        for ignored in dirs:
            if "/" in ignored:
                if source_file == ignored or source_file.startswith(ignored + "/"):
                    return True

        # Check file patterns
        for pattern in files:
            if fnmatch.fnmatch(name, pattern):
                return True

        # Check .gitignore-style patterns against name and full path
        for pattern in dirs:
            if fnmatch.fnmatch(name, pattern):
                return True
            if fnmatch.fnmatch(source_file, pattern):
                return True
            if fnmatch.fnmatch(source_file, f"*/{pattern}"):
                return True

        return False

    def _pipeline_key(self, project_id: UUID) -> str:
        return f"{PIPELINE_KEY_PREFIX}:{project_id}"

    def _set_phase_status(self, project_id: UUID, phase: int, status: str):
        """Update phase status in Redis."""
        if self.redis:
            try:
                self.redis.hset(self._pipeline_key(project_id), f"phase_{phase}_status", status)
            except Exception:
                pass

    def get_pipeline_state(self, project_id: UUID) -> Dict[str, str]:
        """Get current pipeline state from Redis."""
        if self.redis:
            try:
                state = self.redis.hgetall(self._pipeline_key(project_id))
                if state:
                    return state
            except Exception:
                pass
        # Fallback: derive state from database
        return self._derive_state_from_db(project_id)

    def _derive_state_from_db(self, project_id: UUID) -> Dict[str, str]:
        """Derive pipeline state from database when Redis unavailable."""
        state = {
            "phase_1_status": "pending",
            "phase_2_status": "pending",
            "phase_3_status": "pending",
            "phase_4_status": "pending",
        }

        # Phase 1: Check if code_file docs exist in RAG
        code_files = self.db.execute(sql_text(
            "SELECT COUNT(*) FROM rag_documents WHERE project_id = :pid "
            "AND (metadata->>'type' = 'code_file')"
        ), {"pid": str(project_id)}).scalar() or 0

        if code_files > 0:
            state["phase_1_status"] = "completed"

        # Phase 2: Check if business_rule docs exist
        rules = self.db.execute(sql_text(
            "SELECT COUNT(*) FROM rag_documents WHERE project_id = :pid "
            "AND (metadata->>'type' = 'business_rule' OR metadata->>'content_type' = 'business_rule')"
        ), {"pid": str(project_id)}).scalar() or 0

        if rules > 0:
            state["phase_2_status"] = "completed"

        # Phase 3: Check if cards exist
        from app.models.task import Task
        card_count = self.db.query(Task).filter(Task.project_id == project_id).count()
        if card_count > 0:
            state["phase_3_status"] = "completed"

        # Phase 4: Check if wiki exists
        from app.services import wiki_fs
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if project and project.code_path:
            pages = wiki_fs.list_pages(project.code_path)
            if pages and len(pages) > 0:
                state["phase_4_status"] = "completed"

        # Check for running jobs (raw SQL to avoid .astext ORM issue)
        for phase_num, job_input_phase in [(1, "index_files"), (2, "extract_rules"),
                                            (3, "generate_cards"), (4, "generate_wiki")]:
            running = self.db.execute(sql_text(
                "SELECT 1 FROM async_jobs WHERE project_id = :pid "
                "AND status IN ('pending', 'running') "
                "AND input_data->>'phase' = :phase LIMIT 1"
            ), {"pid": str(project_id), "phase": job_input_phase}).first()
            if running:
                state[f"phase_{phase_num}_status"] = "running"

        return state

    # =========================================================================
    # FULL PIPELINE: Run all 4 phases sequentially (25% each)
    # =========================================================================

    async def run_full_pipeline(self, project_id: UUID, job_id: UUID) -> Dict[str, Any]:
        """
        Run all 4 phases sequentially under a SINGLE job.
        Progress is split evenly: 0-25% (Phase 1), 25-50% (Phase 2),
        50-75% (Phase 3), 75-100% (Phase 4).
        """
        jm = JobManager(self.db)
        results = {}

        # Phase 1: Index files (0-25%)
        jm.update_progress(job_id, 0.0, "Fase 1/4: Iniciando indexacao de arquivos...")
        try:
            r1 = await self.phase_1_index_files(project_id, job_id, pmin=0.0, pmax=25.0)
            results["phase_1"] = r1
            jm.update_progress(job_id, 25.0, "Fase 1/4: Concluida")
        except Exception as e:
            logger.error(f"Full pipeline: Phase 1 failed: {e}")
            raise ValueError(f"Fase 1 falhou: {e}")

        # Phase 2: Extract rules (25-50%)
        jm.update_progress(job_id, 25.0, "Fase 2/4: Iniciando extracao de regras...")
        try:
            r2 = await self.phase_2_extract_rules(project_id, job_id, pmin=25.0, pmax=50.0)
            results["phase_2"] = r2
            jm.update_progress(job_id, 50.0, "Fase 2/4: Concluida")
        except Exception as e:
            logger.error(f"Full pipeline: Phase 2 failed: {e}")
            raise ValueError(f"Fase 2 falhou: {e}")

        # Phase 3: Generate cards (50-75%)
        jm.update_progress(job_id, 50.0, "Fase 3/4: Iniciando geracao de cards...")
        try:
            r3 = await self.phase_3_generate_cards(project_id, job_id, pmin=50.0, pmax=75.0)
            results["phase_3"] = r3
            jm.update_progress(job_id, 75.0, "Fase 3/4: Concluida")
        except Exception as e:
            logger.error(f"Full pipeline: Phase 3 failed: {e}")
            raise ValueError(f"Fase 3 falhou: {e}")

        # Phase 4: Generate wiki (75-100%)
        jm.update_progress(job_id, 75.0, "Fase 4/4: Iniciando geracao de wiki...")
        try:
            r4 = await self.phase_4_generate_wiki(project_id, job_id, pmin=75.0, pmax=100.0)
            results["phase_4"] = r4
            jm.update_progress(job_id, 100.0, "Pipeline completo!")
        except Exception as e:
            logger.error(f"Full pipeline: Phase 4 failed: {e}")
            raise ValueError(f"Fase 4 falhou: {e}")

        return {
            "phase": "full_pipeline",
            "phases_completed": 4,
            **results,
        }
