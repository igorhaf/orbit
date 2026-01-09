"""
Prompter API Router
Health check and status monitoring for Prompter architecture.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Dict, Any
import logging

from app.database import get_db

# Try to import PrompterFacade
try:
    from app.prompter.facade import PrompterFacade
    PROMPTER_AVAILABLE = True
except ImportError:
    PROMPTER_AVAILABLE = False

router = APIRouter(prefix="/prompter", tags=["prompter"])
logger = logging.getLogger(__name__)


@router.get("/status")
async def get_prompter_status(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Get Prompter system status and performance metrics

    Returns:
        Dict with feature flags, component status, cache stats, etc.

    Example response:
    {
      "available": true,
      "feature_flags": {
        "use_templates": true,
        "use_cache": true,
        "use_batching": false,
        "use_tracing": false
      },
      "components": {
        "composer_loaded": true,
        "executor_loaded": true,
        "cache_loaded": true,
        "model_selector_loaded": true
      },
      "cache_stats": {
        "total_requests": 145,
        "cache_hits": 47,
        "cache_misses": 98,
        "hit_rate": 0.324,
        "hit_rate_percent": "32.4%",
        "exact_hits": 47
      },
      "available_models": [
        "claude-sonnet-4",
        "claude-haiku-3",
        "gpt-4o",
        "gemini-flash"
      ]
    }
    """
    if not PROMPTER_AVAILABLE:
        return {
            "available": False,
            "error": "PrompterFacade not available - missing dependencies or module not found",
            "feature_flags": None,
            "components": None,
            "cache_stats": None
        }

    try:
        # Initialize facade
        facade = PrompterFacade(db)

        # Get full status
        status_data = facade.get_status()

        # Add availability flag
        status_data["available"] = True

        return status_data

    except Exception as e:
        logger.error(f"Failed to get Prompter status: {e}", exc_info=True)
        return {
            "available": False,
            "error": str(e),
            "feature_flags": None,
            "components": None,
            "cache_stats": None
        }


@router.get("/health")
async def health_check(db: Session = Depends(get_db)) -> Dict[str, str]:
    """
    Simple health check endpoint

    Returns:
        Dict with status ("healthy" or "unhealthy")
    """
    if not PROMPTER_AVAILABLE:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Prompter not available"
        )

    try:
        # Try to initialize facade
        facade = PrompterFacade(db)

        # Basic health checks
        checks = {
            "facade_init": facade is not None,
            "database": db is not None,
        }

        if not all(checks.values()):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Health check failed: {checks}"
            )

        return {
            "status": "healthy",
            "checks": str(checks)
        }

    except Exception as e:
        logger.error(f"Prompter health check failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Health check failed: {str(e)}"
        )


@router.post("/cache/clear")
async def clear_cache(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Clear all caches (admin endpoint)

    WARNING: This will clear all cached responses.
    Use with caution in production.

    Returns:
        Success message with stats before clearing
    """
    if not PROMPTER_AVAILABLE:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Prompter not available"
        )

    try:
        facade = PrompterFacade(db)

        if not facade.cache:
            return {
                "success": False,
                "message": "Cache not enabled (PROMPTER_USE_CACHE=false)"
            }

        # Get stats before clearing
        stats_before = facade.cache.get_stats()

        # Clear cache
        facade.cache.clear()

        logger.info(f"Cache cleared by admin. Stats before: {stats_before}")

        return {
            "success": True,
            "message": "Cache cleared successfully",
            "stats_before_clear": stats_before,
            "stats_after_clear": facade.cache.get_stats()
        }

    except Exception as e:
        logger.error(f"Failed to clear cache: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to clear cache: {str(e)}"
        )


@router.get("/cache/stats")
async def get_cache_stats(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Get detailed cache statistics

    Returns:
        Cache performance metrics
    """
    if not PROMPTER_AVAILABLE:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Prompter not available"
        )

    try:
        facade = PrompterFacade(db)

        if not facade.cache:
            return {
                "enabled": False,
                "message": "Cache not enabled (PROMPTER_USE_CACHE=false)",
                "stats": None
            }

        return {
            "enabled": True,
            "stats": facade.cache.get_stats()
        }

    except Exception as e:
        logger.error(f"Failed to get cache stats: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get cache stats: {str(e)}"
        )


@router.get("/models")
async def list_models(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    List available AI models with pricing and performance info

    Returns:
        List of models with details
    """
    if not PROMPTER_AVAILABLE:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Prompter not available"
        )

    try:
        facade = PrompterFacade(db)

        if not facade.model_selector:
            return {
                "available": [],
                "error": "ModelSelector not initialized"
            }

        # Get list of available models
        model_names = facade.model_selector.list_models(available_only=True)

        # Get detailed info for each model
        models_info = []
        for name in model_names:
            info = facade.model_selector.get_model_info(name)
            if info:
                models_info.append({
                    "name": info.name,
                    "provider": info.provider,
                    "quality_score": info.quality_score,
                    "avg_latency_ms": info.avg_latency_ms,
                    "pricing": {
                        "input_per_mtok": info.input_price_per_mtok,
                        "output_per_mtok": info.output_price_per_mtok,
                    },
                    "limits": {
                        "max_input_tokens": info.max_input_tokens,
                        "max_output_tokens": info.max_output_tokens,
                    },
                    "available": info.available
                })

        return {
            "total": len(models_info),
            "models": models_info
        }

    except Exception as e:
        logger.error(f"Failed to list models: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list models: {str(e)}"
        )
