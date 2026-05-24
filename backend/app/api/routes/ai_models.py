"""
AI Models API Router
CRUD operations for managing AI models configuration.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import datetime

from app.database import get_db
from app.models.ai_model import AIModel, AIModelUsageType
from app.schemas.ai_model import AIModelCreate, AIModelUpdate, AIModelResponse
from app.api.dependencies import get_ai_model_or_404

router = APIRouter()

# v2.5: claudius-only lockdown. New models must use one of these model_ids.
ALLOWED_CLAUDIUS_MODELS = frozenset({
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
})


def mask_api_key(api_key: str) -> str:
    """Mask API key showing only last 4 characters."""
    if len(api_key) <= 4:
        return "****"
    return f"{'*' * (len(api_key) - 4)}{api_key[-4:]}"


def _enforce_claudius(model_data) -> None:
    """v2.5: reject any provider other than 'claudius' and any model_id
    outside the supported Claude trio. Mutates `model_data.provider` to
    'claudius' so callers don't have to send it."""
    if getattr(model_data, "provider", None) and model_data.provider != "claudius":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"provider='{model_data.provider}' não suportado. "
                "v2.5 só aceita 'claudius'."
            ),
        )
    model_data.provider = "claudius"
    cfg = model_data.config or {}
    mid = (cfg.get("model_id") or "").strip()
    if mid and mid not in ALLOWED_CLAUDIUS_MODELS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"config.model_id='{mid}' inválido. "
                f"Permitidos: {sorted(ALLOWED_CLAUDIUS_MODELS)}"
            ),
        )


@router.get("/", response_model=List[AIModelResponse])
async def list_ai_models(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    usage_type: Optional[AIModelUsageType] = Query(None, description="Filter by usage type"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    db: Session = Depends(get_db)
):
    """
    List all AI models (v2.5: all rows are claudius).

    - **usage_type**: Filter by usage type (interview, prompt_generation, etc)
    - **is_active**: Filter by active status
    """
    query = db.query(AIModel)
    if usage_type:
        query = query.filter(AIModel.usage_type == usage_type)
    if is_active is not None:
        query = query.filter(AIModel.is_active == is_active)
    return query.order_by(AIModel.created_at.desc()).offset(skip).limit(limit).all()


@router.post("/", response_model=AIModelResponse, status_code=status.HTTP_201_CREATED)
async def create_ai_model(
    model_data: AIModelCreate,
    db: Session = Depends(get_db)
):
    """
    Create a new AI model configuration.

    v2.5: claudius-only. The `provider` field is ignored/forced to 'claudius'
    and `config.model_id` must be one of:
    claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5.

    - **name**: Unique model name
    - **api_key**: Optional (claudius proxy doesn't require one)
    - **usage_type**: Type of usage for this model
    - **is_active**: Whether this model is active
    - **config**: { model_id, max_tokens?, temperature?, ... }
    """
    _enforce_claudius(model_data)

    # Check if name already exists
    existing = db.query(AIModel).filter(AIModel.name == model_data.name).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Modelo com nome '{model_data.name}' ja existe"
        )

    # Create new model
    db_model = AIModel(
        name=model_data.name,
        provider=model_data.provider,
        api_key=model_data.api_key,
        usage_type=model_data.usage_type,
        is_active=model_data.is_active,
        config=model_data.config,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )

    db.add(db_model)
    db.commit()
    db.refresh(db_model)

    return db_model


@router.get("/{model_id}", response_model=AIModelResponse)
async def get_ai_model(
    model: AIModel = Depends(get_ai_model_or_404)
):
    """
    Get a specific AI model by ID.

    - **model_id**: UUID of the AI model
    """
    return model


