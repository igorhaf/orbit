"""
Codebase Memory Service

PROMPT #118 - Initial codebase scan and memory extraction
PROMPT #163 - Multi-phase analysis with configurable depth
PROMPT #166 - Ignore irrelevant files (.gitignore, vendor, node_modules, etc.)
PROMPT #184 - Extract business rules from git commit history

This service performs the first scan of a project's codebase when the code folder
is selected during project creation. It:
1. Detects the technology stack
2. Scans and indexes files for RAG (ignoring irrelevant files)
3. Uses AI to extract business rules and patterns (multi-phase for better quality)
4. Analyzes git commit history for additional business rules
5. Suggests a project title based on the analysis
6. Prepares relevant data for the context interview

PROMPT #163 Features:
- Configurable scan depth: quick, normal, deep
- Multi-phase analysis for better results with local models
- Each phase saves a prompt to the prompts table for visibility
- Contracts externalized to YAML files (PROMPT #164 - ContractLoader)

PROMPT #166 Features:
- Respects .gitignore patterns from the project
- Ignores common irrelevant directories: node_modules, vendor, .venv, dist, etc.
- Ignores non-code files: images, fonts, binaries, lock files
- Focuses only on business logic files for AI analysis

Business Rule: All code analyzed must have its business rules stored,
including this very feature of project creation.

Usage:
    from app.services.codebase_memory import CodebaseMemoryService

    memory = CodebaseMemoryService(db)

    # Quick scan (30 files, 2 phases)
    result = await memory.scan_and_memorize(code_path, scan_depth="quick")

    # Normal scan (100 files, 4 phases) - default
    result = await memory.scan_and_memorize(code_path, scan_depth="normal")

    # Deep scan (ALL files, N phases)
    result = await memory.scan_and_memorize(code_path, scan_depth="deep")

    # Returns:
    # {
    #     "suggested_title": "E-commerce Platform",
    #     "stack_info": {...},
    #     "business_rules": [...],
    #     "key_features": [...],
    #     "interview_context": "...",
    #     "phases_completed": 4,
    #     "scan_depth": "normal"
    # }
"""

import logging
import asyncio
from pathlib import Path
from typing import Dict, List, Optional, Any, Literal
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.services.stack_detector import StackDetector
from app.services.codebase_indexer import CodebaseIndexer
from app.services.rag_service import RAGService
from app.services.ai_orchestrator import AIOrchestrator
from app.services.console_logger import get_console_logger  # PROMPT #168 - Real-time Console Logs

from .blocklist import BlocklistMixin
from .scanner import ScannerMixin
from .file_analyzer import FileAnalyzerMixin
from .ai_analyzer import AIAnalyzerMixin
from .git_analyzer import GitAnalyzerMixin
from .result_merger import ResultMergerMixin
from .rag_storage import RagStorageMixin

logger = logging.getLogger(__name__)

# PROMPT #163 - Type for scan depth
ScanDepth = Literal["quick", "normal", "deep"]


