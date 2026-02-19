"""
Orbit Folder Service

PROMPT #241 - orbit/ folder architecture inside project code_path.

Creates and manages the orbit/ bridge folder structure:
  {code_path}/orbit/
  {code_path}/orbit/prompts/     <- exported card prompts (.md)
  {code_path}/orbit/results/     <- Claude Code output results (.md)
  {code_path}/orbit/knowledge/   <- additional context files

Human Data Supremacy Rule: this service ONLY writes files when
task.generated_prompt is present (AI-generated). It never overwrites
any file that was not produced by this service.
"""

import json
import logging
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.project import Project
from app.models.task import Task

logger = logging.getLogger(__name__)

ORBIT_SCHEMA_VERSION = "1"


class OrbitFolderService:

    SUBFOLDERS = ("prompts", "results", "knowledge")

    def __init__(self, db: Session):
        self.db = db

    def ensure_orbit_structure(self, project: Project) -> Path:
        """
        Create orbit/ folder and its three subfolders inside code_path.
        Idempotent - safe to call multiple times.
        Returns the orbit/ Path.
        """
        code_path = Path(project.code_path)
        if not code_path.exists():
            raise FileNotFoundError(
                f"code_path nao existe: {code_path}"
            )

        orbit_path = code_path / "orbit"
        orbit_path.mkdir(exist_ok=True)

        for sub in self.SUBFOLDERS:
            (orbit_path / sub).mkdir(exist_ok=True)

        for sub in self.SUBFOLDERS:
            gitkeep = orbit_path / sub / ".gitkeep"
            if not gitkeep.exists():
                gitkeep.touch()

        logger.info(f"Orbit folder structure ensured at {orbit_path}")
        return orbit_path

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

        orbit_path = self.ensure_orbit_structure(project)
        prompts_dir = orbit_path / "prompts"

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
            "orbit_path": str(orbit_path),
        }

    def get_orbit_status(self, project: Project) -> Dict:
        """Return the current state of the orbit/ folder."""
        code_path = Path(project.code_path)
        orbit_path = code_path / "orbit"

        if not orbit_path.exists():
            return {"exists": False, "prompts": 0, "results": 0, "knowledge": 0}

        def _count(sub: str) -> int:
            folder = orbit_path / sub
            if not folder.exists():
                return 0
            return sum(
                1 for f in folder.iterdir()
                if f.is_file() and f.name != ".gitkeep"
            )

        return {
            "exists": True,
            "orbit_path": str(orbit_path),
            "prompts": _count("prompts"),
            "results": _count("results"),
            "knowledge": _count("knowledge"),
        }


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
> Coloque o arquivo de resultado em: `orbit/results/`
"""

    return content
