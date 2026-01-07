"""
Task Executor Module (Backwards Compatibility Wrapper)
PROMPT #70 - Refactor task_executor.py

This file now imports from the modularized task_execution package.
All existing imports continue to work without modification.

Old import (still works):
    from app.services.task_executor import TaskExecutor

New import (recommended):
    from app.services.task_execution import TaskExecutor

Refactored structure:
    app/services/task_execution/
    ├── __init__.py                    # Exports TaskExecutor
    ├── executor.py                    # Core execution logic (~460 lines)
    ├── spec_fetcher.py                # Selective spec fetching (~340 lines)
    ├── context_builder.py             # Context construction (~220 lines)
    ├── budget_manager.py              # Budget tracking (~170 lines)
    └── batch_executor.py              # Batch execution (~170 lines)
"""

from app.services.task_execution import TaskExecutor

# Export TaskExecutor for backwards compatibility
__all__ = ["TaskExecutor"]
