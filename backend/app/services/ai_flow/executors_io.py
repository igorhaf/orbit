"""I/O node executors — wrap services existentes do orbit pra disponibilizar
no engine: FileScanner, RAGQuery, ContractRenderer, ClaudiusSingleCall.

Estes executors TÊM side-effects/custos:
  - file_scanner: lê filesystem (read-only, mas pode demorar)
  - rag_query: consulta vector DB (read-only)
  - contract_renderer: lê YAML contract (read-only, cached)
  - claudius_single_call: CHAMADA AI (consome quota Claude)

Todos marcam metadados apropriados (cost_bearing, side_effecting) pra
o engine/UI poder advertir o usuário.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from .executor import NodeExecutor, NodeExecutionError, ExecutionContext, registry

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# FileScanner
# ─────────────────────────────────────────────────────────────────────────────

# Constantes mínimas inline (evita acoplar deep_pipeline/utils)
_DEFAULT_SKIP_EXTS = {
    ".css", ".scss", ".less", ".svg", ".png", ".jpg", ".gif", ".ico",
    ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".mp3", ".pdf",
    ".lock", ".map", ".min.js", ".min.css",
}
_DEFAULT_SKIP_DIRS = {
    "node_modules", ".git", ".venv", "venv", "__pycache__", ".next",
    "dist", "build", ".cache", ".pytest_cache", ".mypy_cache",
}


@registry.register("file_scanner")
class FileScannerExecutor(NodeExecutor):
    """Walk filesystem starting from project.code_path, return file inventory.

    Inputs: `project` (dict com code_path) ou herdado do ExecutionContext.project.
    Outputs: `files` (list of {path, abs_path, size, lines, ext}).

    Config:
        max_file_size: int (default 100_000) — bytes
        extensions: list[str] — só estes (vazio = todos exceto SKIP_EXTS)
        follow_symlinks: bool (default False)
    """
    side_effecting = False  # read-only

    async def execute(
        self,
        inputs: dict[str, Any],
        config: dict[str, Any],
        ctx: ExecutionContext,
    ) -> dict[str, Any]:
        # Resolve project
        project_dict = inputs.get("project")
        code_path = None
        if isinstance(project_dict, dict):
            code_path = project_dict.get("code_path")
        if not code_path and ctx.project is not None:
            code_path = getattr(ctx.project, "code_path", None)
        if not code_path:
            raise NodeExecutionError(
                "?", "file_scanner",
                "no project.code_path in inputs nor ctx",
            )
        if not os.path.isdir(code_path):
            raise NodeExecutionError(
                "?", "file_scanner",
                f"code_path not a directory: {code_path}",
            )

        max_file_size = int(config.get("max_file_size", 100_000))
        ext_filter = set(config.get("extensions") or [])
        follow_symlinks = bool(config.get("follow_symlinks", False))

        files: list[dict] = []
        for root, dirs, fnames in os.walk(code_path, followlinks=follow_symlinks):
            # in-place dir filter
            dirs[:] = [d for d in dirs if d not in _DEFAULT_SKIP_DIRS and not d.startswith(".")]
            for fname in fnames:
                ext = os.path.splitext(fname)[1].lower()
                if ext in _DEFAULT_SKIP_EXTS:
                    continue
                if ext_filter and ext not in ext_filter:
                    continue
                fpath = os.path.join(root, fname)
                try:
                    st = os.stat(fpath)
                except OSError:
                    continue
                if st.st_size == 0 or st.st_size > max_file_size:
                    continue
                rel = os.path.relpath(fpath, code_path)
                # Não lê conteúdo aqui — caro pra projetos grandes.
                # Outro executor (content_loader em iteração futura) faz isso.
                files.append({
                    "path": rel,
                    "abs_path": fpath,
                    "size": st.st_size,
                    "extension": ext,
                })
        return {"files": files}


# ─────────────────────────────────────────────────────────────────────────────
# RAGQuery
# ─────────────────────────────────────────────────────────────────────────────

@registry.register("rag_query")
class RAGQueryExecutor(NodeExecutor):
    """Vector search no RAG store.

    Inputs: `query` (string).
    Outputs: `docs` (list of {content, similarity, metadata}).

    Config:
        top_k: int (default 5)
        similarity_threshold: float (default 0.7)
        filter: dict — passes through to RAGService.retrieve
    """

    async def execute(
        self,
        inputs: dict[str, Any],
        config: dict[str, Any],
        ctx: ExecutionContext,
    ) -> dict[str, Any]:
        query = inputs.get("query") if "query" in inputs else (
            next(iter(inputs.values())) if inputs else None
        )
        if not isinstance(query, str) or not query.strip():
            return {"docs": []}

        try:
            from app.services.rag_service import RAGService
            rag = RAGService(ctx.db)
            docs = rag.retrieve(
                query=query,
                top_k=int(config.get("top_k", 5)),
                similarity_threshold=float(config.get("similarity_threshold", 0.7)),
                filter=config.get("filter") or None,
            )
        except Exception as e:
            raise NodeExecutionError("?", "rag_query", f"RAG retrieve failed: {e}", cause=e)

        # Normalize result format
        result = []
        for d in (docs or []):
            if isinstance(d, dict):
                result.append({
                    "content": d.get("content") or d.get("text") or "",
                    "similarity": d.get("similarity") or d.get("score"),
                    "metadata": d.get("metadata") or {},
                })
            else:
                # tuple / object
                result.append({"content": str(d), "similarity": None, "metadata": {}})
        return {"docs": result}


# ─────────────────────────────────────────────────────────────────────────────
# ContractRenderer
# ─────────────────────────────────────────────────────────────────────────────

@registry.register("contract_renderer")
class ContractRendererExecutor(NodeExecutor):
    """Renderiza um contract YAML com variables → produz (system_prompt, user_prompt).

    Inputs: `vars` (dict) ou inputs dict completo é usado como vars.
    Outputs: `prompt` (dict com system, user).

    Config:
        contract_name: string (required)
        allow_partial: bool (default False) — não falha se var faltar
    """

    async def execute(
        self,
        inputs: dict[str, Any],
        config: dict[str, Any],
        ctx: ExecutionContext,
    ) -> dict[str, Any]:
        contract_name = (config.get("contract_name") or "").strip()
        if not contract_name:
            raise NodeExecutionError(
                "?", "contract_renderer",
                "config.contract_name is required",
            )
        # vars = inputs.vars (if exists) ou inputs todo
        variables = inputs.get("vars") if "vars" in inputs else dict(inputs)

        try:
            from app.contracts import get_contract_loader
            loader = get_contract_loader()
            result = loader.render(contract_name, variables=variables)
        except Exception as e:
            if config.get("allow_partial"):
                logger.warning(f"contract_renderer partial render failed: {e}")
                return {"prompt": {"system": "", "user": ""}}
            raise NodeExecutionError("?", "contract_renderer", f"render failed: {e}", cause=e)

        # loader.render retorna tuple (system, user) ou string ou dict
        if isinstance(result, tuple) and len(result) == 2:
            system_prompt, user_prompt = result
        elif isinstance(result, dict):
            system_prompt = result.get("system", "")
            user_prompt = result.get("user", "")
        else:
            system_prompt = ""
            user_prompt = str(result)
        return {"prompt": {"system": system_prompt or "", "user": user_prompt or ""}}


# ─────────────────────────────────────────────────────────────────────────────
# ClaudiusSingleCall (AI — COST BEARING)
# ─────────────────────────────────────────────────────────────────────────────

@registry.register("claudius_single_call")
class ClaudiusSingleCallExecutor(NodeExecutor):
    """Single AI call ao Claudius.

    Inputs:
        - `prompt`: dict {system, user} (do contract_renderer)
        OU
        - `text`: string (user_prompt; system_prompt default)

    Outputs:
        - `response`: dict {text, thinking?, usage}
        - `error`: string (se falhou — outro branch pode tratar)

    Config:
        model: string (default "claude-sonnet-4-6")
        max_tokens: int (default 4000)
        thinking_budget: int (default 0; 0 = disabled)
    """
    cost_bearing = True  # consome quota Claude

    async def execute(
        self,
        inputs: dict[str, Any],
        config: dict[str, Any],
        ctx: ExecutionContext,
    ) -> dict[str, Any]:
        # Resolve system + user
        prompt = inputs.get("prompt")
        if isinstance(prompt, dict):
            system = prompt.get("system", "")
            user = prompt.get("user", "")
        else:
            system = "You are a helpful assistant. Respond with JSON when asked."
            user = inputs.get("text") or (
                next(iter(inputs.values())) if inputs else ""
            )
        if not user:
            raise NodeExecutionError(
                "?", "claudius_single_call",
                "no user prompt provided (need inputs.prompt or inputs.text)",
            )

        model = config.get("model", "claude-sonnet-4-6")
        max_tokens = int(config.get("max_tokens", 4000))
        thinking_budget = int(config.get("thinking_budget", 0))

        try:
            from app.services.claudius_pipeline import ClaudiusPipelineService
            from app.services.claudius_pipeline import ClaudiusPipelineError, ClaudiusQuotaExhaustedError
            # db is the 2nd ctor param — passing ctx.db positionally landed it in
            # `base_url`, then `.rstrip("/")` crashed (Session has no rstrip),
            # making every engine Claudius executor inoperant. Pass by keyword +
            # a usage_type so quota logging isn't silently disabled (CLAUDE.md §5).
            cp = ClaudiusPipelineService(db=ctx.db, default_usage_type="ai_flow")
            thinking = {"type": "enabled", "budget_tokens": thinking_budget} if thinking_budget > 0 else None
            result = await cp.call(
                model=model,
                system_prompt=system or "Respond concisely.",
                user_prompt=user,
                max_tokens=max_tokens,
                thinking=thinking,
            )
        except ClaudiusQuotaExhaustedError as e:
            logger.warning(f"claudius_single_call quota exhausted: {e}")
            return {"response": None, "error": f"quota_exhausted: {e}"}
        except ClaudiusPipelineError as e:
            logger.warning(f"claudius_single_call pipeline error: {e}")
            return {"response": None, "error": f"pipeline_error: {e}"}
        except Exception as e:
            raise NodeExecutionError(
                "?", "claudius_single_call",
                f"{type(e).__name__}: {e}",
                cause=e,
            )

        # Update telemetry on context
        usage = (result.get("usage") if isinstance(result, dict) else None) or {}
        ctx.tokens_in += int(usage.get("input_tokens", 0) or 0)
        ctx.tokens_out += int(usage.get("output_tokens", 0) or 0)

        return {
            "response": {
                "text": result.get("text", "") if isinstance(result, dict) else str(result),
                "thinking": result.get("thinking") if isinstance(result, dict) else None,
                "usage": usage,
            },
            "error": None,
        }


__all__ = [
    "FileScannerExecutor",
    "RAGQueryExecutor",
    "ContractRendererExecutor",
    "ClaudiusSingleCallExecutor",
]
