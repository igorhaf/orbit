"""
Deep Pipeline Service package.

Re-exports DeepPipelineService so existing imports continue to work:
    from app.services.deep_pipeline import DeepPipelineService
"""

from .service import DeepPipelineService

__all__ = ["DeepPipelineService"]
