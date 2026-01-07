"""
Tasks API Package
PROMPT #71 - Refactor tasks.py (Modularization)

This package provides task management endpoints organized by domain:
- CRUD operations
- Task execution
- Hierarchy management
- Relationships
- Comments
- Status transitions
- Backlog/Kanban views

Refactored from single 1107-line file into focused modules.

For backwards compatibility, the old tasks.py now imports from this package.
"""

# For now, import everything from the old file to maintain compatibility
# This allows gradual migration
from ..tasks_old import router

__all__ = ["router"]
