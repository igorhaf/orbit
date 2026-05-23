"""Export business rules sintetizadas (pipeline_artifacts.synthesized_rules) como
estrutura Epic > Story no Backlog/Kanban, sem precisar rodar a Fase 4 do Deep Pipeline.

Util quando o Deep Pipeline parou antes de gerar cards (cota Claude, erro upstream).
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.pipeline_artifact import PipelineArtifact, ArtifactType
from app.models.project import Project
from app.models.task import Task, ItemType, TaskStatus, PriorityLevel

logger = logging.getLogger(__name__)
router = APIRouter()


_SEVERITY_TO_PRIORITY = {
    "critical": PriorityLevel.CRITICAL,
    "high": PriorityLevel.HIGH,
    "medium": PriorityLevel.MEDIUM,
    "low": PriorityLevel.LOW,
    "trivial": PriorityLevel.TRIVIAL,
}


def _priority_from_severity(severity: str | None) -> PriorityLevel:
    if not severity:
        return PriorityLevel.MEDIUM
    return _SEVERITY_TO_PRIORITY.get(severity.lower(), PriorityLevel.MEDIUM)


def _build_epic_description(rule_data: dict) -> str:
    """Monta descricao do Epic juntando summary + regras consolidadas + entidades."""
    parts: list[str] = []
    summary = (rule_data.get("domain_summary") or "").strip()
    if summary:
        parts.append(f"## Resumo do dominio\n\n{summary}")

    entities = rule_data.get("domain_entities") or []
    if entities:
        bullets = "\n".join(f"- {e}" for e in entities[:20])
        parts.append(f"## Entidades principais\n\n{bullets}")

    rules = rule_data.get("consolidated_rules") or []
    if rules:
        lines = []
        for r in rules[:30]:
            text = (r.get("rule_text") or "").strip()
            if not text:
                continue
            srcs = r.get("source_files") or []
            src_hint = f" _(arquivos: {', '.join(srcs[:3])})_" if srcs else ""
            lines.append(f"- {text}{src_hint}")
        if lines:
            parts.append("## Regras consolidadas\n\n" + "\n".join(lines))

    implicit = rule_data.get("implicit_rules") or []
    if implicit:
        lines = []
        for r in implicit[:15]:
            text = (r.get("rule_text") or "").strip()
            if text:
                lines.append(f"- {text}")
        if lines:
            parts.append("## Regras implicitas (inferidas)\n\n" + "\n".join(lines))

    return "\n\n".join(parts) or "Sem detalhes adicionais."


def _build_story_from_gap(gap: dict) -> dict[str, Any]:
    title = (gap.get("gap_description") or "Tratar gap detectado").strip()[:255]
    severity = (gap.get("severity") or "medium").strip().lower()
    reason = (gap.get("reason") or "").strip()
    description_parts: list[str] = []
    if reason:
        description_parts.append(f"**Motivo da deteccao:**\n\n{reason}")
    description_parts.append(f"**Severidade detectada pela IA:** `{severity}`")
    return {
        "title": title,
        "description": "\n\n".join(description_parts),
        "priority": _priority_from_severity(severity),
        "labels": ["business-rule-export", f"severity-{severity}"],
    }


@router.post("/{project_id}/business-rules/export-as-tasks")
def export_business_rules_as_tasks(
    project_id: UUID,
    dry_run: bool = Query(False, description="Se true, retorna o que seria criado sem persistir"),
    db: Session = Depends(get_db),
):
    """Cria Epics (por dominio) e Stories (por gap detectado) a partir de synthesized_rules.

    - 1 Epic por dominio (description = resumo + regras consolidadas + entidades + regras implicitas)
    - 1 Story por gap detectado (priority derivada de severity)
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="projeto nao encontrado")

    artifacts = db.query(PipelineArtifact).filter(
        PipelineArtifact.project_id == project_id,
        PipelineArtifact.artifact_type == ArtifactType.synthesized_rules,
    ).all()

    if not artifacts:
        raise HTTPException(
            status_code=400,
            detail="Nenhuma regra sintetizada disponivel pra este projeto. "
                   "Rode o Deep Pipeline ate pelo menos a Fase 2 antes de exportar."
        )

    # Dedup por domain (mantem o mais recente caso ja exista)
    by_domain: dict[str, dict] = {}
    for art in artifacts:
        domain = (art.domain or "").strip() or (art.content or {}).get("domain") or "Sem dominio"
        existing = by_domain.get(domain)
        if not existing or (art.created_at and existing["_created_at"] < art.created_at):
            by_domain[domain] = {
                "_domain": domain,
                "_content": art.content or {},
                "_created_at": art.created_at,
            }

    summary = {
        "domains_found": len(by_domain),
        "epics_planned": len(by_domain),
        "stories_planned": 0,
        "epics_created": 0,
        "stories_created": 0,
        "epic_titles": [],
    }
    for entry in by_domain.values():
        gaps = entry["_content"].get("detected_gaps") or []
        summary["stories_planned"] += len(gaps)

    if dry_run:
        return summary

    # Persiste — Epics primeiro, depois Stories ligadas
    now = datetime.utcnow()
    epic_titles = []
    for entry in by_domain.values():
        domain = entry["_domain"]
        rule_data = entry["_content"]
        epic = Task(
            project_id=project.id,
            title=f"Dominio: {domain}"[:255],
            description=_build_epic_description(rule_data),
            item_type=ItemType.EPIC,
            status=TaskStatus.BACKLOG,
            priority=PriorityLevel.MEDIUM,
            labels=["business-rule-export", "domain"],
            acceptance_criteria=[],
            created_at=now,
        )
        db.add(epic)
        db.flush()  # pega o id
        summary["epics_created"] += 1
        epic_titles.append(domain)

        gaps = rule_data.get("detected_gaps") or []
        for gap in gaps:
            story_data = _build_story_from_gap(gap)
            story = Task(
                project_id=project.id,
                parent_id=epic.id,
                title=story_data["title"],
                description=story_data["description"],
                item_type=ItemType.STORY,
                status=TaskStatus.BACKLOG,
                priority=story_data["priority"],
                labels=story_data["labels"],
                acceptance_criteria=[],
                created_at=now,
            )
            db.add(story)
            summary["stories_created"] += 1

    db.commit()
    summary["epic_titles"] = epic_titles[:20]
    logger.info(
        f"[business-rules-export] project {project_id}: "
        f"{summary['epics_created']} epics, {summary['stories_created']} stories"
    )
    return summary
