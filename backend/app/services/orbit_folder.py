"""
Orbit Folder Service

PROMPT #241 - orbit/ folder architecture inside project code_path.
PROMPT #235 - renamed bridge folder from orbit/ to satellite/.

Creates and manages the satellite/ knowledge-base folder structure:
  {code_path}/satellite/
  {code_path}/satellite/prompts/       <- exported card prompts + AI execution logs
  {code_path}/satellite/results/       <- Claude Code output results (.md)
  {code_path}/satellite/knowledge/     <- additional context files
  {code_path}/satellite/docs/          <- public documentation
  {code_path}/satellite/rag/internal/  <- implementation reports
  {code_path}/satellite/rag/docs/      <- general documentation

Human Data Supremacy Rule: this service ONLY writes files when
task.generated_prompt is present (AI-generated). It never overwrites
any file that was not produced by this service.
"""

import logging
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from uuid import UUID

import yaml
from sqlalchemy.orm import Session

from app.models.project import Project
from app.models.task import Task, TaskStatus
from app.models.task_result import TaskResult

logger = logging.getLogger(__name__)

ORBIT_SCHEMA_VERSION = "1"
SATELLITE_DIR = "satellite"  # PROMPT #235 - KB folder name


def ensure_satellite_dirs(code_path: Path) -> Path:
    """
    PROMPT #235 - Create satellite/ KB structure inside code_path.

    Creates code_path itself if it doesn't exist (parents=True).
    Idempotent - safe to call multiple times.
    Returns the satellite/ Path.

    Structure:
      satellite/
        prompts/       .gitkeep
        results/       .gitkeep
        knowledge/     .gitkeep
        docs/          .gitkeep
        rag/
          internal/    .gitkeep
          docs/        .gitkeep
    """
    code_path.mkdir(parents=True, exist_ok=True)

    satellite_path = code_path / SATELLITE_DIR
    satellite_path.mkdir(exist_ok=True)

    # Core leaf subfolders
    for sub in ("prompts", "results", "knowledge", "docs", "wiki"):
        sub_path = satellite_path / sub
        sub_path.mkdir(exist_ok=True)
        gitkeep = sub_path / ".gitkeep"
        if not gitkeep.exists():
            gitkeep.touch()

    # RAG subfolders
    rag_path = satellite_path / "rag"
    rag_path.mkdir(exist_ok=True)
    for sub in ("internal", "docs"):
        sub_path = rag_path / sub
        sub_path.mkdir(exist_ok=True)
        gitkeep = sub_path / ".gitkeep"
        if not gitkeep.exists():
            gitkeep.touch()

    logger.info(f"Satellite KB structure ensured at {satellite_path}")
    return satellite_path


