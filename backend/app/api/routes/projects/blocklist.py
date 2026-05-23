"""Endpoints da blocklist AI de cada projeto.

Diferenca da blocklist global em /api/v1/settings/blocklist:
- aqui sao itens **especificos do projeto**
- decisao feita por um agente AI rodando sobre o code_path do projeto
- aprovacao/rejeicao individuais
"""
from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.project import Project
from app.services.ai_blocklist_agent import (
    approve_ai_item,
    get_ai_blocklist,
    reject_ai_item,
    screen_project,
)

logger = logging.getLogger(__name__)
router = APIRouter()


class AIBlocklistAction(BaseModel):
    path: str
    kind: str  # "directory" | "file_pattern"


@router.get("/{project_id}/blocklist/ai")
def list_ai_blocklist(project_id: UUID, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="projeto nao encontrado")
    return get_ai_blocklist(project)


@router.post("/{project_id}/blocklist/ai/screen")
async def run_ai_blocklist_screen(project_id: UUID, db: Session = Depends(get_db)):
    """Roda o agente AI sobre o code_path e atualiza a lista AI no projeto."""
    try:
        result = await screen_project(db, project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("ai-blocklist screen falhou")
        raise HTTPException(status_code=500, detail=str(e))
    return result


@router.post("/{project_id}/blocklist/ai/approve")
def approve_item(project_id: UUID, action: AIBlocklistAction, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="projeto nao encontrado")
    if action.kind not in ("directory", "file_pattern"):
        raise HTTPException(status_code=400, detail="kind invalido")
    approve_ai_item(project, action.path, action.kind)
    db.add(project)
    db.commit()
    return {"status": "ok", "path": action.path, "moved_to": "manual"}


@router.post("/{project_id}/blocklist/ai/reject")
def reject_item(project_id: UUID, action: AIBlocklistAction, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="projeto nao encontrado")
    if action.kind not in ("directory", "file_pattern"):
        raise HTTPException(status_code=400, detail="kind invalido")
    reject_ai_item(project, action.path, action.kind)
    db.add(project)
    db.commit()
    return {"status": "ok", "path": action.path, "removed": True}