class CodebaseMemoryService(
    BlocklistMixin,
    ScannerMixin,
    FileAnalyzerMixin,
    AIAnalyzerMixin,
    GitAnalyzerMixin,
    ResultMergerMixin,
    RagStorageMixin,
):
    """
    Service for initial codebase scan and memory extraction.

    Scans a codebase to:
    - Detect technology stack
    - Index code files for RAG
    - Extract business rules using AI
    - Suggest project title
    - Prepare context for AI interviews
    """

    def __init__(self, db: Session):
        """
        Initialize the codebase memory service.

        Args:
            db: SQLAlchemy database session
        """
        self.db = db
        self.stack_detector = StackDetector()
        self.rag = RAGService(db)
        # PROMPT #118 FIX - Disable cache for memory scan to avoid stale/corrupted responses
        self.orchestrator = AIOrchestrator(db, enable_cache=False)
        # PROMPT #163 - Track current folder name for prompts
        self.current_folder_name = ""
        self.current_scan_depth = "normal"
        # PROMPT #166 - Dynamic ignore patterns from .gitignore
        self._gitignore_patterns = set()
        # PROMPT #223 - Instance-level ignore dirs (starts as copy of class-level)
        # AI-detected custom patterns are added here without contaminating the class set
        self._effective_ignore_dirs = set(self.IGNORE_DIRECTORIES)
        self._effective_file_patterns = set(self.IGNORE_FILE_PATTERNS)

    async def scan_and_memorize(
        self,
        code_path: str,
        project_id: Optional[UUID] = None,
        scan_depth: ScanDepth = "normal",
        progress_callback: Optional[callable] = None,  # PROMPT #168 - Progress callback
        job_id: Optional[UUID] = None,  # PROMPT #298 - Parent job for sub-job hierarchy
    ) -> Dict[str, Any]:
        """
        Perform initial codebase scan and memorization.

        This is the main entry point called when a user selects a code folder
        during project creation.

        PROMPT #163 - Now supports configurable scan depth:
        - "quick": 30 files, 2 phases (~1-2 min)
        - "normal": 100 files, 4 phases (~5-10 min)
        - "deep": ALL files, N phases (~15-30+ min)

        Args:
            code_path: Absolute path to the codebase folder
            project_id: Optional project ID (if project already created)
            scan_depth: Depth of analysis - "quick", "normal", or "deep"

        Returns:
            Dict containing:
            - suggested_title: AI-suggested project name
            - stack_info: Detected technology stack
            - business_rules: List of extracted business rules
            - key_features: Main features identified
            - interview_context: Prepared context for AI interview
            - files_indexed: Number of files indexed in RAG
            - scan_summary: Overview of what was scanned
            - phases_completed: Number of AI analysis phases completed
            - scan_depth: The scan depth used

        Raises:
            ValueError: If code_path doesn't exist or is not a directory
        """
        path = Path(code_path)

        if not path.exists():
            raise ValueError(f"Caminho do código não existe: {code_path}")

        if not path.is_dir():
            raise ValueError(f"Caminho do código não é um diretório: {code_path}")

        # PROMPT #163 - Store scan settings
        self.current_folder_name = path.name

        # PROMPT #166 - Load .gitignore patterns for this project
        self._gitignore_patterns = self._load_gitignore_patterns(path)
        # PROMPT #223 - Reset effective ignore dirs for this scan
        self._effective_ignore_dirs = set(self.IGNORE_DIRECTORIES)
        self._effective_file_patterns = set(self.IGNORE_FILE_PATTERNS)

        # PROMPT #250 - Load global blocklist from system_settings
        global_blocklist = self._load_global_blocklist()
        gl_dirs = global_blocklist.get("directories", [])
        gl_patterns = global_blocklist.get("file_patterns", [])
        if gl_dirs:
            self._effective_ignore_dirs.update(gl_dirs)
        if gl_patterns:
            self._effective_file_patterns.update(gl_patterns)

        logger.info(f"🚫 Ignoring {len(self._effective_ignore_dirs)} dirs ({len(gl_dirs)} global) + {len(self._gitignore_patterns)} .gitignore patterns + {len(self._effective_file_patterns)} file patterns ({len(gl_patterns)} global)")

        # PROMPT #223 - AI pre-scan to detect non-standard directories to exclude
        if project_id:
            try:
                # Check if project already has saved custom ignores
                from app.models.project import Project
                project_obj = self.db.query(Project).filter(Project.id == project_id).first()
                if project_obj and project_obj.custom_ignore_patterns:
                    # Reuse previously detected patterns
                    saved_dirs = project_obj.custom_ignore_patterns.get("directories", [])
                    if saved_dirs:
                        self._effective_ignore_dirs.update(saved_dirs)
                        logger.info(f"🤖 Loaded {len(saved_dirs)} saved AI-detected ignore dirs: {saved_dirs}")
                else:
                    # First scan - ask AI to detect directories to ignore
                    ai_ignores = await self._detect_ignore_directories(path, project_id)
                    if ai_ignores.get("directories"):
                        self._effective_ignore_dirs.update(ai_ignores["directories"])
                        # Save to project for future use (Continuous RAG, re-scans)
                        if project_obj:
                            project_obj.custom_ignore_patterns = ai_ignores
                            self.db.commit()
                            logger.info(f"💾 Saved AI-detected ignore patterns to project")
                        # PROMPT #250 - Save as global blocklist suggestions
                        project_name = project_obj.name if project_obj else self.current_folder_name
                        self._save_blocklist_suggestions(
                            ai_ignores["directories"],
                            ai_ignores.get("rationale", {}),
                            project_name,
                        )

                # PROMPT #241 - Load user-editable ignore paths
                if project_obj and project_obj.ignore_paths:
                    user_paths = project_obj.ignore_paths
                    if isinstance(user_paths, list):
                        self._effective_ignore_dirs.update(user_paths)
                        logger.info(f"📁 Loaded {len(user_paths)} user ignore paths: {user_paths}")
            except Exception as e:
                logger.warning(f"AI ignore detection skipped (non-blocking): {e}")

        # PROMPT #228 - Removed auto-switch to "local" for Ollama.
        # With qwen3:8b at 46.5 tok/s (100% GPU), no need to limit scan depth.
        # The override was created for qwen2.5:32b (2.6 tok/s) which was removed in PROMPT #227.
        try:
            from app.models.ai_model import AIModelUsageType
            model_config = self.orchestrator.choose_model(AIModelUsageType.MEMORY)
            logger.info(
                f"Memory model provider: {model_config.get('provider', 'unknown')}, "
                f"model: {model_config.get('db_model_name', 'unknown')}, "
                f"scan_depth: {scan_depth} (preserved)"
            )
        except Exception as e:
            logger.debug(f"Could not detect model provider: {e}")

        self.current_scan_depth = scan_depth
        config = self.SCAN_DEPTH_CONFIG.get(scan_depth, self.SCAN_DEPTH_CONFIG["normal"])

        logger.info(f"🧠 Starting codebase memory scan for: {code_path}")
        logger.info(f"📊 Scan depth: {scan_depth} - {config['description']}")

        # PROMPT #168 - Console logging for real-time visibility
        console = get_console_logger()
        import asyncio

        # PROMPT #296 - Observability: trace_id + per-phase timing
        import time as _time
        scan_trace_id = str(uuid4())
        scan_start_time = _time.time()
        phase_metrics = []  # Collect timing for each phase
        pid_str = str(project_id) if project_id else None
        op_name = "Memory Scan"

        asyncio.create_task(console.log_operation_start(
            trace_id=scan_trace_id,
            operation_name=op_name,
            phase_name="Inicialização",
            project_id=pid_str
        ))

        asyncio.create_task(console.log_memory_scan(
            phase="start",
            message=f"Starting {scan_depth} scan for {path.name}",
            project_id=pid_str,
            trace_id=scan_trace_id
        ))

        result = {
            "code_path": code_path,
            "suggested_title": "",
            "stack_info": {},
            "business_rules": [],
            "key_features": [],
            "interview_context": "",
            "files_indexed": 0,
            "scan_summary": {},
            "phases_completed": 0,  # PROMPT #163
            "scan_depth": scan_depth  # PROMPT #163
        }

        # PROMPT #298 - Sub-job hierarchy
        jm = None
        if job_id:
            from app.services.job_manager import JobManager
            from app.models.async_job import JobType
            jm = JobManager(self.db)

        # PROMPT #168 - Helper function for progress callbacks
        async def report_progress(percent: float, message: str):
            if progress_callback:
                try:
                    progress_callback(percent, message)
                except Exception as e:
                    logger.warning(f"Progress callback failed: {e}")
            # Also log to console
            asyncio.create_task(console.log_memory_scan(
                phase=f"{int(percent)}%",
                message=message,
                project_id=pid_str,
                trace_id=scan_trace_id
            ))

        # --- Step 1: Detect technology stack ---
        phase1_name = "Detecção de Stack"
        phase1_start = _time.time()
        asyncio.create_task(console.log_operation_start(
            trace_id=scan_trace_id, operation_name=op_name, phase_name=phase1_name, project_id=pid_str
        ))
        # PROMPT #298 - Sub-job
        child1_id = None
        if jm:
            child1 = jm.create_child_job(
                parent_job_id=job_id, job_type=JobType.MEMORY_SCAN,
                input_data={"phase": phase1_name, "code_path": code_path},
                phase_label=f"Fase 1: {phase1_name}",
            )
            child1_id = child1.id
            jm.start_job(child1_id)
        logger.info("📊 Step 1: Detecting technology stack...")
        await report_progress(15.0, "Detectando stack tecnológica...")
        try:
            stack_info = self.stack_detector.detect(path)
            result["stack_info"] = stack_info
            logger.info(f"   Detected stack: {stack_info.get('detected_stack', 'unknown')}")
            if jm and child1_id:
                jm.complete_child_job(child1_id, {"detected_stack": stack_info.get("detected_stack", "unknown")})
        except Exception as e:
            if jm and child1_id:
                jm.fail_child_job(child1_id, str(e))
            raise
        phase1_ms = int((_time.time() - phase1_start) * 1000)
        phase_metrics.append({"phase": phase1_name, "duration_ms": phase1_ms})
        asyncio.create_task(console.log_operation_end(
            trace_id=scan_trace_id, operation_name=op_name, phase_name=phase1_name,
            duration_ms=phase1_ms, project_id=pid_str
        ))

        # --- Step 2: Scan and collect file information ---
        phase2_name = "Varredura de Arquivos"
        phase2_start = _time.time()
        asyncio.create_task(console.log_operation_start(
            trace_id=scan_trace_id, operation_name=op_name, phase_name=phase2_name, project_id=pid_str
        ))
        # PROMPT #298 - Sub-job
        child2_id = None
        if jm:
            child2 = jm.create_child_job(
                parent_job_id=job_id, job_type=JobType.MEMORY_SCAN,
                input_data={"phase": phase2_name, "code_path": code_path},
                phase_label=f"Fase 2: {phase2_name}",
            )
            child2_id = child2.id
            jm.start_job(child2_id)
        logger.info("📂 Step 2: Scanning codebase structure...")
        await report_progress(20.0, "Escaneando estrutura do codebase...")
        try:
            scan_data = await self._scan_codebase(path)
            result["scan_summary"] = {
                "total_files": scan_data["total_files"],
                "code_files": scan_data["code_files"],
                "languages": scan_data["languages"],
                "config_files_found": scan_data["config_files"]
            }
            logger.info(f"   Found {scan_data['total_files']} files, {scan_data['code_files']} code files")
            if jm and child2_id:
                jm.complete_child_job(child2_id, {"total_files": scan_data["total_files"], "code_files": scan_data["code_files"]})
        except Exception as e:
            if jm and child2_id:
                jm.fail_child_job(child2_id, str(e))
            raise
        phase2_ms = int((_time.time() - phase2_start) * 1000)
        phase_metrics.append({"phase": phase2_name, "duration_ms": phase2_ms})
        asyncio.create_task(console.log_operation_end(
            trace_id=scan_trace_id, operation_name=op_name, phase_name=phase2_name,
            duration_ms=phase2_ms, project_id=pid_str
        ))

        # --- Step 3: Index files in RAG (if project_id provided) ---
        phase3_name = "Indexação RAG"
        phase3_start = _time.time()
        asyncio.create_task(console.log_operation_start(
            trace_id=scan_trace_id, operation_name=op_name, phase_name=phase3_name, project_id=pid_str
        ))
        # PROMPT #298 - Sub-job
        child3_id = None
        if jm:
            child3 = jm.create_child_job(
                parent_job_id=job_id, job_type=JobType.MEMORY_SCAN,
                input_data={"phase": phase3_name, "code_path": code_path},
                phase_label=f"Fase 3: {phase3_name}",
            )
            child3_id = child3.id
            jm.start_job(child3_id)
        if project_id:
            logger.info("💾 Step 3: Indexing files in RAG...")
            await report_progress(30.0, "Indexando arquivos no RAG...")
            try:
                indexer = CodebaseIndexer(self.db)
                indexing_result = await self._index_for_memory(indexer, project_id, path)
                result["files_indexed"] = indexing_result.get("files_indexed", 0)
                logger.info(f"   Indexed {result['files_indexed']} files")
                if jm and child3_id:
                    jm.complete_child_job(child3_id, {"files_indexed": result["files_indexed"]})
            except Exception as e:
                logger.warning(f"   RAG indexing skipped: {e}")
                result["files_indexed"] = 0
                if jm and child3_id:
                    jm.fail_child_job(child3_id, str(e))
        else:
            logger.info("   Skipping RAG indexing (no project_id yet)")
            if jm and child3_id:
                jm.complete_child_job(child3_id, {"skipped": True, "reason": "no project_id"})
        phase3_ms = int((_time.time() - phase3_start) * 1000)
        phase_metrics.append({"phase": phase3_name, "duration_ms": phase3_ms})
        asyncio.create_task(console.log_operation_end(
            trace_id=scan_trace_id, operation_name=op_name, phase_name=phase3_name,
            duration_ms=phase3_ms, project_id=pid_str
        ))

        # --- Step 4: Extract code samples ---
        phase4_name = "Extração de Amostras"
        phase4_start = _time.time()
        asyncio.create_task(console.log_operation_start(
            trace_id=scan_trace_id, operation_name=op_name, phase_name=phase4_name, project_id=pid_str
        ))
        # PROMPT #298 - Sub-job
        child4_id = None
        if jm:
            child4 = jm.create_child_job(
                parent_job_id=job_id, job_type=JobType.MEMORY_SCAN,
                input_data={"phase": phase4_name, "code_path": code_path},
                phase_label=f"Fase 4: {phase4_name}",
            )
            child4_id = child4.id
            jm.start_job(child4_id)
        logger.info("🔍 Step 4: Extracting code samples for analysis...")
        await report_progress(40.0, "Extraindo amostras de código...")
        try:
            code_samples = self._extract_code_samples(path, scan_data, config)
            logger.info(f"   Extracted {len(code_samples)} code samples")
            if jm and child4_id:
                jm.complete_child_job(child4_id, {"samples_extracted": len(code_samples)})
        except Exception as e:
            if jm and child4_id:
                jm.fail_child_job(child4_id, str(e))
            raise
        phase4_ms = int((_time.time() - phase4_start) * 1000)
        phase_metrics.append({"phase": phase4_name, "duration_ms": phase4_ms})
        asyncio.create_task(console.log_operation_end(
            trace_id=scan_trace_id, operation_name=op_name, phase_name=phase4_name,
            duration_ms=phase4_ms, project_id=pid_str
        ))

        # --- Step 5: AI analysis ---
        phase5_name = "Análise IA"
        phase5_start = _time.time()
        asyncio.create_task(console.log_operation_start(
            trace_id=scan_trace_id, operation_name=op_name, phase_name=phase5_name, project_id=pid_str
        ))
        # PROMPT #298 - Sub-job
        child5_id = None
        if jm:
            child5 = jm.create_child_job(
                parent_job_id=job_id, job_type=JobType.MEMORY_SCAN,
                input_data={"phase": phase5_name, "code_path": code_path, "scan_depth": scan_depth},
                phase_label=f"Fase 5: {phase5_name}",
            )
            child5_id = child5.id
            jm.start_job(child5_id)
        logger.info(f"🤖 Step 5: AI analysis ({scan_depth} mode)...")
        await report_progress(50.0, f"Análise de IA iniciada (modo {scan_depth})...")
        try:
            ai_analysis = await self._ai_analyze_codebase_phased(
                code_samples=code_samples,
                stack_info=stack_info,
                scan_summary=result["scan_summary"],
                root_path=path,
                project_id=project_id,
                scan_depth=scan_depth
            )

            result["suggested_title"] = ai_analysis.get("suggested_title", "")
            result["business_rules"] = ai_analysis.get("business_rules", [])
            result["key_features"] = ai_analysis.get("key_features", [])
            result["interview_context"] = ai_analysis.get("interview_context", "")
            result["phases_completed"] = ai_analysis.get("phases_completed", 1)
            if jm and child5_id:
                jm.complete_child_job(child5_id, {
                    "phases_completed": result["phases_completed"],
                    "rules_found": len(result["business_rules"]),
                    "features_found": len(result["key_features"]),
                })
        except Exception as e:
            if jm and child5_id:
                jm.fail_child_job(child5_id, str(e))
            raise
        phase5_ms = int((_time.time() - phase5_start) * 1000)
        phase5_tokens = ai_analysis.get("total_tokens", 0)
        phase5_cost = ai_analysis.get("total_cost", 0.0)
        phase5_model = ai_analysis.get("model_used", "")
        phase_metrics.append({
            "phase": phase5_name, "duration_ms": phase5_ms,
            "tokens": phase5_tokens, "cost_usd": phase5_cost, "model": phase5_model
        })
        asyncio.create_task(console.log_operation_end(
            trace_id=scan_trace_id, operation_name=op_name, phase_name=phase5_name,
            duration_ms=phase5_ms, project_id=pid_str,
            tokens_used=phase5_tokens or None, cost_usd=phase5_cost or None,
            model_name=phase5_model or None
        ))

        await report_progress(85.0, "Processando resultados de análise de IA...")

        # --- Step 5.5: Git commit analysis ---
        if scan_depth != "local":
            phase55_name = "Análise Git"
            phase55_start = _time.time()
            commits = self._extract_git_commits(path)
            if commits:
                asyncio.create_task(console.log_operation_start(
                    trace_id=scan_trace_id, operation_name=op_name, phase_name=phase55_name, project_id=pid_str
                ))
                # PROMPT #298 - Sub-job
                child55_id = None
                if jm:
                    child55 = jm.create_child_job(
                        parent_job_id=job_id, job_type=JobType.MEMORY_SCAN,
                        input_data={"phase": phase55_name, "commits_count": len(commits)},
                        phase_label=f"Fase 6: {phase55_name}",
                    )
                    child55_id = child55.id
                    jm.start_job(child55_id)
                logger.info(f"📝 Step 5.5: Analyzing {len(commits)} git commits for business rules...")
                await report_progress(87.0, f"Analisando {len(commits)} commits git...")
                try:
                    git_rules = await self._analyze_git_commits(
                        commits, stack_info, project_id
                    )
                    if git_rules:
                        result["business_rules"].extend(git_rules)
                        result["git_commits_analyzed"] = len(commits)
                        result["git_rules_found"] = len(git_rules)
                        logger.info(f"   Found {len(git_rules)} business rules from git history")
                    if jm and child55_id:
                        jm.complete_child_job(child55_id, {
                            "commits_analyzed": len(commits),
                            "rules_found": len(git_rules) if git_rules else 0,
                        })
                except Exception as e:
                    logger.warning(f"Git commit analysis failed (non-fatal): {e}")
                    if jm and child55_id:
                        jm.fail_child_job(child55_id, str(e))
                phase55_ms = int((_time.time() - phase55_start) * 1000)
                phase_metrics.append({"phase": phase55_name, "duration_ms": phase55_ms})
                asyncio.create_task(console.log_operation_end(
                    trace_id=scan_trace_id, operation_name=op_name, phase_name=phase55_name,
                    duration_ms=phase55_ms, project_id=pid_str
                ))
            else:
                logger.info("📝 No git history found, skipping commit analysis")

        # --- Step 6: Store business rules ---
        phase6_name = "Armazenamento de Regras"
        phase6_start = _time.time()
        if project_id and result["business_rules"]:
            asyncio.create_task(console.log_operation_start(
                trace_id=scan_trace_id, operation_name=op_name, phase_name=phase6_name, project_id=pid_str
            ))
            # PROMPT #298 - Sub-job
            child6_id = None
            if jm:
                child6 = jm.create_child_job(
                    parent_job_id=job_id, job_type=JobType.MEMORY_SCAN,
                    input_data={"phase": phase6_name, "rules_count": len(result["business_rules"])},
                    phase_label=f"Fase 7: {phase6_name}",
                )
                child6_id = child6.id
                jm.start_job(child6_id)
            logger.info("💾 Step 6: Storing business rules in RAG...")
            await report_progress(90.0, f"Armazenando {len(result['business_rules'])} regras de negócio...")
            try:
                await self._store_business_rules(project_id, result["business_rules"])
                logger.info(f"   Stored {len(result['business_rules'])} business rules")
                if jm and child6_id:
                    jm.complete_child_job(child6_id, {"rules_stored": len(result["business_rules"])})
            except Exception as e:
                if jm and child6_id:
                    jm.fail_child_job(child6_id, str(e))
                raise
            phase6_ms = int((_time.time() - phase6_start) * 1000)
            phase_metrics.append({"phase": phase6_name, "duration_ms": phase6_ms})
            asyncio.create_task(console.log_operation_end(
                trace_id=scan_trace_id, operation_name=op_name, phase_name=phase6_name,
                duration_ms=phase6_ms, project_id=pid_str
            ))

        # PROMPT #296 - Final summary with diagnostics
        total_scan_ms = int((_time.time() - scan_start_time) * 1000)
        total_tokens = sum(p.get("tokens", 0) for p in phase_metrics)
        total_cost = sum(p.get("cost_usd", 0.0) for p in phase_metrics)

        # Identify bottleneck
        bottleneck = None
        if phase_metrics:
            slowest = max(phase_metrics, key=lambda p: p["duration_ms"])
            pct = int(slowest["duration_ms"] / total_scan_ms * 100) if total_scan_ms > 0 else 0
            if pct > 40:
                bottleneck = f"{slowest['phase']} consumiu {pct}% do tempo total"

        # Generate diagnostics
        diagnostics = self._generate_scan_diagnostics(phase_metrics, total_scan_ms, total_tokens, total_cost)

        asyncio.create_task(console.log_operation_summary(
            trace_id=scan_trace_id,
            operation_name=op_name,
            total_duration_ms=total_scan_ms,
            phases=phase_metrics,
            total_tokens=total_tokens or None,
            total_cost=total_cost or None,
            bottleneck=bottleneck,
            diagnostics=diagnostics,
            project_id=pid_str
        ))

        await report_progress(95.0, "Finalizando resultados...")
        logger.info("✅ Codebase memory scan complete!")
        return result

    def _generate_scan_diagnostics(
        self,
        phases: List[Dict[str, Any]],
        total_ms: int,
        total_tokens: int,
        total_cost: float
    ) -> List[str]:
        """PROMPT #296 - Generate diagnostic suggestions based on scan metrics."""
        diagnostics = []
        if not phases or total_ms == 0:
            return diagnostics

        # Bottleneck detection
        for p in phases:
            pct = int(p["duration_ms"] / total_ms * 100)
            if pct > 50:
                diagnostics.append(
                    f"A fase '{p['phase']}' consumiu {pct}% do tempo ({p['duration_ms']}ms de {total_ms}ms)"
                )

        # Slow scan
        if total_ms > 60000:
            diagnostics.append(
                f"Scan total levou {total_ms // 1000}s. Considere usar scan_depth='quick' para projetos grandes"
            )

        # Token usage
        if total_tokens > 50000:
            diagnostics.append(
                f"Total de {total_tokens} tokens usados. Considere um modelo mais econômico"
            )

        # Cost analysis
        if total_cost > 0.10:
            diagnostics.append(
                f"Custo total: ${total_cost:.4f}. Haiku seria ~70% mais barato para análise de código"
            )

        return diagnostics