class OrbitFolderService:

    SUBFOLDERS = ("prompts", "results", "knowledge")

    def __init__(self, db: Session):
        self.db = db

    def ensure_orbit_structure(self, project: Project) -> Path:
        """
        Create satellite/ KB folder and all its subfolders inside code_path.
        Idempotent - safe to call multiple times.
        Returns the satellite/ Path.
        """
        code_path = Path(project.code_path)
        if not code_path.exists():
            raise FileNotFoundError(
                f"code_path nao existe: {code_path}"
            )

        return ensure_satellite_dirs(code_path)

    def export_prompt(self, task: Task) -> Dict:
        """
        Export a card's generated_prompt to orbit/prompts/ as a structured .md file.

        Returns:
            {
                "file_path": str,
                "filename": str,
                "orbit_path": str,
            }

        Raises:
            ValueError: if task has no generated_prompt
            FileNotFoundError: if project code_path doesn't exist
        """
        if not task.generated_prompt:
            raise ValueError(
                f"Card '{task.title}' nao tem prompt gerado. "
                "Gere o prompt antes de exportar."
            )

        project = self.db.query(Project).filter(
            Project.id == task.project_id
        ).first()

        if not project:
            raise ValueError(f"Projeto {task.project_id} nao encontrado")

        satellite_path = self.ensure_orbit_structure(project)
        prompts_dir = satellite_path / "prompts"

        filename = _build_orbit_filename(task)
        file_path = prompts_dir / filename

        content = _render_prompt_md(task, project)

        file_path.write_text(content, encoding="utf-8")

        logger.info(
            f"Exported prompt for {task.item_type.value} '{task.title}' "
            f"to {file_path}"
        )

        return {
            "file_path": str(file_path),
            "filename": filename,
            "orbit_path": str(satellite_path),
        }

    def get_orbit_status(self, project: Project) -> Dict:
        """Return the current state of the satellite/ KB folder."""
        code_path = Path(project.code_path)
        satellite_path = code_path / SATELLITE_DIR

        if not satellite_path.exists():
            return {"exists": False, "prompts": 0, "results": 0, "knowledge": 0}

        def _count(sub: str) -> int:
            folder = satellite_path / sub
            if not folder.exists():
                return 0
            return sum(
                1 for f in folder.iterdir()
                if f.is_file() and f.name != ".gitkeep"
            )

        return {
            "exists": True,
            "orbit_path": str(satellite_path),
            "prompts": _count("prompts"),
            "results": _count("results"),
            "knowledge": _count("knowledge"),
        }

    # =========================================================================
    # PROMPT #242 - Result detection and processing
    # =========================================================================

    def scan_results(self, project: Project) -> List[Dict]:
        """
        Scan orbit/results/ for unprocessed result files.

        Returns list of dicts with card_id, task, filename, file_path,
        content, and front_matter for each unprocessed result.
        """
        results_dir = Path(project.code_path) / SATELLITE_DIR / "results"
        if not results_dir.exists():
            return []

        unprocessed = []
        for md_file in sorted(results_dir.glob("*_RESULT.md")):
            try:
                front_matter, body = _parse_front_matter(md_file)
                if not front_matter:
                    logger.warning(f"No front matter in {md_file.name}, skipping")
                    continue

                card_id = front_matter.get("orbit_card_id")
                if not card_id:
                    logger.warning(f"No orbit_card_id in {md_file.name}, skipping")
                    continue

                task = self.db.query(Task).filter(Task.id == card_id).first()
                if not task:
                    logger.warning(f"Card {card_id} not found for {md_file.name}")
                    continue

                # Skip if already processed (same file path in TaskResult)
                existing = self.db.query(TaskResult).filter(
                    TaskResult.task_id == card_id
                ).first()
                if existing and existing.file_path == str(md_file):
                    continue

                unprocessed.append({
                    "card_id": str(card_id),
                    "task": task,
                    "filename": md_file.name,
                    "file_path": str(md_file),
                    "content": body,
                    "front_matter": front_matter,
                })
            except Exception as e:
                logger.warning(f"Error scanning {md_file.name}: {e}")

        return unprocessed

    def process_result(self, result_item: Dict) -> Dict:
        """
        Process a single result file and link it to its card.

        Creates or updates TaskResult with the result content,
        then updates card status to REVIEW.
        """
        task = result_item["task"]
        content = result_item["content"]
        file_path = result_item["file_path"]

        # Create or update TaskResult
        existing = self.db.query(TaskResult).filter(
            TaskResult.task_id == task.id
        ).first()

        if existing:
            existing.output_code = content
            existing.file_path = file_path
            existing.updated_at = datetime.utcnow()
        else:
            task_result = TaskResult(
                task_id=task.id,
                output_code=content,
                file_path=file_path,
                model_used="claude-code-manual",
                validation_passed=None,
                attempts=1,
            )
            self.db.add(task_result)

        # Update task status to REVIEW
        old_status = task.status.value if task.status else "unknown"
        task.status = TaskStatus.REVIEW
        task.workflow_state = "review"
        task.updated_at = datetime.utcnow()

        self.db.commit()

        logger.info(
            f"Processed result for {task.item_type.value} '{task.title}' "
            f"({old_status} -> review) from {result_item['filename']}"
        )

        return {
            "task_id": str(task.id),
            "title": task.title,
            "status": "review",
            "filename": result_item["filename"],
        }

    # =========================================================================
    # PROMPT #243 - Knowledge upload to orbit/knowledge/
    # =========================================================================

    def upload_knowledge(self, project: Project, filename: str, content: bytes) -> Dict:
        """
        Save a file to orbit/knowledge/ on disk.

        Returns:
            {
                "file_path": str,
                "filename": str,
                "size_bytes": int,
                "orbit_path": str,
            }
        """
        orbit_path = self.ensure_orbit_structure(project)
        knowledge_dir = orbit_path / "knowledge"

        # Sanitize filename to prevent path traversal
        safe_name = Path(filename).name
        if not safe_name or safe_name.startswith('.'):
            raise ValueError(f"Nome de arquivo inválido: {filename}")

        file_path = knowledge_dir / safe_name

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
        List all files in orbit/knowledge/ (excluding .gitkeep).

        Returns list of dicts with filename, size_bytes, modified_at.
        """
        knowledge_dir = Path(project.code_path) / SATELLITE_DIR / "knowledge"
        if not knowledge_dir.exists():
            return []

        files = []
        for f in sorted(knowledge_dir.iterdir()):
            if f.is_file() and f.name != ".gitkeep":
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
        Delete a file from orbit/knowledge/.

        Returns True if deleted, False if not found.
        """
        knowledge_dir = Path(project.code_path) / SATELLITE_DIR / "knowledge"
        safe_name = Path(filename).name
        file_path = knowledge_dir / safe_name

        if not file_path.exists() or not file_path.is_file():
            return False

        file_path.unlink()
        logger.info(f"Deleted knowledge file '{safe_name}' from {knowledge_dir}")
        return True

    def check_result_for_task(self, task: Task) -> Optional[Dict]:
        """
        Check if a specific task has a result file in orbit/results/.

        Returns processed result dict or None if not found.
        """
        project = self.db.query(Project).filter(
            Project.id == task.project_id
        ).first()
        if not project or not project.code_path:
            return None

        results = self.scan_results(project)
        for result_item in results:
            if result_item["card_id"] == str(task.id):
                return self.process_result(result_item)

        return None


