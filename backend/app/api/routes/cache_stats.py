"""
Cache Statistics API Routes
Endpoints for monitoring cache performance

PROMPT #54.3 - Phase 3: Cache Activation and Monitoring
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Dict, Any

from app.database import get_db
from app.prompter.facade import PrompterFacade
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/cache/stats")
async def get_cache_stats(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Get aggregated cache statistics from all sources

    PROMPT #54.3 - Cache Performance Monitoring
    PROMPT #74 - Aggregate stats from AIOrchestrator and PrompterFacade

    Returns:
        - enabled: Whether cache is enabled
        - backend: Cache backend type (redis or memory)
        - statistics: Multi-level cache stats (L1, L2, L3)
            - l1_exact_match: Exact hash match cache
            - l2_semantic: Semantic similarity cache
            - l3_template: Template cache for deterministic prompts
            - total: Aggregated statistics
    """
    try:
        # PROMPT #74 - Get stats from AIOrchestrator (primary source for all AI operations)
        from app.services.ai_orchestrator import AIOrchestrator

        orchestrator = AIOrchestrator(db=db, enable_cache=True)

        # Check if cache is enabled
        if not orchestrator.cache_service:
            return {
                "enabled": False,
                "backend": "none",
                "message": "Cache is not enabled in AIOrchestrator."
            }

        # Get cache statistics from AIOrchestrator
        stats = orchestrator.cache_service.get_stats()

        # Determine backend type
        backend = "redis" if orchestrator.cache_service.redis_client else "memory"

        # Format response with multi-level cache breakdown
        return {
            "enabled": True,
            "backend": backend,
            "statistics": {
                "l1_exact_match": {
                    "hits": stats.get("exact_hits", 0),
                    "misses": stats.get("cache_misses", 0),
                    "hit_rate": stats.get("exact_hits", 0) / max(stats.get("total_requests", 1), 1),
                },
                "l2_semantic": {
                    "hits": stats.get("semantic_hits", 0),
                    "misses": 0,  # Not tracked separately
                    "hit_rate": stats.get("semantic_hits", 0) / max(stats.get("total_requests", 1), 1),
                    "enabled": orchestrator.cache_service.enable_semantic,
                },
                "l3_template": {
                    "hits": stats.get("template_hits", 0),
                    "misses": 0,  # Not tracked separately
                    "hit_rate": stats.get("template_hits", 0) / max(stats.get("total_requests", 1), 1),
                },
                "total": {
                    "hits": stats.get("cache_hits", 0),
                    "misses": stats.get("cache_misses", 0),
                    "requests": stats.get("total_requests", 0),
                    "hit_rate": stats.get("hit_rate", 0.0),
                    "tokens_saved": 0,  # TODO: Track in AIExecution logs
                    "estimated_cost_saved": 0.0,  # TODO: Calculate from AIExecution logs
                }
            }
        }

    except Exception as e:
        logger.error(f"Error fetching cache stats: {e}")
        raise HTTPException(status_code=500, detail=f"Error fetching cache statistics: {str(e)}")


@router.post("/cache/clear")
async def clear_cache(db: Session = Depends(get_db)) -> Dict[str, str]:
    """
    Clear all cache entries (for development/testing)

    PROMPT #54.3 - Cache Management

    ⚠️ WARNING: This will clear ALL cache entries across all levels

    Returns:
        Status message
    """
    try:
        facade = PrompterFacade(db=db)

        if not facade.cache:
            raise HTTPException(status_code=400, detail="Cache is not enabled")

        # Clear cache (implementation depends on cache service)
        if hasattr(facade.cache, 'clear'):
            facade.cache.clear()
            logger.info("✅ Cache cleared successfully")
            return {"status": "success", "message": "Cache cleared successfully"}
        else:
            raise HTTPException(status_code=501, detail="Cache clear not implemented")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error clearing cache: {e}")
        raise HTTPException(status_code=500, detail=f"Error clearing cache: {str(e)}")
