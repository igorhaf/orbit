"""
Claudius Quota — orbit-side proxy.

The Claudius backend owns the quota tracker (claudius/backend/quota_tracker.py).
These endpoints forward to it so the frontend has a single base URL.

PROMPT: quota-awareness — v2.3.0
"""
import logging

from fastapi import APIRouter, Body, HTTPException

from app.services.claudius_pipeline import ClaudiusPipelineService

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/claudius/quota/status")
async def quota_status():
    """Snapshot of Claude subscription quota window (no Claude calls)."""
    client = ClaudiusPipelineService()
    try:
        return await client.quota_status()
    finally:
        await client.close()


@router.post("/claudius/quota/probe")
async def quota_probe():
    """Ping Claudius with ~5 tokens to validate quota availability.

    Use sparingly. Use /status for cheap polling.
    """
    client = ClaudiusPipelineService()
    try:
        return await client.quota_probe()
    finally:
        await client.close()


@router.get("/claudius/quota/history")
async def quota_history(limit: int = 50):
    """Recent quota events (calls, exhausted, available) for history charts."""
    client = ClaudiusPipelineService()
    try:
        return await client.quota_history(limit=limit)
    finally:
        await client.close()


@router.post("/claudius/quota/tier")
async def quota_set_tier(payload: dict = Body(...)):
    """Change the active plan tier (pro | max_5x | max_20x)."""
    tier = (payload or {}).get("tier", "").lower()
    if tier not in ("pro", "max_5x", "max_20x"):
        raise HTTPException(status_code=400, detail="tier must be: pro | max_5x | max_20x")
    client = ClaudiusPipelineService()
    try:
        return await client.quota_set_tier(tier)
    finally:
        await client.close()