# =============================================================================
# Private helpers
# =============================================================================

def _build_orbit_filename(task: Task) -> str:
    """
    Build the canonical orbit filename for a card.

    Example: TASK_a3f2_implementar_autenticacao.md
    Pattern: {ITEM_TYPE_UPPER}_{short_id}_{title_slug}.md
    """
    item_type = task.item_type.value.upper()
    short_id = str(task.id).replace('-', '')[:4]
    title_slug = _slugify(task.title or "sem_titulo", max_chars=40)
    return f"{item_type}_{short_id}_{title_slug}.md"


def _slugify(text: str, max_chars: int = 40) -> str:
    """Convert arbitrary text to a safe filename slug."""
    text = unicodedata.normalize('NFKD', text)
    text = ''.join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r'[^a-z0-9]+', '_', text.lower())
    text = re.sub(r'_+', '_', text).strip('_')
    return text[:max_chars].rstrip('_')


def _render_prompt_md(task: Task, project: Project) -> str:
    """Render the complete prompt .md content with YAML front matter."""
    now_iso = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    short_id = str(task.id).replace('-', '')[:4]

    # Semantic map
    semantic_map_section = ""
    if task.interview_insights and isinstance(task.interview_insights, dict):
        sm = task.interview_insights.get("semantic_map", {})
        if sm:
            lines = [f"- **{k}**: {v}" for k, v in sm.items()]
            semantic_map_section = "## Mapa Semantico\n\n" + "\n".join(lines) + "\n"

    # Acceptance criteria
    ac_section = ""
    if task.acceptance_criteria:
        items = []
        for ac in task.acceptance_criteria:
            if isinstance(ac, dict):
                items.append(f"- [ ] {ac.get('text', str(ac))}")
            else:
                items.append(f"- [ ] {ac}")
        ac_section = "## Criterios de Aceitacao\n\n" + "\n".join(items) + "\n"

    # Project context
    project_context = (
        project.context_human
        or project.context_semantic
        or "Contexto nao disponivel"
    )
    # Limit context to avoid huge files
    if len(project_context) > 3000:
        project_context = project_context[:3000] + "\n\n(...truncado)"

    # Result filename hint
    base = _build_orbit_filename(task)
    result_filename = base.replace(".md", "_RESULT.md")

    content = f"""---
orbit_card_id: {task.id}
orbit_item_type: {task.item_type.value.upper()}
orbit_project_id: {task.project_id}
orbit_project_name: {project.name}
orbit_short_id: {short_id}
orbit_title: {task.title}
orbit_priority: {task.priority.value if task.priority else 'medium'}
orbit_story_points: {task.story_points or 'N/A'}
orbit_parent_id: {task.parent_id or 'N/A'}
orbit_exported_at: {now_iso}
orbit_schema_version: "{ORBIT_SCHEMA_VERSION}"
---

# {task.item_type.value.upper()}: {task.title}

## Contexto do Projeto

{project_context}

## Descricao

{task.description or "Sem descricao disponivel."}

{semantic_map_section}
{ac_section}
## Prompt de Execucao

{task.generated_prompt}

---

> Exportado pelo ORBIT em {now_iso}
> Arquivo de resultado esperado: `{result_filename}`
> Coloque o arquivo de resultado em: `satellite/results/`
"""

    return content


def _parse_front_matter(file_path: Path) -> Tuple[Optional[Dict], str]:
    """
    Parse YAML front matter from a markdown file.

    Returns (front_matter_dict, body_text).
    Returns (None, full_text) if no valid front matter found.
    """
    try:
        text = file_path.read_text(encoding="utf-8")
    except Exception:
        return None, ""

    if not text.startswith("---"):
        return None, text

    end_marker = text.find("---", 3)
    if end_marker < 0:
        return None, text

    yaml_text = text[3:end_marker].strip()
    body = text[end_marker + 3:].strip()

    try:
        front_matter = yaml.safe_load(yaml_text)
        if not isinstance(front_matter, dict):
            return None, text
        return front_matter, body
    except yaml.YAMLError:
        return None, text
