"""
Continuous RAG Evolution Service

PROMPT #218 - Continuously processes project codebases to keep RAG knowledge fresh.

Detects file changes via SHA-256 hashing, processes changed files with AI to extract
business rules, and updates the RAG accordingly. Uses Redis for scheduling and
PriorityJobExecutor for background processing.

Reuses extensively from:
- CodebaseMemoryService: ignore lists, gitignore, file scoring, prompt parsing
- RAGService: store_business_rule, delete_by_filter
- CodebaseIndexer: language detection, metadata extraction
- ConsoleLogger: real-time progress
- AIOrchestrator: AI calls with chain fallback

Usage:
    from app.services.continuous_rag_service import ContinuousRAGService

    service = ContinuousRAGService(db)

    # Full cycle: scan → delete → process
    result = await service.run_full_cycle(project_id)

    # Manual scan only
    changes = await service.scan_for_changes(project_id)

    # Process pending files
    result = await service.process_pending_files(project_id, batch_size=10)
"""

import asyncio
import hashlib
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.contracts.loader import ContractLoader
from app.models.project import Project
from app.models.rag_file_state import FileProcessingStatus, FileSemanticLayer, RAGFileState
from app.services.ai_orchestrator import AIOrchestrator
from app.services.codebase_indexer import CodebaseIndexer
from app.services.codebase_memory import CodebaseMemoryService
from app.services.console_logger import ConsoleLogger
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)

# Concurrent AI requests - match actual GPU parallelism (OLLAMA_NUM_PARALLEL)
MAX_PARALLEL_EXTRACTIONS = int(os.getenv("OLLAMA_NUM_PARALLEL", "2"))


def _get_console_logger():
    """Get console logger singleton (lazy import to avoid circular)."""
    try:
        return ConsoleLogger.get_instance()
    except Exception:
        return None


