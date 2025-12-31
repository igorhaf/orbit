"""
Prompts API Router
CRUD operations for managing prompts with versioning support.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import datetime

from app.database import get_db
from app.models.prompt import Prompt
from app.schemas.prompt import PromptCreate, PromptUpdate, PromptResponse
from app.api.dependencies import get_prompt_or_404

router = APIRouter()


@router.get("/", response_model=List[PromptResponse])
async def list_prompts(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    project_id: Optional[UUID] = Query(None, description="Filter by project ID"),
    type: Optional[str] = Query(None, description="Filter by prompt type"),
    is_reusable: Optional[bool] = Query(None, description="Filter reusable prompts"),
    created_from_interview_id: Optional[UUID] = Query(None, description="Filter by interview ID"),
    db: Session = Depends(get_db)
):
    """
    List all prompts with filtering options.

    - **project_id**: Filter by project
    - **type**: Filter by prompt type
    - **is_reusable**: Filter reusable prompts
    - **created_from_interview_id**: Filter prompts from specific interview
    """
    query = db.query(Prompt)

    if project_id:
        query = query.filter(Prompt.project_id == project_id)
    if type:
        query = query.filter(Prompt.type == type)
    if is_reusable is not None:
        query = query.filter(Prompt.is_reusable == is_reusable)
    if created_from_interview_id:
        query = query.filter(Prompt.created_from_interview_id == created_from_interview_id)

    prompts = query.order_by(Prompt.created_at.desc()).offset(skip).limit(limit).all()

    return prompts


@router.post("/", response_model=PromptResponse, status_code=status.HTTP_201_CREATED)
async def create_prompt(
    prompt_data: PromptCreate,
    db: Session = Depends(get_db)
):
    """
    Create a new prompt.

    - **project_id**: Project this prompt belongs to (required)
    - **content**: Prompt content (required)
    - **type**: Prompt type (required)
    - **is_reusable**: Whether prompt is reusable (default: false)
    - **components**: Prompt components as JSON (optional)
    - **created_from_interview_id**: Interview that generated this prompt (optional)
    - **parent_id**: Parent prompt for versioning (optional)
    """
    # Determine version number
    version = 1
    if prompt_data.parent_id:
        parent = db.query(Prompt).filter(Prompt.id == prompt_data.parent_id).first()
        if parent:
            version = parent.version + 1

    db_prompt = Prompt(
        project_id=prompt_data.project_id,
        created_from_interview_id=prompt_data.created_from_interview_id,
        parent_id=prompt_data.parent_id,
        content=prompt_data.content,
        type=prompt_data.type,
        is_reusable=prompt_data.is_reusable,
        components=prompt_data.components,
        version=version,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )

    db.add(db_prompt)
    db.commit()
    db.refresh(db_prompt)

    return db_prompt


@router.get("/{prompt_id}", response_model=PromptResponse)
async def get_prompt(
    prompt: Prompt = Depends(get_prompt_or_404)
):
    """
    Get a specific prompt by ID.

    - **prompt_id**: UUID of the prompt
    """
    return prompt


@router.patch("/{prompt_id}", response_model=PromptResponse)
async def update_prompt(
    prompt_update: PromptUpdate,
    prompt: Prompt = Depends(get_prompt_or_404),
    db: Session = Depends(get_db)
):
    """
    Update a prompt (partial update).

    - **content**: Updated content (optional)
    - **type**: Updated type (optional)
    - **is_reusable**: Updated reusable status (optional)
    - **components**: Updated components (optional)
    """
    update_data = prompt_update.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        setattr(prompt, field, value)

    prompt.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(prompt)

    return prompt


@router.delete("/{prompt_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_prompt(
    prompt: Prompt = Depends(get_prompt_or_404),
    db: Session = Depends(get_db)
):
    """
    Delete a prompt.

    - **prompt_id**: UUID of the prompt to delete
    """
    db.delete(prompt)
    db.commit()
    return None


@router.get("/{prompt_id}/versions", response_model=List[PromptResponse])
async def get_prompt_versions(
    prompt: Prompt = Depends(get_prompt_or_404),
    db: Session = Depends(get_db)
):
    """
    Get all versions of a prompt (including parent and children).

    - **prompt_id**: UUID of the prompt
    """
    # Find root prompt
    root_id = prompt.id
    current = prompt
    while current.parent_id:
        current = db.query(Prompt).filter(Prompt.id == current.parent_id).first()
        if current:
            root_id = current.id
        else:
            break

    # Get all versions starting from root
    versions = []

    def get_children(parent_id):
        children = db.query(Prompt).filter(Prompt.parent_id == parent_id).order_by(Prompt.version).all()
        for child in children:
            versions.append(child)
            get_children(child.id)

    # Add root
    root = db.query(Prompt).filter(Prompt.id == root_id).first()
    if root:
        versions.append(root)
        get_children(root.id)

    return sorted(versions, key=lambda p: p.version)


@router.post("/{prompt_id}/version", response_model=PromptResponse, status_code=status.HTTP_201_CREATED)
async def create_new_version(
    new_content: str = Query(..., description="Content for the new version"),
    prompt: Prompt = Depends(get_prompt_or_404),
    db: Session = Depends(get_db)
):
    """
    Create a new version of an existing prompt.

    - **prompt_id**: UUID of the prompt to create a version from
    - **new_content**: Content for the new version
    """
    new_prompt = Prompt(
        project_id=prompt.project_id,
        created_from_interview_id=prompt.created_from_interview_id,
        parent_id=prompt.id,
        content=new_content,
        type=prompt.type,
        is_reusable=prompt.is_reusable,
        components=prompt.components,
        version=prompt.version + 1,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )

    db.add(new_prompt)
    db.commit()
    db.refresh(new_prompt)

    return new_prompt


@router.delete("/", status_code=status.HTTP_204_NO_CONTENT)
async def delete_all_prompts(
    db: Session = Depends(get_db)
):
    """
    Delete all prompts (clear all logs).

    ⚠️ WARNING: This action cannot be undone!
    """
    db.query(Prompt).delete()
    db.commit()
    return None


@router.get("/reusable/all", response_model=List[PromptResponse])
async def get_reusable_prompts(
    project_id: Optional[UUID] = Query(None, description="Filter by project ID"),
    type: Optional[str] = Query(None, description="Filter by prompt type"),
    db: Session = Depends(get_db)
):
    """
    Get all reusable prompts.

    - **project_id**: Filter by project (optional)
    - **type**: Filter by prompt type (optional)
    """
    query = db.query(Prompt).filter(Prompt.is_reusable == True)

    if project_id:
        query = query.filter(Prompt.project_id == project_id)
    if type:
        query = query.filter(Prompt.type == type)

    prompts = query.order_by(Prompt.created_at.desc()).all()

    return prompts
