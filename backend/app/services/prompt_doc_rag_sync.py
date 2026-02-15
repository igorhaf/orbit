"""
Prompt Documentation & Git Commit RAG Sync Service
PROMPT #157 - Ingest PROMPT docs and git commits into RAG

Two sync targets:
1. PROMPT_*.md files (global knowledge) — chunked and stored with
   content_type=prompt_doc so the AI can retrieve architectural decisions,
   bug-fix rationale, and feature context when generating cards or running tasks.

2. Git commits from a project's code_path — each commit message + body is stored
   per-project so the AI has a timeline of changes when reasoning about that repo.

Both sources use the existing _chunk_document() chunking strategy from knowledge.py
and deduplicate via metadata (prompt_number for docs, commit hash for git).
"""

import logging
import os
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Chunking helper (mirrors knowledge.py::_chunk_document)
# ---------------------------------------------------------------------------


def _chunk_document(doc_text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
    if len(doc_text) <= chunk_size:
        return [doc_text]

    chunks: List[str] = []
    start = 0

    while start < len(doc_text):
        end = start + chunk_size

        if end < len(doc_text):
            para_break = doc_text.rfind("\n\n", start, end)
            if para_break > start + chunk_size // 2:
                end = para_break + 2
            else:
                for sep in [". ", "! ", "? ", "\n"]:
                    sentence_break = doc_text.rfind(sep, start, end)
                    if sentence_break > start + chunk_size // 2:
                        end = sentence_break + len(sep)
                        break

        chunk = doc_text[start:end].strip()
        if chunk:
            chunks.append(chunk)

        start = end - overlap

    return chunks


# ---------------------------------------------------------------------------
# PROMPT doc sync
# ---------------------------------------------------------------------------


class PromptDocRAGSync:
    """
    Reads PROMPT_*.md files from the project root and indexes them in RAG
    as global knowledge (project_id=None).

    Deduplication: before storing a file we check whether a document with
    metadata prompt_number == N already exists.  If so, we skip it.
    """

    def __init__(self, db: Session, docs_root: Optional[str] = None):
        self.db = db
        self.rag = RAGService(db)
        # Default: one level up from backend/ → project root
        self.docs_root = Path(docs_root) if docs_root else Path(__file__).resolve().parents[3]

    # --- public API --------------------------------------------------------

    def sync_all(self) -> Dict:
        """
        Scan docs_root for PROMPT_*.md, index any that are not yet in RAG.

        Returns:
            {total, synced, skipped, errors: []}
        """
        result: Dict = {"total": 0, "synced": 0, "skipped": 0, "errors": []}

        prompt_files = sorted(self.docs_root.glob("PROMPT_*.md"))
        result["total"] = len(prompt_files)

        already_indexed = self._get_indexed_prompt_numbers()

        for path in prompt_files:
            prompt_number = self._extract_prompt_number(path.name)
            if prompt_number is None:
                result["errors"].append({"file": path.name, "error": "Nao foi possivel analisar numero do prompt"})
                continue

            # Use filename as unique key so different PROMPT_42_*.md files are
            # each tracked independently.
            if path.name in already_indexed:
                result["skipped"] += 1
                continue

            try:
                self._index_prompt_doc(path, prompt_number)
                result["synced"] += 1
                logger.info(f"Indexed PROMPT doc: {path.name}")
            except Exception as e:
                result["errors"].append({"file": path.name, "error": str(e)})
                logger.error(f"Failed to index {path.name}: {e}")

        return result

    # --- internals ---------------------------------------------------------

    def _get_indexed_prompt_numbers(self) -> set:
        """Return set of filenames already in RAG."""
        query = text("""
            SELECT DISTINCT metadata->>'filename' as filename
            FROM rag_documents
            WHERE metadata->>'content_type' = 'prompt_doc'
        """)
        rows = self.db.execute(query).fetchall()
        return {row.filename for row in rows if row.filename}

    def _extract_prompt_number(self, filename: str) -> Optional[int]:
        """PROMPT_42_FOO.md → 42"""
        parts = filename.replace("PROMPT_", "").split("_", 1)
        try:
            return int(parts[0])
        except (ValueError, IndexError):
            return None

    def _index_prompt_doc(self, path: Path, prompt_number: int):
        """Read file, chunk, store each chunk."""
        content = path.read_text(encoding="utf-8", errors="ignore")
        chunks = _chunk_document(content, chunk_size=600, overlap=60)

        for i, chunk in enumerate(chunks):
            self.rag.store(
                content=chunk,
                metadata={
                    "content_type": "prompt_doc",
                    "filename": path.name,
                    "prompt_number": prompt_number,
                    "chunk_index": i,
                    "total_chunks": len(chunks),
                    "source": "prompt_doc_sync",
                    "synced_at": datetime.utcnow().isoformat(),
                },
                project_id=None,  # global knowledge
            )


# ---------------------------------------------------------------------------
# Git commit sync (per-project)
# ---------------------------------------------------------------------------


def _run_git(code_path: str, args: List[str]) -> Optional[str]:
    """Run a git command; return stdout or None on failure."""
    try:
        result = subprocess.run(
            ["git"] + args,
            cwd=code_path,
            capture_output=True,
            text=True,
            timeout=30,
        )
        return result.stdout.strip() if result.returncode == 0 else None
    except Exception:
        return None


class GitCommitRAGSync:
    """
    Reads git log from a project's code_path and stores each commit
    (subject + body) in RAG scoped to that project.

    Deduplication: skips commits whose hash is already in RAG metadata.
    """

    def __init__(self, db: Session, project_id: UUID, code_path: str):
        self.db = db
        self.project_id = project_id
        self.code_path = code_path
        self.rag = RAGService(db)

    def sync(self, max_commits: int = 100) -> Dict:
        """
        Pull the last *max_commits* from git log and index new ones.

        Returns:
            {total_read, synced, skipped, errors: []}
        """
        result: Dict = {"total_read": 0, "synced": 0, "skipped": 0, "errors": []}

        if not os.path.isdir(self.code_path):
            result["errors"].append({"error": f"code_path nao existe: {self.code_path}"})
            return result

        # format: hash\x1fsubject\x1fbody\x1erecord separator between commits
        sep_record = "\x1e"
        sep_field = "\x1f"
        log_format = f"%H{sep_field}%s{sep_field}%b{sep_record}"

        output = _run_git(self.code_path, [
            "log",
            f"--format={log_format}",
            f"--max-count={max_commits}",
        ])

        if output is None:
            result["errors"].append({"error": "git log falhou ou nao e um repositorio git"})
            return result

        already_indexed = self._get_indexed_hashes()
        records = output.split(sep_record)

        for record in records:
            record = record.strip()
            if not record:
                continue

            parts = record.split(sep_field, 2)
            if len(parts) < 2:
                continue

            commit_hash = parts[0].strip()
            subject = parts[1].strip()
            body = parts[2].strip() if len(parts) > 2 else ""

            result["total_read"] += 1

            if commit_hash in already_indexed:
                result["skipped"] += 1
                continue

            try:
                content = f"{subject}\n\n{body}".strip() if body else subject
                self.rag.store(
                    content=content,
                    metadata={
                        "content_type": "git_commit",
                        "commit_hash": commit_hash,
                        "short_hash": commit_hash[:8],
                        "source": "git_commit_sync",
                        "synced_at": datetime.utcnow().isoformat(),
                    },
                    project_id=self.project_id,
                )
                result["synced"] += 1
                logger.info(f"Indexed commit {commit_hash[:8]} for project {self.project_id}")
            except Exception as e:
                result["errors"].append({"commit": commit_hash[:8], "error": str(e)})
                logger.error(f"Failed to index commit {commit_hash[:8]}: {e}")

        return result

    # --- internals ---------------------------------------------------------

    def _get_indexed_hashes(self) -> set:
        """Return set of commit hashes already stored for this project."""
        query = text("""
            SELECT DISTINCT metadata->>'commit_hash' as commit_hash
            FROM rag_documents
            WHERE project_id = :project_id
              AND metadata->>'content_type' = 'git_commit'
        """)
        rows = self.db.execute(query, {"project_id": str(self.project_id)}).fetchall()
        return {row.commit_hash for row in rows if row.commit_hash}
