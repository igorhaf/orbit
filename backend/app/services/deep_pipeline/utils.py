"""
Deep Pipeline - Utility functions and constants.

Contains pure helper functions, ignore patterns, file classification,
and constants used across all pipeline phases.
"""

import fnmatch
import os
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import logging

logger = logging.getLogger(__name__)


# ── Redis connection for live pipeline state (optional, best-effort) ─────────

_redis_client = None


def _get_redis():
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    try:
        import redis as _redis
        host = os.getenv("REDIS_HOST", "redis")
        port = int(os.getenv("REDIS_PORT", "6379"))
        _redis_client = _redis.Redis(host=host, port=port, db=0, decode_responses=True, socket_connect_timeout=2)
        _redis_client.ping()
        return _redis_client
    except Exception:
        _redis_client = False  # Mark as unavailable
        return None


# ── Constants ────────────────────────────────────────────────────────────────

# Directories always excluded from scanning
IGNORE_DIRECTORIES = {
    "node_modules", "__pycache__", ".git", ".svn", ".hg", "vendor", "dist",
    "build", ".next", ".nuxt", "target", "bin", "obj", ".venv", "venv",
    "env", ".env", ".tox", ".mypy_cache", ".pytest_cache", "coverage",
    ".nyc_output", ".cache", ".gradle", ".idea", ".vscode", ".DS_Store",
    "tmp", "temp", "logs", ".terraform", ".serverless",
}

# File extensions to analyze
CODE_EXTENSIONS = {
    ".py", ".js", ".ts", ".tsx", ".jsx", ".php", ".rb", ".java", ".go",
    ".rs", ".cs", ".swift", ".kt", ".scala", ".vue", ".svelte",
    ".sql", ".graphql", ".prisma",
}

# Extensions that rarely contain business rules
SKIP_EXTENSIONS = {
    ".css", ".scss", ".less", ".svg", ".png", ".jpg", ".gif", ".ico",
    ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".mp3", ".pdf",
    ".lock", ".map", ".min.js", ".min.css",
}

# Max file size to send to AI (bytes) - very large files are likely generated
MAX_FILE_SIZE = 100_000  # 100KB

# Complexity keywords for heuristic scoring
COMPLEXITY_KEYWORDS = re.compile(
    r'\b(if|else|elif|switch|case|for|while|do|try|catch|except|finally|throw|raise)\b'
)

# Import patterns for dependency graph
IMPORT_PATTERNS = [
    re.compile(r'^\s*import\s+(.+)', re.MULTILINE),
    re.compile(r'^\s*from\s+(\S+)\s+import', re.MULTILINE),
    re.compile(r'^\s*require\s*\(\s*[\'"](.+?)[\'"]\s*\)', re.MULTILINE),
    re.compile(r'^\s*use\s+(.+?)\s*;', re.MULTILINE),
    re.compile(r'^\s*include\s+[\'"](.+?)[\'"]', re.MULTILINE),
]


# ── Utility Mixin ────────────────────────────────────────────────────────────

