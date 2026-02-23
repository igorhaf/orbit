"""
Contracts API Router
Full CRUD for database-backed contract management.

PROMPT #104 - Contracts Area (Initial)
PROMPT #164 - Full CRUD with ContractLoader
PROMPT #257 - Contracts in Database + Visual Nodes in AI Flow
"""

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from uuid import UUID, uuid4
from datetime import datetime
import logging
import yaml

from sqlalchemy.orm import Session

from app.database import get_db
from app.models.contract import Contract as ContractModel
from app.contracts.loader import get_contract_loader

logger = logging.getLogger(__name__)

router = APIRouter()


# =============================================================================
# Request/Response Models
# =============================================================================

class ContractCreateRequest(BaseModel):
    """Request body for creating a contract."""
    name: str  # e.g., "business/new_contract"
    version: int = 1
    domain: str = "generation"
    category: str = ""
    usage_type: str = "general"
    description: str = ""
    system_prompt: str = ""
    user_prompt: str = ""
    semantic_map: Dict[str, Any] = {}
    variables: Dict[str, Any] = {}
    governance: Dict[str, Any] = {}
    rules: Dict[str, Any] = {}
    validators: List[Any] = []
    execution: Dict[str, Any] = {}
    data: Dict[str, Any] = {}
    components: List[str] = []
    tags: List[str] = []


class ContractUpdateRequest(BaseModel):
    """Request body for updating a contract."""
    version: Optional[int] = None
    domain: Optional[str] = None
    category: Optional[str] = None
    usage_type: Optional[str] = None
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    user_prompt: Optional[str] = None
    semantic_map: Optional[Dict[str, Any]] = None
    variables: Optional[Dict[str, Any]] = None
    governance: Optional[Dict[str, Any]] = None
    rules: Optional[Dict[str, Any]] = None
    validators: Optional[List[Any]] = None
    execution: Optional[Dict[str, Any]] = None
    data: Optional[Dict[str, Any]] = None
    components: Optional[List[str]] = None
    tags: Optional[List[str]] = None


class ContractResponse(BaseModel):
    """Standard contract response."""
    id: str
    name: str
    version: int
    domain: str
    category: str
    usage_type: str
    description: str
    system_prompt: str
    user_prompt: str
    semantic_map: Dict[str, Any]
    variables: Dict[str, Any]
    governance: Dict[str, Any]
    rules: Dict[str, Any]
    validators: List[Any]
    execution: Dict[str, Any]
    data: Dict[str, Any]
    components: List[Any]
    tags: List[Any]
    is_active: bool
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ContractListResponse(BaseModel):
    """Contract list item."""
    id: str
    name: str
    domain: str
    category: str
    usage_type: str
    description: str
    version: int
    tags: List[Any]
    is_active: bool


class ValidationResult(BaseModel):
    """Result of contract validation."""
    valid: bool
    errors: List[str]
    warnings: List[str]


# =============================================================================
# Helpers
# =============================================================================

def _row_to_response(row: ContractModel) -> ContractResponse:
    """Convert a DB row to a ContractResponse."""
    return ContractResponse(
        id=str(row.id),
        name=row.name,
        version=row.version or 1,
        domain=row.domain or "generation",
        category=row.category or "",
        usage_type=row.usage_type or "general",
        description=row.description or "",
        system_prompt=row.system_prompt or "",
        user_prompt=row.user_prompt or "",
        semantic_map=row.semantic_map or {},
        variables=row.variables or {},
        governance=row.governance or {},
        rules=row.rules or {},
        validators=row.validators or [],
        execution=row.execution or {},
        data=row.data or {},
        components=row.components or [],
        tags=row.tags or [],
        is_active=row.is_active,
        created_at=row.created_at.isoformat() if row.created_at else None,
        updated_at=row.updated_at.isoformat() if row.updated_at else None,
    )


def _row_to_list_response(row: ContractModel) -> ContractListResponse:
    """Convert a DB row to a ContractListResponse."""
    return ContractListResponse(
        id=str(row.id),
        name=row.name,
        domain=row.domain or "generation",
        category=row.category or "",
        usage_type=row.usage_type or "general",
        description=row.description or "",
        version=row.version or 1,
        tags=row.tags or [],
        is_active=row.is_active,
    )


# =============================================================================
# Endpoints
# =============================================================================

@router.get("/")
async def list_contracts(
    domain: Optional[str] = Query(None, description="Filter by domain"),
    category: Optional[str] = Query(None, description="Filter by category"),
    usage_type: Optional[str] = Query(None, description="Filter by usage_type"),
    tags: Optional[str] = Query(None, description="Comma-separated tags"),
    db: Session = Depends(get_db),
) -> List[ContractListResponse]:
    """List all contracts with optional filters."""
    try:
        query = db.query(ContractModel).filter_by(is_active=True)

        if domain:
            query = query.filter_by(domain=domain)
        if category:
            query = query.filter(ContractModel.name.like(f"{category}/%"))
        if usage_type:
            query = query.filter_by(usage_type=usage_type)

        rows = query.order_by(ContractModel.domain, ContractModel.name).all()

        results = [_row_to_list_response(r) for r in rows]

        # Filter by tags if specified
        if tags:
            required_tags = [t.strip() for t in tags.split(",")]
            results = [
                r for r in results
                if all(tag in (r.tags or []) for tag in required_tags)
            ]

        return results

    except Exception as e:
        logger.error(f"Error listing contracts: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/domains")
async def list_domains(db: Session = Depends(get_db)) -> List[str]:
    """Get list of available domains."""
    rows = (
        db.query(ContractModel.domain)
        .filter_by(is_active=True)
        .distinct()
        .all()
    )
    return sorted(set(row[0] for row in rows if row[0]))


