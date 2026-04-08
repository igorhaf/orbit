"""
Blocklist Mixin for CodebaseMemoryService

Contains methods for loading/saving blocklists, gitignore patterns,
and path ignore logic.

PROMPT #166 - Ignore irrelevant files (.gitignore, vendor, node_modules, etc.)
PROMPT #223 - AI-detected custom ignore patterns
PROMPT #241 - User-editable ignore paths
PROMPT #250 - Global blocklist from system_settings
"""

import os
import fnmatch
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any, Set

logger = logging.getLogger(__name__)


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


class BlocklistMixin:
    """Mixin providing blocklist, gitignore, and path ignore functionality."""

    # Class-level constants (referenced by other code via self.IGNORE_DIRECTORIES etc.)
    IGNORE_DIRECTORIES = IGNORE_DIRECTORIES
    IGNORE_FILE_PATTERNS = IGNORE_FILE_PATTERNS

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
        """Salva sugestoes de bloqueio detectadas pela IA."""
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

        # Check relative path against blocklist entries with '/' (e.g. "projects/suinda")
        for ignored in self._effective_ignore_dirs:
            if "/" in ignored:
                if rel_str == ignored or rel_str.startswith(ignored + "/"):
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

    def _should_ignore_dir(self, dirname: str, rel_dir_path: str = "") -> bool:
        """
        PROMPT #166 - Quick check if directory name should be ignored.

        Used during os.walk to prune directories early.

        Args:
            dirname: Directory name (not full path)
            rel_dir_path: Relative path from project root (e.g. "projects/suinda")

        Returns:
            True if directory should be skipped
        """
        # Check built-in + AI-detected ignore list (PROMPT #223)
        if dirname in self._effective_ignore_dirs:
            return True

        # Check relative path against blocklist entries that contain '/'
        # e.g. "projects/suinda" should match when rel_dir_path is "projects/suinda"
        if rel_dir_path:
            for ignored in self._effective_ignore_dirs:
                if "/" in ignored:
                    # Match if the relative path equals or starts with the ignored path
                    if rel_dir_path == ignored or rel_dir_path.startswith(ignored + "/"):
                        return True

        # Check .gitignore patterns (directory names only)
        for pattern in self._gitignore_patterns:
            if fnmatch.fnmatch(dirname, pattern):
                return True

        return False
