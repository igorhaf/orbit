"""
FileProcessor Service
Handles secure file upload, extraction, and processing for Project Analyzer
"""

import os
import zipfile
import tarfile
import shutil
import magic
import logging
from pathlib import Path
from typing import Dict, Any, List
from uuid import UUID
from fastapi import UploadFile, HTTPException

from app.config import settings

logger = logging.getLogger(__name__)

# Security constants
ALLOWED_EXTENSIONS = {".zip", ".tar", ".tar.gz", ".tgz"}
ALLOWED_MIME_TYPES = {
    "application/zip",
    "application/x-zip-compressed",
    "application/x-tar",
    "application/gzip",
    "application/x-gzip",
    "application/x-compressed-tar"
}

# Directories to ignore during file tree building
IGNORED_DIRS = {
    "node_modules",
    "vendor",
    ".git",
    ".svn",
    ".hg",
    "__pycache__",
    ".venv",
    "venv",
    "env",
    "dist",
    "build",
    ".next",
    ".nuxt",
    "coverage",
    ".pytest_cache",
    ".mypy_cache",
}

# Extensions to ignore
IGNORED_EXTENSIONS = {
    ".pyc",
    ".pyo",
    ".pyd",
    ".so",
    ".dll",
    ".dylib",
    ".log",
    ".tmp",
}


