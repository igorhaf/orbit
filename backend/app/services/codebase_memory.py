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

import os
import json
import logging
import fnmatch
import asyncio
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Any, Literal, Set
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.services.stack_detector import StackDetector
from app.services.codebase_indexer import CodebaseIndexer
from app.services.rag_service import RAGService
from app.services.ai_orchestrator import AIOrchestrator
from app.services.console_logger import get_console_logger  # PROMPT #168 - Real-time Console Logs
from app.services.symbol_extractor import extract_and_format_batch, extract_symbols, format_symbol_map  # PROMPT #230

logger = logging.getLogger(__name__)

# PROMPT #163 - Type for scan depth
ScanDepth = Literal["quick", "normal", "deep"]


class CodebaseMemoryService:
    """
    Service for initial codebase scan and memory extraction.

    Scans a codebase to:
    - Detect technology stack
    - Index code files for RAG
    - Extract business rules using AI
    - Suggest project title
    - Prepare context for AI interviews
    """

    # File extensions to analyze for business rules
    ANALYSIS_EXTENSIONS = {
        ".py", ".php", ".js", ".ts", ".tsx", ".jsx",
        ".java", ".rb", ".go", ".cs", ".swift", ".kt",
        ".vue", ".svelte",
        # PROMPT #169 - Include view/template files for branding/context
        ".blade.php", ".html", ".twig", ".ejs", ".erb",
        ".hbs", ".pug", ".mustache"
    }

    # Config/docs files to extract from
    CONFIG_FILES = {
        "README.md", "readme.md", "README.txt",
        "CONTRIBUTING.md", "ARCHITECTURE.md",
        "package.json", "composer.json", "Cargo.toml",
        "pyproject.toml", "setup.py", "pom.xml",
        ".env.example", "docker-compose.yml"
    }

    # PROMPT #166 - Expanded list of directories to ALWAYS ignore
    # These directories contain dependencies, caches, or generated files - NOT business logic
    IGNORE_DIRECTORIES = {
        # Package managers / Dependencies
        "node_modules",      # JavaScript/Node.js
        "vendor",            # PHP Composer, Go modules
        "vendors",           # Alternative vendor folder
        "bower_components",  # Bower (legacy)
        "jspm_packages",     # JSPM
        "packages",          # NuGet, some monorepos
        ".pnpm",             # pnpm

        # Python
        ".venv", "venv", "env", ".env",
        "__pycache__", ".pytest_cache", ".mypy_cache",
        ".tox", ".nox", "eggs", "*.egg-info",
        "site-packages", ".Python",

        # Ruby
        ".bundle", "bundle",

        # Java/Kotlin
        ".gradle", "gradle",
        ".m2", "target",

        # .NET
        "bin", "obj", "packages",

        # Build outputs
        "dist", "build", "out", "output",
        ".next", ".nuxt", ".output",
        ".svelte-kit", ".vercel", ".netlify",
        "public/build", "public/dist",

        # Version control
        ".git", ".svn", ".hg", ".bzr",

        # IDE / Editor
        ".idea", ".vscode", ".vs",
        ".eclipse", ".settings",
        "*.xcworkspace", "*.xcodeproj",

        # Test coverage / Reports
        "coverage", ".nyc_output",
        "htmlcov", ".coverage",

        # Logs and temp
        "logs", "log", "tmp", "temp",
        ".temp", ".tmp", ".cache",

        # Documentation build
        "_site", "site", "docs/_build",
        ".docusaurus", ".vuepress",

        # Assets / Static files (usually not business logic)
        "public/assets", "static/assets",
        "uploads", "storage/app",

        # Laravel specific
        "storage/framework",
        "storage/logs",
        "bootstrap/cache",

        # Docker
        ".docker",

        # Backups / Snapshots
        ".claude-backups", "backups", "backup",
        ".backups", "_backups",

        # Misc
        ".terraform", ".serverless",
        ".aws-sam", ".amplify",
    }

    # PROMPT #166 - File patterns to ALWAYS ignore (not business logic)
    IGNORE_FILE_PATTERNS = {
        # Lock files
        "*.lock", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
        "composer.lock", "Gemfile.lock", "Cargo.lock", "poetry.lock",

        # Compiled / Generated
        "*.min.js", "*.min.css", "*.map",
        "*.pyc", "*.pyo", "*.pyd",
        "*.class", "*.jar", "*.war",
        "*.dll", "*.exe", "*.so", "*.dylib",
        "*.o", "*.a", "*.lib",

        # Images / Media (not code)
        "*.png", "*.jpg", "*.jpeg", "*.gif", "*.ico", "*.svg",
        "*.webp", "*.bmp", "*.tiff",
        "*.mp3", "*.mp4", "*.wav", "*.avi", "*.mov",
        "*.pdf", "*.doc", "*.docx", "*.xls", "*.xlsx",

        # Fonts
        "*.woff", "*.woff2", "*.ttf", "*.eot", "*.otf",

        # Archives
        "*.zip", "*.tar", "*.gz", "*.rar", "*.7z",

        # Database files
        "*.sqlite", "*.sqlite3", "*.db",

        # Environment / Secrets (should not be read)
        ".env", ".env.local", ".env.production",
        "*.pem", "*.key", "*.crt", "*.cer",

        # IDE / Config
        ".DS_Store", "Thumbs.db", "*.swp", "*.swo",
        ".editorconfig", ".prettierrc*", ".eslintrc*",
        "tsconfig.tsbuildinfo",
    }

    # PROMPT #163 - Configurable scan depth settings
    # PROMPT #165 - Added "local" profile for Ollama/local models
    SCAN_DEPTH_CONFIG = {
        "quick": {
            "max_files": 30,
            "max_content_per_file": 5000,
            "phases": ["documentation", "quick_scan"],
            "files_per_phase": 15,
            "description": "Quick scan: 30 files, 2 phases (~1-2 min)"
        },
        "normal": {
            "max_files": 100,
            "max_content_per_file": 10000,
            "phases": ["documentation", "domain", "logic", "consolidation"],
            "files_per_phase": 25,
            "description": "Normal scan: 100 files, 4 phases (~5-10 min)"
        },
        "deep": {
            "max_files": None,  # No limit - read ALL files
            "max_content_per_file": 20000,
            "phases": "dynamic",  # Create phases as needed
            "files_per_phase": 15,
            "description": "Deep scan: ALL files, N phases (~15-30+ min)"
        },
        # PROMPT #165 - Profile optimized for local models (Ollama/Qwen)
        # PROMPT #236 - Increased max_files from 15→50 so chain prompting
        # can pick a proportional subset (50% of available, min 5, max 25)
        "local": {
            "max_files": 50,
            "max_content_per_file": 2000,  # Much smaller to fit in 32K context
            "phases": ["quick_scan"],  # Single phase for simplicity
            "files_per_phase": 10,
            "description": "Local model scan: up to 50 files, chain prompting (~5-15 min)"
        }
    }

    # Legacy constants (used as defaults, overridden by scan_depth)
    MAX_FILES_FOR_AI = 100  # PROMPT #163 - Increased from 30
    MAX_CONTENT_PER_FILE = 10000  # PROMPT #163 - Increased from 5000

    # PROMPT #118 FIX - Directories that contain business logic
    BUSINESS_LOGIC_DIRS = {
        "models", "model", "entities", "entity",
        "controllers", "controller", "handlers", "handler",
        "services", "service", "usecases", "use_cases",
        "repositories", "repository", "repos",
        "validators", "validation", "rules",
        "migrations", "database/migrations",
        "middleware", "middlewares",
        "requests", "forms", "dtos",
        "policies", "guards", "permissions",
        "observers", "listeners", "events",
        "jobs", "commands", "actions"
    }

    # PROMPT #118 FIX - Files that typically contain business logic
    BUSINESS_LOGIC_PATTERNS = {
        # Models and entities
        "model", "entity", "domain",
        # Controllers and handlers
        "controller", "handler", "endpoint",
        # Services and use cases
        "service", "usecase", "interactor",
        # Validation and rules
        "validator", "rule", "policy", "guard",
        # Data and repositories
        "repository", "repo", "dao",
        # Migrations (database schema = business rules)
        "migration", "schema",
        # Middleware (business rules enforcement)
        "middleware", "filter",
        # Request validation (business rules)
        "request", "form", "dto",
        # Events and jobs
        "event", "listener", "job", "command"
    }

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
        self._gitignore_patterns: Set[str] = set()
        # PROMPT #223 - Instance-level ignore dirs (starts as copy of class-level)
        # AI-detected custom patterns are added here without contaminating the class set
        self._effective_ignore_dirs: Set[str] = set(self.IGNORE_DIRECTORIES)
        self._effective_file_patterns: Set[str] = set(self.IGNORE_FILE_PATTERNS)

    def _load_global_blocklist(self) -> Dict:
        """Carrega a lista de bloqueio global do system_settings."""
        from app.models.system_settings import SystemSettings
        try:
            setting = self.db.query(SystemSettings).filter(
                SystemSettings.key == "global_blocklist"
            ).first()
            if setting and setting.value:
                return setting.value
        except Exception as e:
            logger.warning(f"Falha ao carregar blocklist global: {e}")
        return {"directories": [], "file_patterns": []}

    def _save_blocklist_suggestions(self, new_dirs: List[str], rationale: Dict, project_name: str) -> None:
        """Salva sugestões de bloqueio detectadas pela IA."""
        from app.models.system_settings import SystemSettings
        try:
            blocklist = self._load_global_blocklist()
            blocked_dirs = set(blocklist.get("directories", []))
            rejected_setting = self.db.query(SystemSettings).filter(
                SystemSettings.key == "blocklist_rejected"
            ).first()
            rejected = set(rejected_setting.value) if rejected_setting and isinstance(rejected_setting.value, list) else set()

            suggestions_setting = self.db.query(SystemSettings).filter(
                SystemSettings.key == "blocklist_suggestions"
            ).first()
            existing_suggestions = []
            if suggestions_setting and isinstance(suggestions_setting.value, list):
                existing_suggestions = suggestions_setting.value
            existing_paths = {s["path"] for s in existing_suggestions}

            new_suggestions = []
            for d in new_dirs:
                if d not in blocked_dirs and d not in rejected and d not in existing_paths:
                    new_suggestions.append({
                        "path": d,
                        "type": "directory",
                        "source_project": project_name,
                        "rationale": rationale.get(d, "Detectado pela IA como não sendo código de negocio"),
                    })

            if new_suggestions:
                all_suggestions = existing_suggestions + new_suggestions
                if suggestions_setting:
                    suggestions_setting.value = all_suggestions
                    suggestions_setting.updated_at = __import__("datetime").datetime.utcnow()
                else:
                    self.db.add(SystemSettings(
                        key="blocklist_suggestions",
                        value=all_suggestions,
                        description="Sugestões pendentes para lista de bloqueio global",
                        updated_at=__import__("datetime").datetime.utcnow(),
                    ))
                self.db.commit()
                logger.info(f"💡 {len(new_suggestions)} novas sugestões de bloqueio salvas de '{project_name}'")
        except Exception as e:
            logger.warning(f"Falha ao salvar sugestões de bloqueio: {e}")

    def _load_gitignore_patterns(self, root_path: Path) -> Set[str]:
        """
        PROMPT #166 - Load and parse .gitignore patterns from project.

        Reads .gitignore from the project root and converts patterns
        to a set of directory/file patterns to ignore.

        Args:
            root_path: Root path of the codebase

        Returns:
            Set of patterns to ignore
        """
        patterns = set()
        gitignore_path = root_path / ".gitignore"

        if not gitignore_path.exists():
            logger.debug(f"No .gitignore found at {root_path}")
            return patterns

        try:
            content = gitignore_path.read_text(encoding="utf-8", errors="ignore")
            for line in content.splitlines():
                # Skip empty lines and comments
                line = line.strip()
                if not line or line.startswith("#"):
                    continue

                # Remove trailing slashes for directory matching
                if line.endswith("/"):
                    line = line[:-1]

                # Handle negation (!) - we skip these for simplicity
                if line.startswith("!"):
                    continue

                patterns.add(line)

            logger.info(f"📄 Loaded {len(patterns)} patterns from .gitignore")
        except Exception as e:
            logger.warning(f"Failed to parse .gitignore: {e}")

        return patterns

    def _should_ignore_path(self, path: Path, root_path: Path) -> bool:
        """
        PROMPT #166 - Check if a path should be ignored.

        Checks against:
        1. Built-in IGNORE_DIRECTORIES
        2. Built-in IGNORE_FILE_PATTERNS
        3. Project's .gitignore patterns

        Args:
            path: Path to check
            root_path: Root path of the codebase

        Returns:
            True if path should be ignored
        """
        # Get relative path for pattern matching
        try:
            rel_path = path.relative_to(root_path)
        except ValueError:
            rel_path = path

        rel_str = str(rel_path)
        name = path.name

        # Check if any part of the path is in effective ignore dirs (PROMPT #223)
        for part in rel_path.parts:
            if part in self._effective_ignore_dirs:
                return True

        # Check file patterns (includes global blocklist patterns)
        for pattern in self._effective_file_patterns:
            if fnmatch.fnmatch(name, pattern):
                return True

        # Check .gitignore patterns
        for pattern in self._gitignore_patterns:
            # Check if pattern matches the name or relative path
            if fnmatch.fnmatch(name, pattern):
                return True
            if fnmatch.fnmatch(rel_str, pattern):
                return True
            # Check if pattern matches any part of the path
            if fnmatch.fnmatch(rel_str, f"*/{pattern}"):
                return True
            if fnmatch.fnmatch(rel_str, f"*/{pattern}/*"):
                return True

        return False

    def _should_ignore_dir(self, dirname: str) -> bool:
        """
        PROMPT #166 - Quick check if directory name should be ignored.

        Used during os.walk to prune directories early.

        Args:
            dirname: Directory name (not full path)

        Returns:
            True if directory should be skipped
        """
        # Check built-in + AI-detected ignore list (PROMPT #223)
        if dirname in self._effective_ignore_dirs:
            return True

        # Check .gitignore patterns (directory names only)
        for pattern in self._gitignore_patterns:
            if fnmatch.fnmatch(dirname, pattern):
                return True

        return False

    def _quick_directory_listing(self, root_path: Path) -> str:
        """
        PROMPT #223 - List top-level directory structure for AI analysis.

        Walks only 2 levels deep, counting total files and code files per dir.
        This is a fast filesystem-only operation (no AI, no file reads).

        Returns:
            Formatted string showing directory tree with file counts
        """
        lines = []
        for root, dirs, files in os.walk(root_path):
            # Prune already-known ignored dirs
            dirs[:] = sorted(d for d in dirs if not self._should_ignore_dir(d))
            rel = Path(root).relative_to(root_path)
            depth = len(rel.parts)
            if depth > 2:
                dirs.clear()
                continue
            indent = "  " * depth
            dir_name = rel.name if rel.parts else root_path.name
            code_count = sum(
                1 for f in files
                if Path(f).suffix.lower() in self.ANALYSIS_EXTENSIONS
            )
            lines.append(f"{indent}{dir_name}/ ({len(files)} files, {code_count} code)")
        return "\n".join(lines[:100])

    async def _detect_ignore_directories(
        self, root_path: Path, project_id: Optional[UUID] = None
    ) -> Dict[str, Any]:
        """
        PROMPT #223 - Use AI to detect non-standard directories to exclude.

        Sends a compact directory listing to the AI and asks it to identify
        directories containing third-party code, vendored dependencies, or
        non-business-logic files.

        Args:
            root_path: Project root path
            project_id: Optional project ID for orchestrator tracking

        Returns:
            Dict with "directories" (list of names) and "rationale" (dict)
        """
        import json as _json
        from datetime import datetime as _dt

        dir_listing = self._quick_directory_listing(root_path)
        if not dir_listing.strip():
            return {"directories": [], "rationale": {}, "detected_by_ai": True}

        already_ignored = ", ".join(sorted(list(self._effective_ignore_dirs)[:30]))

        # Load prompt from YAML
        try:
            from app.prompts.loader import PromptLoader
            loader = PromptLoader()
            system_prompt, user_prompt = loader.render(
                "memory/detect_ignore_dirs",
                {
                    "directory_listing": dir_listing,
                    "already_ignored": already_ignored,
                }
            )
        except Exception as e:
            logger.warning(f"Failed to load detect_ignore_dirs YAML, using inline: {e}")
            system_prompt = (
                "You analyze project directory structures to identify folders that should be "
                "EXCLUDED from business logic analysis. Respond with ONLY a JSON object: "
                '{"directories": ["dir1"], "rationale": {"dir1": "reason"}}. '
                "If none, respond: {\"directories\": [], \"rationale\": {}}. "
                "Do NOT list standard dirs (node_modules, vendor, .git, dist, build, __pycache__)."
            )
            user_prompt = (
                f"Project directory structure (2 levels deep):\n\n{dir_listing}\n\n"
                f"Already ignored: {already_ignored}\n\n"
                "Identify NON-STANDARD directories to exclude."
            )

        try:
            response = await self.orchestrator.execute(
                usage_type="memory",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=500,
                project_id=project_id,
            )

            content = response.get("content", "").strip()
            # Strip markdown code fences if present
            if content.startswith("```"):
                content = "\n".join(content.split("\n")[1:])
            if content.endswith("```"):
                content = "\n".join(content.split("\n")[:-1])
            content = content.strip()

            parsed = _json.loads(content)
            dirs = parsed.get("directories", [])
            rationale = parsed.get("rationale", {})

            # Filter out dirs already in the built-in ignore set
            new_dirs = [
                d for d in dirs
                if d not in self._effective_ignore_dirs and d not in self._gitignore_patterns
            ]

            result = {
                "directories": new_dirs,
                "rationale": {k: v for k, v in rationale.items() if k in new_dirs},
                "detected_by_ai": True,
                "detection_timestamp": _dt.utcnow().isoformat(),
            }

            if new_dirs:
                logger.info(f"🤖 AI detected {len(new_dirs)} additional dirs to ignore: {new_dirs}")
            else:
                logger.info("🤖 AI found no additional directories to ignore")

            return result

        except _json.JSONDecodeError as e:
            logger.warning(f"AI returned invalid JSON for ignore detection: {e}")
            return {"directories": [], "rationale": {}, "detected_by_ai": True}
        except Exception as e:
            logger.warning(f"AI ignore detection failed (non-blocking): {e}")
            return {"directories": [], "rationale": {}, "detected_by_ai": True}

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

    async def _scan_codebase(self, root_path: Path) -> Dict[str, Any]:
        """
        Scan codebase to collect file statistics and structure.

        PROMPT #166 - Now respects .gitignore and expanded ignore patterns.

        Args:
            root_path: Root path of the codebase

        Returns:
            Dict with scan statistics
        """
        stats = {
            "total_files": 0,
            "code_files": 0,
            "ignored_files": 0,  # PROMPT #166 - Track ignored files
            "languages": {},
            "config_files": [],
            "directory_structure": [],
            "key_files": []
        }

        for root, dirs, files in os.walk(root_path):
            # PROMPT #166 - Skip ignored directories using new method
            dirs[:] = [d for d in dirs if not self._should_ignore_dir(d)]

            rel_root = Path(root).relative_to(root_path)

            # Track directory structure (first 2 levels)
            if len(rel_root.parts) <= 2:
                stats["directory_structure"].append(str(rel_root))

            for filename in files:
                file_path = Path(root) / filename

                # PROMPT #166 - Check if file should be ignored
                if self._should_ignore_path(file_path, root_path):
                    stats["ignored_files"] += 1
                    continue

                stats["total_files"] += 1

                # Check if it's a config file
                if filename in self.CONFIG_FILES:
                    stats["config_files"].append(str(file_path.relative_to(root_path)))

                # Check if it's a code file
                ext = file_path.suffix.lower()
                if ext in self.ANALYSIS_EXTENSIONS:
                    stats["code_files"] += 1

                    # Count by language
                    lang = self._extension_to_language(ext)
                    stats["languages"][lang] = stats["languages"].get(lang, 0) + 1

                    # Identify key files (models, controllers, main files)
                    if self._is_key_file(filename, file_path):
                        rel_path = str(file_path.relative_to(root_path))
                        stats["key_files"].append(rel_path)

        logger.info(f"📊 Scan complete: {stats['total_files']} files analyzed, {stats['ignored_files']} ignored")
        return stats

    def _extension_to_language(self, ext: str) -> str:
        """Map file extension to language name."""
        mapping = {
            ".py": "Python",
            ".php": "PHP",
            ".js": "JavaScript",
            ".ts": "TypeScript",
            ".tsx": "TypeScript (React)",
            ".jsx": "JavaScript (React)",
            ".java": "Java",
            ".rb": "Ruby",
            ".go": "Go",
            ".cs": "C#",
            ".swift": "Swift",
            ".kt": "Kotlin",
            ".vue": "Vue",
            ".svelte": "Svelte"
        }
        return mapping.get(ext, ext)

    def _is_key_file(self, filename: str, file_path: Path) -> bool:
        """
        Determine if a file is a key file worth analyzing.

        PROMPT #118 FIX - Expanded to capture more business logic files:
        - Models, Entities, Domains
        - Controllers, Handlers, Endpoints
        - Services, UseCases, Interactors
        - Validators, Rules, Policies
        - Migrations (database schema = business rules!)
        - Middleware (business rules enforcement)
        - Requests/Forms/DTOs (validation rules)
        - Events, Listeners, Jobs

        PROMPT #169 - Also include context/branding files:
        - Route files (contain domain names, URL structure)
        - Layout/template files (contain titles, branding)
        - Config files with domain info
        """
        lower_name = filename.lower()
        path_parts = [p.lower() for p in file_path.parts]

        # Check if file is in a business logic directory
        for part in path_parts:
            if part in self.BUSINESS_LOGIC_DIRS:
                return True

        # Check if filename contains business logic patterns
        for pattern in self.BUSINESS_LOGIC_PATTERNS:
            if pattern in lower_name:
                return True

        # Check for route files (often contain business rules AND domain context)
        if "route" in lower_name or "routes" in path_parts:
            return True

        # Check for main entry files
        entry_files = {"main.py", "app.py", "index.js", "index.ts", "server.js", "server.ts"}
        if lower_name in entry_files:
            return True

        # Laravel specific - check for common business files
        laravel_patterns = {
            "kernel.php", "routes.php", "web.php", "api.php",
            "appserviceprovider.php", "authserviceprovider.php"
        }
        if lower_name in laravel_patterns:
            return True

        # PROMPT #169 - Include layout/template files (contain branding, titles)
        if "layout" in lower_name or "master" in lower_name or "base" in lower_name:
            return True

        # PROMPT #169 - Include views directory files (contain titles, branding context)
        if "views" in path_parts or "templates" in path_parts or "resources/views" in str(file_path).lower():
            # Include main layout files
            if any(p in lower_name for p in ["layout", "master", "app", "base", "main", "header", "welcome"]):
                return True

        # PROMPT #169 - Include config files that may have domain/branding info
        if "config" in path_parts and any(p in lower_name for p in ["app", "site", "domain", "branding"]):
            return True

        return False

    def _extract_code_samples(
        self,
        root_path: Path,
        scan_data: Dict,
        config: Optional[Dict] = None
    ) -> List[Dict[str, str]]:
        """
        Extract representative code samples for AI analysis.

        PROMPT #169 - Framework-agnostic approach using conceptual heuristics:

        Prioritization is based on CONTENT CHARACTERISTICS, not naming conventions:
        1. Larger files (more code = more logic)
        2. Files with more imports/dependencies (more interconnected = more central)
        3. Files deeper in directory structure (more specific to the domain)
        4. Avoid files that look like config/boilerplate by content pattern

        This works for ANY language/framework without hardcoded naming patterns.

        Args:
            root_path: Root path of codebase
            scan_data: Scan statistics from _scan_codebase
            config: Optional scan depth config (from SCAN_DEPTH_CONFIG)

        Returns:
            List of {filename, content, type} dicts
        """
        # PROMPT #163 - Use config limits or defaults
        max_files = config.get("max_files", self.MAX_FILES_FOR_AI) if config else self.MAX_FILES_FOR_AI
        max_content = config.get("max_content_per_file", self.MAX_CONTENT_PER_FILE) if config else self.MAX_CONTENT_PER_FILE

        # For "deep" mode, max_files is None (no limit)
        if max_files is None:
            max_files = float('inf')

        samples = []
        scored_files = []

        # Collect all code files with their scores
        key_files = scan_data.get("key_files", [])

        for file_path in key_files:
            full_path = root_path / file_path
            if not full_path.exists():
                continue

            try:
                content = full_path.read_text(encoding="utf-8", errors="ignore")
                score = self._calculate_file_relevance_score(file_path, content)

                scored_files.append({
                    "filename": file_path,
                    "content": content,
                    "score": score,
                    "type": "code"
                })
            except Exception as e:
                logger.warning(f"Failed to read {file_path}: {e}")

        # Sort by relevance score (higher = more relevant)
        scored_files.sort(key=lambda x: x["score"], reverse=True)

        # Take top N files based on score
        for file_data in scored_files:
            if len(samples) >= max_files:
                break

            samples.append({
                "filename": file_data["filename"],
                "content": file_data["content"][:max_content],
                "type": file_data["type"]
            })

        # Add README only if we have space and found one
        if len(samples) < max_files:
            for config_file in scan_data.get("config_files", []):
                if "readme" in config_file.lower():
                    full_path = root_path / config_file
                    if full_path.exists():
                        try:
                            content = full_path.read_text(encoding="utf-8", errors="ignore")
                            samples.append({
                                "filename": config_file,
                                "content": content[:max_content],
                                "type": "documentation"
                            })
                            break
                        except Exception as e:
                            logger.warning(f"Failed to read {config_file}: {e}")

        logger.info(f"📂 Extracted {len(samples)} code samples (max_files={max_files}, scored from {len(scored_files)} candidates)")
        return samples

    def _calculate_file_relevance_score(self, file_path: str, content: str) -> float:
        """
        Calculate a relevance score for a file based on conceptual heuristics.

        PROMPT #169 - Framework-agnostic scoring:
        - Larger files tend to have more business logic
        - Files with more imports are more interconnected (central to the system)
        - Deeper paths are more domain-specific
        - Penalize files that look like boilerplate/config

        Returns a score where higher = more relevant for understanding business logic.
        """
        score = 0.0
        lines = content.split('\n')
        line_count = len(lines)

        # 1. File size score (larger files tend to have more logic)
        # Cap at 1000 lines to avoid over-weighting massive files
        size_score = min(line_count, 1000) / 100.0  # 0-10 points
        score += size_score

        # 2. Import/dependency density (more imports = more interconnected)
        import_patterns = [
            'import ', 'from ', 'require(', 'use ', 'include ',
            '#include', 'using ', '@import', 'load '
        ]
        import_count = sum(1 for line in lines[:100] if any(p in line for p in import_patterns))
        import_score = min(import_count, 20) / 2.0  # 0-10 points
        score += import_score

        # 3. Path depth score (deeper = more specific)
        path_depth = file_path.count('/') + file_path.count('\\')
        depth_score = min(path_depth, 5) * 1.5  # 0-7.5 points
        score += depth_score

        # 4. Function/method density (more functions = more logic)
        function_patterns = [
            'def ', 'function ', 'func ', 'fn ', '=> {',
            'public function', 'private function', 'protected function',
            'public static', 'private static',
            'async ', 'pub fn', 'func ('
        ]
        function_count = sum(1 for line in lines if any(p in line for p in function_patterns))
        function_score = min(function_count, 30) / 3.0  # 0-10 points
        score += function_score

        # 5. Class/struct definitions (indicates domain objects)
        class_patterns = ['class ', 'struct ', 'interface ', 'trait ', 'enum ', 'type ']
        class_count = sum(1 for line in lines if any(p in line for p in class_patterns))
        class_score = min(class_count, 10) * 0.5  # 0-5 points
        score += class_score

        # 6. BONUSES for context/branding files (PROMPT #169)
        # These files often contain system names, domains, and business context

        # Bonus for domain names (government, company, etc.)
        domain_patterns = [
            '.gov.br', '.gov', '.gob.', '.edu.br', '.org.br',
            'Route::domain', '@domain', 'domain =', 'host =',
            'APP_URL', 'BASE_URL', 'SITE_URL'
        ]
        if any(p in content for p in domain_patterns):
            score += 10.0  # High bonus - domain info is very valuable for context

        # Bonus for HTML titles (branding context)
        if '<title>' in content and '</title>' in content:
            score += 8.0  # Titles contain system names!

        # Bonus for route files (URL structure = system structure)
        if 'Route::' in content or '@route' in content or 'router.' in content:
            score += 5.0

        # 7. PENALTIES for likely non-business files

        # Penalty for config-like content
        config_indicators = [
            '"version":', "'version':", 'version =',
            '"name":', "'name':", '"dependencies":',
            'module.exports', 'export default {',
            '<?xml', '<!DOCTYPE', '<configuration>'
        ]
        if any(indicator in content[:500] for indicator in config_indicators):
            score -= 5.0

        # Penalty for test files
        if any(p in file_path.lower() for p in ['test', 'spec', '_test.', '.test.', 'tests/']):
            score -= 3.0

        # Penalty for migration/schema files (they define structure, not logic)
        if any(p in file_path.lower() for p in ['migration', 'schema', 'seed', 'fixture']):
            score -= 2.0

        # Penalty for very small files (likely stubs or simple configs)
        if line_count < 20:
            score -= 3.0

        # Penalty for files with mostly comments/empty lines
        non_empty_lines = [l for l in lines if l.strip() and not l.strip().startswith(('#', '//', '/*', '*', '--', ';'))]
        if len(non_empty_lines) < line_count * 0.3:
            score -= 2.0

        return max(score, 0.0)  # Don't go negative

    # =========================================================================
    # PROMPT #163 - Multi-phase Analysis Methods
    # =========================================================================

    def _is_domain_file(self, filename: str) -> bool:
        """Check if file is domain/model related."""
        lower = filename.lower()
        return any(p in lower for p in ["model", "entity", "migration", "schema", "domain"])

    def _is_logic_file(self, filename: str) -> bool:
        """Check if file is logic/service related."""
        lower = filename.lower()
        return any(p in lower for p in ["controller", "service", "handler", "usecase", "validator", "request", "policy"])

    def _format_samples_for_prompt(self, samples: List[Dict], use_symbols: bool = True) -> str:
        """
        Format code samples as a string for the prompt.

        PROMPT #230 - Uses symbol extraction by default for 5-10x compression.
        Falls back to raw code for documentation/config files.
        """
        if not use_symbols:
            # Legacy mode: raw code
            parts = []
            for sample in samples:
                parts.append(f"\n### File: {sample['filename']} ({sample['type']})")
                parts.append("```")
                parts.append(sample["content"])
                parts.append("```\n")
            return "\n".join(parts)

        # PROMPT #230 - Symbol extraction mode
        code_samples = [s for s in samples if s.get("type") == "code"]
        doc_samples = [s for s in samples if s.get("type") != "code"]

        parts = []

        # Documentation files: include raw content (they're already compact)
        for sample in doc_samples:
            content = sample.get("content", "")[:3000]  # Cap docs at 3K
            parts.append(f"\n### File: {sample['filename']} ({sample['type']})")
            parts.append(content)

        # Code files: use symbol extraction
        if code_samples:
            parts.append("\n### ARCHITECTURAL SYMBOL MAP (extracted from code files)")
            parts.append(extract_and_format_batch(code_samples))

        return "\n".join(parts)

    def _parse_phase_response(self, content: str) -> Dict:
        """
        Parse JSON response from a phase analysis.

        PROMPT #230 - Uses _try_parse_json from PROMPT #229 for robust
        4-strategy autocorrection instead of ad-hoc parsing.
        """
        from app.services.utility_node_executor import UtilityNodeExecutor

        default = {
            "partial_title": "",
            "business_rules_found": [],
            "features_found": [],
            "entities_found": [],
            "insights": ""
        }

        if not content or not content.strip():
            return default

        parsed = UtilityNodeExecutor._try_parse_json(content.strip(), auto_repair=True)
        if parsed and isinstance(parsed, dict):
            return parsed

        logger.warning(f"Failed to parse phase response even with autocorrection")
        return default

    # PROMPT #184 - Git commit analysis for business rules
    NOISE_COMMIT_PATTERNS = [
        "merge branch", "merge pull request", "merge remote",
        "bump version", "update deps", "chore(deps)",
        "initial commit", "wip", "fixup!", "squash!",
        "auto-generated", "generated with", "co-authored-by",
        "update changelog", "release v", "version bump",
    ]

    def _is_noise_commit(self, subject: str) -> bool:
        """Return True for commits unlikely to contain business rules."""
        subject_lower = subject.lower().strip()
        if not subject_lower or len(subject_lower) < 5:
            return True
        return any(pattern in subject_lower for pattern in self.NOISE_COMMIT_PATTERNS)

    def _extract_git_commits(self, root_path: Path, max_commits: int = 200) -> List[Dict[str, str]]:
        """
        Extract recent git commits from repository.

        PROMPT #184 - Uses subprocess to run git log.
        Returns empty list if no .git directory or git not available.
        """
        git_dir = root_path / ".git"
        if not git_dir.exists():
            logger.info("📝 No .git directory found, skipping commit analysis")
            return []

        try:
            result = subprocess.run(
                ["git", "log", f"--pretty=format:%H|||%s|||%b|||%an|||%ad",
                 "--date=short", f"-{max_commits}"],
                cwd=str(root_path),
                capture_output=True, text=True, timeout=30
            )
            if result.returncode != 0:
                logger.warning(f"git log failed: {result.stderr[:200]}")
                return []

            commits = []
            for line in result.stdout.strip().split("\n"):
                if not line.strip():
                    continue
                parts = line.split("|||")
                if len(parts) >= 2:
                    subject = parts[1].strip()
                    if self._is_noise_commit(subject):
                        continue
                    commits.append({
                        "hash": parts[0].strip()[:12],
                        "subject": subject,
                        "body": parts[2].strip() if len(parts) > 2 else "",
                        "author": parts[3].strip() if len(parts) > 3 else "",
                        "date": parts[4].strip() if len(parts) > 4 else ""
                    })

            logger.info(f"📝 Extracted {len(commits)} meaningful commits (filtered from {max_commits} max)")
            return commits

        except subprocess.TimeoutExpired:
            logger.warning("git log timed out after 30s")
            return []
        except FileNotFoundError:
            logger.warning("git command not found")
            return []
        except Exception as e:
            logger.warning(f"Failed to extract git commits: {e}")
            return []

    def _format_commits_for_prompt(self, commits: List[Dict[str, str]]) -> str:
        """Format commits into readable text for AI prompt."""
        parts = []
        for c in commits:
            entry = f"[{c['date']}] {c['hash']} - {c['subject']}"
            if c.get("body"):
                body_clean = c["body"].replace("\n", " ").strip()[:200]
                if body_clean:
                    entry += f"\n  {body_clean}"
            parts.append(entry)
        return "\n".join(parts)

    async def _analyze_git_commits(
        self,
        commits: List[Dict[str, str]],
        stack_info: Dict,
        project_id: Optional[UUID] = None
    ) -> List[str]:
        """
        Use AI to extract business rules from git commit messages.

        PROMPT #184 - Follows same pattern as _analyze_phase().
        """
        if not commits:
            return []

        commit_text = self._format_commits_for_prompt(commits)

        try:
            from app.contracts.loader import ContractLoader
            loader = ContractLoader()

            system_prompt, user_prompt = loader.render(
                "memory/git_commit_analysis",
                {
                    "folder_name": self.current_folder_name,
                    "commit_log": commit_text,
                    "total_commits": len(commits),
                    "stack_detected": stack_info.get("detected_stack", "")
                }
            )

            response = await self.orchestrator.execute(
                usage_type="memory",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                project_id=project_id,
                metadata={
                    "phase": "git_commit_analysis",
                    "commits_count": len(commits),
                    "scan_type": "memory_scan_git_commits",
                    "scan_depth": self.current_scan_depth
                }
            )

            result = self._parse_phase_response(response.get("content", "{}"))
            rules = result.get("business_rules_found", [])
            logger.info(f"📝 AI extracted {len(rules)} business rules from git commits")
            return rules

        except Exception as e:
            logger.warning(f"Git commit AI analysis failed: {e}")
            return []

    def _score_phase_confidence(self, result: Dict) -> int:
        """
        PROMPT #230 - Score the quality of a phase analysis result.

        Returns 0-100 confidence score. Used to decide if a larger model
        should be used for re-analysis.
        """
        score = 0
        if result.get("partial_title"):
            score += 20
        rules = result.get("business_rules_found", [])
        if len(rules) >= 3:
            score += 30
        elif len(rules) >= 1:
            score += 15
        features = result.get("features_found", [])
        if len(features) >= 3:
            score += 20
        elif len(features) >= 1:
            score += 10
        if result.get("entities_found"):
            score += 15
        if result.get("insights") and len(result.get("insights", "")) > 20:
            score += 15
        return score

    def _rerank_samples_for_phase(self, samples: List[Dict], phase_name: str) -> List[Dict]:
        """
        PROMPT #230 - Rerank code samples by relevance to the current phase.

        Uses symbol extraction keywords for fast local reranking (no AI).
        """
        phase_keywords = {
            "documentation": {"readme", "config", "package", "composer", "setup", "install", "docker"},
            "domain": {"model", "entity", "migration", "schema", "domain", "table", "column", "relationship"},
            "logic": {"service", "controller", "handler", "usecase", "validator", "middleware", "policy", "guard"},
            "quick_scan": set(),  # No reranking for quick scan
        }
        keywords = phase_keywords.get(phase_name, set())
        if not keywords:
            return samples

        def phase_score(sample: Dict) -> float:
            filename = sample.get("filename", "").lower()
            content = sample.get("content", "").lower()[:2000]
            score = 0.0
            for kw in keywords:
                if kw in filename:
                    score += 3.0
                if kw in content:
                    score += 1.0
            return score

        return sorted(samples, key=phase_score, reverse=True)

    async def _analyze_phase(
        self,
        phase_name: str,
        samples: List[Dict],
        stack_info: Dict,
        project_id: Optional[UUID],
        previous_context: Optional[Dict] = None
    ) -> Dict:
        """
        Execute one phase of analysis using externalized YAML prompt.

        PROMPT #163 - Each phase saves a prompt to the prompts table.
        PROMPT #230 - Symbol extraction, confidence scoring, reranking.
        """
        if not samples:
            logger.info(f"⏭️ Skipping phase '{phase_name}' - no samples")
            return {
                "partial_title": "",
                "business_rules_found": [],
                "features_found": [],
                "entities_found": [],
                "insights": f"No files found for {phase_name} phase"
            }

        # PROMPT #230 - Rerank samples for this specific phase
        samples = self._rerank_samples_for_phase(samples, phase_name)

        logger.info(f"🔄 Starting phase: {phase_name} ({len(samples)} files)")

        try:
            # Load contract from YAML (PROMPT #164 - Use ContractLoader)
            from app.contracts.loader import ContractLoader
            loader = ContractLoader()

            # PROMPT #230 - Use symbol extraction for code samples
            code_content = self._format_samples_for_prompt(samples, use_symbols=True)
            previous_analysis = json.dumps(previous_context, ensure_ascii=False) if previous_context else None

            system_prompt, user_prompt = loader.render(
                "memory/codebase_analysis",
                {
                    "folder_name": self.current_folder_name,
                    "phase_name": phase_name,
                    "code_content": code_content,
                    "previous_analysis": previous_analysis,
                    "stack_detected": stack_info.get("detected_stack", "")
                }
            )

            # Execute with project_id to save prompt to database
            response = await self.orchestrator.execute(
                usage_type="memory",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                project_id=project_id,
                metadata={
                    "phase": phase_name,
                    "files_count": len(samples),
                    "scan_type": "memory_scan_phase",
                    "scan_depth": self.current_scan_depth
                }
            )

            result = self._parse_phase_response(response.get("content", "{}"))

            # PROMPT #230 - Score confidence and decide if fallback needed
            confidence = self._score_phase_confidence(result)
            logger.info(f"📊 Phase '{phase_name}' confidence: {confidence}/100")

            if confidence >= 30:
                logger.info(f"✅ Completed phase: {phase_name} - found {len(result.get('business_rules_found', []))} rules (confidence: {confidence})")
                return result

            # PROMPT #230 - Low confidence: retry with force_fallback to escalate model
            logger.warning(f"⚠️ Phase '{phase_name}' low confidence ({confidence}), retrying with fallback model...")
            smaller_samples = samples[:max(5, len(samples) // 2)]
            code_content = self._format_samples_for_prompt(smaller_samples, use_symbols=True)
            system_prompt, user_prompt = loader.render(
                "memory/codebase_analysis",
                {
                    "folder_name": self.current_folder_name,
                    "phase_name": phase_name,
                    "code_content": code_content,
                    "previous_analysis": previous_analysis,
                    "stack_detected": stack_info.get("detected_stack", "")
                }
            )
            response = await self.orchestrator.execute(
                usage_type="memory",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                project_id=project_id,
                metadata={
                    "phase": f"{phase_name}_fallback",
                    "files_count": len(smaller_samples),
                    "scan_type": "memory_scan_phase_fallback",
                    "scan_depth": self.current_scan_depth,
                    "confidence_original": confidence
                }
            )
            fallback_result = self._parse_phase_response(response.get("content", "{}"))
            fallback_confidence = self._score_phase_confidence(fallback_result)

            # Use whichever result is better
            if fallback_confidence > confidence:
                logger.info(f"✅ Fallback improved confidence: {confidence} -> {fallback_confidence}")
                return fallback_result

            logger.info(f"✅ Completed phase: {phase_name} - found {len(result.get('business_rules_found', []))} rules")
            return result

        except Exception as e:
            logger.error(f"❌ Phase '{phase_name}' failed: {e}")
            # Fallback to legacy analysis for this phase
            return {
                "partial_title": "",
                "business_rules_found": [],
                "features_found": [],
                "entities_found": [],
                "insights": f"Phase {phase_name} failed: {str(e)}"
            }

    async def _consolidate_phases(
        self,
        all_phases: Dict,
        stack_info: Dict,
        project_id: Optional[UUID],
        total_files: int
    ) -> Dict:
        """
        Consolidate all phase results into final analysis.

        PROMPT #163 - Uses externalized YAML prompt for consolidation.
        """
        logger.info("🔄 Starting consolidation phase...")

        try:
            # PROMPT #164 - Use ContractLoader
            from app.contracts.loader import ContractLoader
            loader = ContractLoader()

            # Format all phases for the consolidation prompt
            all_phases_text = json.dumps(all_phases, ensure_ascii=False, indent=2)

            system_prompt, user_prompt = loader.render(
                "memory/consolidation",
                {
                    "all_phases": all_phases_text,
                    "folder_name": self.current_folder_name,
                    "stack_info": json.dumps(stack_info),
                    "total_files_analyzed": total_files
                }
            )

            response = await self.orchestrator.execute(
                usage_type="memory",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                project_id=project_id,
                metadata={
                    "phase": "consolidation",
                    "scan_type": "memory_scan_consolidation",
                    "scan_depth": self.current_scan_depth,
                    "total_phases": len(all_phases)
                }
            )

            content = response.get("content", "{}")

            # PROMPT #230 - Use robust JSON autocorrection
            from app.services.utility_node_executor import UtilityNodeExecutor
            parsed = UtilityNodeExecutor._try_parse_json(content.strip(), auto_repair=True)
            if parsed and isinstance(parsed, dict):
                logger.info(f"✅ Consolidation complete - Title: {parsed.get('suggested_title', 'N/A')}")
                return parsed

            logger.warning("Consolidation returned invalid JSON, using merge fallback")
            return self._merge_phase_results(all_phases, stack_info)

        except Exception as e:
            logger.error(f"❌ Consolidation failed: {e}")
            return self._merge_phase_results(all_phases, stack_info)

    def _merge_phase_results(self, all_phases: Dict, stack_info: Dict) -> Dict:
        """Merge results from all phases without AI consolidation (fallback)."""
        all_rules = []
        all_features = []
        all_entities = []
        best_title = ""

        for phase_name, phase_data in all_phases.items():
            if isinstance(phase_data, dict):
                all_rules.extend(phase_data.get("business_rules_found", []))
                all_features.extend(phase_data.get("features_found", []))
                all_entities.extend(phase_data.get("entities_found", []))
                if phase_data.get("partial_title") and not best_title:
                    best_title = phase_data.get("partial_title")

        # Deduplicate
        all_rules = list(dict.fromkeys(all_rules))
        all_features = list(dict.fromkeys(all_features))
        all_entities = list(dict.fromkeys(all_entities))

        # PROMPT #165 - Validate and improve title
        final_title = self._validate_title(best_title, self.current_folder_name, stack_info) if best_title else self._generate_fallback_title(stack_info, self.current_folder_name)

        # PROMPT #266 - Increased limits to avoid losing extracted data
        return {
            "suggested_title": final_title,
            "business_rules": all_rules[:200],
            "key_features": all_features[:50],
            "entities": all_entities[:50],
            "interview_context": f"Este projeto foi analisado em múltiplas fases. Foram encontradas {len(all_rules)} regras de negócio e {len(all_features)} funcionalidades."
        }

    async def _ai_analyze_codebase_phased(
        self,
        code_samples: List[Dict[str, str]],
        stack_info: Dict,
        scan_summary: Dict,
        root_path: Path,
        project_id: Optional[UUID] = None,
        scan_depth: ScanDepth = "normal"
    ) -> Dict[str, Any]:
        """
        Perform multi-phase AI analysis of codebase.

        PROMPT #163 - Main method for phased analysis.
        Each phase focuses on a different aspect of the codebase.

        Args:
            code_samples: List of code sample dicts
            stack_info: Stack detection results
            scan_summary: Scan statistics
            root_path: Root path of the codebase
            project_id: Optional project ID (for saving prompts)
            scan_depth: Depth of analysis

        Returns:
            Dict with consolidated AI analysis results
        """
        config = self.SCAN_DEPTH_CONFIG.get(scan_depth, self.SCAN_DEPTH_CONFIG["normal"])
        phases_completed = 0
        all_phases = {}

        if scan_depth == "quick":
            # Quick mode: 2 phases only
            # Phase 1: Documentation
            doc_samples = [s for s in code_samples if s["type"] in ["documentation", "configuration"]]
            all_phases["documentation"] = await self._analyze_phase(
                "documentation", doc_samples, stack_info, project_id
            )
            phases_completed += 1

            # Phase 2: Quick scan of code
            code_only = [s for s in code_samples if s["type"] == "code"][:15]
            all_phases["quick_scan"] = await self._analyze_phase(
                "quick_scan", code_only, stack_info, project_id,
                previous_context=all_phases.get("documentation")
            )
            phases_completed += 1

        elif scan_depth == "normal":
            # Normal mode: 3 phases (documentation + domain parallel, then logic)
            # PROMPT #230 - Parallel execution: doc + domain have no dependency
            doc_samples = [s for s in code_samples if s["type"] in ["documentation", "configuration"]]
            domain_samples = [s for s in code_samples if self._is_domain_file(s["filename"])][:25]

            logger.info("🚀 Running documentation + domain phases in parallel...")
            doc_result, domain_result = await asyncio.gather(
                self._analyze_phase("documentation", doc_samples, stack_info, project_id),
                self._analyze_phase("domain", domain_samples, stack_info, project_id),
            )
            all_phases["documentation"] = doc_result
            all_phases["domain"] = domain_result
            phases_completed += 2

            # Logic depends on domain (needs previous_context) - runs after
            logic_samples = [s for s in code_samples if self._is_logic_file(s["filename"])][:25]
            all_phases["logic"] = await self._analyze_phase(
                "logic", logic_samples, stack_info, project_id,
                previous_context=all_phases.get("domain")
            )
            phases_completed += 1

        elif scan_depth == "local":
            # PROMPT #167 - Chain Prompting for local models (Ollama/Qwen)
            # Instead of one big prompt, use multiple small prompts sequentially
            logger.info("🔗 Using Chain Prompting strategy for local model")

            all_phases = await self._chain_prompting_analysis(
                code_samples, stack_info, project_id
            )
            phases_completed = len(all_phases)

            # Skip consolidation - chain prompting already produces final result
            if "final" in all_phases:
                consolidated = all_phases["final"]
                consolidated["phases_completed"] = phases_completed
                return consolidated

        else:  # deep mode
            # Deep mode: Dynamic phases based on file count
            # Phase 1: Documentation (always)
            doc_samples = [s for s in code_samples if s["type"] in ["documentation", "configuration"]]
            all_phases["documentation"] = await self._analyze_phase(
                "documentation", doc_samples, stack_info, project_id
            )
            phases_completed += 1

            # Get all code files
            code_only = [s for s in code_samples if s["type"] == "code"]
            files_per_phase = config.get("files_per_phase", 15)

            # Create dynamic phases for all code files
            previous_ctx = all_phases.get("documentation")
            phase_num = 2

            for i in range(0, len(code_only), files_per_phase):
                batch = code_only[i:i + files_per_phase]

                # Determine batch type
                domain_count = sum(1 for s in batch if self._is_domain_file(s["filename"]))
                logic_count = sum(1 for s in batch if self._is_logic_file(s["filename"]))

                if domain_count > logic_count:
                    batch_type = "domain"
                elif logic_count > 0:
                    batch_type = "logic"
                else:
                    batch_type = "code"

                phase_name = f"batch_{phase_num}_{batch_type}"
                all_phases[phase_name] = await self._analyze_phase(
                    batch_type, batch, stack_info, project_id,
                    previous_context=previous_ctx
                )
                previous_ctx = all_phases[phase_name]
                phases_completed += 1
                phase_num += 1

        # Final phase: Consolidation
        consolidated = await self._consolidate_phases(
            all_phases, stack_info, project_id, len(code_samples)
        )
        phases_completed += 1

        # Add phases_completed to result
        consolidated["phases_completed"] = phases_completed

        return consolidated

    # =========================================================================
    # PROMPT #167 - Chain Prompting for Local Models
    # =========================================================================

    async def _chain_prompting_analysis(
        self,
        code_samples: List[Dict[str, str]],
        stack_info: Dict,
        project_id: Optional[UUID] = None
    ) -> Dict[str, Any]:
        """
        PROMPT #167 - Chain Prompting strategy for local models (Ollama/Qwen).

        Instead of sending one massive prompt with all code, we:
        1. Ask about each file individually (small prompts)
        2. Collect insights from each file
        3. Consolidate with a final small prompt

        This works much better with 7B models that have context limits.
        """
        all_phases = {}
        file_insights = []

        # PROMPT #236 - Proportional file limit: analyze ~50% of available files
        # (min 5, max 25) instead of hardcoded 5. For 30 files = 15 analyzed.
        available_count = len(code_samples)
        max_files = max(5, min(25, available_count * 50 // 100))

        logger.info(f"🔗 Chain Prompting: Analyzing {max_files}/{available_count} files individually")

        # PROMPT #168 - Console logging for chain prompting
        console = get_console_logger()
        total_files = min(len(code_samples), max_files)

        # Step 1: Analyze each file with a VERY simple prompt
        for i, sample in enumerate(code_samples[:max_files]):
            filename = sample.get("filename", f"file_{i}")
            content = sample.get("content", "")[:2000]  # Max 2K per file

            # Progress: 50-80% for file analysis (30% spread across files)
            progress = 50 + (i / total_files) * 30
            logger.info(f"   Analyzing file {i+1}/{total_files}: {filename}")

            asyncio.create_task(console.log_memory_scan(
                phase=f"file_{i+1}/{total_files}",
                message=f"Analyzing: {filename} ({i+1}/{total_files})",
                files_processed=i+1,
                project_id=str(project_id) if project_id else None
            ))

            try:
                insight = await self._chain_analyze_single_file(
                    filename, content, project_id, i+1
                )
                if insight:
                    file_insights.append(insight)
                    all_phases[f"file_{i+1}"] = insight
            except Exception as e:
                logger.warning(f"   ⚠️ Failed to analyze {filename}: {e}")
                continue

        # Step 2: If we got insights, consolidate them
        if file_insights:
            logger.info(f"🔗 Chain Prompting: Consolidating {len(file_insights)} file insights")
            final_result = await self._chain_consolidate_insights(
                file_insights, stack_info, project_id
            )
            all_phases["final"] = final_result
        else:
            # Fallback if no insights were collected
            logger.warning("⚠️ Chain Prompting: No insights collected, using fallback")
            all_phases["final"] = {
                "suggested_title": self._generate_fallback_title(stack_info, self.current_folder_name),
                "business_rules": [],
                "key_features": [],
                "entities": [],
                "interview_context": f"Este projeto usa {stack_info.get('detected_stack', 'tecnologia desconhecida')}."
            }

        return all_phases

    async def _chain_analyze_single_file(
        self,
        filename: str,
        content: str,
        project_id: Optional[UUID],
        file_num: int
    ) -> Optional[Dict]:
        """
        PROMPT #167 - Analyze a single file with a tiny prompt.
        PROMPT #230 - Uses symbol extraction instead of raw code.
        PROMPT #284 - Returns structured JSON with extracted rules and features.

        Returns dict with filename, analysis, business_rules, features, entities.
        """
        # PROMPT #230 - Extract symbols instead of sending raw code
        try:
            symbols = extract_symbols(filename, content)
            symbol_text = format_symbol_map(symbols)
        except Exception:
            symbol_text = content[:1500]

        system_prompt = "Você é um analista de código. Responda APENAS em JSON válido, sem markdown. IDIOMA: português brasileiro."

        user_prompt = f"""Arquivo: {filename}

{symbol_text}

Análise este arquivo e responda em JSON:
{{
  "purpose": "O que este arquivo faz (1 frase)",
  "business_rules": ["regra1", "regra2"],
  "features": ["funcionalidade1"],
  "entities": ["entidade1"],
  "system_hint": ""
}}

REGRAS:
- business_rules: validacoes, restricoes, calculos, permissoes, fluxos de negocio encontrados. Liste TODAS que encontrar. Se nenhuma, lista vazia.
- features: funcionalidades que o arquivo implementa (ex: "autenticação JWT", "upload de arquivos")
- entities: modelos/tabelas/dados principais (ex: "Usuário", "Pedido", "Produto")
- system_hint: se encontrar <title>XXX</title> ou dominio .gov.br/.com.br, escreva aqui
- TUDO em português brasileiro"""

        try:
            response = await asyncio.wait_for(
                self.orchestrator.execute(
                    usage_type="memory",
                    messages=[{"role": "user", "content": user_prompt}],
                    system_prompt=system_prompt,
                    max_tokens=400,
                    project_id=project_id,
                    metadata={
                        "phase": f"chain_file_{file_num}",
                        "scan_type": "chain_prompting",
                        "filename": filename
                    }
                ),
                timeout=300.0
            )

            text = response.get("content", "").strip()
            if not text:
                return None

            # Try to parse JSON response
            from app.services.utility_node_executor import UtilityNodeExecutor
            parsed = UtilityNodeExecutor._try_parse_json(text, auto_repair=True)

            if parsed and isinstance(parsed, dict):
                return {
                    "filename": filename,
                    "analysis": parsed.get("purpose", text),
                    "business_rules": parsed.get("business_rules", []),
                    "features": parsed.get("features", []),
                    "entities": parsed.get("entities", []),
                    "system_hint": parsed.get("system_hint", "")
                }

            # Fallback: treat as plain text analysis
            return {
                "filename": filename,
                "analysis": text,
                "business_rules": [],
                "features": [],
                "entities": [],
                "system_hint": ""
            }

        except asyncio.TimeoutError:
            logger.warning(f"Timeout analyzing {filename} (>5min), skipping...")
            return None
        except Exception as e:
            logger.warning(f"Chain analyze failed for {filename}: {e}")
            return None

    async def _chain_consolidate_insights(
        self,
        file_insights: List[Dict],
        stack_info: Dict,
        project_id: Optional[UUID]
    ) -> Dict:
        """
        PROMPT #167 - Consolidate file insights into final result.
        PROMPT #284 - Aggregates structured rules/features from each file first,
        then uses AI to deduplicate, organize, and generate title + context.
        """
        # PROMPT #284 - Aggregate rules, features, entities from all file insights
        all_rules = []
        all_features = []
        all_entities = []
        system_hints = []
        summaries = []

        for insight in file_insights:
            # Collect structured data from each file
            for rule in insight.get("business_rules", []):
                if rule and isinstance(rule, str) and rule.lower() not in ("nenhuma", "nenhum", "none", "n/a", ""):
                    all_rules.append(rule)
            for feat in insight.get("features", []):
                if feat and isinstance(feat, str) and feat.lower() not in ("nenhuma", "nenhum", "none", "n/a", ""):
                    all_features.append(feat)
            for ent in insight.get("entities", []):
                if ent and isinstance(ent, str) and ent.lower() not in ("nenhuma", "nenhum", "none", "n/a", ""):
                    all_entities.append(ent)
            hint = insight.get("system_hint", "")
            if hint and hint.lower() not in ("", "nenhum", "nenhuma", "none"):
                system_hints.append(hint)
            summaries.append(f"- {insight['filename']}: {insight.get('analysis', '')}")

        # Deduplicate (case-insensitive)
        seen_rules = set()
        unique_rules = []
        for r in all_rules:
            key = r.lower().strip()
            if key not in seen_rules:
                seen_rules.add(key)
                unique_rules.append(r)

        seen_features = set()
        unique_features = []
        for f in all_features:
            key = f.lower().strip()
            if key not in seen_features:
                seen_features.add(key)
                unique_features.append(f)

        seen_entities = set()
        unique_entities = []
        for e in all_entities:
            key = e.lower().strip()
            if key not in seen_entities:
                seen_entities.add(key)
                unique_entities.append(e)

        logger.info(
            f"Chain aggregation: {len(unique_rules)} rules, "
            f"{len(unique_features)} features, {len(unique_entities)} entities "
            f"from {len(file_insights)} files"
        )

        stack_name = stack_info.get("detected_stack", "desconhecida")

        # Build context for consolidation prompt
        rules_text = "\n".join([f"  - {r}" for r in unique_rules[:30]]) if unique_rules else "  Nenhuma regra encontrada"
        features_text = "\n".join([f"  - {f}" for f in unique_features[:20]]) if unique_features else "  Nenhuma feature encontrada"
        entities_text = ", ".join(unique_entities[:15]) if unique_entities else "Nenhuma"
        hints_text = "\n".join([f"  - {h}" for h in system_hints]) if system_hints else ""
        summaries_text = "\n".join(summaries[:15])

        system_prompt = "Você é um arquiteto de software. Responda APENAS em JSON válido, sem markdown. IDIOMA OBRIGATÓRIO: Todo o conteúdo DEVE ser em português brasileiro."

        user_prompt = f"""Pasta do projeto: {self.current_folder_name}
Stack: {stack_name}

REGRAS DE NEGOCIO EXTRAIDAS DOS ARQUIVOS:
{rules_text}

FUNCIONALIDADES ENCONTRADAS:
{features_text}

ENTIDADES: {entities_text}

RESUMO DOS ARQUIVOS:
{summaries_text}
{f"DICAS DE SISTEMA: {chr(10).join(system_hints)}" if hints_text else ""}

Com base nessas informações REAIS extraidas do código, gere o JSON final:
{{
  "suggested_title": "Título descritivo do sistema (5-8 palavras)",
  "business_rules": ["lista COMPLETA de regras de negocio - inclua TODAS as regras acima + adicione se encontrar mais"],
  "key_features": ["lista COMPLETA de funcionalidades - inclua TODAS acima + adicione se encontrar mais"],
  "entities": ["lista de entidades/modelos principais"],
  "interview_context": "Paragrafo de 100-200 palavras descrevendo o proposito, stack, funcionalidades e regras principais do sistema"
}}

INSTRUÇÕES:
1. MANTENHA todas as regras e features ja extraidas - NÃO descarte nenhuma
2. Se possível, adicione mais regras inferidas dos resumos dos arquivos
3. interview_context deve ser um texto RICO e DETALHADO, não apenas 1 frase
4. Título deve refletir o dominio do negocio, NÃO a tecnologia
5. TUDO em português brasileiro"""

        try:
            response = await self.orchestrator.execute(
                usage_type="memory",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=2000,
                project_id=project_id,
                metadata={
                    "phase": "chain_consolidation",
                    "scan_type": "chain_prompting",
                    "files_analyzed": len(file_insights),
                    "rules_pre_aggregated": len(unique_rules),
                    "features_pre_aggregated": len(unique_features)
                }
            )

            content = response.get("content", "{}")

            from app.services.utility_node_executor import UtilityNodeExecutor
            result = UtilityNodeExecutor._try_parse_json(content.strip(), auto_repair=True)
            if not result or not isinstance(result, dict):
                result = {}

            # Ensure we don't lose pre-aggregated data if AI returned less
            ai_rules = result.get("business_rules", [])
            ai_features = result.get("key_features", [])
            ai_entities = result.get("entities", [])

            # Merge: AI result + pre-aggregated (deduplicated)
            if len(ai_rules) < len(unique_rules):
                merged_rules = list(ai_rules)
                existing_lower = {r.lower().strip() for r in merged_rules}
                for r in unique_rules:
                    if r.lower().strip() not in existing_lower:
                        merged_rules.append(r)
                        existing_lower.add(r.lower().strip())
                result["business_rules"] = merged_rules

            if len(ai_features) < len(unique_features):
                merged_features = list(ai_features)
                existing_lower = {f.lower().strip() for f in merged_features}
                for f in unique_features:
                    if f.lower().strip() not in existing_lower:
                        merged_features.append(f)
                        existing_lower.add(f.lower().strip())
                result["key_features"] = merged_features

            if len(ai_entities) < len(unique_entities):
                merged_entities = list(ai_entities)
                existing_lower = {e.lower().strip() for e in merged_entities}
                for e in unique_entities:
                    if e.lower().strip() not in existing_lower:
                        merged_entities.append(e)
                        existing_lower.add(e.lower().strip())
                result["entities"] = merged_entities

            # Validate title
            title = result.get("suggested_title", "")
            result["suggested_title"] = self._validate_title(title, self.current_folder_name, stack_info)

            logger.info(
                f"Chain Prompting complete - Title: {result.get('suggested_title')}, "
                f"Rules: {len(result.get('business_rules', []))}, "
                f"Features: {len(result.get('key_features', []))}"
            )
            return result

        except Exception as e:
            logger.error(f"Chain consolidation failed: {e}")
            # Fallback: use pre-aggregated data directly
            return {
                "suggested_title": self._generate_fallback_title(stack_info, self.current_folder_name),
                "business_rules": unique_rules[:20],
                "key_features": unique_features[:15],
                "entities": unique_entities[:10],
                "interview_context": f"Sistema {stack_name} com {len(file_insights)} arquivos analisados. "
                    f"Regras identificadas: {', '.join(unique_rules[:5])}. "
                    f"Funcionalidades: {', '.join(unique_features[:5])}."
            }

    # =========================================================================
    # Legacy method (kept for backwards compatibility)
    # =========================================================================

    async def _ai_analyze_codebase(
        self,
        code_samples: List[Dict[str, str]],
        stack_info: Dict,
        scan_summary: Dict,
        root_path: Optional[Path] = None  # PROMPT #118 FIX - Added for folder name
    ) -> Dict[str, Any]:
        """
        Use AI to analyze codebase and extract insights.

        Args:
            code_samples: List of code sample dicts
            stack_info: Stack detection results
            scan_summary: Scan statistics
            root_path: Root path of the codebase (for folder name)

        Returns:
            Dict with AI analysis results
        """
        # Build context for AI
        context_parts = []

        # Stack info
        if stack_info.get("detected_stack"):
            context_parts.append(
                f"Detected Technology Stack: {stack_info['detected_stack']} "
                f"({stack_info.get('description', '')})"
            )
            context_parts.append(f"Confidence: {stack_info.get('confidence', 0)}%")

        # Scan summary
        context_parts.append(f"\nCodebase Statistics:")
        context_parts.append(f"- Total files: {scan_summary.get('total_files', 0)}")
        context_parts.append(f"- Code files: {scan_summary.get('code_files', 0)}")

        languages = scan_summary.get("languages", {})
        if languages:
            lang_str = ", ".join([f"{k}: {v}" for k, v in languages.items()])
            context_parts.append(f"- Languages: {lang_str}")

        # Code samples
        context_parts.append("\n\n--- CODE SAMPLES ---\n")
        for sample in code_samples:
            context_parts.append(f"\n### File: {sample['filename']} ({sample['type']})")
            context_parts.append("```")
            context_parts.append(sample["content"])
            context_parts.append("```\n")

        full_context = "\n".join(context_parts)

        # PROMPT #118 FIX - Build comprehensive system prompt for deep analysis
        # Get folder name for better title suggestion
        folder_name = root_path.name if root_path else (
            Path(code_samples[0]["filename"]).parts[0] if code_samples else "Projeto"
        )

        system_prompt = f"""Você é um arquiteto de software especialista analisando uma base de código.
Sua tarefa é EXTRAIR PROFUNDAMENTE as regras de negócio e entender o propósito do sistema.

## O QUE VOCÊ DEVE FAZER:

1. **Sugerir um Título de Projeto**:
   - Baseie-se no DOMÍNIO e PROPÓSITO do sistema, NÃO na tecnologia
   - O nome da pasta é "{folder_name}" - use isso como pista do domínio
   - Exemplos BONS: "Sistema de Gestão Financeira", "Controle de Contas a Pagar/Receber", "Plataforma de Vendas"
   - Exemplos RUINS: "Laravel Project", "PHP Application", "Sistema Web"

2. **Extrair Regras de Negócio** (MÍNIMO 5-10 regras):
   Análise CADA arquivo de código e extraia regras como:
   - Validações de dados (ex: "CPF deve ser válido", "Valor mínimo de R$ 10")
   - Restrições de acesso (ex: "Apenas admin pode excluir", "Usuário só vê seus próprios dados")
   - Cálculos e fórmulas (ex: "Desconto de 10% para pagamento à vista", "Juros de 2% ao mês")
   - Estados e transições (ex: "Pedido pode ser cancelado apenas se não foi enviado")
   - Relacionamentos obrigatórios (ex: "Toda venda deve ter um cliente")
   - Limites e constraints (ex: "Máximo de 5 parcelas", "Prazo máximo de 30 dias")

3. **Identificar Funcionalidades Principais** (MÍNIMO 5-8 features):
   - Liste os módulos/funcionalidades que o sistema oferece
   - Seja específico: "Cadastro de clientes com histórico de compras" ao invés de "CRUD de clientes"

4. **Preparar Contexto para Entrevista**:
   - Escreva um PARÁGRAFO DETALHADO (mínimo 200 palavras) explicando:
     - O que o sistema faz
     - Para quem ele foi feito (público-alvo)
     - Quais problemas ele resolve
     - Quais são as principais entidades/conceitos do domínio
     - Pontos que precisam de mais esclarecimento

## COMO IDENTIFICAR REGRAS DE NEGÓCIO NO CÓDIGO:

### Em Migrations/Schema:
- Campos required/nullable = obrigatoriedade
- Foreign keys = relacionamentos
- Unique constraints = unicidade
- Default values = valores padrão do negócio

### Em Models/Entities:
- Relacionamentos = regras de associação
- Scopes/Queries = filtros de negócio
- Mutators/Accessors = transformações de dados
- Casts/Formatters = tipos de dados do domínio

### Em Controllers/Services:
- Validações = regras de entrada
- Condicionais (if/else) = regras de fluxo
- Cálculos = fórmulas de negócio
- Status/Estados = ciclo de vida de entidades

### Em Validators/Requests:
- Required fields = campos obrigatórios
- Rules = validações específicas do domínio
- Messages = regras traduzidas para usuário

### Em Middleware/Policies:
- Verificações de permissão = regras de acesso
- Verificações de estado = pré-condições

## FORMATO DE RESPOSTA (JSON):
{{
    "suggested_title": "Nome Descritivo do Sistema (baseado no domínio, não na tecnologia)",
    "business_rules": [
        "Regra 1: Descrição clara da regra de negócio encontrada no código",
        "Regra 2: Outra regra de negócio...",
        "... (mínimo 5-10 regras)"
    ],
    "key_features": [
        "Funcionalidade 1: Descrição do que faz",
        "Funcionalidade 2: Descrição do que faz",
        "... (mínimo 5-8 funcionalidades)"
    ],
    "interview_context": "Parágrafo detalhado (mínimo 200 palavras) explicando o sistema, seu propósito, público-alvo, problemas que resolve, entidades principais e pontos que precisam de esclarecimento para a entrevista de contexto..."
}}

IMPORTANTE: Seja PROFUNDO e DETALHADO. Uma análise superficial não serve. Extraia TODO o conhecimento possível do código."""

        try:
            # Use "memory" usage_type if configured, otherwise fall back to "general"
            # PROMPT #122 FIX - Removed hardcoded max_tokens to use model's config
            # (Cohere has max 4096, was causing 400 error with hardcoded 8000)
            response = await self.orchestrator.execute(
                usage_type="memory",
                messages=[{"role": "user", "content": full_context}],
                system_prompt=system_prompt
                # max_tokens now comes from ai_models.config
            )

            # PROMPT #230 - Use robust JSON autocorrection
            content = response.get("content", "{}")
            from app.services.utility_node_executor import UtilityNodeExecutor
            result = UtilityNodeExecutor._try_parse_json(content.strip(), auto_repair=True)
            if not result or not isinstance(result, dict):
                result = {}

            return {
                "suggested_title": result.get("suggested_title", ""),
                "business_rules": result.get("business_rules", []),
                "key_features": result.get("key_features", []),
                "interview_context": result.get("interview_context", "")
            }

        except Exception as e:
            logger.error(f"AI analysis failed: {e}")
            # PROMPT #118 FIX - Return fallback based on folder name and stack detection
            return {
                "suggested_title": self._generate_fallback_title(stack_info, folder_name),
                "business_rules": [],
                "key_features": [],
                "interview_context": f"Este projeto parece ser um sistema {stack_info.get('detected_stack', 'de software')}. A análise automática não conseguiu extrair detalhes específicos do código. Recomenda-se explorar manualmente as funcionalidades durante a entrevista de contexto."
            }

    def _validate_title(self, title: str, folder_name: str, stack_info: Dict) -> str:
        """
        PROMPT #165 - Validate title to avoid generic fallbacks.
        PROMPT #169 - Improved validation to reject "Sistema de X" patterns.

        Ensures title is:
        - At least 4 words long (more descriptive)
        - Not just folder name or technology name
        - Not generic "Sistema de X" pattern
        - Descriptive of the system's purpose
        """
        if not title:
            return self._generate_fallback_title(stack_info, folder_name)

        # Clean the title
        title = title.strip()

        # Check if too short (less than 4 words for better descriptions)
        words = title.split()
        if len(words) < 4:
            logger.warning(f"⚠️ Title too short ({len(words)} words): '{title}'")
            # Try to expand with stack info
            stack = stack_info.get("detected_stack", "")
            if stack and len(words) >= 2:
                return f"{title} - Aplicação {stack.title()}"
            return self._generate_fallback_title(stack_info, folder_name)

        # Check if it's just the folder name
        clean_folder = folder_name.replace("-", " ").replace("_", " ").lower()
        if title.lower() == f"sistema {clean_folder}" or title.lower() == f"sistema de {clean_folder}":
            logger.warning(f"⚠️ Title is just folder name: '{title}'")
            # This is too generic - try to add context from stack
            stack = stack_info.get("detected_stack", "")
            if stack:
                return f"{title} - Aplicação {stack.title()}"
            return title

        # Check for generic "Sistema de X" patterns (only 3 words)
        title_lower = title.lower()
        if title_lower.startswith("sistema de ") and len(words) <= 3:
            logger.warning(f"⚠️ Title is generic 'Sistema de X': '{title}'")
            stack = stack_info.get("detected_stack", "")
            if stack:
                return f"{title} - Aplicação {stack.title()}"
            return title

        # Check for generic patterns
        generic_patterns = [
            "sistema sistema", "projeto projeto",
            "laravel project", "php application",
            "react app", "node project"
        ]
        if title_lower in generic_patterns:
            return self._generate_fallback_title(stack_info, folder_name)

        return title

    def _generate_fallback_title(self, stack_info: Dict, folder_name: str = "") -> str:
        """
        Generate fallback title based on folder name and stack detection.

        PROMPT #118 FIX - Prioritize folder name over stack name.
        PROMPT #165 - Improved to generate more descriptive titles.
        """
        # PROMPT #118 FIX - Use folder name as primary source
        if folder_name and folder_name not in {"src", "app", "project", "code", "backend", "frontend"}:
            # Clean up folder name: my-project -> My Project
            clean_name = folder_name.replace("-", " ").replace("_", " ").title()

            # PROMPT #165 - Try to make title more descriptive based on stack
            stack = stack_info.get("detected_stack", "")
            if stack:
                stack_clean = stack.replace("_", " ").title()
                # Avoid redundancy like "Sistema Contas - Aplicação Contas"
                if stack_clean.lower() not in clean_name.lower():
                    return f"Sistema {clean_name} - Aplicação {stack_clean}"

            return f"Sistema de Gestão {clean_name}"

        stack = stack_info.get("detected_stack", "")
        if stack:
            return f"Sistema {stack.replace('_', ' ').title()}"

        return "Software Project"

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

        ignore_dirs = indexer.IGNORE_DIRS

        for root, dirs, files in os.walk(root_path):
            dirs[:] = [d for d in dirs if d not in ignore_dirs]

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
