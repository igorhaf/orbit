"""
System Settings API Router
CRUD operations for managing system-wide configuration settings.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status, Body
from sqlalchemy.orm import Session
from typing import List, Dict, Any
from datetime import datetime
from pydantic import BaseModel

from app.database import get_db
from app.models.system_settings import SystemSettings
from app.schemas.system_settings import SystemSettingsCreate, SystemSettingsUpdate, SystemSettingsResponse
from app.api.dependencies import get_setting_or_404

router = APIRouter()


class BulkUpdateRequest(BaseModel):
    """Request model for bulk updating settings."""
    settings: Dict[str, Any]


@router.get("/", response_model=List[SystemSettingsResponse])
async def list_settings(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """
    List all system settings.

    Returns all configuration settings with their values and descriptions.
    """
    settings = db.query(SystemSettings).order_by(
        SystemSettings.key
    ).offset(skip).limit(limit).all()

    return settings


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
