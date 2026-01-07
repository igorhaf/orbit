"""
Task Execution Package
PROMPT #70 - Refactor task_executor.py (Modularization)

This package provides task execution functionality with:
- Intelligent model selection (Haiku vs Sonnet)
- Surgical context building (3-5k tokens vs 200k)
- Automatic validation and regeneration
- Token budget tracking
- Batch execution with dependency resolution
- Real-time cost calculation

Refactored from single 1179-line file into focused modules:
- spec_fetcher.py: Selective spec fetching and formatting (~340 lines)
- context_builder.py: Surgical context construction (~220 lines)
- budget_manager.py: Token budget tracking (~170 lines)
- batch_executor.py: Batch execution with topological sort (~170 lines)
- executor.py: Core execution logic (~460 lines)

Total: ~1,360 lines (vs 1179 original) = +181 lines (docstrings and module headers)
"""

from .executor import TaskExecutor

# Export TaskExecutor for main application
__all__ = ["TaskExecutor"]
