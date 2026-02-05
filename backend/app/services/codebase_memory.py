"""
Codebase Memory Service

PROMPT #118 - Initial codebase scan and memory extraction
PROMPT #163 - Multi-phase analysis with configurable depth
PROMPT #166 - Ignore irrelevant files (.gitignore, vendor, node_modules, etc.)

This service performs the first scan of a project's codebase when the code folder
is selected during project creation. It:
1. Detects the technology stack
2. Scans and indexes files for RAG (ignoring irrelevant files)
3. Uses AI to extract business rules and patterns (multi-phase for better quality)
4. Suggests a project title based on the analysis
5. Prepares relevant data for the context interview

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
from pathlib import Path
from typing import Dict, List, Optional, Any, Literal, Set
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.services.stack_detector import StackDetector
from app.services.codebase_indexer import CodebaseIndexer
from app.services.rag_service import RAGService
from app.services.ai_orchestrator import AIOrchestrator

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
        ".vue", ".svelte"
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
        # Smaller prompts to avoid timeout/memory issues with 7B models
        "local": {
            "max_files": 15,
            "max_content_per_file": 2000,  # Much smaller to fit in 32K context
            "phases": ["quick_scan"],  # Single phase for simplicity
            "files_per_phase": 10,
            "description": "Local model scan: 15 files, 1 phase (~2-5 min)"
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

        # Check if any part of the path is in IGNORE_DIRECTORIES
        for part in rel_path.parts:
            if part in self.IGNORE_DIRECTORIES:
                return True

        # Check file patterns
        for pattern in self.IGNORE_FILE_PATTERNS:
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
        # Check built-in ignore list
        if dirname in self.IGNORE_DIRECTORIES:
            return True

        # Check .gitignore patterns (directory names only)
        for pattern in self._gitignore_patterns:
            if fnmatch.fnmatch(dirname, pattern):
                return True

        return False

    async def scan_and_memorize(
        self,
        code_path: str,
        project_id: Optional[UUID] = None,
        scan_depth: ScanDepth = "normal"
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
            raise ValueError(f"Code path does not exist: {code_path}")

        if not path.is_dir():
            raise ValueError(f"Code path is not a directory: {code_path}")

        # PROMPT #163 - Store scan settings
        self.current_folder_name = path.name

        # PROMPT #166 - Load .gitignore patterns for this project
        self._gitignore_patterns = self._load_gitignore_patterns(path)
        logger.info(f"🚫 Ignoring {len(self.IGNORE_DIRECTORIES)} built-in dirs + {len(self._gitignore_patterns)} .gitignore patterns")

        # PROMPT #165 - Auto-detect local model (Ollama) and use optimized profile
        try:
            from app.models.ai_model import AIModelUsageType
            model_config = self.orchestrator.choose_model(AIModelUsageType.MEMORY)
            if model_config.get("provider") == "ollama":
                scan_depth = "local"
                logger.info(f"🦙 Detected Ollama provider, switching to 'local' scan profile for better performance")
        except Exception as e:
            logger.debug(f"Could not detect model provider: {e}")
            # Continue with original scan_depth

        self.current_scan_depth = scan_depth
        config = self.SCAN_DEPTH_CONFIG.get(scan_depth, self.SCAN_DEPTH_CONFIG["normal"])

        logger.info(f"🧠 Starting codebase memory scan for: {code_path}")
        logger.info(f"📊 Scan depth: {scan_depth} - {config['description']}")

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

        # Step 1: Detect technology stack
        logger.info("📊 Step 1: Detecting technology stack...")
        stack_info = self.stack_detector.detect(path)
        result["stack_info"] = stack_info
        logger.info(f"   Detected stack: {stack_info.get('detected_stack', 'unknown')}")

        # Step 2: Scan and collect file information
        logger.info("📂 Step 2: Scanning codebase structure...")
        scan_data = await self._scan_codebase(path)
        result["scan_summary"] = {
            "total_files": scan_data["total_files"],
            "code_files": scan_data["code_files"],
            "languages": scan_data["languages"],
            "config_files_found": scan_data["config_files"]
        }
        logger.info(f"   Found {scan_data['total_files']} files, {scan_data['code_files']} code files")

        # Step 3: Index files in RAG (if project_id provided)
        if project_id:
            logger.info("💾 Step 3: Indexing files in RAG...")
            try:
                indexer = CodebaseIndexer(self.db)
                # Create a temporary project reference for indexing
                indexing_result = await self._index_for_memory(indexer, project_id, path)
                result["files_indexed"] = indexing_result.get("files_indexed", 0)
                logger.info(f"   Indexed {result['files_indexed']} files")
            except Exception as e:
                logger.warning(f"   RAG indexing skipped: {e}")
                result["files_indexed"] = 0
        else:
            logger.info("   Skipping RAG indexing (no project_id yet)")

        # Step 4: Extract representative code samples for AI analysis
        # PROMPT #163 - Use scan_depth config for limits
        logger.info("🔍 Step 4: Extracting code samples for analysis...")
        code_samples = self._extract_code_samples(path, scan_data, config)
        logger.info(f"   Extracted {len(code_samples)} code samples")

        # Step 5: Use AI to analyze and extract insights
        # PROMPT #163 - Use multi-phase analysis for better results
        logger.info(f"🤖 Step 5: AI analysis ({scan_depth} mode)...")
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

        # Step 6: Store business rules in RAG for future reference
        if project_id and result["business_rules"]:
            logger.info("💾 Step 6: Storing business rules in RAG...")
            await self._store_business_rules(project_id, result["business_rules"])
            logger.info(f"   Stored {len(result['business_rules'])} business rules")

        logger.info("✅ Codebase memory scan complete!")
        return result

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

        # Check for route files (often contain business rules)
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

        return False

    def _extract_code_samples(
        self,
        root_path: Path,
        scan_data: Dict,
        config: Optional[Dict] = None
    ) -> List[Dict[str, str]]:
        """
        Extract representative code samples for AI analysis.

        PROMPT #163 - Now uses configurable limits from scan_depth config.
        PROMPT #166 - Respects ignore patterns (files already filtered in scan_data)

        Prioritizes:
        1. README and documentation
        2. Configuration files
        3. Key files (models, controllers)
        4. Entry points

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

        # Priority 1: README and docs
        for config_file in scan_data.get("config_files", []):
            if len(samples) >= max_files:
                break

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
                    except Exception as e:
                        logger.warning(f"Failed to read {config_file}: {e}")

        # Priority 2: Package/config files
        for config_file in scan_data.get("config_files", []):
            if len(samples) >= max_files:
                break

            if config_file.endswith((".json", ".toml", ".yml", ".yaml")):
                full_path = root_path / config_file
                if full_path.exists():
                    try:
                        content = full_path.read_text(encoding="utf-8", errors="ignore")
                        samples.append({
                            "filename": config_file,
                            "content": content[:max_content],
                            "type": "configuration"
                        })
                    except Exception as e:
                        logger.warning(f"Failed to read {config_file}: {e}")

        # Priority 3: Key files (models, controllers, services)
        key_files = scan_data.get("key_files", [])

        # Sort key files to prioritize migrations, models, then controllers
        def sort_priority(f):
            f_lower = f.lower()
            if "migration" in f_lower:
                return 0  # Highest priority - database schema = business rules
            if "model" in f_lower or "entity" in f_lower:
                return 1  # Models define domain
            if "service" in f_lower or "usecase" in f_lower:
                return 2  # Services contain logic
            if "controller" in f_lower or "handler" in f_lower:
                return 3  # Controllers have validation
            if "request" in f_lower or "validator" in f_lower:
                return 4  # Validation rules
            return 5

        key_files_sorted = sorted(key_files, key=sort_priority)

        # PROMPT #163 - For deep mode, get all key files; otherwise limit
        files_to_process = key_files_sorted if max_files == float('inf') else key_files_sorted[:int(max_files)]

        for key_file in files_to_process:
            if len(samples) >= max_files:
                break

            full_path = root_path / key_file
            if full_path.exists():
                try:
                    content = full_path.read_text(encoding="utf-8", errors="ignore")
                    samples.append({
                        "filename": key_file,
                        "content": content[:max_content],
                        "type": "code"
                    })
                except Exception as e:
                    logger.warning(f"Failed to read {key_file}: {e}")

        logger.info(f"📂 Extracted {len(samples)} code samples (max_files={max_files}, max_content={max_content})")
        return samples

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

    def _format_samples_for_prompt(self, samples: List[Dict]) -> str:
        """Format code samples as a string for the prompt."""
        parts = []
        for sample in samples:
            parts.append(f"\n### File: {sample['filename']} ({sample['type']})")
            parts.append("```")
            parts.append(sample["content"])
            parts.append("```\n")
        return "\n".join(parts)

    def _parse_phase_response(self, content: str) -> Dict:
        """Parse JSON response from a phase analysis."""
        try:
            # Try to extract JSON from response (might have markdown)
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]

            # Fix invalid escape sequences
            content = self._fix_invalid_escapes(content.strip())
            return json.loads(content)
        except Exception as e:
            logger.warning(f"Failed to parse phase response: {e}")
            return {
                "partial_title": "",
                "business_rules_found": [],
                "features_found": [],
                "entities_found": [],
                "insights": ""
            }

    def _fix_invalid_escapes(self, s: str) -> str:
        """Fix invalid escape sequences in JSON string."""
        invalid_escapes = ['\\a', '\\c', '\\d', '\\e', '\\g', '\\h', '\\i', '\\j',
                           '\\k', '\\l', '\\m', '\\o', '\\p', '\\q', '\\s', '\\v',
                           '\\w', '\\x', '\\y', '\\z', '\\A', '\\B', '\\C', '\\D',
                           '\\E', '\\F', '\\G', '\\H', '\\I', '\\J', '\\K', '\\L',
                           '\\M', '\\N', '\\O', '\\P', '\\Q', '\\R', '\\S', '\\T',
                           '\\U', '\\V', '\\W', '\\X', '\\Y', '\\Z']
        for esc in invalid_escapes:
            s = s.replace(esc, '\\\\' + esc[1])
        return s

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

        logger.info(f"🔄 Starting phase: {phase_name} ({len(samples)} files)")

        try:
            # Load contract from YAML (PROMPT #164 - Use ContractLoader)
            from app.contracts.loader import ContractLoader
            loader = ContractLoader()

            code_content = self._format_samples_for_prompt(samples)
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

            # PROMPT #165 - Check if result is valid (not empty)
            if result.get("partial_title") or result.get("business_rules_found") or result.get("features_found"):
                logger.info(f"✅ Completed phase: {phase_name} - found {len(result.get('business_rules_found', []))} rules")
                return result

            # PROMPT #165 - Result is empty, retry with fewer files
            logger.warning(f"⚠️ Phase '{phase_name}' returned empty result, retrying with fewer files...")
            if len(samples) > 5:
                smaller_samples = samples[:5]
                code_content = self._format_samples_for_prompt(smaller_samples)
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
                        "phase": f"{phase_name}_retry",
                        "files_count": len(smaller_samples),
                        "scan_type": "memory_scan_phase_retry",
                        "scan_depth": self.current_scan_depth
                    }
                )
                result = self._parse_phase_response(response.get("content", "{}"))
                if result.get("partial_title") or result.get("business_rules_found"):
                    logger.info(f"✅ Retry succeeded for phase: {phase_name}")
                    return result

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

            # Parse JSON
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]

            content = self._fix_invalid_escapes(content.strip())
            result = json.loads(content)

            logger.info(f"✅ Consolidation complete - Title: {result.get('suggested_title', 'N/A')}")
            return result

        except Exception as e:
            logger.error(f"❌ Consolidation failed: {e}")
            # Return merged results from phases
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

        return {
            "suggested_title": final_title,
            "business_rules": all_rules[:15],
            "key_features": all_features[:10],
            "entities": all_entities[:10],
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
            # Normal mode: 4 phases
            # Phase 1: Documentation
            doc_samples = [s for s in code_samples if s["type"] in ["documentation", "configuration"]]
            all_phases["documentation"] = await self._analyze_phase(
                "documentation", doc_samples, stack_info, project_id
            )
            phases_completed += 1

            # Phase 2: Domain (models, migrations)
            domain_samples = [s for s in code_samples if self._is_domain_file(s["filename"])][:25]
            all_phases["domain"] = await self._analyze_phase(
                "domain", domain_samples, stack_info, project_id,
                previous_context=all_phases.get("documentation")
            )
            phases_completed += 1

            # Phase 3: Logic (controllers, services)
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

        logger.info(f"🔗 Chain Prompting: Analyzing {len(code_samples)} files individually")

        # Step 1: Analyze each file with a VERY simple prompt
        for i, sample in enumerate(code_samples[:15]):  # Max 15 files
            filename = sample.get("filename", f"file_{i}")
            content = sample.get("content", "")[:2000]  # Max 2K per file

            logger.info(f"   📄 Analyzing file {i+1}/15: {filename}")

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

        The prompt is intentionally very small and simple to work with local models.
        """
        # Super simple prompt - just ask what this file does
        system_prompt = "Você é um analista de código. Responda de forma MUITO CURTA e DIRETA."

        user_prompt = f"""Arquivo: {filename}

```
{content}
```

Em NO MÁXIMO 3 linhas, responda:
1. O que este arquivo FAZ? (1 frase)
2. Qual a principal REGRA DE NEGÓCIO? (1 frase, ou "Nenhuma" se não houver)
3. Qual a principal ENTIDADE/DADO? (1 palavra, ou "Nenhum")"""

        try:
            response = await self.orchestrator.execute(
                usage_type="memory",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=200,  # Muito pequeno - forçar resposta curta
                project_id=project_id,
                metadata={
                    "phase": f"chain_file_{file_num}",
                    "scan_type": "chain_prompting",
                    "filename": filename
                }
            )

            text = response.get("content", "").strip()
            if text:
                return {
                    "filename": filename,
                    "analysis": text
                }
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

        Uses a small prompt that just asks for a summary based on the file analyses.
        """
        # Format insights as a simple list
        insights_text = ""
        for insight in file_insights[:10]:  # Max 10 insights
            insights_text += f"- {insight['filename']}: {insight['analysis']}\n"

        stack_name = stack_info.get("detected_stack", "desconhecida")

        system_prompt = "Você é um arquiteto de software. Responda APENAS em JSON válido, sem markdown."

        user_prompt = f"""Pasta do projeto: {self.current_folder_name}
Stack: {stack_name}

Resumo dos arquivos analisados:
{insights_text}

Baseado APENAS nessas análises, responda em JSON:
{{
  "suggested_title": "Nome descritivo do sistema (4-6 palavras, SEM mencionar tecnologia)",
  "business_rules": ["Regra 1", "Regra 2", "Regra 3"],
  "key_features": ["Feature 1", "Feature 2", "Feature 3"],
  "entities": ["Entidade 1", "Entidade 2"],
  "interview_context": "Uma frase descrevendo o propósito do sistema"
}}"""

        try:
            response = await self.orchestrator.execute(
                usage_type="memory",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=500,
                project_id=project_id,
                metadata={
                    "phase": "chain_consolidation",
                    "scan_type": "chain_prompting",
                    "files_analyzed": len(file_insights)
                }
            )

            content = response.get("content", "{}")

            # Parse JSON
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]

            content = self._fix_invalid_escapes(content.strip())
            result = json.loads(content)

            # Validate title
            title = result.get("suggested_title", "")
            result["suggested_title"] = self._validate_title(title, self.current_folder_name, stack_info)

            logger.info(f"✅ Chain Prompting complete - Title: {result.get('suggested_title')}")
            return result

        except Exception as e:
            logger.error(f"Chain consolidation failed: {e}")
            return {
                "suggested_title": self._generate_fallback_title(stack_info, self.current_folder_name),
                "business_rules": [insight.get("analysis", "")[:100] for insight in file_insights[:5]],
                "key_features": [],
                "entities": [],
                "interview_context": f"Sistema {stack_name} com {len(file_insights)} arquivos analisados."
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
   Analise CADA arquivo de código e extraia regras como:
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

            # Parse JSON response
            import json
            import re
            content = response.get("content", "{}")

            # Try to extract JSON from response (might have markdown)
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]

            # PROMPT #121 FIX - Sanitize invalid escape sequences before JSON parse
            # AI sometimes returns regex patterns with \s, \d, etc. that are invalid in JSON
            # Replace invalid escapes with double backslash to make them valid
            def fix_invalid_escapes(s):
                # Replace invalid escape sequences with double backslash
                # JSON only allows: \", \\, \/, \b, \f, \n, \r, \t, \uXXXX
                invalid_escapes = ['\\a', '\\c', '\\d', '\\e', '\\g', '\\h', '\\i', '\\j',
                                   '\\k', '\\l', '\\m', '\\o', '\\p', '\\q', '\\s', '\\v',
                                   '\\w', '\\x', '\\y', '\\z', '\\A', '\\B', '\\C', '\\D',
                                   '\\E', '\\F', '\\G', '\\H', '\\I', '\\J', '\\K', '\\L',
                                   '\\M', '\\N', '\\O', '\\P', '\\Q', '\\R', '\\S', '\\T',
                                   '\\U', '\\V', '\\W', '\\X', '\\Y', '\\Z']
                for esc in invalid_escapes:
                    s = s.replace(esc, '\\\\' + esc[1])
                return s

            content = fix_invalid_escapes(content.strip())
            result = json.loads(content)

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

        Ensures title is:
        - At least 3 words long
        - Not just folder name or technology name
        - Descriptive of the system's purpose
        """
        if not title:
            return self._generate_fallback_title(stack_info, folder_name)

        # Clean the title
        title = title.strip()

        # Check if too short (less than 3 words)
        words = title.split()
        if len(words) < 3:
            logger.warning(f"⚠️ Title too short ({len(words)} words): '{title}'")
            # Try to expand it
            if len(words) == 2:
                return f"Sistema de {title}"
            return self._generate_fallback_title(stack_info, folder_name)

        # Check if it's just the folder name
        clean_folder = folder_name.replace("-", " ").replace("_", " ").lower()
        if title.lower() == f"sistema {clean_folder}":
            logger.warning(f"⚠️ Title is just folder name: '{title}'")
            # This is generic, but better than nothing
            # Try to add context from stack
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
        if title.lower() in generic_patterns:
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

        Args:
            project_id: Project UUID
            business_rules: List of business rule strings
        """
        for i, rule in enumerate(business_rules):
            self.rag.store(
                content=rule,
                metadata={
                    "type": "business_rule",
                    "project_id": str(project_id),
                    "rule_index": i,
                    "source": "codebase_memory_scan"
                },
                project_id=project_id
            )

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
