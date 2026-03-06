"""
RAG Pipeline utilities - shared constants, helpers, and functions.

Used across all phases and the main service module.
"""

import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Dict, List

logger = logging.getLogger(__name__)

PIPELINE_KEY_PREFIX = "rag:pipeline"

# PROMPT #259 - Thinking disabled to save credits
THINKING_CONFIG = None

# Noise commit patterns (used by Phase 4 git helpers)
NOISE_COMMIT_PATTERNS = [
    "merge branch", "merge pull request", "initial commit",
    "wip", "fix typo", "update readme", "bump version",
    "auto-commit", "generated", "revert",
]

SLUG_RE = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')


def _get_redis():
    """Get Redis client (best-effort, returns None if unavailable)."""
    try:
        import redis as _redis
        host = os.getenv("REDIS_HOST", "localhost")
        port = int(os.getenv("REDIS_PORT", 6379))
        client = _redis.Redis(host=host, port=port, db=0, decode_responses=True,
                              socket_connect_timeout=3, socket_timeout=3)
        client.ping()
        return client
    except Exception:
        logger.warning("Redis not available for pipeline state. Using DB-only tracking.")
        return None


def _detect_language(file_path: str) -> str:
    """Detect programming language from file extension."""
    ext = Path(file_path).suffix.lower()
    LANG_MAP = {
        ".py": "python", ".js": "javascript", ".ts": "typescript",
        ".tsx": "typescript", ".jsx": "javascript", ".java": "java",
        ".rb": "ruby", ".go": "go", ".rs": "rust", ".php": "php",
        ".c": "c", ".cpp": "cpp", ".h": "c", ".cs": "csharp",
        ".swift": "swift", ".kt": "kotlin", ".scala": "scala",
        ".html": "html", ".css": "css", ".scss": "scss",
        ".sql": "sql", ".sh": "shell", ".yaml": "yaml", ".yml": "yaml",
        ".json": "json", ".md": "markdown", ".xml": "xml",
    }
    return LANG_MAP.get(ext, "unknown")


def _extract_git_commits(code_path: str, max_commits: int = 200) -> List[Dict[str, str]]:
    """Extract recent git commits from repository."""
    git_dir = Path(code_path) / ".git"
    if not git_dir.exists():
        return []
    try:
        result = subprocess.run(
            ["git", "log", f"--pretty=format:%H|||%s|||%b|||%an|||%ad",
             "--date=short", f"-{max_commits}"],
            cwd=code_path, capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            return []
        commits = []
        for line in result.stdout.strip().split("\n"):
            if not line.strip():
                continue
            parts = line.split("|||")
            if len(parts) >= 2:
                subject = parts[1].strip()
                if any(p in subject.lower() for p in NOISE_COMMIT_PATTERNS):
                    continue
                if len(subject) < 5:
                    continue
                commits.append({
                    "hash": parts[0].strip()[:12],
                    "subject": subject,
                    "body": parts[2].strip() if len(parts) > 2 else "",
                    "author": parts[3].strip() if len(parts) > 3 else "",
                    "date": parts[4].strip() if len(parts) > 4 else "",
                })
        return commits
    except Exception:
        return []