@router.patch("/{model_id}", response_model=AIModelResponse)
async def update_ai_model(
    model_update: AIModelUpdate,
    model: AIModel = Depends(get_ai_model_or_404),
    db: Session = Depends(get_db)
):
    """
    Update an AI model configuration (partial update).

    v2.5: provider locked to 'claudius', config.model_id must be one of
    the supported Claude models.

    - **name**: New model name (optional)
    - **api_key**: New API key (optional; claudius doesn't require one)
    - **usage_type**: New usage type (optional)
    - **is_active**: New active status (optional)
    - **config**: New configuration (optional; model_id validated)
    """
    update_data = model_update.model_dump(exclude_unset=True)

    # v2.5: reject provider changes; validate model_id whitelist
    if "provider" in update_data and update_data["provider"] != "claudius":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"provider='{update_data['provider']}' não suportado. Apenas 'claudius'.",
        )
    update_data["provider"] = "claudius"
    new_cfg = update_data.get("config") or {}
    new_mid = (new_cfg.get("model_id") or "").strip() if isinstance(new_cfg, dict) else ""
    if new_mid and new_mid not in ALLOWED_CLAUDIUS_MODELS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"config.model_id='{new_mid}' inválido. Permitidos: {sorted(ALLOWED_CLAUDIUS_MODELS)}",
        )

    # Check if name is being updated and already exists
    if "name" in update_data and update_data["name"] != model.name:
        existing = db.query(AIModel).filter(
            AIModel.name == update_data["name"]
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Modelo com nome '{update_data['name']}' ja existe"
            )

    # Special handling for api_key: if empty string, don't update (keep current value)
    # This allows "leave empty to keep current" behavior in frontend
    if "api_key" in update_data and update_data["api_key"] == "":
        del update_data["api_key"]

    for field, value in update_data.items():
        setattr(model, field, value)

    model.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(model)

    return model


@router.delete("/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ai_model(
    model: AIModel = Depends(get_ai_model_or_404),
    db: Session = Depends(get_db)
):
    """
    Delete an AI model.

    - **model_id**: UUID of the model to delete
    """
    db.delete(model)
    db.commit()
    return None


@router.get("/usage/{usage_type}", response_model=List[AIModelResponse])
async def get_models_by_usage_type(
    usage_type: AIModelUsageType,
    active_only: bool = Query(True, description="Return only active models"),
    db: Session = Depends(get_db)
):
    """
    Get all models filtered by usage type.

    - **usage_type**: Type of usage to filter by
    - **active_only**: Return only active models (default: true)
    """
    query = db.query(AIModel).filter(AIModel.usage_type == usage_type)

    if active_only:
        query = query.filter(AIModel.is_active == True)

    models = query.order_by(AIModel.name).all()

    return models


@router.patch("/{model_id}/toggle", response_model=AIModelResponse)
async def toggle_ai_model(
    model: AIModel = Depends(get_ai_model_or_404),
    db: Session = Depends(get_db)
):
    """
    Toggle the active status of an AI model.

    - **model_id**: UUID of the model to toggle
    """
    model.is_active = not model.is_active
    model.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(model)

    return model


@router.get("/orchestration/status")
async def get_orchestration_status(
    db: Session = Depends(get_db)
):
    """
    Get the current status of the AI orchestration system.

    Returns information about:
    - Available AI providers (anthropic, openai, google)
    - Model selection strategies for each usage type
    - Which models will be used for each task type

    This endpoint helps monitor and debug the multi-model orchestration system.
    """
    from app.services.ai_orchestrator import AIOrchestrator

    try:
        # Initialize orchestrator
        orchestrator = AIOrchestrator(db)

        # Get available providers
        available_providers = orchestrator.get_available_providers()

        # Get strategies for each usage type
        strategies = orchestrator.get_strategies()

        # Get total models count
        total_models = db.query(AIModel).count()
        active_models = db.query(AIModel).filter(AIModel.is_active == True).count()

        return {
            "status": "operational" if len(available_providers) > 0 else "no_providers",
            "available_providers": available_providers,
            "total_models": total_models,
            "active_models": active_models,
            "strategies": strategies,
            "usage_types": {
                "prompt_generation": "Usa o melhor modelo para analisar entrevistas e gerar prompts",
                "task_execution": "Usa o melhor modelo para executar código e tarefas tecnicas",
                "commit_generation": "Usa modelo rápido e economico para mensagens de commit",
                "interview": "Usa modelo conversacional para entrevistas tecnicas",
                "general": "Usa modelo economico para consultas gerais"
            }
        }

    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"Error getting orchestration status: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Falha ao obter status de orquestracao: {str(e)}"
        )