class ContinuousRAGService:
    """
    Orchestrates continuous RAG evolution for project codebases.

    Workflow:
    1. scan_for_changes() - Walk filesystem, compute hashes, detect new/modified/deleted
    2. process_deleted_files() - Clean up RAG documents for deleted files
    3. process_pending_files() - Use AI to extract business rules from changed files
    """

    def __init__(self, db: Session):
        self.db = db
        self.rag = RAGService(db)
        self.orchestrator = AIOrchestrator(db)
        self.indexer = CodebaseIndexer(db)
        self._contract_loader = ContractLoader()

        # Reuse CodebaseMemoryService for ignore lists and analysis utilities
        self._memory = CodebaseMemoryService(db)

    # =========================================================================
    # Public API
    # =========================================================================

    async def run_full_cycle(self, project_id: UUID, job_id: UUID = None) -> Dict[str, Any]:
        """
        Execute a complete scan-process-cleanup cycle for a project.

        PROMPT #298 - Accepts job_id for sub-job hierarchy.
        Returns combined statistics from all phases.
        """
        console = _get_console_logger()
        if console:
            asyncio.create_task(console.log_memory_scan(
                phase="continuous_start",
                message="Starting continuous RAG evolution cycle",
                project_id=str(project_id)
            ))

        # Phase 1: Scan for changes
        scan_result = await self.scan_for_changes(project_id)

        # Phase 2: Clean up deleted files
        delete_result = await self.process_deleted_files(project_id)

        # Phase 3: Process new/modified files
        # PROMPT #298 - Pass job_id for per-file sub-jobs
        process_result = await self.process_pending_files(project_id, parent_job_id=job_id)

        # PROMPT #233 - No auto-generation: wiki enrichment is now manual via button.
        # Pipeline only extracts rules to RAG.

        result = {
            "project_id": str(project_id),
            "scan": scan_result,
            "deleted": delete_result,
            "processed": process_result,
            "timestamp": datetime.utcnow().isoformat(),
        }

        if console:
            total_changes = scan_result.get("new_files", 0) + scan_result.get("modified_files", 0)
            asyncio.create_task(console.log_memory_scan(
                phase="continuous_complete",
                message=(
                    f"Cycle complete: {total_changes} changes detected, "
                    f"{process_result.get('rules_extracted', 0)} rules extracted, "
                    f"{delete_result.get('rag_docs_removed', 0)} docs cleaned"
                ),
                project_id=str(project_id)
            ))

        return result

    async def scan_for_changes(self, project_id: UUID) -> Dict[str, Any]:
        """
        Walk the project's code_path, compute file hashes, and detect changes.

        Reuses CodebaseMemoryService's ignore infrastructure for filtering.
        Uses async hashing to avoid blocking the event loop.
        """
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.code_path:
            return {"error": "Projeto não encontrado ou sem code_path", "new_files": 0, "modified_files": 0, "deleted_files": 0}

        code_path = Path(project.code_path)
        if not code_path.exists():
            return {"error": f"Caminho do código não encontrado: {code_path}", "new_files": 0, "modified_files": 0, "deleted_files": 0}

        # Load .gitignore patterns (reuse from CodebaseMemoryService)
        self._memory._gitignore_patterns = self._memory._load_gitignore_patterns(code_path)

        # PROMPT #223 - Reset effective ignore dirs and load project-specific custom ignores
        self._memory._effective_ignore_dirs = set(self._memory.IGNORE_DIRECTORIES)
        self._memory._effective_file_patterns = set(self._memory.IGNORE_FILE_PATTERNS)
        if project.custom_ignore_patterns:
            custom_dirs = project.custom_ignore_patterns.get("directories", [])
            if custom_dirs:
                self._memory._effective_ignore_dirs.update(custom_dirs)
                logger.info(f"🤖 Loaded {len(custom_dirs)} project-specific ignore dirs: {custom_dirs}")

        # PROMPT #241 - Load user-editable ignore paths
        if project.ignore_paths and isinstance(project.ignore_paths, list):
            self._memory._effective_ignore_dirs.update(project.ignore_paths)
            logger.info(f"📁 Loaded {len(project.ignore_paths)} user ignore paths: {project.ignore_paths}")

        # PROMPT #250 - Load global blocklist
        global_blocklist = self._memory._load_global_blocklist()
        gl_dirs = global_blocklist.get("directories", [])
        gl_patterns = global_blocklist.get("file_patterns", [])
        if gl_dirs:
            self._memory._effective_ignore_dirs.update(gl_dirs)
        if gl_patterns:
            self._memory._effective_file_patterns.update(gl_patterns)

        # Get existing file states from DB
        existing_states = {}
        for state in self.db.query(RAGFileState).filter(
            RAGFileState.project_id == project_id,
            RAGFileState.status != FileProcessingStatus.DELETED
        ).all():
            existing_states[state.file_path] = state

        # Walk filesystem - collect files first, then hash in parallel
        files_to_hash = []

        for root, dirs, files in os.walk(code_path):
            # Prune ignored directories (reuse from CodebaseMemoryService)
            # Pass relative path so entries like "projects/suinda" are matched
            root_rel = str(Path(root).relative_to(code_path)) if Path(root) != code_path else ""
            dirs[:] = [
                d for d in dirs
                if not self._memory._should_ignore_dir(
                    d,
                    rel_dir_path=(root_rel + "/" + d).lstrip("/") if root_rel else d,
                )
            ]

            for filename in files:
                file_path = Path(root) / filename

                # Check if file should be ignored (reuse from CodebaseMemoryService)
                if self._memory._should_ignore_path(file_path, code_path):
                    continue

                # Only process code files (reuse language detection from CodebaseIndexer)
                language = self.indexer._detect_language(file_path)
                if not language:
                    continue

                rel_path = str(file_path.relative_to(code_path))
                files_to_hash.append((file_path, rel_path))

        # Hash files in parallel using thread pool (non-blocking)
        loop = asyncio.get_event_loop()
        hash_tasks = [
            loop.run_in_executor(None, self._compute_file_hash, fp)
            for fp, _ in files_to_hash
        ]
        hashes = await asyncio.gather(*hash_tasks)

        # Process results
        found_files = set()
        new_count = 0
        modified_count = 0

        for (file_path, rel_path), file_hash in zip(files_to_hash, hashes):
            if not file_hash:
                continue

            found_files.add(rel_path)
            file_stat = file_path.stat()

            if rel_path in existing_states:
                state = existing_states[rel_path]
                if state.file_hash != file_hash:
                    # File modified
                    state.file_hash = file_hash
                    state.file_size = file_stat.st_size
                    state.last_modified = datetime.fromtimestamp(file_stat.st_mtime)
                    state.status = FileProcessingStatus.PENDING
                    state.error_message = None
                    # PROMPT #230 - Classify layer if not yet set
                    if not state.file_layer or state.file_layer == FileSemanticLayer.UNKNOWN:
                        state.file_layer = self._classify_semantic_layer(rel_path)
                    modified_count += 1
            else:
                # New file — PROMPT #230: classify semantic layer
                new_state = RAGFileState(
                    project_id=project_id,
                    file_path=rel_path,
                    file_hash=file_hash,
                    file_size=file_stat.st_size,
                    last_modified=datetime.fromtimestamp(file_stat.st_mtime),
                    status=FileProcessingStatus.PENDING,
                    file_layer=self._classify_semantic_layer(rel_path),
                )
                self.db.add(new_state)
                new_count += 1

        # Detect deleted files
        deleted_count = 0
        for rel_path, state in existing_states.items():
            if rel_path not in found_files:
                state.status = FileProcessingStatus.DELETED
                deleted_count += 1

        self.db.commit()

        logger.info(
            f"Scan complete for project {project_id}: "
            f"{new_count} new, {modified_count} modified, {deleted_count} deleted"
        )

        return {
            "new_files": new_count,
            "modified_files": modified_count,
            "deleted_files": deleted_count,
            "total_tracked": len(found_files),
        }

    async def process_deleted_files(self, project_id: UUID) -> Dict[str, Any]:
        """
        Clean up RAG documents for files that no longer exist on disk.
        """
        deleted_states = self.db.query(RAGFileState).filter(
            RAGFileState.project_id == project_id,
            RAGFileState.status == FileProcessingStatus.DELETED
        ).all()

        if not deleted_states:
            return {"deleted_files": 0, "rag_docs_removed": 0}

        rag_docs_removed = 0

        for state in deleted_states:
            # Delete RAG documents by source_file filter (covers all docs)
            try:
                count = self.rag.delete_by_filter({
                    "project_id": str(project_id),
                    "type": "business_rule",
                    "source": "continuous_scan",
                    "source_file": state.file_path
                })
                rag_docs_removed += count
            except Exception:
                pass

            # Remove the file state record
            self.db.delete(state)

        self.db.commit()

        logger.info(f"Cleaned {len(deleted_states)} deleted files, {rag_docs_removed} RAG docs removed")

        return {
            "deleted_files": len(deleted_states),
            "rag_docs_removed": rag_docs_removed,
        }

    async def process_pending_files(
        self,
        project_id: UUID,
        batch_size: int = 10,
        parent_job_id: UUID = None,  # PROMPT #298 - Parent job for per-file sub-jobs
    ) -> Dict[str, Any]:
        """
        Process pending files using AI to extract business rules.

        PROMPT #298 - When parent_job_id is provided, creates a child job per file
        for granular traceability.

        Uses asyncio.Semaphore for parallel AI extraction (up to MAX_PARALLEL_EXTRACTIONS
        concurrent requests to Ollama/cloud models).
        """
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.code_path:
            return {"processed": 0, "rules_extracted": 0, "errors": 0}

        code_path = Path(project.code_path)

        # Get pending files — PROMPT #230: ordered by semantic layer priority
        # Schema first (DB structure), then Routes, Logic, Presentation, Config last
        from sqlalchemy import case
        layer_order = case(
            (RAGFileState.file_layer == FileSemanticLayer.SCHEMA.value, 1),
            (RAGFileState.file_layer == FileSemanticLayer.ROUTES.value, 2),
            (RAGFileState.file_layer == FileSemanticLayer.LOGIC.value, 3),
            (RAGFileState.file_layer == FileSemanticLayer.PRESENTATION.value, 4),
            (RAGFileState.file_layer == FileSemanticLayer.CONFIG.value, 5),
            else_=6,
        )
        pending_states = self.db.query(RAGFileState).filter(
            RAGFileState.project_id == project_id,
            RAGFileState.status == FileProcessingStatus.PENDING
        ).order_by(layer_order).limit(batch_size).all()

        if not pending_states:
            return {"processed": 0, "rules_extracted": 0, "errors": 0}

        console = _get_console_logger()
        total_count = len(pending_states)

        # Mark all as processing upfront
        for state in pending_states:
            state.status = FileProcessingStatus.PROCESSING
        self.db.commit()

        # v2.5: claudius-only. Parallelism tuning per-provider removed.
        try:
            from app.models.ai_model import AIModelUsageType
            _model_cfg = self.orchestrator.choose_model(AIModelUsageType.MEMORY)
        except Exception:
            _model_cfg = {}
        _is_ollama = False
        _parallel = MAX_PARALLEL_EXTRACTIONS
        semaphore = asyncio.Semaphore(_parallel)

        # PROMPT #298 - Create child jobs per file upfront (pending, not running)
        jm = None
        child_job_map = {}  # state_id → child_job_id
        if parent_job_id:
            from app.services.job_manager import JobManager
            from app.models.async_job import JobType
            jm = JobManager(self.db)
            for i, state in enumerate(pending_states, 1):
                child = jm.create_child_job(
                    parent_job_id=parent_job_id,
                    job_type=JobType.RAG_CONTINUOUS_SCAN,
                    input_data={"file_path": state.file_path},
                    phase_label=f"Arquivo {i}/{total_count}: {state.file_path}",
                )
                child_job_map[state.id] = child.id

        # Shared counters (accessed sequentially after gather)
        results = []

        # PROMPT #224 - File patterns unlikely to contain business rules
        _SKIP_PATTERNS = {
            # Test files
            ".test.", ".spec.", "_test.", "_spec.", ".tests.", ".specs.",
            "test_", "spec_", "tests/", "test/", "__tests__/", "__test__/",
            # Config/tooling
            "webpack.config", "babel.config", "jest.config", "eslint",
            "prettier", "tsconfig", "rollup.config", "vite.config",
            ".eslintrc", ".prettierrc", ".babelrc", "stylelint",
            # Type definitions
            ".d.ts",
            # Generated
            ".generated.", ".g.cs", ".designer.cs",
            # Migrations (already captured by initial scan)
            "migration", "migrations/",
            # Fixtures/seeds
            "fixture", "seed", "factory",
        }

        def _is_low_value_file(filepath: str) -> bool:
            fp_lower = filepath.lower()
            return any(pat in fp_lower for pat in _SKIP_PATTERNS)

        # PROMPT #237 - Complete/fail child jobs immediately using separate DB session
        # to avoid transaction conflicts with the main session during asyncio.gather
        def _complete_child_immediately(child_job_id, result_data):
            """Complete a child job using a fresh DB session (thread-safe for asyncio)."""
            from app.database import SessionLocal
            from app.services.job_manager import JobManager as JM
            _db = SessionLocal()
            try:
                _jm = JM(_db)
                _jm.complete_child_job(child_job_id, result_data)
            except Exception as e:
                logger.warning(f"Failed to complete child job {child_job_id}: {e}")
            finally:
                _db.close()

        def _fail_child_immediately(child_job_id, error_msg):
            """Fail a child job using a fresh DB session (thread-safe for asyncio)."""
            from app.database import SessionLocal
            from app.services.job_manager import JobManager as JM
            _db = SessionLocal()
            try:
                _jm = JM(_db)
                _jm.fail_child_job(child_job_id, error_msg)
            except Exception as e:
                logger.warning(f"Failed to fail child job {child_job_id}: {e}")
            finally:
                _db.close()

        def _start_child_immediately(child_job_id):
            """Start a child job using a fresh DB session (thread-safe for asyncio)."""
            from app.database import SessionLocal
            from app.services.job_manager import JobManager as JM
            _db = SessionLocal()
            try:
                _jm = JM(_db)
                _jm.start_job(child_job_id)
            except Exception as e:
                logger.warning(f"Failed to start child job {child_job_id}: {e}")
            finally:
                _db.close()

        async def _process_one(idx: int, state: RAGFileState) -> Dict[str, Any]:
            """Process a single file with semaphore-controlled concurrency."""
            file_full_path = code_path / state.file_path
            _child_id = child_job_map.get(state.id) if jm else None

            if not file_full_path.exists():
                # Mark child as started+completed immediately for deleted files
                if _child_id:
                    _start_child_immediately(_child_id)
                    _complete_child_immediately(_child_id, {"status": "deleted"})
                return {"state_id": state.id, "status": "deleted"}

            # PROMPT #224 - Skip files unlikely to have business rules
            if _is_low_value_file(state.file_path):
                # Mark child as started+completed immediately for skipped files
                if _child_id:
                    _start_child_immediately(_child_id)
                    _complete_child_immediately(_child_id, {"status": "skipped"})
                return {
                    "state_id": state.id,
                    "file_path": state.file_path,
                    "status": "skipped",
                }

            if console:
                asyncio.create_task(console.log_memory_scan(
                    phase=f"file_{idx+1}/{total_count}",
                    message=f"Analyzing: {state.file_path}",
                    files_processed=idx + 1,
                    project_id=str(project_id)
                ))

            async with semaphore:
                # Mark child job as running only when semaphore is acquired
                if _child_id:
                    _start_child_immediately(_child_id)

                try:
                    # Read file content (fast, local I/O)
                    content = file_full_path.read_text(encoding="utf-8", errors="ignore")

                    # Detect language
                    language = self.indexer._detect_language(file_full_path) or "unknown"

                    # v2.5: claudius-only; previously throttled for Ollama
                    max_content = 15000
                    if len(content) > max_content:
                        content = content[:max_content]

                    _resp_tokens = 4096

                    rules = await self._extract_rules_from_file(
                        filename=state.file_path,
                        content=content,
                        language=language,
                        project_id=project_id,
                        project_context=project.context_semantic,
                        is_local=False,
                        max_resp_tokens=_resp_tokens,
                    )

                    # PROMPT #237 - Complete child job immediately on success
                    if _child_id:
                        _complete_child_immediately(_child_id, {"rules_extracted": len(rules) if rules else 0})

                    return {
                        "state_id": state.id,
                        "file_path": state.file_path,
                        "status": "success",
                        "rules": rules,
                    }

                except Exception as e:
                    # PROMPT #237 - Fail child job immediately on error
                    if _child_id:
                        _fail_child_immediately(_child_id, str(e)[:500])

                    return {
                        "state_id": state.id,
                        "file_path": state.file_path,
                        "status": "error",
                        "error": str(e)[:500],
                    }

        # PROMPT #221 / #224 / #231 - Per-file timeout (configurable, matches OLLAMA_TIMEOUT)
        PER_FILE_TIMEOUT = int(os.getenv("RAG_FILE_TIMEOUT_SECONDS", "600"))  # 10 min default

        async def _process_one_with_timeout(idx: int, state: RAGFileState) -> Dict[str, Any]:
            try:
                return await asyncio.wait_for(
                    _process_one(idx, state),
                    timeout=PER_FILE_TIMEOUT,
                )
            except asyncio.TimeoutError:
                logger.warning(f"File extraction timed out after {PER_FILE_TIMEOUT}s: {state.file_path}")
                # PROMPT #237 - Fail child job immediately on timeout
                _child_id = child_job_map.get(state.id) if jm else None
                if _child_id:
                    _fail_child_immediately(_child_id, f"Extracao expirou apos {PER_FILE_TIMEOUT}s")
                return {
                    "state_id": state.id,
                    "file_path": state.file_path,
                    "status": "error",
                    "error": f"Extracao expirou apos {PER_FILE_TIMEOUT}s",
                }

        # PROMPT #247 - Sequential execution to avoid blocking Claudius proxy
        results = []
        for i, state in enumerate(pending_states):
            result = await _process_one_with_timeout(i, state)
            results.append(result)

        # Process results sequentially (DB writes are not thread-safe)
        processed = 0
        total_rules = 0
        errors = 0

        # Build state lookup for quick access
        state_lookup = {state.id: state for state in pending_states}

        for idx, result in enumerate(results):
            if isinstance(result, Exception):
                errors += 1
                logger.error(f"Unexpected error in parallel processing: {result}")
                continue

            state = state_lookup.get(result.get("state_id"))
            if not state:
                continue

            # PROMPT #237 - Child jobs are now completed/failed inside _process_one
            # using a separate DB session, so no need to do it here.

            if result["status"] == "deleted":
                state.status = FileProcessingStatus.DELETED
                if (idx + 1) % 10 == 0:
                    self.db.commit()
                continue

            # PROMPT #224 - Mark skipped files as completed (no rules to extract)
            if result["status"] == "skipped":
                state.status = FileProcessingStatus.COMPLETED
                state.last_processed_at = datetime.utcnow()
                state.rules_extracted = 0
                state.error_message = None
                processed += 1
                if (idx + 1) % 10 == 0:
                    self.db.commit()
                continue

            if result["status"] == "error":
                state.status = FileProcessingStatus.FAILED
                state.error_message = result.get("error", "Erro desconhecido")
                state.retry_count = (state.retry_count or 0) + 1
                errors += 1
                logger.error(f"Failed to process {result.get('file_path')} (attempt {state.retry_count}): {result.get('error')}")
                if (idx + 1) % 10 == 0:
                    self.db.commit()
                continue

            # Success — update RAG
            rules = result.get("rules", [])

            # Delete old RAG documents for this file (single unified call)
            try:
                self.rag.delete_by_filter({
                    "project_id": str(project_id),
                    "type": "business_rule",
                    "source": "continuous_scan",
                    "source_file": state.file_path
                })
            except Exception:
                pass

            # Store new rules in RAG
            new_doc_ids = []
            for rule in rules:
                rule_text = rule.get("rule_text", "")
                if not rule_text or len(rule_text) < 10:
                    continue

                doc_id = self.rag.store_business_rule(
                    content=rule_text,
                    project_id=project_id,
                    source="continuous_scan",
                    source_file=state.file_path,
                    rule_type=rule.get("rule_type", "general"),
                    priority="normal" if rule.get("confidence") != "high" else "high",
                    fully_coded=True,
                )
                new_doc_ids.append(str(doc_id))

            # Update file state
            state.status = FileProcessingStatus.COMPLETED
            state.last_processed_at = datetime.utcnow()
            state.rag_document_ids = new_doc_ids
            state.rules_extracted = len(new_doc_ids)
            state.error_message = None

            processed += 1
            total_rules += len(new_doc_ids)

            # PROMPT #237 - Child job already completed inside _process_one
            if (idx + 1) % 10 == 0:
                self.db.commit()

            logger.info(
                f"{state.file_path}: {len(new_doc_ids)} rules extracted"
            )

        # PROMPT #300 - Final batch commit for remaining uncommitted changes
        self.db.commit()

        # PROMPT #230 - Count rules by semantic layer
        rules_by_layer = {}
        for state in pending_states:
            if state.status == FileProcessingStatus.COMPLETED and state.rules_extracted > 0:
                layer_name = state.file_layer.value if state.file_layer else "unknown"
                rules_by_layer[layer_name] = rules_by_layer.get(layer_name, 0) + state.rules_extracted

        pending_remaining = self.db.query(RAGFileState).filter(
            RAGFileState.project_id == project_id,
            RAGFileState.status == FileProcessingStatus.PENDING
        ).count()

        return {
            "processed": processed,
            "rules_extracted": total_rules,
            "errors": errors,
            "pending_remaining": pending_remaining,
            "rules_by_layer": rules_by_layer,
        }

    async def get_project_stats(self, project_id: UUID) -> Dict[str, Any]:
        """
        Get continuous RAG statistics for a project.
        """
        # File state counts
        status_counts = dict(
            self.db.query(RAGFileState.status, func.count(RAGFileState.id))
            .filter(RAGFileState.project_id == project_id)
            .group_by(RAGFileState.status)
            .all()
        )

        total_files = sum(status_counts.values())
        total_rules = self.db.query(func.sum(RAGFileState.rules_extracted)).filter(
            RAGFileState.project_id == project_id,
            RAGFileState.status == FileProcessingStatus.COMPLETED
        ).scalar() or 0

        # Last processed timestamp
        last_processed = self.db.query(func.max(RAGFileState.last_processed_at)).filter(
            RAGFileState.project_id == project_id
        ).scalar()

        # RAG stats
        try:
            rag_stats = self.rag.get_detailed_stats(project_id=project_id)
        except Exception:
            rag_stats = {}

        return {
            "project_id": str(project_id),
            "total_files_tracked": total_files,
            "by_status": {k.value if hasattr(k, 'value') else k: v for k, v in status_counts.items()},
            "total_rules_extracted": total_rules,
            "last_processed_at": last_processed.isoformat() if last_processed else None,
            "coverage_percent": round(
                (status_counts.get(FileProcessingStatus.COMPLETED, 0) / total_files * 100)
                if total_files > 0 else 0, 1
            ),
            "rag_stats": rag_stats,
        }

    async def reset_project(self, project_id: UUID) -> Dict[str, Any]:
        """
        Clear all file state and RAG documents from continuous scan for a project.
        """
        # Delete all RAG documents from continuous scan
        try:
            removed = self.rag.delete_by_filter({
                "project_id": str(project_id),
                "type": "business_rule",
                "source": "continuous_scan"
            })
        except Exception:
            removed = 0

        # Delete all file state records
        deleted = self.db.query(RAGFileState).filter(
            RAGFileState.project_id == project_id
        ).delete()
        self.db.commit()

        logger.info(f"Reset continuous RAG for project {project_id}: {deleted} files, {removed} RAG docs")

        return {
            "files_cleared": deleted,
            "rag_docs_removed": removed,
        }

    # =========================================================================
    # Internal Methods
    # =========================================================================

    # PROMPT #230 - Semantic layer priority for batch ordering (lower = processed first)
    LAYER_PRIORITY = {
        FileSemanticLayer.SCHEMA: 1,
        FileSemanticLayer.ROUTES: 2,
        FileSemanticLayer.LOGIC: 3,
        FileSemanticLayer.PRESENTATION: 4,
        FileSemanticLayer.CONFIG: 5,
        FileSemanticLayer.UNKNOWN: 6,
    }

    @staticmethod
    def _classify_semantic_layer(file_path: str) -> FileSemanticLayer:
        """
        PROMPT #230 - Stack-agnostic semantic layer classification.

        Classifies files by their architectural role based on path patterns.
        Works across Laravel, Django, Spring, Next.js, Go, Rails, etc.
        """
        fp = file_path.lower().replace("\\", "/")

        # --- SCHEMA layer: DB structure, models, entities ---
        schema_patterns = [
            "migration", "migrate",
            "/models/", "/model/", "/entities/", "/entity/",
            "/schemas/", "/schema/",
            "database/", "/orm/",
            "/domain/", "/domains/",
            "prisma/", "typeorm/", "sequelize/",
            ".prisma", ".graphql", ".proto",
        ]
        if any(p in fp for p in schema_patterns):
            return FileSemanticLayer.SCHEMA

        # --- ROUTES layer: API endpoints, controllers, handlers ---
        routes_patterns = [
            "/controllers/", "/controller/",
            "/handlers/", "/handler/",
            "/routes/", "/route/", "/routing/",
            "routes/",  # Root-level routes dir (e.g., routes/web.php)
            "/endpoints/", "/endpoint/",
            "/api/", "/resources/",
            "/resolvers/", "/resolver/",
            "router", "views.py",
        ]
        if any(p in fp for p in routes_patterns):
            return FileSemanticLayer.ROUTES

        # --- LOGIC layer: business logic, services, use cases ---
        logic_patterns = [
            "/services/", "/service/",
            "/usecases/", "/usecase/", "/use_cases/", "/use-cases/",
            "/actions/", "/action/",
            "/jobs/", "/job/", "/workers/", "/worker/",
            "/commands/", "/command/",
            "/events/", "/event/", "/listeners/", "/listener/",
            "/policies/", "/policy/",
            "/rules/", "/rule/",
            "/interactors/", "/interactor/",
            "/managers/", "/manager/",
            "/helpers/", "/helper/", "/utils/", "/util/",
            "/lib/", "/core/",
            "/middleware/", "/middlewares/",
            "/validators/", "/validator/",
            "/observers/", "/observer/",
            "/notifications/", "/notification/",
            "/mail/", "/emails/",
            "/requests/",  # Form requests / validation (Laravel, etc.)
        ]
        if any(p in fp for p in logic_patterns):
            return FileSemanticLayer.LOGIC

        # --- PRESENTATION layer: UI, views, components, templates ---
        presentation_patterns = [
            "/views/", "/view/",
            "/components/", "/component/",
            "/templates/", "/template/",
            "/pages/", "/page/",
            "/layouts/", "/layout/",
            "/partials/", "/partial/",
            "/widgets/", "/widget/",
            "/screens/", "/screen/",
            "/ui/",
            ".blade.php", ".vue", ".jsx", ".tsx",
            ".ejs", ".pug", ".hbs", ".handlebars",
            ".twig", ".jinja", ".html",
        ]
        if any(p in fp for p in presentation_patterns):
            return FileSemanticLayer.PRESENTATION

        # --- CONFIG layer: configuration, bootstrapping ---
        config_patterns = [
            "/config/", "/configs/", "/configuration/",
            "config/",  # Root-level config dirs (e.g., config/app.php)
            "/bootstrap/", "/boot/",
            "bootstrap/",  # Root-level bootstrap (e.g., bootstrap/app.php)
            "/providers/", "/provider/",
            "/initializers/", "/initializer/",
            "docker", "makefile", "dockerfile",
            ".env", ".ini", ".toml", ".yaml", ".yml",
            "package.json", "composer.json", "gemfile",
            "requirements.txt", "cargo.toml", "go.mod",
            "webpack", "vite", "babel", "eslint", "prettier",
            "tsconfig", "jest.config", "phpunit",
        ]
        if any(p in fp for p in config_patterns):
            return FileSemanticLayer.CONFIG

        return FileSemanticLayer.UNKNOWN

    def _compute_file_hash(self, file_path: Path) -> Optional[str]:
        """Compute SHA-256 hash of file content."""
        try:
            sha256 = hashlib.sha256()
            with open(file_path, "rb") as f:
                for chunk in iter(lambda: f.read(8192), b""):
                    sha256.update(chunk)
            return sha256.hexdigest()
        except Exception as e:
            logger.warning(f"Failed to hash {file_path}: {e}")
            return None

    # PROMPT #224/#230 - Compact prompt for local models (fewer tokens = faster inference)
    # PROMPT #230 - Rewritten to extract FUNCTIONAL business rules, not technical details
    _LOCAL_SYSTEM_PROMPT = (
        "Voce e um analista de negocios. Extraia APENAS regras de NEGOCIO FUNCIONAIS do codigo. "
        "FOQUE em: o que o USUARIO pode fazer, permissoes, fluxos, limites, calculos de negocio. "
        "IGNORE completamente: tipos de campo, configs de framework, drivers, sessoes, "
        "CSS, logs, booleanos, chaves estrangeiras, detalhes tecnicos de infraestrutura. "
        "Escreva cada regra como se explicasse para um GERENTE DE PRODUTO, nao para um programador. "
        "Responda APENAS com JSON valido, em portugues brasileiro: "
        '{"business_rules":[{"rule_text":"...","rule_type":"validation|workflow|constraint|domain","confidence":"high|medium"}]}'
    )

    async def _extract_rules_from_file(
        self,
        filename: str,
        content: str,
        language: str,
        project_id: UUID,
        project_context: Optional[str] = None,
        is_local: bool = False,
        max_resp_tokens: int = 4096,
    ) -> List[Dict[str, str]]:
        """
        Use AI to extract business rules from a single file.

        Uses externalized YAML contract and AIOrchestrator with chain fallback.
        PROMPT #224 - Uses compact prompt for local models to reduce inference time.
        """
        try:
            if is_local:
                # Compact prompt: ~60 tokens system + minimal user prompt
                system_prompt = self._LOCAL_SYSTEM_PROMPT
                user_prompt = f"{filename} ({language}):\n{content}"
            else:
                system_prompt, user_prompt = self._contract_loader.render(
                    "memory/continuous_rag_extract",
                    {
                        "filename": filename,
                        "file_content": content,
                        "language": language,
                        "project_context": project_context or "",
                        "stack_info": "",
                    }
                )

            response = await self.orchestrator.execute(
                usage_type="memory",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=max_resp_tokens,
                project_id=project_id,
                metadata={
                    "phase": "continuous_rag_extract",
                    "scan_type": "continuous_rag",
                    "filename": filename,
                    "language": language,
                }
            )

            # Parse response (reuse pattern from CodebaseMemoryService)
            result = self._memory._parse_phase_response(response.get("content", "{}"))

            rules = result.get("business_rules", [])

            # Normalize rules: AI may return various key names
            parsed_rules = []
            for rule in rules:
                if isinstance(rule, str):
                    parsed_rules.append({
                        "rule_text": rule,
                        "rule_type": "general",
                        "confidence": "medium",
                    })
                elif isinstance(rule, dict):
                    # Normalize rule_text from various possible keys
                    rule_text = (
                        rule.get("rule_text")
                        or rule.get("description")
                        or rule.get("rule")
                        or rule.get("text")
                        or rule.get("content")
                        or ""
                    )
                    # Append condition/action context if present
                    condition = rule.get("condition", "")
                    action = rule.get("action", "")
                    if condition and action:
                        rule_text = f"{rule_text} [Condition: {condition}] [Action: {action}]"
                    elif condition:
                        rule_text = f"{rule_text} [Condition: {condition}]"

                    parsed_rules.append({
                        "rule_text": rule_text,
                        "rule_type": rule.get("rule_type") or rule.get("type") or rule.get("category") or "general",
                        "confidence": rule.get("confidence") or "medium",
                        "source_context": rule.get("source_context") or rule.get("context") or "",
                    })

            return parsed_rules

        except Exception as e:
            logger.error(f"AI rule extraction failed for {filename}: {e}")
            return []

    # =========================================================================
    # PROMPT #250 - Embedding-Only Indexing (No AI calls)
    # =========================================================================

    async def index_files_direct(self, project_id: UUID) -> Dict[str, Any]:
        """
        Index project files directly via Nomic Embed Text embeddings (no AI calls).

        Reads each pending file, stores its content as a RAG document using
        embedding-only storage. No business rule extraction — just raw file
        content indexed for semantic search.

        Returns:
            Dict with indexed count and errors
        """
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.code_path:
            return {"indexed": 0, "errors": 0, "error": "Project not found or no code_path"}

        code_path = Path(project.code_path)

        pending_states = self.db.query(RAGFileState).filter(
            RAGFileState.project_id == project_id,
            RAGFileState.status == FileProcessingStatus.PENDING
        ).all()

        if not pending_states:
            return {"indexed": 0, "errors": 0}

        console = _get_console_logger()
        indexed = 0
        errors = 0

        for state in pending_states:
            try:
                file_path = code_path / state.file_path
                if not file_path.exists():
                    state.status = FileProcessingStatus.DELETED
                    continue

                content = file_path.read_text(errors="replace")
                if not content.strip():
                    state.status = FileProcessingStatus.PROCESSED
                    continue

                # Truncate very large files (Nomic context: 8192 tokens ~ 32K chars)
                if len(content) > 30000:
                    content = content[:30000]

                # Store directly via RAG embedding (Nomic Embed Text, no AI)
                self.rag.store(
                    content=f"# {state.file_path}\n\n{content}",
                    metadata={
                        "type": "source_code",
                        "source": "continuous_scan",
                        "source_file": state.file_path,
                        "file_layer": state.file_layer or "unknown",
                    },
                    project_id=project_id,
                )

                state.status = FileProcessingStatus.PROCESSED
                state.rules_extracted = 0
                indexed += 1

                if console and indexed % 50 == 0:
                    asyncio.create_task(console.log_memory_scan(
                        phase="index_direct",
                        message=f"Indexed {indexed}/{len(pending_states)} files (embedding-only)",
                        project_id=str(project_id),
                    ))

            except Exception as e:
                logger.error(f"Direct index failed for {state.file_path}: {e}")
                state.status = FileProcessingStatus.ERROR
                state.error_message = str(e)[:500]
                errors += 1

        self.db.commit()

        logger.info(f"Direct indexing complete: {indexed} files indexed, {errors} errors")
        return {"indexed": indexed, "errors": errors}
