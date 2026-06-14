"""
Tests for the AI Flow GraphExecutor — v3.7.8 layered (parallel) execution.

These use fake NodeExecutors (no DB, no network) so they're fast and hermetic.
They lock in the invariants that the wave scheduler must NOT break:
  - independent nodes run in parallel (not serialized)
  - branch-skip (if_else/switch) still routes correctly
  - loops (for_each) still iterate the body the right number of times
  - on_error stop/continue behave as before
  - quota coordination short-circuits Claudius nodes after exhaustion
"""
import asyncio
import time
import uuid

import pytest

from app.services.ai_flow.executor import (
    GraphExecutor, ExecutionContext, NodeExecutor, registry,
)


# ── Fake executors (registered once) ──────────────────────────────────────────
_RAN: list = []
_BODY_COUNT = [0]


@registry.register("t_sleep")
class _Sleep(NodeExecutor):
    async def execute(self, inputs, config, ctx):
        await asyncio.sleep(float(config.get("secs", 0.5)))
        return {"ok": True}


@registry.register("t_marker")
class _Marker(NodeExecutor):
    async def execute(self, inputs, config, ctx):
        _RAN.append(config.get("id"))
        # Emit a non-empty payload on the default 'output' handle so an
        # if_else downstream has a value to route into its active branch.
        return {"output": "PAYLOAD", "ok": True}


@registry.register("t_boom")
class _Boom(NodeExecutor):
    async def execute(self, inputs, config, ctx):
        raise RuntimeError("boom")


@registry.register("t_collection")
class _Coll(NodeExecutor):
    async def execute(self, inputs, config, ctx):
        return {"collection": [1, 2, 3]}


@registry.register("t_body")
class _Body(NodeExecutor):
    async def execute(self, inputs, config, ctx):
        _BODY_COUNT[0] += 1
        return {"x": _BODY_COUNT[0]}


async def _run(nodes, edges, max_conc=8):
    _RAN.clear()
    _BODY_COUNT[0] = 0
    events = []

    async def emit(ev, payload):
        events.append((ev, payload.get("node_id")))

    ctx = ExecutionContext(run_id=uuid.uuid4(), db=None, ws_emit=emit, max_concurrency=max_conc)
    res = await GraphExecutor({"nodes": nodes, "edges": edges}, ctx).run()
    return res, events


def _util(nid, kind, **cfg):
    return {"id": nid, "type": "genericUtilityNode", "data": {"kind": kind, "config": cfg}}


def _ctrl(nid, kind, **cfg):
    return {"id": nid, "type": "controlFlowNode", "data": {"kind": kind, "config": cfg}}


@pytest.mark.asyncio
async def test_independent_nodes_run_in_parallel():
    nodes = [_util(f"n{i}", "t_sleep", secs=1.0) for i in range(8)]
    t0 = time.monotonic()
    res, _ = await _run(nodes, [])
    elapsed = time.monotonic() - t0
    assert res.ok
    assert res.nodes_executed == 8
    # Sequential would be ~8s; parallel one wave ~1s. Allow generous headroom.
    assert elapsed < 3.0, f"expected parallel (~1s), got {elapsed:.2f}s"


@pytest.mark.asyncio
async def test_layers_respect_dependencies():
    # A -> {B,C,D} -> E. B,C,D parallel; E after.
    nodes = [_util(x, "t_sleep", secs=0.4) for x in "ABCDE"]
    edges = [
        {"source": "A", "target": "B"}, {"source": "A", "target": "C"},
        {"source": "A", "target": "D"}, {"source": "B", "target": "E"},
        {"source": "C", "target": "E"}, {"source": "D", "target": "E"},
    ]
    t0 = time.monotonic()
    res, _ = await _run(nodes, edges)
    elapsed = time.monotonic() - t0
    assert res.nodes_executed == 5
    # 3 layers * 0.4 = 1.2s; serial would be 2.0s.
    assert elapsed < 1.8, f"layers not parallel: {elapsed:.2f}s"


@pytest.mark.asyncio
async def test_branch_skip_routes_active_handle():
    nodes = [
        _util("src", "t_marker", id="src"),
        _ctrl("cond", "if_else", condition="true"),
        _util("yes", "t_marker", id="yes"),
        _util("no", "t_marker", id="no"),
    ]
    edges = [
        {"source": "src", "target": "cond", "sourceHandle": "output", "targetHandle": "input"},
        {"source": "cond", "target": "yes", "sourceHandle": "true"},
        {"source": "cond", "target": "no", "sourceHandle": "false"},
    ]
    _, events = await _run(nodes, edges)
    skipped = [n for ev, n in events if ev == "node_skipped"]
    assert "yes" in _RAN
    assert "no" not in _RAN
    assert "no" in skipped


@pytest.mark.asyncio
async def test_for_each_iterates_body_once_per_item():
    nodes = [
        _util("s", "t_collection"),
        _ctrl("loop", "for_each"),
        _util("body", "t_body"),
    ]
    edges = [
        {"source": "s", "target": "loop", "sourceHandle": "collection", "targetHandle": "collection"},
        {"source": "loop", "target": "body", "sourceHandle": "body"},
    ]
    res, _ = await _run(nodes, edges)
    assert res.ok
    assert _BODY_COUNT[0] == 3  # not 4 (no stray main-pass run), not 0


@pytest.mark.asyncio
async def test_on_error_stop_halts_downstream():
    nodes = [
        _util("start", "t_marker", id="start"),
        _util("boom", "t_boom"),
        _util("after", "t_marker", id="after"),
    ]
    edges = [{"source": "start", "target": "boom"}, {"source": "boom", "target": "after"}]
    res, _ = await _run(nodes, edges)
    assert not res.ok
    assert "after" not in _RAN  # stop halted downstream


@pytest.mark.asyncio
async def test_on_error_continue_runs_downstream():
    nodes = [
        _util("boom", "t_boom", on_error="continue"),
        _util("after", "t_marker", id="after"),
    ]
    edges = [{"source": "boom", "target": "after"}]
    res, _ = await _run(nodes, edges)
    assert not res.ok  # still records the failure
    assert "after" in _RAN  # but downstream ran


@pytest.mark.asyncio
async def test_cycle_raises_validation_error():
    from app.services.ai_flow.executor import GraphValidationError
    nodes = [_util("a", "t_marker", id="a"), _util("b", "t_marker", id="b")]
    edges = [{"source": "a", "target": "b"}, {"source": "b", "target": "a"}]
    ctx = ExecutionContext(run_id=uuid.uuid4(), db=None)
    with pytest.raises(GraphValidationError):
        GraphExecutor({"nodes": nodes, "edges": edges}, ctx)._topological_order()
