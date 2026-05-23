"""Agente que classifica pastas/arquivos do projeto como relevantes ou bloqueaveis.

Usa o AIOrchestrator (usage_type=PATTERN_DISCOVERY) pra evitar que bibliotecas,
caches e build outputs poluam a indexacao RAG e a extracao de regras.

Resultados sao gravados em `projects.custom_ignore_patterns` sob as chaves
`ai_directories` / `ai_file_patterns` (cada item: {path, reason}) para distinguir
de bloqueios manuais (`directories` / `file_patterns`).
"""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.project import Project
from app.models.ai_model import AIModelUsageType
from app.services.ai_orchestrator import AIOrchestrator

logger = logging.getLogger(__name__)

# Limites
MAX_SCAN_DEPTH = 4
MAX_PATHS_PER_BATCH = 80
MAX_FILE_PATTERNS_PER_BATCH = 30

# Heuristica: extensoes que sugerem arquivos transitorios/binarios mesmo antes da IA
_LIKELY_BINARY_EXTS = {
    ".lock", ".log", ".tmp", ".bak", ".swp", ".pyc", ".pyo", ".class", ".o",
    ".so", ".dll", ".exe", ".dylib", ".min.js", ".min.css", ".map",
}

# Dirs que ja saem do default hardcoded do CodebaseIndexer — pular IA pra evitar gasto
_HARDCODED_DEFAULTS = {
    "node_modules", ".venv", "venv", "vendor", ".git", ".next", "dist", "build",
    "__pycache__", ".pytest_cache", "coverage", ".idea", ".vscode",
}


SYSTEM_PROMPT = """Voce e um analista de codebase. Recebera uma lista de pastas e arquivos de um projeto e deve decidir, para cada item, se ele:

- e RELEVANTE para entender as regras de negocio do projeto (codigo-fonte, configs, docs, schemas), OU
- e IRRELEVANTE / poluicao (bibliotecas de terceiros, build outputs, caches, lockfiles, binarios, logs, dumps, backups, arquivos gerados).

Responda APENAS um JSON valido no formato:
{
  "blocked": [
    {"path": "<path exato recebido>", "reason": "<motivo curto em portugues>"}
  ]
}

Inclua em "blocked" SOMENTE itens irrelevantes. Itens relevantes nao precisam aparecer no JSON.
Seja conservador: se houver duvida, NAO bloqueie."""


def _list_top_paths(code_path: str, max_depth: int = MAX_SCAN_DEPTH) -> tuple[list[str], list[str]]:
    """Lista pastas (relativas) e amostras de arquivos no projeto, sem entrar em libs ja conhecidas."""
    root = Path(code_path)
    if not root.exists() or not root.is_dir():
        return [], []

    dirs: list[str] = []
    file_patterns: set[str] = set()

    def walk(current: Path, depth: int):
        if depth > max_depth:
            return
        try:
            for item in sorted(current.iterdir()):
                if item.name.startswith("."):
                    # Inclui dotdirs mas pula os obvios
                    if item.is_dir() and item.name not in _HARDCODED_DEFAULTS:
                        rel = str(item.relative_to(root))
                        dirs.append(rel)
                elif item.is_dir():
                    if item.name in _HARDCODED_DEFAULTS:
                        continue
                    rel = str(item.relative_to(root))
                    dirs.append(rel)
                    if depth < max_depth:
                        walk(item, depth + 1)
                elif item.is_file():
                    if item.suffix in _LIKELY_BINARY_EXTS:
                        file_patterns.add(f"*{item.suffix}")
        except (PermissionError, OSError):
            pass

    walk(root, 0)
    return dirs[:200], sorted(file_patterns)[:40]


def _parse_blocked_response(text: str) -> list[dict[str, str]]:
    """Extrai blocos JSON de uma resposta texto, tolerante a explicacoes ao redor."""
    if not text:
        return []
    candidates: list[str] = []
    for match in re.finditer(r"\{[\s\S]*?\}", text):
        candidates.append(match.group(0))
    if not candidates:
        candidates = [text]
    for snippet in candidates:
        try:
            parsed = json.loads(snippet)
        except Exception:
            continue
        blocked = parsed.get("blocked") if isinstance(parsed, dict) else None
        if isinstance(blocked, list):
            cleaned: list[dict[str, str]] = []
            for entry in blocked:
                if isinstance(entry, dict):
                    path_val = (entry.get("path") or entry.get("pattern") or "").strip()
                    reason_val = (entry.get("reason") or "").strip()
                elif isinstance(entry, str):
                    path_val = entry.strip()
                    reason_val = ""
                else:
                    continue
                if path_val:
                    cleaned.append({"path": path_val, "reason": reason_val[:300]})
            return cleaned
    return []