class UtilsMixin:
    """Mixin providing filesystem helpers, ignore patterns, and file classification."""

    def _build_ignore_patterns(self, project) -> List[str]:
        """Build combined ignore patterns from all sources."""
        patterns = []

        # User-defined ignore paths
        if project.ignore_paths:
            if isinstance(project.ignore_paths, list):
                patterns.extend(project.ignore_paths)

        # AI-detected patterns
        if project.custom_ignore_patterns:
            cp = project.custom_ignore_patterns
            if isinstance(cp, dict) and "directories" in cp:
                patterns.extend(cp["directories"])

        # .gitignore
        gitignore = os.path.join(project.code_path, ".gitignore")
        if os.path.isfile(gitignore):
            try:
                with open(gitignore, "r") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#"):
                            patterns.append(line)
            except Exception:
                pass

        return patterns

    def _is_ignored(self, rel_path: str, patterns: List[str]) -> bool:
        """Check if a relative path matches any ignore pattern."""
        for pattern in patterns:
            if fnmatch.fnmatch(rel_path, pattern):
                return True
            if fnmatch.fnmatch(rel_path, f"*/{pattern}"):
                return True
            if rel_path.startswith(pattern.rstrip("/")):
                return True
        return False

    @staticmethod
    def _extract_imports(content: str) -> List[str]:
        """Extract import/require statements from code."""
        imports = set()
        for pattern in IMPORT_PATTERNS:
            for match in pattern.finditer(content):
                imp = match.group(1).strip().strip("'\"")
                if imp and not imp.startswith("."):
                    imports.add(imp.split(".")[0].split("/")[0])
        return list(imports)[:20]  # Limit to 20 most relevant

    @staticmethod
    def _detect_language(ext: str) -> str:
        """Detect programming language from extension."""
        lang_map = {
            ".py": "python", ".js": "javascript", ".ts": "typescript",
            ".tsx": "typescript", ".jsx": "javascript", ".php": "php",
            ".rb": "ruby", ".java": "java", ".go": "go", ".rs": "rust",
            ".cs": "csharp", ".swift": "swift", ".kt": "kotlin",
            ".scala": "scala", ".vue": "vue", ".svelte": "svelte",
            ".sql": "sql", ".graphql": "graphql", ".prisma": "prisma",
        }
        return lang_map.get(ext, "unknown")

    @staticmethod
    def _classify_file_type(rel_path: str, content: str) -> str:
        """Classify file by its role in the architecture."""
        path_lower = rel_path.lower()
        if any(p in path_lower for p in ["migration", "alembic", "migrate"]):
            return "migration"
        if any(p in path_lower for p in ["model", "schema", "entity"]):
            return "model"
        if any(p in path_lower for p in ["route", "controller", "endpoint", "api"]):
            return "route"
        if any(p in path_lower for p in ["service", "usecase", "interactor"]):
            return "domain_logic"
        if any(p in path_lower for p in ["test", "spec", "__test__"]):
            return "test"
        if any(p in path_lower for p in ["component", "page", "view", "template"]):
            return "ui"
        if any(p in path_lower for p in ["config", "setting", ".env"]):
            return "config"
        if any(p in path_lower for p in ["middleware", "guard", "interceptor"]):
            return "infrastructure"
        return "domain_logic"

    def _save_checkpoint(self, pipeline_run, phase: int, completed_files: set):
        """Save micro-batch checkpoint state to PipelineRun for resume after crash."""
        pipeline_run.checkpoint_state = {
            "phase": phase,
            "completed_files": list(completed_files),
            "saved_at": datetime.utcnow().isoformat(),
        }
        self.db.commit()
        logger.info(f"Checkpoint saved: phase={phase}, files={len(completed_files)}")

    async def _provider_health_check(self, model: str, ollama_kwargs: dict) -> bool:
        """Test if the AI provider responds before sending a batch.
        Uses the lightweight /api/health endpoint instead of a full AI call
        to avoid wasting tokens and being slow under load.
        Retries up to 3 times with backoff before declaring offline.
        """
        import asyncio
        for attempt in range(3):
            try:
                healthy = await asyncio.wait_for(
                    self.claudio.health_check(),
                    timeout=15,
                )
                if healthy:
                    return True
                logger.warning(f"Health check attempt {attempt + 1}/3 returned unhealthy")
            except Exception as e:
                logger.warning(f"Health check attempt {attempt + 1}/3 failed: {e}")
            if attempt < 2:
                await asyncio.sleep(5 * (attempt + 1))  # 5s, 10s backoff
        return False

    def _gather_enrichment_context(self, project) -> Dict[str, str]:
        """Gather wiki pages, RAG business rules, git commits and done cards for enrichment."""
        from app.models.wiki_page import WikiPage
        from app.models.task import Task, TaskStatus

        extra: Dict[str, str] = {}

        # 1. Wiki pages -- titles + first 200 chars of content
        try:
            wiki_pages = (
                self.db.query(WikiPage)
                .filter(WikiPage.project_id == project.id)
                .order_by(WikiPage.order_index)
                .limit(10)
                .all()
            )
            if wiki_pages:
                wiki_text = "\n".join(
                    f"- {wp.title}: {(wp.content or '')[:200]}"
                    for wp in wiki_pages
                )
                extra["wiki_content"] = wiki_text[:3000]
                logger.info(f"Post-pipeline enrichment: {len(wiki_pages)} wiki pages gathered")
        except Exception as e:
            logger.warning(f"Post-pipeline enrichment: wiki fetch failed: {e}")

        # 2. RAG business rules
        try:
            from app.services.rag_service import RAGService
            rag = RAGService(self.db)
            rules = rag.get_business_rules(
                project_id=project.id,
                query=project.name,
                top_k=15,
                similarity_threshold=0.4,
            )
            if rules:
                formatted = rag.format_business_rules_for_prompt(rules, max_chars=3000)
                if formatted:
                    extra["business_rules"] = formatted
                    logger.info(f"Post-pipeline enrichment: {len(rules)} business rules gathered")
        except Exception as e:
            logger.warning(f"Post-pipeline enrichment: RAG fetch failed: {e}")

        # 3. Git commits -- last 30 meaningful commits
        try:
            code_path = project.code_path
            if code_path and Path(code_path).exists():
                import subprocess as _sp
                res = _sp.run(
                    ["git", "log", "--pretty=format:%s", "--date=short", "-50"],
                    cwd=code_path, capture_output=True, text=True, timeout=10,
                )
                if res.returncode == 0 and res.stdout.strip():
                    noise = {"merge", "bump", "chore", "wip", "initial commit", "auto"}
                    commits = [
                        line.strip() for line in res.stdout.strip().split("\n")
                        if line.strip() and not any(n in line.lower() for n in noise)
                    ][:30]
                    if commits:
                        extra["git_commits"] = "\n".join(f"- {c}" for c in commits)
                        logger.info(f"Post-pipeline enrichment: {len(commits)} git commits gathered")
        except Exception as e:
            logger.warning(f"Post-pipeline enrichment: git fetch failed: {e}")

        # 4. Done/closed cards -- titles of completed work
        try:
            done_cards = (
                self.db.query(Task.title, Task.item_type)
                .filter(
                    Task.project_id == project.id,
                    Task.status == TaskStatus.DONE,
                )
                .limit(30)
                .all()
            )
            if done_cards:
                cards_text = "\n".join(
                    f"- [{c.item_type.value if hasattr(c.item_type, 'value') else c.item_type}] {c.title}"
                    for c in done_cards
                )
                extra["done_cards"] = cards_text[:2000]
                logger.info(f"Post-pipeline enrichment: {len(done_cards)} done cards gathered")
        except Exception as e:
            logger.warning(f"Post-pipeline enrichment: done cards fetch failed: {e}")

        return extra

    def _build_local_arch_map(
        self,
        domain_rules: Dict[str, Dict],
        file_inventory: List[Dict],
        project,
    ) -> Dict:
        """Build a minimal architectural map locally without AI calls.

        Used when phase_3 is disabled -- derives structure from domain_rules
        and file_inventory metadata.
        """
        # Count languages from inventory
        lang_counts: Dict[str, int] = defaultdict(int)
        file_type_counts: Dict[str, int] = defaultdict(int)
        for f in file_inventory:
            lang = f.get("language", "unknown")
            lang_counts[lang] += 1
            ft = f.get("file_type", "other")
            file_type_counts[ft] += 1

        # Build domain list from domain_rules keys
        domains = []
        for domain_name, data in domain_rules.items():
            rules = data.get("consolidated_rules", [])
            entities = data.get("domain_entities", [])
            domains.append({
                "name": domain_name,
                "description": data.get("domain_summary", f"Dominio {domain_name}"),
                "entities": entities,
                "rule_count": len(rules),
                "complexity": "high" if len(rules) > 15 else ("medium" if len(rules) > 5 else "low"),
            })

        return {
            "domains": domains,
            "cross_domain_flows": [],
            "tech_stack": {
                "languages": dict(lang_counts),
                "file_types": dict(file_type_counts),
            },
            "patterns": [],
            "project_summary": f"Projeto {project.name} com {len(domains)} dominios e {len(file_inventory)} arquivos",
        }

    @staticmethod
    def _map_priority(priority_str: str):
        """Map string priority to PriorityLevel enum."""
        from app.models.task import PriorityLevel
        mapping = {
            "critical": PriorityLevel.CRITICAL,
            "high": PriorityLevel.HIGH,
            "medium": PriorityLevel.MEDIUM,
            "low": PriorityLevel.LOW,
        }
        return mapping.get(priority_str.lower(), PriorityLevel.MEDIUM)
