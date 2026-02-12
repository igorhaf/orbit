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
    result = await service.process_pending_files(project_id, batch_size=50)
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
from app.models.rag_file_state import FileProcessingStatus, RAGFileState
from app.services.ai_orchestrator import AIOrchestrator
from app.services.codebase_indexer import CodebaseIndexer
from app.services.codebase_memory import CodebaseMemoryService
from app.services.console_logger import ConsoleLogger
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)

# Concurrent AI requests to Ollama (matches OLLAMA_NUM_PARALLEL)
MAX_PARALLEL_EXTRACTIONS = 3


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

    async def run_full_cycle(self, project_id: UUID) -> Dict[str, Any]:
        """
        Execute a complete scan-process-cleanup cycle for a project.

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
        process_result = await self.process_pending_files(project_id)

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
            return {"error": "Project not found or no code_path", "new_files": 0, "modified_files": 0, "deleted_files": 0}

        code_path = Path(project.code_path)
        if not code_path.exists():
            return {"error": f"Code path not found: {code_path}", "new_files": 0, "modified_files": 0, "deleted_files": 0}

        # Load .gitignore patterns (reuse from CodebaseMemoryService)
        self._memory._gitignore_patterns = self._memory._load_gitignore_patterns(code_path)

        # PROMPT #223 - Reset effective ignore dirs and load project-specific custom ignores
        self._memory._effective_ignore_dirs = set(self._memory.IGNORE_DIRECTORIES)
        if project.custom_ignore_patterns:
            custom_dirs = project.custom_ignore_patterns.get("directories", [])
            if custom_dirs:
                self._memory._effective_ignore_dirs.update(custom_dirs)
                logger.info(f"🤖 Loaded {len(custom_dirs)} project-specific ignore dirs: {custom_dirs}")

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
            dirs[:] = [d for d in dirs if not self._memory._should_ignore_dir(d)]

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
                    modified_count += 1
            else:
                # New file
                new_state = RAGFileState(
                    project_id=project_id,
                    file_path=rel_path,
                    file_hash=file_hash,
                    file_size=file_stat.st_size,
                    last_modified=datetime.fromtimestamp(file_stat.st_mtime),
                    status=FileProcessingStatus.PENDING,
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
        batch_size: int = 50
    ) -> Dict[str, Any]:
        """
        Process pending files using AI to extract business rules.

        Uses asyncio.Semaphore for parallel AI extraction (up to MAX_PARALLEL_EXTRACTIONS
        concurrent requests to Ollama/cloud models).
        """
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.code_path:
            return {"processed": 0, "rules_extracted": 0, "errors": 0}

        code_path = Path(project.code_path)

        # Get pending files
        pending_states = self.db.query(RAGFileState).filter(
            RAGFileState.project_id == project_id,
            RAGFileState.status == FileProcessingStatus.PENDING
        ).limit(batch_size).all()

        if not pending_states:
            return {"processed": 0, "rules_extracted": 0, "errors": 0}

        console = _get_console_logger()
        total_count = len(pending_states)

        # Mark all as processing upfront
        for state in pending_states:
            state.status = FileProcessingStatus.PROCESSING
        self.db.commit()

        # Semaphore limits concurrent AI requests
        semaphore = asyncio.Semaphore(MAX_PARALLEL_EXTRACTIONS)

        # Shared counters (accessed sequentially after gather)
        results = []

        async def _process_one(idx: int, state: RAGFileState) -> Dict[str, Any]:
            """Process a single file with semaphore-controlled concurrency."""
            file_full_path = code_path / state.file_path

            if not file_full_path.exists():
                return {"state_id": state.id, "status": "deleted"}

            if console:
                asyncio.create_task(console.log_memory_scan(
                    phase=f"file_{idx+1}/{total_count}",
                    message=f"Analyzing: {state.file_path}",
                    files_processed=idx + 1,
                    project_id=str(project_id)
                ))

            async with semaphore:
                try:
                    # Read file content (fast, local I/O)
                    content = file_full_path.read_text(encoding="utf-8", errors="ignore")

                    # Detect language
                    language = self.indexer._detect_language(file_full_path) or "unknown"

                    # PROMPT #224 - Detect provider to set appropriate content limit
                    # Local models (Ollama) are much slower with large inputs
                    try:
                        from app.models.ai_model import AIModelUsageType
                        _mc = self.orchestrator.choose_model(AIModelUsageType.MEMORY)
                        _is_local = _mc.get("provider") == "ollama"
                    except Exception:
                        _is_local = False

                    max_content = 3000 if _is_local else 15000
                    if len(content) > max_content:
                        content = content[:max_content]

                    # Extract business rules via AI (this is the slow part)
                    rules = await self._extract_rules_from_file(
                        filename=state.file_path,
                        content=content,
                        language=language,
                        project_id=project_id,
                        project_context=project.context_semantic,
                    )

                    return {
                        "state_id": state.id,
                        "file_path": state.file_path,
                        "status": "success",
                        "rules": rules,
                    }

                except Exception as e:
                    return {
                        "state_id": state.id,
                        "file_path": state.file_path,
                        "status": "error",
                        "error": str(e)[:500],
                    }

        # PROMPT #221 / #224 - Per-file timeout to prevent indefinite hangs
        PER_FILE_TIMEOUT = 300  # 5 minutes max per file

        async def _process_one_with_timeout(idx: int, state: RAGFileState) -> Dict[str, Any]:
            try:
                return await asyncio.wait_for(
                    _process_one(idx, state),
                    timeout=PER_FILE_TIMEOUT,
                )
            except asyncio.TimeoutError:
                logger.warning(f"File extraction timed out after {PER_FILE_TIMEOUT}s: {state.file_path}")
                return {
                    "state_id": state.id,
                    "file_path": state.file_path,
                    "status": "error",
                    "error": f"Extraction timed out after {PER_FILE_TIMEOUT}s",
                }

        # Launch all tasks with controlled concurrency
        tasks = [_process_one_with_timeout(i, state) for i, state in enumerate(pending_states)]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Process results sequentially (DB writes are not thread-safe)
        processed = 0
        total_rules = 0
        errors = 0

        # Build state lookup for quick access
        state_lookup = {state.id: state for state in pending_states}

        for result in results:
            if isinstance(result, Exception):
                errors += 1
                logger.error(f"Unexpected error in parallel processing: {result}")
                continue

            state = state_lookup.get(result.get("state_id"))
            if not state:
                continue

            if result["status"] == "deleted":
                state.status = FileProcessingStatus.DELETED
                self.db.commit()
                continue

            if result["status"] == "error":
                state.status = FileProcessingStatus.FAILED
                state.error_message = result.get("error", "Unknown error")
                self.db.commit()
                errors += 1
                logger.error(f"Failed to process {result.get('file_path')}: {result.get('error')}")
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
                    priority="normal" if rule.get("confidence") != "high" else "high"
                )
                new_doc_ids.append(str(doc_id))

            # Update file state
            state.status = FileProcessingStatus.COMPLETED
            state.last_processed_at = datetime.utcnow()
            state.rag_document_ids = new_doc_ids
            state.rules_extracted = len(new_doc_ids)
            state.error_message = None
            self.db.commit()

            processed += 1
            total_rules += len(new_doc_ids)

            logger.info(
                f"{state.file_path}: {len(new_doc_ids)} rules extracted"
            )

        return {
            "processed": processed,
            "rules_extracted": total_rules,
            "errors": errors,
            "pending_remaining": self.db.query(RAGFileState).filter(
                RAGFileState.project_id == project_id,
                RAGFileState.status == FileProcessingStatus.PENDING
            ).count(),
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

    async def _extract_rules_from_file(
        self,
        filename: str,
        content: str,
        language: str,
        project_id: UUID,
        project_context: Optional[str] = None,
    ) -> List[Dict[str, str]]:
        """
        Use AI to extract business rules from a single file.

        Uses externalized YAML contract and AIOrchestrator with chain fallback.
        """
        try:
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

            # PROMPT #224 - Reduce max_tokens for local models (JSON rules don't need 4K)
            try:
                from app.models.ai_model import AIModelUsageType
                _mc = self.orchestrator.choose_model(AIModelUsageType.MEMORY)
                _resp_tokens = 1024 if _mc.get("provider") == "ollama" else 4096
            except Exception:
                _resp_tokens = 2048

            response = await self.orchestrator.execute(
                usage_type="memory",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=_resp_tokens,
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
