"""AI Flow Engine — interpreta o grafo do canvas e executa node-by-node.

Arquitetura em 4 conceitos:

  ┌──────────────────┐
  │  NodeExecutor    │  ABC — cada `kind` (file_scanner, json_extractor, ...)
  │                  │       é uma subclass que implementa async execute().
  └──────────────────┘

  ┌──────────────────┐
  │  NodeRegistry    │  Singleton: kind → NodeExecutor class.
  │                  │  Executors se registram via @registry.register("kind").
  └──────────────────┘

  ┌──────────────────┐
  │ ExecutionContext │  Estado da run: db session, ws_emit, project, run_id,
  │                  │  outputs por node, telemetria.
  └──────────────────┘

  ┌──────────────────┐
  │  GraphExecutor   │  BFS topológico do grafo. Pra cada node em ordem:
  │                  │   1. coleta inputs dos predecessores
  │                  │   2. resolve NodeExecutor via registry
  │                  │   3. await executor.execute(inputs, config, ctx)
  │                  │   4. armazena output → propaga pros sucessores
  │                  │  Emite telemetry/progresso via ws_emit_fn.
  └──────────────────┘
"""
from __future__ import annotations

import asyncio
import logging
import time
from abc import ABC, abstractmethod
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional
from uuid import UUID, uuid4

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Errors
# ─────────────────────────────────────────────────────────────────────────────

class NodeExecutionError(Exception):
    """Raised when a node fails. Carries node_id + kind + original cause."""
    def __init__(self, node_id: str, kind: str, message: str, *, cause: Exception | None = None):
        self.node_id = node_id
        self.kind = kind
        self.cause = cause
        super().__init__(f"[{kind}@{node_id}] {message}")


class GraphValidationError(Exception):
    """Raised when graph structure prevents execution (cycle, missing executor, etc)."""