class FileProcessor:
    """
    Handles file upload, extraction, and processing with security checks
    """

    def __init__(self):
        self.upload_dir = Path(settings.upload_dir)
        self.extraction_dir = Path(settings.extraction_dir)
        self.max_upload_bytes = settings.max_upload_size_mb * 1024 * 1024
        self.max_extraction_bytes = settings.max_extraction_size_mb * 1024 * 1024

        # Ensure directories exist
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        self.extraction_dir.mkdir(parents=True, exist_ok=True)

    async def validate_upload(self, file: UploadFile) -> Dict[str, Any]:
        """
        Validate uploaded file for security

        Checks:
        - File extension whitelist
        - MIME type (magic bytes)
        - File size limits

        Args:
            file: FastAPI UploadFile

        Returns:
            Dictionary with validation results

        Raises:
            HTTPException if validation fails
        """

        filename = file.filename
        if not filename:
            raise HTTPException(status_code=400, detail="No filename provided")

        # Check extension
        file_ext = self._get_file_extension(filename)
        if file_ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file type. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
            )

        # Read file content for validation
        content = await file.read()
        file_size = len(content)

        # Check file size
        if file_size > self.max_upload_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"File too large. Max size: {settings.max_upload_size_mb}MB"
            )

        if file_size == 0:
            raise HTTPException(status_code=400, detail="Empty file")

        # Verify MIME type using magic bytes
        mime_type = magic.from_buffer(content, mime=True)
        if mime_type not in ALLOWED_MIME_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file type detected: {mime_type}"
            )

        # Reset file position for later reading
        await file.seek(0)

        return {
            "filename": filename,
            "file_size": file_size,
            "mime_type": mime_type,
            "extension": file_ext,
        }

    async def save_upload(
        self,
        file: UploadFile,
        analysis_id: UUID
    ) -> Path:
        """
        Save uploaded file securely

        Args:
            file: FastAPI UploadFile
            analysis_id: UUID for unique naming

        Returns:
            Path to saved file
        """

        # Validate first
        validation = await self.validate_upload(file)

        # Create safe filename
        safe_filename = self._sanitize_filename(validation["filename"])
        file_path = self.upload_dir / f"{analysis_id}_{safe_filename}"

        # Save file
        try:
            with open(file_path, "wb") as f:
                content = await file.read()
                f.write(content)

            logger.info(f"Saved upload to {file_path}")
            return file_path

        except Exception as e:
            logger.error(f"Failed to save upload: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

    async def extract_archive(
        self,
        file_path: Path,
        analysis_id: UUID,
        timeout_seconds: int = 300
    ) -> Path:
        """
        Extract archive with security checks

        Security measures:
        - Prevent path traversal (e.g., ../../../etc/passwd)
        - Prevent zip bombs (extraction size limit)
        - Timeout for extraction

        Args:
            file_path: Path to archive file
            analysis_id: UUID for extraction directory
            timeout_seconds: Max extraction time

        Returns:
            Path to extraction directory

        Raises:
            HTTPException if extraction fails or security check fails
        """

        extract_path = self.extraction_dir / str(analysis_id)
        extract_path.mkdir(parents=True, exist_ok=True)

        try:
            # Determine archive type
            file_ext = self._get_file_extension(str(file_path))

            if file_ext in {".zip"}:
                self._extract_zip(file_path, extract_path)
            elif file_ext in {".tar", ".tar.gz", ".tgz"}:
                self._extract_tar(file_path, extract_path)
            else:
                raise ValueError(f"Unsupported archive type: {file_ext}")

            # Check total extracted size
            total_size = self._get_dir_size(extract_path)
            if total_size > self.max_extraction_bytes:
                shutil.rmtree(extract_path)
                raise HTTPException(
                    status_code=413,
                    detail=f"Extracted size exceeds limit ({settings.max_extraction_size_mb}MB)"
                )

            logger.info(f"Extracted archive to {extract_path} ({total_size} bytes)")
            return extract_path

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to extract archive: {e}")
            if extract_path.exists():
                shutil.rmtree(extract_path)
            raise HTTPException(status_code=500, detail=f"Extraction failed: {str(e)}")

    def _extract_zip(self, file_path: Path, extract_path: Path):
        """Extract ZIP archive with security checks"""

        with zipfile.ZipFile(file_path, 'r') as zip_ref:
            # Check for path traversal
            for member in zip_ref.namelist():
                if self._is_path_traversal(member):
                    raise HTTPException(
                        status_code=400,
                        detail="Archive contains path traversal attempt"
                    )

            # Extract all
            zip_ref.extractall(extract_path)

    def _extract_tar(self, file_path: Path, extract_path: Path):
        """Extract TAR/TGZ archive with security checks"""

        mode = 'r:gz' if str(file_path).endswith('.gz') else 'r'

        with tarfile.open(file_path, mode) as tar_ref:
            # Check for path traversal
            for member in tar_ref.getmembers():
                if self._is_path_traversal(member.name):
                    raise HTTPException(
                        status_code=400,
                        detail="Archive contains path traversal attempt"
                    )

            # Extract all
            tar_ref.extractall(extract_path)

    def build_file_tree(self, root_path: Path, max_depth: int = 10) -> Dict:
        """
        Build JSON tree structure of files

        Filters out:
        - node_modules, vendor, .git, etc.
        - Binary files
        - Very large files

        Args:
            root_path: Root directory to scan
            max_depth: Maximum directory depth

        Returns:
            {
                "name": "project_root",
                "type": "directory",
                "children": [...]
            }
        """

        def build_tree(path: Path, depth: int = 0) -> Dict:
            """Recursive helper"""

            if depth > max_depth:
                return None

            name = path.name

            # Skip ignored directories
            if path.is_dir() and name in IGNORED_DIRS:
                return None

            # Skip ignored extensions
            if path.is_file() and path.suffix in IGNORED_EXTENSIONS:
                return None

            if path.is_file():
                # Skip very large files (>10MB)
                try:
                    size = path.stat().st_size
                    if size > 10 * 1024 * 1024:
                        return None
                except:
                    return None

                return {
                    "name": name,
                    "type": "file",
                    "path": str(path.relative_to(root_path)),
                    "size": size,
                }

            elif path.is_dir():
                children = []
                try:
                    for child in path.iterdir():
                        child_node = build_tree(child, depth + 1)
                        if child_node:
                            children.append(child_node)
                except PermissionError:
                    pass

                return {
                    "name": name,
                    "type": "directory",
                    "path": str(path.relative_to(root_path)),
                    "children": children
                }

            return None

        tree = build_tree(root_path)
        return tree if tree else {"name": root_path.name, "type": "directory", "children": []}

    def cleanup(self, analysis_id: UUID):
        """
        Remove temporary files for analysis

        Args:
            analysis_id: UUID of analysis
        """

        try:
            # Remove upload file
            for file in self.upload_dir.glob(f"{analysis_id}_*"):
                file.unlink()
                logger.info(f"Removed upload file: {file}")

            # Remove extraction directory
            extract_path = self.extraction_dir / str(analysis_id)
            if extract_path.exists():
                shutil.rmtree(extract_path)
                logger.info(f"Removed extraction dir: {extract_path}")

        except Exception as e:
            logger.error(f"Failed to cleanup files for {analysis_id}: {e}")

    @staticmethod
    def _get_file_extension(filename: str) -> str:
        """Get file extension, handling .tar.gz"""

        if filename.endswith(".tar.gz"):
            return ".tar.gz"
        return Path(filename).suffix.lower()

    @staticmethod
    def _sanitize_filename(filename: str) -> str:
        """Remove dangerous characters from filename"""

        # Keep only alphanumeric, dash, underscore, dot
        safe_chars = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.")
        sanitized = "".join(c if c in safe_chars else "_" for c in filename)

        return sanitized[:255]  # Limit length

    @staticmethod
    def _is_path_traversal(path: str) -> bool:
        """Check if path contains traversal attempt"""

        # Normalize path
        normalized = os.path.normpath(path)

        # Check for parent directory references
        if normalized.startswith("..") or "/../" in normalized:
            return True

        # Check for absolute paths
        if os.path.isabs(normalized):
            return True

        return False

    @staticmethod
    def _get_dir_size(path: Path) -> int:
        """Calculate total size of directory"""

        total = 0
        for item in path.rglob("*"):
            if item.is_file():
                try:
                    total += item.stat().st_size
                except:
                    pass
        return total
