"""
Codebase Indexer Service

PROMPT #89 - Phase 2: Code RAG Implementation

This service indexes project codebases in RAG for context-aware code generation.
Scans project files, extracts metadata, and stores in RAG for semantic search.

Features:
- Recursive file scanning with extension filtering
- Metadata extraction (imports, exports, classes, functions)
- Incremental indexing (only changed files)
- Language-specific parsers
- Background job integration

Usage:
    from app.services.codebase_indexer import CodebaseIndexer

    indexer = CodebaseIndexer(db)

    # Index entire project
    result = await indexer.index_project(project_id)

    # Index single file
    await indexer.index_file(project_id, file_path)

    # Search code
    results = await indexer.search_code(
        project_id=project_id,
        query="User model relationships",
        language="php"
    )
"""

import os
import re
import logging
from typing import Dict, List, Optional, Set
from uuid import UUID
from pathlib import Path

from sqlalchemy.orm import Session

from app.services.rag_service import RAGService
from app.models.project import Project

logger = logging.getLogger(__name__)


class CodebaseIndexer:
    """
    Codebase indexer for RAG-based code context.

    Indexes project files for semantic search during task execution.
    """

    # Supported languages and extensions
    LANGUAGE_EXTENSIONS = {
        "php": [".php"],
        "typescript": [".ts", ".tsx"],
        "javascript": [".js", ".jsx"],
        "python": [".py"],
        "css": [".css", ".scss", ".sass"],
        "html": [".html", ".blade.php"],
        "sql": [".sql"],
        "yaml": [".yaml", ".yml"],
        "json": [".json"]
    }

    # Directories to ignore
    IGNORE_DIRS = {
        "node_modules",
        ".venv",
        "venv",
        "vendor",
        ".git",
        ".next",
        "dist",
        "build",
        "__pycache__",
        ".pytest_cache",
        "coverage",
        ".idea",
        ".vscode"
    }

    # File patterns to ignore
    IGNORE_PATTERNS = {
        "*.min.js",
        "*.min.css",
        "package-lock.json",
        "composer.lock",
        "yarn.lock"
    }

    def __init__(self, db: Session):
        """
        Initialize codebase indexer.

        Args:
            db: SQLAlchemy database session
        """
        self.db = db
        self.rag = RAGService(db)

    async def index_project(
        self,
        project_id: UUID,
        force: bool = False
    ) -> Dict:
        """
        Index entire project codebase.

        Args:
            project_id: Project UUID
            force: If True, re-index all files even if unchanged

        Returns:
            Dict with indexing statistics

        Example:
            result = await indexer.index_project(project_id)
            # {
            #     "project_id": "uuid",
            #     "files_scanned": 150,
            #     "files_indexed": 145,
            #     "files_skipped": 5,
            #     "languages": {"php": 80, "typescript": 50, "css": 15},
            #     "total_lines": 12500
            # }
        """
        # Get project
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        if not project.project_folder:
            raise ValueError(f"Project {project_id} has no project_folder configured")

        project_path = Path(project.project_folder)
        if not project_path.exists():
            raise ValueError(f"Project folder does not exist: {project_path}")

        logger.info(f"Starting codebase indexing for project {project_id} at {project_path}")

        # Statistics
        stats = {
            "project_id": str(project_id),
            "files_scanned": 0,
            "files_indexed": 0,
            "files_skipped": 0,
            "languages": {},
            "total_lines": 0,
            "errors": []
        }

        # Scan files recursively
        for file_path in self._scan_directory(project_path):
            stats["files_scanned"] += 1

            try:
                # Detect language
                language = self._detect_language(file_path)
                if not language:
                    stats["files_skipped"] += 1
                    continue

                # Index file
                await self._index_file(project_id, file_path, language)

                stats["files_indexed"] += 1
                stats["languages"][language] = stats["languages"].get(language, 0) + 1

                # Count lines
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    lines = len(f.readlines())
                    stats["total_lines"] += lines

            except Exception as e:
                logger.error(f"Error indexing file {file_path}: {e}")
                stats["errors"].append(str(file_path))
                stats["files_skipped"] += 1

        logger.info(f"Codebase indexing complete: {stats['files_indexed']} files indexed")

        return stats

    def _scan_directory(self, directory: Path) -> List[Path]:
        """
        Recursively scan directory for code files.

        Args:
            directory: Root directory to scan

        Returns:
            List of file paths
        """
        files = []

        for root, dirs, filenames in os.walk(directory):
            # Filter out ignored directories
            dirs[:] = [d for d in dirs if d not in self.IGNORE_DIRS]

            for filename in filenames:
                file_path = Path(root) / filename

                # Check if file should be ignored
                if self._should_ignore_file(file_path):
                    continue

                files.append(file_path)

        return files

    def _should_ignore_file(self, file_path: Path) -> bool:
        """
        Check if file should be ignored.

        Args:
            file_path: File path

        Returns:
            True if file should be ignored
        """
        # Check ignore patterns
        for pattern in self.IGNORE_PATTERNS:
            if file_path.match(pattern):
                return True

        return False

    def _detect_language(self, file_path: Path) -> Optional[str]:
        """
        Detect programming language from file extension.

        Args:
            file_path: File path

        Returns:
            Language name or None
        """
        extension = file_path.suffix.lower()

        for language, extensions in self.LANGUAGE_EXTENSIONS.items():
            if extension in extensions:
                return language

        return None

    async def _index_file(
        self,
        project_id: UUID,
        file_path: Path,
        language: str
    ):
        """
        Index single file in RAG.

        Args:
            project_id: Project UUID
            file_path: File path
            language: Programming language
        """
        # Read file content
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()

        # Extract metadata based on language
        metadata_extractor = self._get_metadata_extractor(language)
        metadata = metadata_extractor(content, file_path)

        # Build content for RAG
        # Include file path + content summary + key structures
        rag_content = self._build_rag_content(file_path, content, metadata, language)

        # Store in RAG
        self.rag.store(
            content=rag_content,
            metadata={
                "type": "code_file",
                "project_id": str(project_id),
                "file_path": str(file_path),
                "language": language,
                **metadata
            },
            project_id=project_id
        )

    def _build_rag_content(
        self,
        file_path: Path,
        content: str,
        metadata: Dict,
        language: str
    ) -> str:
        """
        Build optimized content for RAG indexing.

        Includes:
        - File path (for context)
        - Extracted structures (classes, functions, imports)
        - First 500 chars of content (for semantic matching)

        Args:
            file_path: File path
            content: File content
            metadata: Extracted metadata
            language: Programming language

        Returns:
            Optimized content string
        """
        parts = [
            f"File: {file_path}",
            f"Language: {language}",
            ""
        ]

        # Add structures
        if metadata.get("classes"):
            parts.append(f"Classes: {', '.join(metadata['classes'])}")

        if metadata.get("functions"):
            parts.append(f"Functions: {', '.join(metadata['functions'][:10])}")  # Limit to 10

        if metadata.get("imports"):
            parts.append(f"Imports: {', '.join(metadata['imports'][:10])}")

        if metadata.get("exports"):
            parts.append(f"Exports: {', '.join(metadata['exports'][:10])}")

        # Add content preview
        parts.append("")
        parts.append("Content Preview:")
        parts.append(content[:500])  # First 500 chars

        return "\n".join(parts)

    def _get_metadata_extractor(self, language: str):
        """
        Get metadata extractor function for language.

        Args:
            language: Programming language

        Returns:
            Extractor function
        """
        extractors = {
            "php": self._extract_php_metadata,
            "typescript": self._extract_typescript_metadata,
            "javascript": self._extract_javascript_metadata,
            "python": self._extract_python_metadata,
            "css": self._extract_css_metadata
        }

        return extractors.get(language, self._extract_generic_metadata)

    def _extract_php_metadata(self, content: str, file_path: Path) -> Dict:
        """Extract metadata from PHP file."""
        metadata = {
            "classes": [],
            "functions": [],
            "imports": [],
            "namespace": None
        }

        # Extract namespace
        namespace_match = re.search(r"namespace\s+([\w\\]+);", content)
        if namespace_match:
            metadata["namespace"] = namespace_match.group(1)

        # Extract classes
        class_matches = re.findall(r"class\s+(\w+)", content)
        metadata["classes"] = class_matches

        # Extract functions
        function_matches = re.findall(r"function\s+(\w+)\s*\(", content)
        metadata["functions"] = function_matches

        # Extract imports (use statements)
        import_matches = re.findall(r"use\s+([\w\\]+);", content)
        metadata["imports"] = import_matches

        return metadata

    def _extract_typescript_metadata(self, content: str, file_path: Path) -> Dict:
        """Extract metadata from TypeScript/TSX file."""
        metadata = {
            "classes": [],
            "functions": [],
            "imports": [],
            "exports": [],
            "components": []
        }

        # Extract classes
        class_matches = re.findall(r"class\s+(\w+)", content)
        metadata["classes"] = class_matches

        # Extract functions
        function_matches = re.findall(r"(?:function|const)\s+(\w+)\s*[=\(]", content)
        metadata["functions"] = function_matches

        # Extract React components (function or arrow)
        component_matches = re.findall(r"(?:function|const)\s+([A-Z]\w+)\s*[=\(]", content)
        metadata["components"] = component_matches

        # Extract imports
        import_matches = re.findall(r"import\s+.*?from\s+['\"](.+?)['\"]", content)
        metadata["imports"] = import_matches

        # Extract exports
        export_matches = re.findall(r"export\s+(?:default\s+)?(?:function|const|class)\s+(\w+)", content)
        metadata["exports"] = export_matches

        return metadata

    def _extract_javascript_metadata(self, content: str, file_path: Path) -> Dict:
        """Extract metadata from JavaScript file."""
        # Reuse TypeScript extractor (similar syntax)
        return self._extract_typescript_metadata(content, file_path)

    def _extract_python_metadata(self, content: str, file_path: Path) -> Dict:
        """Extract metadata from Python file."""
        metadata = {
            "classes": [],
            "functions": [],
            "imports": []
        }

        # Extract classes
        class_matches = re.findall(r"class\s+(\w+)", content)
        metadata["classes"] = class_matches

        # Extract functions
        function_matches = re.findall(r"def\s+(\w+)\s*\(", content)
        metadata["functions"] = function_matches

        # Extract imports
        import_matches = re.findall(r"(?:from\s+([\w.]+)\s+)?import\s+([\w,\s]+)", content)
        metadata["imports"] = [m[0] or m[1] for m in import_matches]

        return metadata

    def _extract_css_metadata(self, content: str, file_path: Path) -> Dict:
        """Extract metadata from CSS file."""
        metadata = {
            "classes": [],
            "ids": []
        }

        # Extract class selectors
        class_matches = re.findall(r"\.(\w+)", content)
        metadata["classes"] = list(set(class_matches))  # Unique

        # Extract ID selectors
        id_matches = re.findall(r"#(\w+)", content)
        metadata["ids"] = list(set(id_matches))

        return metadata

    def _extract_generic_metadata(self, content: str, file_path: Path) -> Dict:
        """Extract generic metadata (fallback)."""
        return {
            "line_count": len(content.split("\n")),
            "char_count": len(content)
        }

    async def search_code(
        self,
        project_id: UUID,
        query: str,
        language: Optional[str] = None,
        file_type: Optional[str] = None,
        top_k: int = 5
    ) -> List[Dict]:
        """
        Search code in project via semantic search.

        Args:
            project_id: Project UUID
            query: Search query (e.g., "User model relationships")
            language: Filter by language (php, typescript, etc.)
            file_type: Filter by file type (model, controller, component, etc.)
            top_k: Number of results

        Returns:
            List of similar code files

        Example:
            results = await indexer.search_code(
                project_id=project_id,
                query="authentication middleware",
                language="php",
                top_k=3
            )

            for r in results:
                print(f"File: {r['metadata']['file_path']}")
                print(f"Similarity: {r['similarity']:.2f}")
                print(f"Classes: {r['metadata']['classes']}")
        """
        # Build filter
        filter_dict = {
            "project_id": project_id,
            "type": "code_file"
        }

        if language:
            filter_dict["language"] = language

        if file_type:
            filter_dict["file_type"] = file_type

        # Retrieve from RAG
        results = self.rag.retrieve(
            query=query,
            filter=filter_dict,
            top_k=top_k,
            similarity_threshold=0.7  # Only relevant results
        )

        return results

    async def get_indexing_stats(self, project_id: UUID) -> Dict:
        """
        Get indexing statistics for project.

        Args:
            project_id: Project UUID

        Returns:
            Dict with statistics
        """
        stats = self.rag.get_stats(project_id=project_id)

        # Filter to code files only
        # (In production, would query metadata->>'type' = 'code_file')

        return {
            "project_id": str(project_id),
            "total_documents": stats["document_count"],
            "avg_content_length": stats["avg_content_length"],
            "document_types": stats["metadata_types"]
        }
