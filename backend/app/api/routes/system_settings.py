"""
System Settings API Router
CRUD operations for managing system-wide configuration settings.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status, Body
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from typing import List, Dict, Any, Optional
from datetime import datetime
from pydantic import BaseModel

from app.database import get_db
from app.models.system_settings import SystemSettings
from app.schemas.system_settings import SystemSettingsCreate, SystemSettingsUpdate, SystemSettingsResponse
from app.api.dependencies import get_setting_or_404

import logging

logger = logging.getLogger(__name__)

router = APIRouter()

# Default settings that should always exist in the database.
# Each entry: (key, default_value, description)
_DEFAULT_SETTINGS = [
    ("max_discovery_patterns", "20", "Max patterns per discovery scan (default 20, cap 50 per project)"),
    ("default_api_timeout_seconds", "120", "Default API timeout in seconds for all AI model calls (PROMPT #207)"),
    # PROMPT #215 - Prompt Queue Settings
    ("queue_auto_sort_strategy", "balanced", "Default queue sort strategy: balanced, hierarchy_first, priority_first, age_first, dependency_first"),
    ("queue_max_concurrent", "1", "Maximum concurrent prompt executions from queue"),
    ("queue_auto_populate", "true", "Auto-populate queue when cards are activated (true/false)"),
]


class BulkUpdateRequest(BaseModel):
    """Request model for bulk updating settings."""
    settings: Dict[str, Any]


def _ensure_default_settings(db: Session) -> None:
    """Create default settings if they don't exist yet."""
    for key, value, description in _DEFAULT_SETTINGS:
        existing = db.query(SystemSettings).filter(SystemSettings.key == key).first()
        if not existing:
            db.add(SystemSettings(key=key, value=value, description=description))
    db.commit()