# ─────────────────────────────────────────────────────────────────────────────
# ExecutionContext — passed to every NodeExecutor.execute()
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ExecutionContext:
    """Per-run state shared across all node executions."""
    run_id: UUID                                              # this run's unique id
    db: Any                                                   # SQLAlchemy session
    project_id: Optional[UUID] = None                         # project the run targets (if any)
    project: Optional[Any] = None                             # eagerly-loaded Project row
    ws_emit: Optional[Callable[[str, dict], Awaitable[None]]] = None  # async fn: (event, payload) -> None
    job_id: Optional[UUID] = None                             # AsyncJob backing this run

    # Per-node outputs (populated by GraphExecutor as nodes complete).
    # key = source_node_id; value = dict of output_handle → value (or single value if 1 output).
    outputs: dict[str, dict[str, Any]] = field(default_factory=dict)

    # Cumulative telemetry
    started_at: float = field(default_factory=time.monotonic)
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: float = 0.0
    nodes_executed: int = 0
    nodes_failed: int = 0

    async def emit(self, event: str, payload: dict) -> None:
        """Send a WS event (no-op if ws_emit not provided)."""
        if self.ws_emit:
            try:
                await self.ws_emit(event, payload)
            except Exception as e:  # nunca derrubar a execução por WS
                logger.warning(f"ws_emit failed: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# ExecutionResult — returned by GraphExecutor.run()
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ExecutionResult:
    run_id: UUID
    ok: bool
    nodes_executed: int
    nodes_failed: int
    duration_seconds: float
    tokens_in: int
    tokens_out: int
    cost_usd: float
    outputs: dict[str, dict[str, Any]]                      # final outputs por node
    errors: list[dict[str, str]] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# NodeExecutor — base interface
# ─────────────────────────────────────────────────────────────────────────────

class NodeExecutor(ABC):
    """Base class for all node executors. Subclass + register via @registry.register("kind")."""

    # Per-class metadata (override in subclass)
    kind: str = ""                                          # must match the node `data.kind`
    cost_bearing: bool = False                              # marks AI/quota-consuming ops
    side_effecting: bool = False                            # marks DB writes / external mutations

    @abstractmethod
    async def execute(
        self,
        inputs: dict[str, Any],
        config: dict[str, Any],
        ctx: ExecutionContext,
    ) -> dict[str, Any]:
        """Run the node.

        Args:
            inputs: dict keyed by INPUT handle name; values come from upstream nodes' outputs.
            config: node.data.config (user-edited via NodeInspector).
            ctx: shared ExecutionContext.

        Returns:
            dict keyed by OUTPUT handle name; values propagated to downstream nodes.

        Raises:
            NodeExecutionError if execution fails.
        """
        raise NotImplementedError


# ─────────────────────────────────────────────────────────────────────────────
# NodeRegistry — kind → NodeExecutor class
# ─────────────────────────────────────────────────────────────────────────────

class NodeRegistry:
    """Maps kind strings to NodeExecutor classes."""

    def __init__(self):
        self._executors: dict[str, type[NodeExecutor]] = {}

    def register(self, kind: str):
        """Decorator: register a NodeExecutor class under `kind`.

        Usage:
            @registry.register("json_extractor")
            class JSONExtractorExecutor(NodeExecutor):
                ...
        """
        def deco(cls: type[NodeExecutor]) -> type[NodeExecutor]:
            cls.kind = kind
            if kind in self._executors:
                logger.warning(f"NodeRegistry: overwriting existing executor for kind={kind!r}")
            self._executors[kind] = cls
            return cls
        return deco

    def get(self, kind: str) -> type[NodeExecutor] | None:
        return self._executors.get(kind)

    def all_kinds(self) -> list[str]:
        return sorted(self._executors.keys())

    def __contains__(self, kind: str) -> bool:
        return kind in self._executors


# Module-level singleton instance.
registry = NodeRegistry()


# ─────────────────────────────────────────────────────────────────────────────
# GraphExecutor — topological execution of the canvas graph
# ─────────────────────────────────────────────────────────────────────────────

class GraphExecutor:
    """Executes a canvas graph node-by-node in topological order.

    A "graph" is the same shape returned by /canvas-snapshot:
        {
            "nodes": [{id, type, data: {kind, config, ...}, parentId?}, ...],
            "edges": [{source, target, sourceHandle?, targetHandle?, data}],
            "subflows": {id: {node_ids, ...}},
        }

    Execution skips purely VISUAL nodes (groupNode, subflowNode, ioNode):
    those have no executor and contribute nothing to the data flow.
    """

    # Node types that DON'T execute (visuals/containers)
    _SKIP_TYPES = {"groupNode", "subflowNode", "ioNode"}

    # Kinds que produzem branches condicionais (some outputs ficam None
    # quando aquele branch não está ativo). Successors via handle None
    # são marcados como skipped (propagação transparente).
    _BRANCHING_KINDS = {"if_else", "switch"}

    def __init__(
        self,
        graph: dict[str, Any],
        ctx: ExecutionContext,
        node_registry: NodeRegistry | None = None,
    ):
        self.graph = graph
        self.ctx = ctx
        self.registry = node_registry or registry
        self.nodes_by_id: dict[str, dict] = {n["id"]: n for n in graph.get("nodes", [])}
        self.edges = list(graph.get("edges", []))
        # v3.7.1: set de nodes a pular (decidido em runtime pelo branch-skip).
        # Propagação: se TODOS os predecessores executáveis estão skipped,
        # este node também é skipped (não há dado pra processar).
        self._skipped: set[str] = set()

    # ── Public ────────────────────────────────────────────────────────────

    async def run(self, initial_inputs: dict[str, Any] | None = None) -> ExecutionResult:
        """Execute the entire graph. Returns ExecutionResult.

        `initial_inputs` is propagated as the output of any node with no
        incoming edges (e.g. the first FileScanner gets the project).
        """
        # Validation phase
        order = self._topological_order()
        await self.ctx.emit("graph_started", {
            "run_id": str(self.ctx.run_id),
            "total_nodes": len(order),
        })

        errors: list[dict[str, str]] = []
        initial_inputs = initial_inputs or {}

        for node_id in order:
            node = self.nodes_by_id[node_id]
            kind = self._kind_of(node)

            # v3.7.1: branch-skip — se este node foi marcado como skipped
            # (propagação de branch inativo), não executa. Emite evento e
            # propaga skip pra seus successors.
            if node_id in self._skipped:
                await self.ctx.emit("node_skipped", {
                    "run_id": str(self.ctx.run_id),
                    "node_id": node_id,
                    "kind": kind,
                    "reason": "predecessor branch inactive",
                })
                # Output vazio mas registrado pra successors saberem que existe
                self.ctx.outputs[node_id] = {}
                self._propagate_skip(node_id, all_handles_inactive=True)
                continue

            await self.ctx.emit("node_started", {
                "run_id": str(self.ctx.run_id),
                "node_id": node_id,
                "kind": kind,
            })

            try:
                inputs = self._gather_inputs(node_id, initial_inputs)
                executor_cls = self.registry.get(kind)
                if executor_cls is None:
                    raise NodeExecutionError(
                        node_id, kind,
                        f"no executor registered for kind={kind!r}. "
                        f"Available: {self.registry.all_kinds()}",
                    )
                executor = executor_cls()
                config = node.get("data", {}).get("config", {}) or {}
                t0 = time.monotonic()
                output = await executor.execute(inputs, config, self.ctx)
                duration_ms = int((time.monotonic() - t0) * 1000)

                if not isinstance(output, dict):
                    raise NodeExecutionError(
                        node_id, kind,
                        f"executor returned {type(output).__name__}, expected dict",
                    )

                self.ctx.outputs[node_id] = output
                self.ctx.nodes_executed += 1
                await self.ctx.emit("node_completed", {
                    "run_id": str(self.ctx.run_id),
                    "node_id": node_id,
                    "kind": kind,
                    "duration_ms": duration_ms,
                    "output_keys": list(output.keys()),
                })

                # v3.7.1: se este node é branching (if_else/switch), marca
                # successors dos handles inativos (None) como skipped.
                if kind in self._BRANCHING_KINDS:
                    self._skip_inactive_branches(node_id, output)
            except NodeExecutionError as e:
                self.ctx.nodes_failed += 1
                errors.append({
                    "node_id": node_id,
                    "kind": kind,
                    "message": str(e),
                })
                await self.ctx.emit("node_failed", {
                    "run_id": str(self.ctx.run_id),
                    "node_id": node_id,
                    "kind": kind,
                    "error": str(e),
                })
                logger.error(f"node {node_id} ({kind}) failed: {e}")
                # Por enquanto, falha PARA tudo. Em iteração futura: respeitar
                # `error` output handles dos executors (json_extractor, claudius)
                # pra permitir fluxo de tratamento de erro.
                break
            except Exception as e:
                # Unexpected — wrap and stop
                self.ctx.nodes_failed += 1
                errors.append({
                    "node_id": node_id,
                    "kind": kind,
                    "message": f"{type(e).__name__}: {e}",
                })
                logger.exception(f"unexpected error in node {node_id} ({kind})")
                await self.ctx.emit("node_failed", {
                    "run_id": str(self.ctx.run_id),
                    "node_id": node_id,
                    "kind": kind,
                    "error": f"{type(e).__name__}: {e}",
                })
                break

        duration = time.monotonic() - self.ctx.started_at
        result = ExecutionResult(
            run_id=self.ctx.run_id,
            ok=len(errors) == 0,
            nodes_executed=self.ctx.nodes_executed,
            nodes_failed=self.ctx.nodes_failed,
            duration_seconds=duration,
            tokens_in=self.ctx.tokens_in,
            tokens_out=self.ctx.tokens_out,
            cost_usd=self.ctx.cost_usd,
            outputs=dict(self.ctx.outputs),
            errors=errors,
        )
        await self.ctx.emit("graph_completed", {
            "run_id": str(self.ctx.run_id),
            "ok": result.ok,
            "nodes_executed": result.nodes_executed,
            "nodes_failed": result.nodes_failed,
            "duration_seconds": result.duration_seconds,
        })
        return result

    # ── Internal helpers ──────────────────────────────────────────────────

    def _kind_of(self, node: dict) -> str:
        """Resolve the executable kind of a node.

        Most nodes carry kind in `data.kind` (utility/control flow).
        modelNode → `claudius_single_call` (or batch, based on data.call_kind).
        """
        ntype = node.get("type")
        data = node.get("data", {}) or {}
        if ntype == "modelNode":
            call_kind = data.get("call_kind")
            if call_kind == "batch":
                return "claudius_batch_call"
            return "claudius_single_call"
        return data.get("kind", "")

    def _is_executable(self, node: dict) -> bool:
        return node.get("type") not in self._SKIP_TYPES

    def _topological_order(self) -> list[str]:
        """Return executable nodes in topological order. Raises if cycle detected.

        Algorithm: Kahn's BFS — start from nodes with indegree 0, peel layers.
        Cycle detected if not all nodes were processed at the end.

        Visual nodes (groupNode, subflowNode, ioNode) are EXCLUDED from execution
        but still considered in the graph topology so edges through them work
        (ioNode passes data; group is transparent).
        """
        # Adjacency considering ALL nodes (visual ones pass data through)
        successors: dict[str, list[str]] = defaultdict(list)
        indegree: dict[str, int] = defaultdict(int)
        for n in self.graph.get("nodes", []):
            indegree[n["id"]] = 0
        for e in self.edges:
            src = e.get("source")
            tgt = e.get("target")
            if not src or not tgt:
                continue
            if src not in self.nodes_by_id or tgt not in self.nodes_by_id:
                continue
            successors[src].append(tgt)
            indegree[tgt] += 1

        # Kahn
        queue: deque[str] = deque(
            nid for nid in self.nodes_by_id if indegree[nid] == 0
        )
        order_all: list[str] = []
        while queue:
            nid = queue.popleft()
            order_all.append(nid)
            for nxt in successors[nid]:
                indegree[nxt] -= 1
                if indegree[nxt] == 0:
                    queue.append(nxt)

        if len(order_all) != len(self.nodes_by_id):
            unprocessed = [n for n, d in indegree.items() if d > 0]
            raise GraphValidationError(
                f"cycle detected in graph; {len(unprocessed)} unprocessed nodes "
                f"(sample: {unprocessed[:5]})"
            )

        # Filter to executable
        return [nid for nid in order_all if self._is_executable(self.nodes_by_id[nid])]

    def _gather_inputs(self, node_id: str, initial_inputs: dict[str, Any]) -> dict[str, Any]:
        """Collect inputs from upstream nodes, keyed by INPUT handle name.

        If the upstream is a visual node (ioNode, etc), traverses backwards
        through it to find the first executable producer.
        """
        result: dict[str, Any] = {}
        # Find incoming edges
        incoming = [e for e in self.edges if e.get("target") == node_id]
        if not incoming:
            # Root node — gets initial inputs
            return dict(initial_inputs)

        for e in incoming:
            src_id = e.get("source")
            src_handle = e.get("sourceHandle") or "output"
            tgt_handle = e.get("targetHandle") or "input"
            # Walk backwards through visual nodes
            value = self._resolve_upstream_value(src_id, src_handle, initial_inputs)
            result[tgt_handle] = value
        return result

    def _resolve_upstream_value(
        self,
        src_id: str,
        src_handle: str,
        initial_inputs: dict[str, Any],
        _visited: set[str] | None = None,
    ) -> Any:
        """Walks backwards from src_id; if visual, traverses through it."""
        if _visited is None:
            _visited = set()
        if src_id in _visited:
            return None
        _visited.add(src_id)
        src_node = self.nodes_by_id.get(src_id)
        if not src_node:
            return None
        if self._is_executable(src_node):
            output = self.ctx.outputs.get(src_id, {})
            # exact handle match, or first key if 1-output
            if src_handle in output:
                return output[src_handle]
            if len(output) == 1:
                return next(iter(output.values()))
            return None
        # Visual node — find HIS predecessors and chain backwards
        upstream_edges = [e for e in self.edges if e.get("target") == src_id]
        if not upstream_edges:
            # No predecessors — root visual node receives initial input
            return initial_inputs.get(src_handle) or (
                next(iter(initial_inputs.values())) if initial_inputs else None
            )
        # Take the first upstream edge (visual nodes typically have 1 in)
        up = upstream_edges[0]
        return self._resolve_upstream_value(
            up.get("source"),
            up.get("sourceHandle") or "output",
            initial_inputs,
            _visited,
        )

    # ── Branch-skip helpers (v3.7.1) ──────────────────────────────────────

    def _skip_inactive_branches(self, branching_node_id: str, output: dict[str, Any]) -> None:
        """Após executar um branching node (if_else/switch), marca como skipped
        todos os successors conectados a handles cujo output é None.

        Ex: if_else produziu {true: <payload>, false: None}. Os successors
        ligados ao handle "false" são marcados skipped; os ligados a "true"
        executam normalmente.
        """
        inactive_handles = {h for h, v in output.items() if v is None}
        if not inactive_handles:
            return
        for e in self.edges:
            if e.get("source") != branching_node_id:
                continue
            handle = e.get("sourceHandle")
            if handle in inactive_handles:
                target = e.get("target")
                if target and target not in self._skipped:
                    self._skipped.add(target)

    def _propagate_skip(self, skipped_node_id: str, all_handles_inactive: bool = True) -> None:
        """Propaga skip pra successors quando o atual node é skipped.

        Heurística: se TODOS os predecessores executáveis (não visuais) de um
        successor estão skipped, o successor também não tem do que se alimentar
        → skipped. Caso contrário, ele pode ter input válido de outro caminho
        e deve executar.
        """
        successors = [e["target"] for e in self.edges if e.get("source") == skipped_node_id]
        for succ_id in successors:
            if succ_id in self._skipped:
                continue
            # Verifica se todos os predecessores executáveis estão skipped
            preds = [e.get("source") for e in self.edges if e.get("target") == succ_id]
            exec_preds = [p for p in preds if p and self._is_executable(self.nodes_by_id.get(p, {}))]
            if not exec_preds:
                continue
            # Considera "ativo" um pred que (a) não está skipped E (b) já
            # executou OU ainda vai executar
            any_active = any(p not in self._skipped for p in exec_preds)
            if not any_active:
                self._skipped.add(succ_id)
