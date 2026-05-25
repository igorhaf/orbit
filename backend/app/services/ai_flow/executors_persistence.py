"""Persistence executors — escrevem em DB/RAG store.

TODOS são side_effecting=True. REGRA #0 (human data is sacred): nunca
sobrescrever conteúdo editado manualmente; só inserir novo ou atualizar
itens cuja `source == 'ai_generated'`.

Executors:
  - pipeline_artifact_writer:  PipelineArtifact row
  - wiki_page_writer:          WikiPage (respeita REGRA #0)
  - business_rule_storer:      RAG store de business rule
  - checkpoint_saver:          PipelineRun.checkpoint_state
  - embed_and_store:           RAG store genérico (qualquer doc)
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any
from uuid import uuid4

from .executor import NodeExecutor, NodeExecutionError, ExecutionContext, registry

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# PipelineArtifactWriter
# ─────────────────────────────────────────────────────────────────────────────

@registry.register("pipeline_artifact_writer")
class PipelineArtifactWriterExecutor(NodeExecutor):
    """Escreve uma row em pipeline_artifacts.

    Inputs: `content` (dict — o JSON do artifact).
    Outputs: `artifact` (dict {id, type, phase, project_id}).

    Config:
        artifact_type: string (e.g. 'file_analysis', 'synthesized_rules',
                       'architectural_map', 'epic_generation', etc.)
        phase: int (0-7) — opcional, default inferido pelo type
        domain: string opcional
        source_path: string opcional
    """
    side_effecting = True

    # Mapping default phase por artifact_type (espelha o Deep Pipeline real)
    _DEFAULT_PHASES: dict[str, int] = {
        "file_analysis": 1,
        "synthesized_rules": 2,
        "architectural_map": 3,
        "epic_generation": 4,
        "story_generation": 4,
        "wiki_structure": 5,
        "quality_report": 6,
    }

    async def execute(
        self,
        inputs: dict[str, Any],
        config: dict[str, Any],
        ctx: ExecutionContext,
    ) -> dict[str, Any]:
        if ctx.project is None and ctx.project_id is None:
            raise NodeExecutionError(
                "?", "pipeline_artifact_writer",
                "no project context (ctx.project or project_id required)",
            )
        content = inputs.get("content") if "content" in inputs else (
            next(iter(inputs.values())) if inputs else None
        )
        if not isinstance(content, (dict, list)):
            raise NodeExecutionError(
                "?", "pipeline_artifact_writer",
                f"content must be dict/list, got {type(content).__name__}",
            )

        artifact_type = (config.get("artifact_type") or "").strip()
        if not artifact_type or artifact_type == "auto":
            # Default: try to infer from input — fallback to file_analysis
            artifact_type = "file_analysis"
        phase = config.get("phase")
        if phase is None:
            phase = self._DEFAULT_PHASES.get(artifact_type, 0)

        try:
            from app.models.pipeline_artifact import PipelineArtifact, ArtifactType
            pid = ctx.project_id or (ctx.project.id if ctx.project else None)
            artifact = PipelineArtifact(
                id=uuid4(),
                project_id=pid,
                artifact_type=ArtifactType(artifact_type),
                phase=int(phase),
                domain=config.get("domain"),
                source_path=config.get("source_path"),
                content=content,
            )
            ctx.db.add(artifact)
            ctx.db.commit()
            ctx.db.refresh(artifact)
        except ValueError as e:
            raise NodeExecutionError(
                "?", "pipeline_artifact_writer",
                f"invalid artifact_type {artifact_type!r}: {e}",
                cause=e,
            )
        except Exception as e:
            ctx.db.rollback()
            raise NodeExecutionError(
                "?", "pipeline_artifact_writer",
                f"write failed: {type(e).__name__}: {e}",
                cause=e,
            )

        return {
            "artifact": {
                "id": str(artifact.id),
                "type": artifact_type,
                "phase": phase,
                "project_id": str(pid),
            },
        }


# ─────────────────────────────────────────────────────────────────────────────
# WikiPageWriter — respeita REGRA #0
# ─────────────────────────────────────────────────────────────────────────────

@registry.register("wiki_page_writer")
class WikiPageWriterExecutor(NodeExecutor):
    """Escreve/atualiza uma WikiPage.

    REGRA #0: NUNCA sobrescreve páginas com source='manual' ou 'enrichment'.
    Só insere nova OU atualiza páginas onde source='ai_generated'.

    Inputs: `page` (dict com {slug, title, content, parent_id?, order_index?}).
    Outputs: `page` (dict {id, slug, action: created|updated|skipped}).

    Config:
        respect_human_edits: bool (default True) — desliga só se admin sabe
                              o que está fazendo
    """
    side_effecting = True

    async def execute(
        self,
        inputs: dict[str, Any],
        config: dict[str, Any],
        ctx: ExecutionContext,
    ) -> dict[str, Any]:
        if ctx.project is None and ctx.project_id is None:
            raise NodeExecutionError(
                "?", "wiki_page_writer",
                "no project context",
            )
        page_in = inputs.get("page") if "page" in inputs else (
            next(iter(inputs.values())) if inputs else None
        )
        if not isinstance(page_in, dict):
            raise NodeExecutionError(
                "?", "wiki_page_writer",
                f"page must be dict, got {type(page_in).__name__}",
            )
        slug = (page_in.get("slug") or "").strip()
        title = (page_in.get("title") or "").strip()
        content = page_in.get("content") or ""
        if not slug or not title:
            raise NodeExecutionError(
                "?", "wiki_page_writer",
                "page.slug and page.title are required",
            )

        respect_human = bool(config.get("respect_human_edits", True))
        pid = ctx.project_id or (ctx.project.id if ctx.project else None)

        try:
            from app.models.wiki_page import WikiPage
            existing = (
                ctx.db.query(WikiPage)
                .filter(WikiPage.project_id == pid, WikiPage.slug == slug)
                .first()
            )
            if existing:
                # REGRA #0
                if respect_human and existing.source in ("manual", "enrichment"):
                    return {"page": {
                        "id": str(existing.id),
                        "slug": slug,
                        "action": "skipped",
                        "reason": f"source={existing.source} (REGRA #0)",
                    }}
                existing.title = title
                existing.content = content
                existing.source = "ai_generated"
                existing.updated_at = datetime.utcnow()
                if "parent_id" in page_in:
                    existing.parent_id = page_in["parent_id"]
                if "order_index" in page_in:
                    existing.order_index = page_in["order_index"]
                ctx.db.commit()
                return {"page": {
                    "id": str(existing.id),
                    "slug": slug,
                    "action": "updated",
                }}
            # Insert new
            page = WikiPage(
                id=uuid4(),
                project_id=pid,
                slug=slug,
                title=title,
                content=content,
                parent_id=page_in.get("parent_id"),
                order_index=int(page_in.get("order_index", 0)),
                source=page_in.get("source", "ai_generated"),
            )
            ctx.db.add(page)
            ctx.db.commit()
            ctx.db.refresh(page)
            return {"page": {"id": str(page.id), "slug": slug, "action": "created"}}
        except Exception as e:
            ctx.db.rollback()
            raise NodeExecutionError(
                "?", "wiki_page_writer",
                f"write failed: {type(e).__name__}: {e}",
                cause=e,
            )


# ─────────────────────────────────────────────────────────────────────────────
# BusinessRuleStorer
# ─────────────────────────────────────────────────────────────────────────────

@registry.register("business_rule_storer")
class BusinessRuleStorerExecutor(NodeExecutor):
    """Persiste business rule no RAG store.

    Inputs: `rule` (string ou dict {text, rule_type?, priority?}).
    Outputs: `doc_id` (string).

    Config:
        rule_type: string (default 'domain') — domain | cross_cutting | infra | ui
        priority: string (default 'medium')
    """
    side_effecting = True

    async def execute(
        self,
        inputs: dict[str, Any],
        config: dict[str, Any],
        ctx: ExecutionContext,
    ) -> dict[str, Any]:
        rule = inputs.get("rule") if "rule" in inputs else (
            next(iter(inputs.values())) if inputs else None
        )
        if isinstance(rule, dict):
            text = rule.get("text") or rule.get("content") or ""
            rule_type = rule.get("rule_type") or config.get("rule_type", "domain")
            priority = rule.get("priority") or config.get("priority", "medium")
        elif isinstance(rule, str):
            text = rule
            rule_type = config.get("rule_type", "domain")
            priority = config.get("priority", "medium")
        else:
            raise NodeExecutionError(
                "?", "business_rule_storer",
                f"rule must be string or dict, got {type(rule).__name__}",
            )
        if not text.strip():
            raise NodeExecutionError(
                "?", "business_rule_storer",
                "rule text is empty",
            )

        pid = ctx.project_id or (ctx.project.id if ctx.project else None)
        if not pid:
            raise NodeExecutionError(
                "?", "business_rule_storer",
                "no project context",
            )

        try:
            from app.services.rag_service import RAGService
            rag = RAGService(ctx.db)
            doc_id = rag.store_business_rule(
                project_id=pid,
                rule_text=text,
                rule_type=rule_type,
                priority=priority,
            )
        except Exception as e:
            raise NodeExecutionError(
                "?", "business_rule_storer",
                f"RAG store failed: {type(e).__name__}: {e}",
                cause=e,
            )
        return {"doc_id": str(doc_id) if doc_id else ""}


# ─────────────────────────────────────────────────────────────────────────────
# CheckpointSaver
# ─────────────────────────────────────────────────────────────────────────────

@registry.register("checkpoint_saver")
class CheckpointSaverExecutor(NodeExecutor):
    """Salva checkpoint na PipelineRun (pra resume após crash).

    Inputs: `state` (dict — qualquer JSON serializável).
    Outputs: `saved` (bool).

    Config:
        scope: string (default 'phase') — 'phase' | 'file'
        include_scores: bool (default True)
    """
    side_effecting = True

    async def execute(
        self,
        inputs: dict[str, Any],
        config: dict[str, Any],
        ctx: ExecutionContext,
    ) -> dict[str, Any]:
        state = inputs.get("state") if "state" in inputs else (
            next(iter(inputs.values())) if inputs else None
        )
        if not isinstance(state, dict):
            return {"saved": False}

        # Procura PipelineRun ativo pro project deste ctx
        pid = ctx.project_id or (ctx.project.id if ctx.project else None)
        if not pid:
            # Sem project — salva no AsyncJob.input_data como fallback
            if ctx.job_id:
                try:
                    from app.models.async_job import AsyncJob
                    job = ctx.db.query(AsyncJob).filter(AsyncJob.id == ctx.job_id).first()
                    if job:
                        existing = dict(job.input_data or {})
                        existing.setdefault("checkpoints", []).append({
                            "saved_at": datetime.utcnow().isoformat(),
                            "scope": config.get("scope", "phase"),
                            "state": state,
                        })
                        job.input_data = existing
                        ctx.db.commit()
                        return {"saved": True}
                except Exception:
                    ctx.db.rollback()
            return {"saved": False}

        try:
            from app.models.pipeline_run import PipelineRun
            pipeline_run = (
                ctx.db.query(PipelineRun)
                .filter(PipelineRun.project_id == pid)
                .filter(PipelineRun.status.in_(["running", "interrupted"]))
                .order_by(PipelineRun.created_at.desc())
                .first()
            )
            if not pipeline_run:
                # Cria um pipeline_run novo só pra carregar o checkpoint
                pipeline_run = PipelineRun(
                    id=uuid4(),
                    project_id=pid,
                    profile_name="ai_flow_run",
                    version="v3",
                    status="running",
                    started_at=datetime.utcnow(),
                )
                ctx.db.add(pipeline_run)
            pipeline_run.checkpoint_state = {
                "saved_at": datetime.utcnow().isoformat(),
                "scope": config.get("scope", "phase"),
                "run_id": str(ctx.run_id),
                **state,
            }
            ctx.db.commit()
            return {"saved": True}
        except Exception as e:
            ctx.db.rollback()
            logger.warning(f"checkpoint_saver failed: {e}")
            return {"saved": False}


# ─────────────────────────────────────────────────────────────────────────────
# EmbedAndStore — RAG store genérico
# ─────────────────────────────────────────────────────────────────────────────

@registry.register("embed_and_store")
class EmbedAndStoreExecutor(NodeExecutor):
    """Embed + persiste qualquer documento no RAG store.

    Inputs:
        content: string
        metadata: dict (opcional)
    Outputs: doc_id (string).

    Config:
        collection: string (default 'default')
        embedding_model: string (default 'nomic-embed-text') — informational
    """
    side_effecting = True

    async def execute(
        self,
        inputs: dict[str, Any],
        config: dict[str, Any],
        ctx: ExecutionContext,
    ) -> dict[str, Any]:
        content = inputs.get("content") if "content" in inputs else (
            next(iter(inputs.values())) if inputs else None
        )
        metadata = inputs.get("metadata") or {}
        if not isinstance(content, str) or not content.strip():
            return {"doc_id": ""}

        pid = ctx.project_id or (ctx.project.id if ctx.project else None)

        try:
            from app.services.rag_service import RAGService
            rag = RAGService(ctx.db)
            # rag.store é o método genérico — adapta payload
            meta_dict = dict(metadata)
            meta_dict.setdefault("source", "ai_flow_run")
            meta_dict.setdefault("collection", config.get("collection", "default"))
            if pid:
                meta_dict.setdefault("project_id", str(pid))
            doc_id = rag.store(content=content, metadata=meta_dict)
        except Exception as e:
            raise NodeExecutionError(
                "?", "embed_and_store",
                f"RAG store failed: {type(e).__name__}: {e}",
                cause=e,
            )
        return {"doc_id": str(doc_id) if doc_id else ""}


__all__ = [
    "PipelineArtifactWriterExecutor",
    "WikiPageWriterExecutor",
    "BusinessRuleStorerExecutor",
    "CheckpointSaverExecutor",
    "EmbedAndStoreExecutor",
]
