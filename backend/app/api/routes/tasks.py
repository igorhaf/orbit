"""
Tasks API Router (Package Wrapper)
PROMPT #71 - Refactor tasks.py

This file imports from the tasks package.
The actual implementation is in tasks_routes.py.

Package structure:
    app/api/routes/tasks/
    ├── __init__.py         # Package entry (imports from tasks_routes)
"""

from app.api.routes.tasks import router

__all__ = ["router"]
