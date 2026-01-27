"""
Contracts API Router
Lists all YAML prompt templates from the prompts directory.

PROMPT #104 - Contracts Area
PROMPT #114 - Fix YAML display and add editing
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any
from pathlib import Path
import logging
import yaml

from app.prompts.loader import PromptLoader, PROMPTS_DIR

logger = logging.getLogger(__name__)

router = APIRouter()


class ContractUpdateRequest(BaseModel):
    """Request body for updating a contract."""
    content: str


@router.get("/")
async def list_contracts() -> List[Dict[str, Any]]:
    """
    List all contracts (YAML prompt templates).

    Returns a list of all YAML prompt files with their metadata:
    - name: The prompt identifier
    - path: Full path relative to prompts directory
    - category: Category folder (backlog, context, interviews, etc.)
    - description: Human-readable description from YAML
    """
    try:
        loader = PromptLoader()
        contracts = []

        # Get all prompts (excluding components)
        prompt_names = loader.list_prompts()

        for prompt_name in prompt_names:
            try:
                template = loader.load(prompt_name)
                contracts.append({
                    "name": template.metadata.name,
                    "path": prompt_name,
                    "category": template.metadata.category,
                    "description": template.metadata.description or ""
                })
            except Exception as e:
                logger.warning(f"Failed to load prompt {prompt_name}: {e}")
                continue

        # Sort by category then name
        contracts.sort(key=lambda x: (x["category"], x["name"]))

        return contracts

    except Exception as e:
        logger.error(f"Error listing contracts: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{path:path}")
async def get_contract(path: str) -> Dict[str, Any]:
    """
    Get a specific contract by path.

    Returns the full YAML content of the contract.
    Path format: category/name (e.g., "backlog/epic_from_interview")
    """
    try:
        loader = PromptLoader()
        template = loader.load(path)

        return {
            "name": template.metadata.name,
            "path": path,
            "category": template.metadata.category,
            "description": template.metadata.description or "",
            "content": template.raw_content
        }

    except Exception as e:
        logger.error(f"Error loading contract {path}: {e}")
        raise HTTPException(status_code=404, detail=f"Contract not found: {path}")


@router.put("/{path:path}")
async def update_contract(path: str, request: ContractUpdateRequest) -> Dict[str, Any]:
    """
    Update a specific contract by path.

    Validates YAML syntax before saving.
    Path format: category/name (e.g., "backlog/epic_from_interview")
    """
    try:
        # Validate YAML syntax
        try:
            yaml.safe_load(request.content)
        except yaml.YAMLError as e:
            raise HTTPException(status_code=400, detail=f"Invalid YAML syntax: {e}")

        # Get the file path
        if not path.endswith('.yaml'):
            file_path = PROMPTS_DIR / f"{path}.yaml"
        else:
            file_path = PROMPTS_DIR / path

        # Check if file exists
        if not file_path.exists():
            raise HTTPException(status_code=404, detail=f"Contract not found: {path}")

        # Write the content
        file_path.write_text(request.content, encoding='utf-8')

        # Clear the cache so changes are reflected
        loader = PromptLoader()
        loader.clear_cache()

        logger.info(f"Contract updated: {path}")

        return {
            "success": True,
            "path": path,
            "message": "Contract saved successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating contract {path}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save contract: {e}")
