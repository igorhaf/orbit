"""
Tasks API Router (Backwards Compatibility Wrapper)
PROMPT #71 - Refactor tasks.py

This file now imports from the modularized tasks package.
All existing imports continue to work without modification.

Old import (still works):
    from app.api.routes.tasks import router

Package structure:
    app/api/routes/tasks/
    ├── __init__.py         # Package entry (imports from tasks_old for now)

Note: This is a simplified version that keeps the monolithic file
but provides the package structure for future modularization.
"""

from app.api.routes.tasks import router

# Export router for backwards compatibility
__all__ = ["router"]
