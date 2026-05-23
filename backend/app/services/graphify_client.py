"""Cliente HTTP que chama o Claudius pra disparar/consultar Graphify
e registra rastros em ai_executions."""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy.orm import Session

from app.models.ai_execution import AIExecution
from app.models.ai_model import AIModelUsageType

logger = logging.getLogger(__name__)

CLAUDIUS_BASE_URL = os.getenv("CLAUDIUS_BASE_URL", "http://claudius-backend:8001")
CLAUDIUS_API_KEY = os.getenv("CLAUDIUS_API_KEY", "123456789")
HTTP_TIMEOUT = 30.0


class GraphifyClient:
    def __init__(self, db: Session):
        self.db = db
        self.base_url = CLAUDIUS_BASE_URL.rstrip("/")
        self.headers = {"x-api-key": CLAUDIUS_API_KEY, "Content-Type": "application/json"}

    async def enqueue(
        self,
        folder_path: str,
        project_id: UUID | str | None = None,
        options: dict | None = None,
    ) -> dict[str, Any]:
        start = time.time()
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            resp = await client.post(
                f"{self.base_url}/api/graphify",
                headers=self.headers,
                json={
                    "folder_path": folder_path,
                    "project_id": str(project_id) if project_id else None,
                    "options": options or {},
                },
            )
            resp.raise_for_status()
            data = resp.json()

        job_id = data.get("job_id")
        self._log_execution(
            project_id=project_id,
            folder_path=folder_path,
            job_id=job_id,
            status_kind="enqueued",
            duration_ms=int((time.time() - start) * 1000),
        )
        return data

    async def status(self, job_id: str) -> dict[str, Any] | None:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            resp = await client.get(
                f"{self.base_url}/api/graphify/{job_id}",
                headers=self.headers,
            )
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.json()

    async def list_jobs(self, project_id: str | None = None, limit: int = 50) -> list[dict]:
        params = {"limit": limit}
        if project_id:
            params["project_id"] = project_id
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            resp = await client.get(
                f"{self.base_url}/api/graphify/jobs",
                headers=self.headers,
                params=params,
            )
            resp.raise_for_status()
            return resp.json().get("jobs", [])

    async def delete_job(self, job_id: str) -> bool:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            resp = await client.delete(
                f"{self.base_url}/api/graphify/{job_id}",
                headers=self.headers,
            )
            return resp.status_code == 200

    def proxy_url(self, job_id: str, kind: str) -> str:
        # kind = html | graph.json | report.md
        return f"{self.base_url}/api/graphify/{job_id}/{kind}"

    def _log_execution(
        self,
        *,
        project_id: UUID | str | None,
        folder_path: str,
        job_id: str | None,
        status_kind: str,
        duration_ms: int = 0,
        error: str | None = None,
    ) -> None:
        try:
            log = AIExecution(
                ai_model_id=None,
                usage_type=AIModelUsageType.PATTERN_DISCOVERY,
                input_messages=[{"role": "user", "content": f"graphify on {folder_path}"}],
                system_prompt=None,
                response_content=None,
                input_tokens=0,
                output_tokens=0,
                total_tokens=0,
                provider="claudius",
                model_name="graphify",
                execution_time_ms=duration_ms,
                execution_metadata={
                    "source": "graphify",
                    "job_id": job_id,
                    "folder_path": folder_path,
                    "project_id": str(project_id) if project_id else None,
                    "kind": status_kind,
                },
                error_message=error,
                created_at=datetime.utcnow(),
            )
            self.db.add(log)
            self.db.commit()
        except Exception as exc:
            try:
                self.db.rollback()
            except Exception:
                pass
            logger.warning(f"ai_executions log falhou (non-blocking): {exc}")

    async def stream_output(self, job_id: str, kind: str):
        """Stream HTML/JSON/MD do Claudius pro frontend.

        Returns an awaitable that yields a stream context manager.
        """
        kind_map = {"html": "html", "graph.json": "graph.json", "report.md": "report.md"}
        if kind not in kind_map:
            raise ValueError(f"kind invalido: {kind}")
        url = f"{self.base_url}/api/graphify/{job_id}/{kind_map[kind]}"
        # caller usa async with client.stream(...) — retorno bruto
        return url
