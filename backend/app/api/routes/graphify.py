"""Router orbit-side para Graphify. Encaminha pro claudius e adiciona contexto de projeto."""
from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse, JSONResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.project import Project
from app.services.graphify_client import GraphifyClient

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/projects/{project_id}")
async def enqueue_for_project(project_id: UUID, db: Session = Depends(get_db)) -> dict[str, Any]:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="projeto nao encontrado")
    if not project.code_path:
        raise HTTPException(status_code=400, detail="projeto sem code_path definido")

    client = GraphifyClient(db)
    try:
        result = await client.enqueue(folder_path=project.code_path, project_id=str(project_id))
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"claudius retornou {e.response.status_code}: {e.response.text[:200]}")
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"falha de comunicacao com claudius: {e}")
    return result


@router.post("/folder")
async def enqueue_for_folder(payload: dict, db: Session = Depends(get_db)) -> dict[str, Any]:
    folder = payload.get("folder_path")
    if not folder:
        raise HTTPException(status_code=400, detail="folder_path obrigatorio")
    client = GraphifyClient(db)
    try:
        return await client.enqueue(folder_path=folder, project_id=payload.get("project_id"))
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"claudius retornou {e.response.status_code}: {e.response.text[:200]}")


@router.get("/jobs")
async def list_jobs(
    project_id: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    client = GraphifyClient(db)
    jobs = await client.list_jobs(project_id=project_id, limit=limit)
    return {"jobs": jobs}


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    client = GraphifyClient(db)
    job = await client.status(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job nao encontrado")
    return job


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    client = GraphifyClient(db)
    ok = await client.delete_job(job_id)
    if not ok:
        raise HTTPException(status_code=404, detail="job nao encontrado")
    return {"deleted": job_id}


async def _proxy(kind: str, job_id: str, media_type: str, db: Session) -> StreamingResponse:
    client = GraphifyClient(db)
    url = client.proxy_url(job_id, kind)
    headers = client.headers
    upstream = httpx.AsyncClient(timeout=60.0)

    async def gen():
        try:
            async with upstream.stream("GET", url, headers=headers) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    raise HTTPException(status_code=resp.status_code, detail=body.decode("utf-8", errors="replace")[:300])
                async for chunk in resp.aiter_bytes():
                    yield chunk
        finally:
            await upstream.aclose()

    return StreamingResponse(gen(), media_type=media_type)


@router.get("/jobs/{job_id}/html")
async def job_html(job_id: str, db: Session = Depends(get_db)):
    return await _proxy("html", job_id, "text/html", db)


@router.get("/jobs/{job_id}/graph.json")
async def job_graph_json(job_id: str, db: Session = Depends(get_db)):
    return await _proxy("graph.json", job_id, "application/json", db)


@router.get("/jobs/{job_id}/report.md")
async def job_report(job_id: str, db: Session = Depends(get_db)):
    return await _proxy("report.md", job_id, "text/markdown", db)
