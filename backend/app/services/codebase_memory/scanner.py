"""
Scanner Mixin for CodebaseMemoryService

Contains methods for scanning the codebase structure: file walking,
directory listing, AI-based ignore detection, extension-to-language
mapping, and key file identification.

PROMPT #166 - Respects .gitignore and expanded ignore patterns
PROMPT #223 - AI pre-scan to detect non-standard directories to exclude
"""

import os
import json
import logging
import asyncio
from pathlib import Path
from typing import Dict, List, Optional, Any, Set
from uuid import UUID

logger = logging.getLogger(__name__)

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


class ScannerMixin:
    """Mixin providing codebase scanning functionality."""

    # Class-level constants
    ANALYSIS_EXTENSIONS = ANALYSIS_EXTENSIONS
    CONFIG_FILES = CONFIG_FILES

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
            root_rel = str(Path(root).relative_to(root_path)) if Path(root) != root_path else ""
            dirs[:] = sorted(
                d for d in dirs
                if not self._should_ignore_dir(
                    d,
                    rel_dir_path=(root_rel + "/" + d).lstrip("/") if root_rel else d,
                )
            )
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
            root_rel = str(Path(root).relative_to(root_path)) if Path(root) != root_path else ""
            dirs[:] = [
                d for d in dirs
                if not self._should_ignore_dir(
                    d,
                    rel_dir_path=(root_rel + "/" + d).lstrip("/") if root_rel else d,
                )
            ]

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