@router.get("/", response_model=List[SystemSettingsResponse])
async def list_settings(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """
    List all system settings.

    Returns all configuration settings with their values and descriptions.
    Automatically creates default settings if they don't exist.
    """
    _ensure_default_settings(db)

    settings = db.query(SystemSettings).order_by(
        SystemSettings.key
    ).offset(skip).limit(limit).all()

    return settings


# ──────────────────────────────────────────────────
# Global Blocklist Endpoints
# MUST be declared BEFORE /{key} catch-all routes
# ──────────────────────────────────────────────────

BLOCKLIST_KEY = "global_blocklist"
SUGGESTIONS_KEY = "blocklist_suggestions"
REJECTED_KEY = "blocklist_rejected"


class BlocklistUpdate(BaseModel):
    directories: List[str] = []
    file_patterns: List[str] = []


class BlocklistSuggestionAction(BaseModel):
    items: List[Dict[str, str]]


def _get_blocklist(db: Session) -> Dict[str, Any]:
    setting = db.query(SystemSettings).filter(SystemSettings.key == BLOCKLIST_KEY).first()
    if setting and setting.value:
        return setting.value
    return {"directories": [], "file_patterns": []}


def _save_blocklist(db: Session, data: Dict[str, Any]) -> None:
    existing = db.query(SystemSettings).filter(SystemSettings.key == BLOCKLIST_KEY).first()
    if existing:
        existing.value = data
        existing.updated_at = datetime.utcnow()
        flag_modified(existing, "value")
    else:
        db.add(SystemSettings(
            key=BLOCKLIST_KEY,
            value=data,
            description="Lista de bloqueio global - pastas e padroes ignorados em todos os projetos",
            updated_at=datetime.utcnow(),
        ))
    db.commit()


def _get_suggestions(db: Session) -> List[Dict[str, Any]]:
    setting = db.query(SystemSettings).filter(SystemSettings.key == SUGGESTIONS_KEY).first()
    if setting and setting.value:
        return setting.value if isinstance(setting.value, list) else []
    return []


def _save_suggestions(db: Session, data: List[Dict[str, Any]]) -> None:
    existing = db.query(SystemSettings).filter(SystemSettings.key == SUGGESTIONS_KEY).first()
    if existing:
        existing.value = data
        existing.updated_at = datetime.utcnow()
        flag_modified(existing, "value")
    else:
        db.add(SystemSettings(
            key=SUGGESTIONS_KEY,
            value=data,
            description="Sugestoes pendentes para lista de bloqueio global",
            updated_at=datetime.utcnow(),
        ))
    db.commit()


def _get_rejected(db: Session) -> List[str]:
    setting = db.query(SystemSettings).filter(SystemSettings.key == REJECTED_KEY).first()
    if setting and setting.value:
        return setting.value if isinstance(setting.value, list) else []
    return []


def _save_rejected(db: Session, data: List[str]) -> None:
    existing = db.query(SystemSettings).filter(SystemSettings.key == REJECTED_KEY).first()
    if existing:
        existing.value = data
        existing.updated_at = datetime.utcnow()
        flag_modified(existing, "value")
    else:
        db.add(SystemSettings(
            key=REJECTED_KEY,
            value=data,
            description="Itens rejeitados da lista de bloqueio (nao sugerir novamente)",
            updated_at=datetime.utcnow(),
        ))
    db.commit()


@router.get("/blocklist")
async def get_blocklist(db: Session = Depends(get_db)):
    """Retorna a lista de bloqueio global."""
    return _get_blocklist(db)


@router.put("/blocklist")
async def update_blocklist(
    data: BlocklistUpdate,
    db: Session = Depends(get_db),
):
    """Atualiza a lista de bloqueio global."""
    blocklist = {
        "directories": sorted(set(data.directories)),
        "file_patterns": sorted(set(data.file_patterns)),
    }
    _save_blocklist(db, blocklist)
    return blocklist


@router.get("/blocklist/suggestions")
async def get_blocklist_suggestions(db: Session = Depends(get_db)):
    """Retorna sugestoes pendentes para a lista de bloqueio."""
    return _get_suggestions(db)


@router.post("/blocklist/suggestions/approve")
async def approve_blocklist_suggestions(
    action: BlocklistSuggestionAction,
    db: Session = Depends(get_db),
):
    """Aprova sugestoes e move para a lista de bloqueio global."""
    blocklist = _get_blocklist(db)
    suggestions = _get_suggestions(db)
    approved_paths = {item["path"] for item in action.items}

    for item in action.items:
        item_type = item.get("type", "directory")
        path = item["path"]
        if item_type == "file_pattern":
            if path not in blocklist["file_patterns"]:
                blocklist["file_patterns"].append(path)
        else:
            if path not in blocklist["directories"]:
                blocklist["directories"].append(path)

    blocklist["directories"] = sorted(set(blocklist["directories"]))
    blocklist["file_patterns"] = sorted(set(blocklist["file_patterns"]))

    remaining = [s for s in suggestions if s["path"] not in approved_paths]

    _save_blocklist(db, blocklist)
    _save_suggestions(db, remaining)

    return {"blocklist": blocklist, "remaining_suggestions": len(remaining)}


@router.post("/blocklist/suggestions/reject")
async def reject_blocklist_suggestions(
    action: BlocklistSuggestionAction,
    db: Session = Depends(get_db),
):
    """Rejeita sugestoes (nao serao sugeridas novamente)."""
    suggestions = _get_suggestions(db)
    rejected = _get_rejected(db)
    rejected_paths = {item["path"] for item in action.items}

    remaining = [s for s in suggestions if s["path"] not in rejected_paths]
    new_rejected = list(set(rejected) | rejected_paths)

    _save_suggestions(db, remaining)
    _save_rejected(db, new_rejected)

    return {"remaining_suggestions": len(remaining)}


# ──────────────────────────────────────────────────
# Catch-all /{key} routes - MUST be LAST
# ──────────────────────────────────────────────────

@router.get("/{key}", response_model=SystemSettingsResponse)
async def get_setting(
    setting: SystemSettings = Depends(get_setting_or_404)
):
    """
    Get a specific setting by key.

    - **key**: Setting key (unique identifier)
    """
    return setting


@router.put("/{key}", response_model=SystemSettingsResponse)
async def create_or_update_setting(
    key: str,
    value: Any = Body(..., description="Setting value (any JSON-compatible type)"),
    description: str = Body(None, description="Setting description"),
    db: Session = Depends(get_db)
):
    """
    Create or update a setting.

    - **key**: Setting key (unique identifier)
    - **value**: Setting value (any JSON-compatible type)
    - **description**: Human-readable description (optional)

    If the setting exists, it will be updated. If not, it will be created.
    """
    # Check if setting exists
    existing = db.query(SystemSettings).filter(SystemSettings.key == key).first()

    if existing:
        # Update existing setting
        existing.value = value
        if description:
            existing.description = description
        existing.updated_at = datetime.utcnow()

        db.commit()
        db.refresh(existing)
        return existing
    else:
        # Create new setting
        new_setting = SystemSettings(
            key=key,
            value=value,
            description=description,
            updated_at=datetime.utcnow()
        )

        db.add(new_setting)
        db.commit()
        db.refresh(new_setting)
        return new_setting


@router.delete("/{key}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_setting(
    setting: SystemSettings = Depends(get_setting_or_404),
    db: Session = Depends(get_db)
):
    """
    Delete a setting.

    - **key**: Setting key to delete
    """
    db.delete(setting)
    db.commit()
    return None




@router.post("/bulk", response_model=List[SystemSettingsResponse])
async def bulk_update_settings(
    bulk_request: BulkUpdateRequest,
    db: Session = Depends(get_db)
):
    """
    Create or update multiple settings at once.

    - **settings**: Dictionary of key-value pairs to create/update

    Example:
    ```json
    {
      "settings": {
        "app.theme": "dark",
        "app.language": "en",
        "notifications.enabled": true
      }
    }
    ```
    """
    updated_settings = []

    for key, value in bulk_request.settings.items():
        # Check if setting exists
        existing = db.query(SystemSettings).filter(SystemSettings.key == key).first()

        if existing:
            # Update existing
            existing.value = value
            existing.updated_at = datetime.utcnow()
            updated_settings.append(existing)
        else:
            # Create new
            new_setting = SystemSettings(
                key=key,
                value=value,
                updated_at=datetime.utcnow()
            )
            db.add(new_setting)
            updated_settings.append(new_setting)

    db.commit()

    # Refresh all
    for setting in updated_settings:
        db.refresh(setting)

    return updated_settings


@router.get("/grouped/by-prefix")
async def get_settings_by_prefix(
    prefix: str = Query(..., description="Key prefix to filter by (e.g., 'app.')"),
    db: Session = Depends(get_db)
):
    """
    Get settings grouped by key prefix.

    Useful for getting all settings in a category.

    - **prefix**: Key prefix to filter by (e.g., "app.", "notifications.")

    Example: prefix="app." returns all settings starting with "app."
    """
    settings = db.query(SystemSettings).filter(
        SystemSettings.key.like(f"{prefix}%")
    ).order_by(SystemSettings.key).all()

    return {
        "prefix": prefix,
        "count": len(settings),
        "settings": [
            {
                "key": s.key,
                "value": s.value,
                "description": s.description,
                "updated_at": s.updated_at
            }
            for s in settings
        ]
    }
