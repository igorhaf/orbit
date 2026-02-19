"""
Tasks API Package

This package provides task management endpoints.
The main implementation is in tasks_routes.py.
"""

from ..tasks_routes import router

__all__ = ["router"]
