"""
RAG Pipeline Service package.

Re-exports RagPipelineService and _get_redis for backward compatibility.
All existing imports like:
    from app.services.rag_pipeline import RagPipelineService
    from app.services.rag_pipeline import _get_redis
continue to work unchanged.
"""

from .service import RagPipelineService
from .utils import _get_redis

__all__ = ["RagPipelineService", "_get_redis"]
