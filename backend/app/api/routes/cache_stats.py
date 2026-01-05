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
    Get cache statistics from PrompterFacade

    PROMPT #54.3 - Cache Performance Monitoring

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
        # Initialize PrompterFacade to access cache service
        facade = PrompterFacade(db=db)

        # Check if cache is enabled
        if not facade.cache:
            return {
                "enabled": False,
                "backend": "none",
                "message": "Cache is not enabled. Set PROMPTER_USE_CACHE=true to enable."
            }

        # Get cache statistics
        stats = facade.cache.get_stats()

        # Determine backend type
        backend = "redis" if facade.cache.redis_client else "memory"

        # Format response with multi-level cache breakdown
        return {
            "enabled": True,
            "backend": backend,
            "statistics": {
                "l1_exact_match": {
                    "hits": stats.get("l1_hits", 0),
                    "misses": stats.get("l1_misses", 0),
                    "hit_rate": stats.get("l1_hit_rate", 0.0),
                },
                "l2_semantic": {
                    "hits": stats.get("l2_hits", 0),
                    "misses": stats.get("l2_misses", 0),
                    "hit_rate": stats.get("l2_hit_rate", 0.0),
                    "enabled": facade.cache.enable_semantic,
                },
                "l3_template": {
                    "hits": stats.get("l3_hits", 0),
                    "misses": stats.get("l3_misses", 0),
                    "hit_rate": stats.get("l3_hit_rate", 0.0),
                },
                "total": {
                    "hits": stats.get("total_hits", 0),
                    "misses": stats.get("total_misses", 0),
                    "requests": stats.get("total_requests", 0),
                    "hit_rate": stats.get("total_hit_rate", 0.0),
                    "tokens_saved": stats.get("tokens_saved", 0),
                    "estimated_cost_saved": stats.get("cost_saved", 0.0),
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
