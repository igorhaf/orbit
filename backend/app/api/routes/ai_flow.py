"""
AI Flow Chain API Router
PROMPT #122 - AI Flow: Visual Fallback Chain Configuration

CRUD operations for managing per-usage_type AI model fallback chains.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime
from uuid import uuid4

from app.database import get_db
from app.models.ai_model import AIModel, AIModelUsageType
from app.models.ai_flow_chain import AIFlowChain
from app.schemas.ai_flow_chain import (
    AIFlowChainBase,
    AIFlowChainCreate,
    AIFlowChainResponse,
    AIFlowChainWithModels,
)

router = APIRouter()


def _resolve_chain_models(db: Session, chain_ids: List[str]) -> List[dict]:
    """Resolve list of model UUIDs to full model objects for frontend display."""
    models = []
    for model_id in chain_ids:
        model = db.query(AIModel).filter(AIModel.id == model_id).first()
        if model:
            models.append({
                "id": str(model.id),
                "name": model.name,
                "provider": model.provider,
                "usage_type": model.usage_type.value if hasattr(model.usage_type, "value") else model.usage_type,
                "is_active": model.is_active,
                "config": model.config or {},
                "rate_limit_requests": model.rate_limit_requests,
                "rate_limit_window_seconds": model.rate_limit_window_seconds,
            })
        else:
            models.append({
                "id": model_id,
                "name": "Unknown (deleted)",
                "provider": "unknown",
                "usage_type": "general",
                "is_active": False,
                "config": {},
                "rate_limit_requests": None,
                "rate_limit_window_seconds": None,
            })
    return models


def _chain_to_dict(chain: AIFlowChain, models: List[dict]) -> dict:
    return {
        "id": chain.id,
        "usage_type": chain.usage_type.value if hasattr(chain.usage_type, "value") else chain.usage_type,
        "chain": chain.chain,
        "is_active": chain.is_active,
        "created_at": chain.created_at,
        "updated_at": chain.updated_at,
        "models": models,
    }


@router.get("/chains", response_model=List[AIFlowChainWithModels])
async def list_chains(db: Session = Depends(get_db)):
    """List all flow chains with their associated model details."""
    chains = db.query(AIFlowChain).order_by(AIFlowChain.usage_type).all()
    result = []
    for chain in chains:
        models = _resolve_chain_models(db, chain.chain or [])
        result.append(_chain_to_dict(chain, models))
    return result


@router.get("/chains/{usage_type}", response_model=AIFlowChainWithModels)
async def get_chain(usage_type: AIModelUsageType, db: Session = Depends(get_db)):
    """Get chain for specific usage_type."""
    chain = db.query(AIFlowChain).filter(AIFlowChain.usage_type == usage_type).first()
    if not chain:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No chain configured for usage_type '{usage_type.value}'",
        )
    models = _resolve_chain_models(db, chain.chain or [])
    return _chain_to_dict(chain, models)


@router.put("/chains/{usage_type}", response_model=AIFlowChainResponse)
async def upsert_chain(
    usage_type: AIModelUsageType,
    data: AIFlowChainBase,
    db: Session = Depends(get_db),
):
    """Create or update chain for a usage_type (upsert)."""
    for model_id in data.chain:
        model = db.query(AIModel).filter(AIModel.id == model_id).first()
        if not model:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"AI Model '{model_id}' not found",
            )

    existing = db.query(AIFlowChain).filter(AIFlowChain.usage_type == usage_type).first()

    if existing:
        existing.chain = data.chain
        existing.is_active = data.is_active
        existing.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(existing)
        return existing
    else:
        new_chain = AIFlowChain(
            id=uuid4(),
            usage_type=usage_type,
            chain=data.chain,
            is_active=data.is_active,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(new_chain)
        db.commit()
        db.refresh(new_chain)
        return new_chain


@router.delete("/chains/{usage_type}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chain(usage_type: AIModelUsageType, db: Session = Depends(get_db)):
    """Delete chain for a usage_type."""
    chain = db.query(AIFlowChain).filter(AIFlowChain.usage_type == usage_type).first()
    if not chain:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No chain configured for usage_type '{usage_type.value}'",
        )
    db.delete(chain)
    db.commit()
    return None
