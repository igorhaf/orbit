"""
Orbit Folder Service

Manages the .satellite marker file and .orbit/ minimal folder structure
inside a project's code_path.

Structure:
  {code_path}/.satellite          <- marker file (plain text, version info)
  {code_path}/.orbit/             <- minimal orbit folder
  {code_path}/.orbit/memory/      <- AI execution logs
  {code_path}/.orbit/docs/        <- uploaded documents (PDFs, binaries)

Wiki pages, prompts, and results are stored in the database only.
"""

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.project import Project

logger = logging.getLogger(__name__)

# Constants
SATELLITE_MARKER = ".satellite"
ORBIT_DIR = ".orbit"
ORBIT_MEMORY_DIR = ".orbit/memory"
ORBIT_DOCS_DIR = ".orbit/docs"

MARKER_CONTENT = "orbit-managed-project\nversion: 1\n"


class OrbitFolderService:

    def __init__(self, db: Session):
        self.db = db

    def ensure_orbit_structure(self, code_path: str, project_name: str = "") -> Path:
        """
        Create .satellite marker file and .orbit/ directory structure.

        Idempotent — safe to call multiple times.
        Returns the .orbit/ Path.
        """
        root = Path(code_path)
        if not root.exists():
            raise FileNotFoundError(f"code_path does not exist: {root}")

        # Write .satellite marker
        marker = root / SATELLITE_MARKER
        if not marker.exists():
            marker.write_text(MARKER_CONTENT, encoding="utf-8")
            logger.info(f"Created .satellite marker at {marker}")

        # Create .orbit/ subdirectories
        orbit_path = root / ORBIT_DIR
        orbit_path.mkdir(exist_ok=True)

        for sub in ("memory", "docs"):
            sub_path = orbit_path / sub
            sub_path.mkdir(exist_ok=True)

        logger.info(f"Orbit structure ensured at {orbit_path}")
        return orbit_path

    def is_orbit_project(self, code_path: str) -> bool:
        """Check if .satellite marker exists at code_path."""
        marker = Path(code_path) / SATELLITE_MARKER
        return marker.is_file()

    def upload_knowledge(self, project: Project, filename: str, content: bytes) -> Dict:
        """
        Save a file to .orbit/docs/ on disk.

        Returns dict with file_path, filename, size_bytes, orbit_path.
        """
        orbit_path = self.ensure_orbit_structure(project.code_path, project.name)
        docs_dir = orbit_path / "docs"

        # Sanitize filename to prevent path traversal
        safe_name = Path(filename).name
        if not safe_name or safe_name.startswith('.'):
            raise ValueError(f"Invalid filename: {filename}")

        file_path = docs_dir / safe_name
        file_path.write_bytes(content)

        logger.info(
            f"Uploaded knowledge file '{safe_name}' "
            f"({len(content)} bytes) to {file_path}"
        )

        return {
            "file_path": str(file_path),
            "filename": safe_name,
            "size_bytes": len(content),
            "orbit_path": str(orbit_path),
        }

    def list_knowledge_files(self, project: Project) -> List[Dict]:
        """
        List all files in .orbit/docs/.

        Returns list of dicts with filename, size_bytes, modified_at.
        """
        docs_dir = Path(project.code_path) / ORBIT_DIR / "docs"
        if not docs_dir.exists():
            return []

        files = []
        for f in sorted(docs_dir.iterdir()):
            if f.is_file():
                stat = f.stat()
                files.append({
                    "filename": f.name,
                    "size_bytes": stat.st_size,
                    "modified_at": datetime.fromtimestamp(
                        stat.st_mtime, tz=timezone.utc
                    ).isoformat(),
                })
        return files

    def delete_knowledge_file(self, project: Project, filename: str) -> bool:
        """
        Delete a single user-uploaded file from .orbit/docs/.

        Returns True if deleted, False if not found.
        """
        docs_dir = Path(project.code_path) / ORBIT_DIR / "docs"
        safe_name = Path(filename).name

        file_path = docs_dir / safe_name

        if not file_path.exists() or not file_path.is_file():
            return False

        file_path.unlink()
        logger.info(f"Deleted knowledge file '{safe_name}' from {docs_dir}")
        return True

    def get_orbit_status(self, project: Project) -> Dict:
        """Return the current state of the .orbit/ folder."""
        code_path = Path(project.code_path)
        orbit_path = code_path / ORBIT_DIR

        if not orbit_path.exists():
            return {
                "exists": False,
                "is_orbit_project": self.is_orbit_project(project.code_path),
                "memory": 0,
                "docs": 0,
            }

        def _count(sub: str) -> int:
            folder = orbit_path / sub
            if not folder.exists():
                return 0
            return sum(1 for f in folder.iterdir() if f.is_file())

        return {
            "exists": True,
            "is_orbit_project": self.is_orbit_project(project.code_path),
            "orbit_path": str(orbit_path),
            "memory": _count("memory"),
            "docs": _count("docs"),
        }


# =============================================================================
# Module-level helper functions (backward compatibility)
# =============================================================================

def ensure_satellite_dirs(code_path: Path) -> Path:
    """
    Backward-compatible wrapper. Creates .satellite marker + .orbit/ structure.

    Returns the .orbit/ Path.
    """
    root = Path(code_path)
    root.mkdir(parents=True, exist_ok=True)

    # Write .satellite marker
    marker = root / SATELLITE_MARKER
    if not marker.exists():
        marker.write_text(MARKER_CONTENT, encoding="utf-8")

    # Create .orbit/ subdirectories
    orbit_path = root / ORBIT_DIR
    orbit_path.mkdir(exist_ok=True)

    for sub in ("memory", "docs"):
        sub_path = orbit_path / sub
        sub_path.mkdir(exist_ok=True)

    logger.info(f"Orbit structure ensured at {orbit_path}")
    return orbit_path


def get_orbit_docs_path(code_path: str) -> Path:
    """Return Path to .orbit/docs/ for the given code_path."""
    return Path(code_path) / ORBIT_DIR / "docs"


def get_orbit_memory_path(code_path: str) -> Path:
    """Return Path to .orbit/memory/ for the given code_path."""
    return Path(code_path) / ORBIT_DIR / "memory"
