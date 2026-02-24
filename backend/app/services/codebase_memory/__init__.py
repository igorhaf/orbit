"""
Codebase Memory Service Package

Refactored from monolithic codebase_memory.py into a package with mixins.

Re-exports CodebaseMemoryService and ScanDepth for backward compatibility:
    from app.services.codebase_memory import CodebaseMemoryService
"""

from .service import CodebaseMemoryService, ScanDepth

__all__ = ["CodebaseMemoryService", "ScanDepth"]