async def _classify_batch(
    orchestrator: AIOrchestrator,
    project_name: str,
    items: list[str],
    is_file_patterns: bool,
) -> list[dict[str, str]]:
    label = "padroes de arquivos" if is_file_patterns else "pastas"
    user_prompt = (
        f"Projeto: {project_name}\n"
        f"Tipo de item: {label}\n\n"
        f"Itens:\n" + "\n".join(f"- {p}" for p in items) +
        "\n\nResponda apenas o JSON com a lista 'blocked'."
    )
    try:
        result = await orchestrator.execute(
            usage_type=AIModelUsageType.PATTERN_DISCOVERY,
            messages=[{"role": "user", "content": user_prompt}],
            system_prompt=SYSTEM_PROMPT,
            max_tokens=4000,
        )
    except Exception as exc:
        logger.warning(f"ai-blocklist agent failed: {exc}")
        return []
    content = (result or {}).get("content") if isinstance(result, dict) else None
    return _parse_blocked_response(content or "")


async def screen_project(db: Session, project_id: UUID | str) -> dict[str, Any]:
    """Roda o agente no projeto e atualiza `custom_ignore_patterns.ai_*`."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise ValueError(f"projeto {project_id} nao encontrado")
    if not project.code_path:
        raise ValueError("projeto sem code_path definido")

    dirs, file_patterns = _list_top_paths(project.code_path)
    if not dirs and not file_patterns:
        logger.info(f"[ai-blocklist] {project.name}: nada a analisar")
        return {"directories": [], "file_patterns": [], "scanned_dirs": 0, "scanned_file_patterns": 0}

    orchestrator = AIOrchestrator(db)

    blocked_dirs: list[dict[str, str]] = []
    for offset in range(0, len(dirs), MAX_PATHS_PER_BATCH):
        chunk = dirs[offset:offset + MAX_PATHS_PER_BATCH]
        blocked_dirs.extend(await _classify_batch(orchestrator, project.name, chunk, False))

    blocked_patterns: list[dict[str, str]] = []
    for offset in range(0, len(file_patterns), MAX_FILE_PATTERNS_PER_BATCH):
        chunk = file_patterns[offset:offset + MAX_FILE_PATTERNS_PER_BATCH]
        blocked_patterns.extend(await _classify_batch(orchestrator, project.name, chunk, True))

    # Persistir junto com manual em custom_ignore_patterns
    current = dict(project.custom_ignore_patterns or {})
    current["ai_directories"] = blocked_dirs
    current["ai_file_patterns"] = blocked_patterns
    current["ai_last_run_at"] = datetime.utcnow().isoformat()
    project.custom_ignore_patterns = current
    db.add(project)
    db.commit()

    logger.info(
        f"[ai-blocklist] {project.name}: bloqueou {len(blocked_dirs)} pastas e "
        f"{len(blocked_patterns)} padroes de arquivos"
    )
    return {
        "directories": blocked_dirs,
        "file_patterns": blocked_patterns,
        "scanned_dirs": len(dirs),
        "scanned_file_patterns": len(file_patterns),
        "last_run_at": current["ai_last_run_at"],
    }


def get_ai_blocklist(project: Project) -> dict[str, Any]:
    cur = project.custom_ignore_patterns or {}
    return {
        "directories": cur.get("ai_directories", []),
        "file_patterns": cur.get("ai_file_patterns", []),
        "last_run_at": cur.get("ai_last_run_at"),
    }


def approve_ai_item(project: Project, path: str, kind: str) -> None:
    """Promove um item AI pra blocklist manual (e remove do AI)."""
    cur = dict(project.custom_ignore_patterns or {})
    key_ai = "ai_directories" if kind == "directory" else "ai_file_patterns"
    key_manual = "directories" if kind == "directory" else "file_patterns"
    ai_list = list(cur.get(key_ai, []))
    manual_list = list(cur.get(key_manual, []))
    cur[key_ai] = [entry for entry in ai_list if (entry.get("path") if isinstance(entry, dict) else entry) != path]
    if path not in manual_list:
        manual_list.append(path)
    cur[key_manual] = manual_list
    project.custom_ignore_patterns = cur


def reject_ai_item(project: Project, path: str, kind: str) -> None:
    """Remove um item AI sem promover (rejeita a sugestao)."""
    cur = dict(project.custom_ignore_patterns or {})
    key_ai = "ai_directories" if kind == "directory" else "ai_file_patterns"
    ai_list = list(cur.get(key_ai, []))
    cur[key_ai] = [entry for entry in ai_list if (entry.get("path") if isinstance(entry, dict) else entry) != path]
    project.custom_ignore_patterns = cur