@router.get("/categories")
async def list_categories(db: Session = Depends(get_db)) -> List[str]:
    """Get list of available categories."""
    rows = (
        db.query(ContractModel.category)
        .filter_by(is_active=True)
        .distinct()
        .all()
    )
    return sorted(set(row[0] for row in rows if row[0]))


@router.get("/by-usage-type/{usage_type}")
async def get_contracts_by_usage_type(
    usage_type: str,
    db: Session = Depends(get_db),
) -> List[ContractResponse]:
    """
    PROMPT #257 - Get contracts filtered by usage_type.
    Used by AI Flow to show contract nodes for a specific operation.
    """
    try:
        rows = (
            db.query(ContractModel)
            .filter_by(usage_type=usage_type, is_active=True)
            .order_by(ContractModel.name)
            .all()
        )
        return [_row_to_response(r) for r in rows]

    except Exception as e:
        logger.error(f"Error getting contracts by usage_type: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/search")
async def search_contracts(
    q: str = Query(..., description="Search query"),
    domain: Optional[str] = None,
    category: Optional[str] = None,
    db: Session = Depends(get_db),
) -> List[ContractListResponse]:
    """Search contracts by name, description, or tags."""
    try:
        query_lower = f"%{q.lower()}%"
        query = db.query(ContractModel).filter_by(is_active=True)

        if domain:
            query = query.filter_by(domain=domain)
        if category:
            query = query.filter(ContractModel.name.like(f"{category}/%"))

        # Search in name and description
        from sqlalchemy import or_, func
        query = query.filter(
            or_(
                func.lower(ContractModel.name).like(query_lower),
                func.lower(ContractModel.description).like(query_lower),
            )
        )

        rows = query.order_by(ContractModel.name).all()
        return [_row_to_list_response(r) for r in rows]

    except Exception as e:
        logger.error(f"Error searching contracts: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/validate")
async def validate_contract(content: str) -> ValidationResult:
    """Validate contract YAML syntax."""
    errors = []
    warnings = []

    try:
        data = yaml.safe_load(content)
        if data is None:
            errors.append("YAML content is empty")
            return ValidationResult(valid=False, errors=errors, warnings=warnings)
    except yaml.YAMLError as e:
        errors.append(f"Invalid YAML syntax: {e}")
        return ValidationResult(valid=False, errors=errors, warnings=warnings)

    required_fields = ["name", "version", "category"]
    for field in required_fields:
        if field not in data:
            errors.append(f"Missing required field: {field}")

    valid_domains = ["business", "interview", "generation", "memory", "component"]
    if "domain" in data and data["domain"] not in valid_domains:
        warnings.append(f"Invalid domain '{data['domain']}'. Valid: {valid_domains}")

    return ValidationResult(
        valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
    )


@router.post("/")
async def create_contract(
    request: ContractCreateRequest,
    db: Session = Depends(get_db),
) -> ContractResponse:
    """Create a new contract."""
    try:
        # Check if name already exists
        existing = db.query(ContractModel).filter_by(name=request.name).first()
        if existing:
            raise HTTPException(status_code=409, detail=f"Contract already exists: {request.name}")

        contract = ContractModel(
            id=uuid4(),
            name=request.name,
            version=request.version,
            domain=request.domain,
            category=request.category,
            usage_type=request.usage_type,
            description=request.description,
            system_prompt=request.system_prompt,
            user_prompt=request.user_prompt,
            semantic_map=request.semantic_map,
            variables=request.variables,
            governance=request.governance,
            rules=request.rules,
            validators=request.validators,
            execution=request.execution,
            data=request.data,
            components=request.components,
            tags=request.tags,
        )
        db.add(contract)
        db.commit()
        db.refresh(contract)

        # Clear loader cache
        try:
            get_contract_loader().clear_cache()
        except Exception:
            pass

        logger.info(f"Contract created: {request.name}")
        return _row_to_response(contract)

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating contract: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{path:path}")
async def get_contract(
    path: str,
    db: Session = Depends(get_db),
) -> ContractResponse:
    """Get a specific contract by path/name."""
    try:
        row = db.query(ContractModel).filter_by(name=path).first()
        if not row:
            raise HTTPException(status_code=404, detail=f"Contract not found: {path}")

        return _row_to_response(row)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error loading contract {path}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{path:path}")
async def update_contract(
    path: str,
    request: ContractUpdateRequest,
    db: Session = Depends(get_db),
) -> ContractResponse:
    """Update a specific contract."""
    try:
        row = db.query(ContractModel).filter_by(name=path).first()
        if not row:
            raise HTTPException(status_code=404, detail=f"Contract not found: {path}")

        # Update only provided fields
        update_data = request.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(row, key, value)

        row.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(row)

        # Clear loader cache
        try:
            get_contract_loader().clear_cache()
        except Exception:
            pass

        logger.info(f"Contract updated: {path}")
        return _row_to_response(row)

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating contract {path}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{path:path}")
async def delete_contract(
    path: str,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Soft-delete a contract (set is_active=False)."""
    try:
        row = db.query(ContractModel).filter_by(name=path).first()
        if not row:
            raise HTTPException(status_code=404, detail=f"Contract not found: {path}")

        row.is_active = False
        row.updated_at = datetime.utcnow()
        db.commit()

        # Clear loader cache
        try:
            get_contract_loader().clear_cache()
        except Exception:
            pass

        logger.info(f"Contract deactivated: {path}")
        return {"success": True, "path": path, "message": "Contract deactivated"}

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error deleting contract {path}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
