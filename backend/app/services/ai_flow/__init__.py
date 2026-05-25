"""AI Flow execution engine — runs the canvas graph as a real pipeline.

Entry point:
    from app.services.ai_flow import GraphExecutor
    executor = GraphExecutor(graph, db_session, ws_emit_fn)
    result = await executor.run(initial_inputs)
"""
from .executor import (
    NodeExecutor,
    NodeRegistry,
    ExecutionContext,
    ExecutionResult,
    GraphExecutor,
    NodeExecutionError,
    GraphValidationError,
    registry,
)

# Import pra registrar os executors (efeito colateral via @registry.register).
# A ordem importa: pure primeiro (sem deps), depois io, depois control_flow.
from . import executors_pure  # noqa: F401
from . import executors_io    # noqa: F401

__all__ = [
    "NodeExecutor",
    "NodeRegistry",
    "ExecutionContext",
    "ExecutionResult",
    "GraphExecutor",
    "NodeExecutionError",
    "GraphValidationError",
    "registry",
]
