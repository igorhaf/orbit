"""
Contracts API Router
Full CRUD for YAML contract management.

PROMPT #104 - Contracts Area (Initial)
PROMPT #114 - Fix YAML display and add editing
PROMPT #164 - Full CRUD with ContractLoader
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from pathlib import Path
import logging
import yaml
import shutil
from datetime import datetime

from app.contracts.loader import ContractLoader, CONTRACTS_DIR
from app.contracts.models import ContractNotFoundError

logger = logging.getLogger(__name__)

router = APIRouter()


# =============================================================================
# Request/Response Models
# =============================================================================

class ContractCreateRequest(BaseModel):
    """Request body for creating a contract."""
    path: str  # e.g., "business/new_contract"
    content: str
    create_backup: bool = False


class ContractUpdateRequest(BaseModel):
    """Request body for updating a contract."""
    content: str
    create_backup: bool = False


class ContractValidateRequest(BaseModel):
    """Request body for validating contract YAML."""
    content: str


class ContractResponse(BaseModel):
    """Standard contract response."""
    name: str
    path: str
    category: str
    domain: str
    description: str
    version: int
    status: str
    content: Optional[str] = None


class ContractListResponse(BaseModel):
    """Contract list item."""
    name: str
    path: str
    category: str
    domain: str
    description: str
    version: int
    status: str
    tags: List[str]


class ValidationResult(BaseModel):
    """Result of contract validation."""
    valid: bool
    errors: List[str]
    warnings: List[str]
    schema_version: str = "1.0"


# =============================================================================
# Endpoints
# =============================================================================

@router.get("/")
async def list_contracts(
    domain: Optional[str] = Query(None, description="Filter by domain"),
    category: Optional[str] = Query(None, description="Filter by category"),
    status: Optional[str] = Query(None, description="Filter by status"),
    tags: Optional[str] = Query(None, description="Comma-separated tags")
) -> List[ContractListResponse]:
    """
    List all contracts with optional filters.

    Filters:
    - domain: business, interview, generation, memory, component
    - category: folder name (business, generation, interviews, etc.)
    - status: draft, active, deprecated
    - tags: comma-separated list of tags
    """
    try:
        loader = ContractLoader()
        contracts = []

        # Get all contracts
        contract_names = loader.list_contracts(domain=domain, category=category)

        for contract_name in contract_names:
            try:
                contract = loader.load(contract_name)

                # Filter by status
                if status and contract.governance.status != status:
                    continue

                # Filter by tags
                if tags:
                    required_tags = [t.strip() for t in tags.split(',')]
                    if not all(tag in contract.metadata.tags for tag in required_tags):
                        continue

                contracts.append(ContractListResponse(
                    name=contract.metadata.name,
                    path=contract_name,
                    category=contract.metadata.category,
                    domain=contract.metadata.domain,
                    description=contract.metadata.description or "",
                    version=contract.metadata.version,
                    status=contract.governance.status,
                    tags=contract.metadata.tags
                ))
            except Exception as e:
                logger.warning(f"Failed to load contract {contract_name}: {e}")
                continue

        # Sort by domain, then category, then name
        contracts.sort(key=lambda x: (x.domain, x.category, x.name))

        return contracts

    except Exception as e:
        logger.error(f"Error listing contracts: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/domains")
async def list_domains() -> List[str]:
    """Get list of available domains."""
    loader = ContractLoader()
    return loader.get_domains()


@router.get("/categories")
async def list_categories() -> List[str]:
    """Get list of available categories (top-level folders)."""
    loader = ContractLoader()
    return loader.get_categories()


@router.get("/search")
async def search_contracts(
    q: str = Query(..., description="Search query"),
    domain: Optional[str] = None,
    category: Optional[str] = None
) -> List[ContractListResponse]:
    """
    Search contracts by name, description, or tags.
    """
    try:
        loader = ContractLoader()
        contracts = []
        query_lower = q.lower()

        contract_names = loader.list_contracts(domain=domain, category=category)

        for contract_name in contract_names:
            try:
                contract = loader.load(contract_name)

                # Search in name, description, and tags
                name_match = query_lower in contract.metadata.name.lower()
                desc_match = query_lower in (contract.metadata.description or "").lower()
                tags_match = any(query_lower in tag.lower() for tag in contract.metadata.tags)

                if name_match or desc_match or tags_match:
                    contracts.append(ContractListResponse(
                        name=contract.metadata.name,
                        path=contract_name,
                        category=contract.metadata.category,
                        domain=contract.metadata.domain,
                        description=contract.metadata.description or "",
                        version=contract.metadata.version,
                        status=contract.governance.status,
                        tags=contract.metadata.tags
                    ))
            except Exception as e:
                continue

        return contracts

    except Exception as e:
        logger.error(f"Error searching contracts: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/validate")
async def validate_contract(request: ContractValidateRequest) -> ValidationResult:
    """
    Validate contract YAML syntax and schema.
    """
    errors = []
    warnings = []

    # 1. Validate YAML syntax
    try:
        data = yaml.safe_load(request.content)
        if data is None:
            errors.append("Conteudo YAML esta vazio")
            return ValidationResult(valid=False, errors=errors, warnings=warnings)
    except yaml.YAMLError as e:
        errors.append(f"Sintaxe YAML invalida: {e}")
        return ValidationResult(valid=False, errors=errors, warnings=warnings)

    # 2. Validate required fields
    required_fields = ['name', 'version', 'category']
    for field in required_fields:
        if field not in data:
            errors.append(f"Campo obrigatorio ausente: {field}")

    # 3. Validate domain if present
    valid_domains = ['business', 'interview', 'generation', 'memory', 'component']
    if 'domain' in data and data['domain'] not in valid_domains:
        warnings.append(f"Dominio invalido '{data['domain']}'. Dominios validos: {valid_domains}")

    # 4. Validate governance status if present
    if 'governance' in data and 'status' in data['governance']:
        valid_statuses = ['draft', 'active', 'deprecated']
        if data['governance']['status'] not in valid_statuses:
            warnings.append(f"Status invalido. Status validos: {valid_statuses}")

    # 5. Validate variables structure
    if 'variables' in data:
        if 'required' in data['variables']:
            if not isinstance(data['variables']['required'], list):
                errors.append("variables.required deve ser uma lista")
        if 'optional' in data['variables']:
            if not isinstance(data['variables']['optional'], list):
                errors.append("variables.optional deve ser uma lista")

    # 6. Check for prompts in non-component contracts
    if data.get('domain') != 'business' and data.get('domain') != 'component':
        if not data.get('system_prompt') and not data.get('user_prompt'):
            warnings.append("Contrato nao possui system_prompt ou user_prompt definido")

    return ValidationResult(
        valid=len(errors) == 0,
        errors=errors,
        warnings=warnings
    )


@router.post("/")
async def create_contract(request: ContractCreateRequest) -> Dict[str, Any]:
    """
    Create a new contract.

    The path should be in format: category/name (e.g., "business/new_rule")
    """
    try:
        # Validate YAML first
        validation = await validate_contract(ContractValidateRequest(content=request.content))
        if not validation.valid:
            raise HTTPException(status_code=400, detail=f"YAML invalido: {validation.errors}")

        # Build file path
        path = request.path
        if not path.endswith('.yaml'):
            path = f"{path}.yaml"

        file_path = CONTRACTS_DIR / path

        # Check if file already exists
        if file_path.exists():
            raise HTTPException(status_code=409, detail=f"Contrato ja existe: {request.path}")

        # Create parent directories if needed
        file_path.parent.mkdir(parents=True, exist_ok=True)

        # Write the file
        file_path.write_text(request.content, encoding='utf-8')

        # Clear cache
        loader = ContractLoader()
        loader.clear_cache()

        logger.info(f"Contract created: {request.path}")

        return {
            "success": True,
            "path": request.path,
            "message": "Contrato criado com sucesso"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating contract: {e}")
        raise HTTPException(status_code=500, detail=f"Falha ao criar contrato: {e}")


@router.get("/{path:path}")
async def get_contract(path: str) -> ContractResponse:
    """
    Get a specific contract by path.

    Path format: category/name (e.g., "business/project_creation")
    """
    try:
        loader = ContractLoader()
        contract = loader.load(path)

        return ContractResponse(
            name=contract.metadata.name,
            path=path,
            category=contract.metadata.category,
            domain=contract.metadata.domain,
            description=contract.metadata.description or "",
            version=contract.metadata.version,
            status=contract.governance.status,
            content=contract.raw_content
        )

    except ContractNotFoundError:
        raise HTTPException(status_code=404, detail=f"Contrato nao encontrado: {path}")
    except Exception as e:
        logger.error(f"Error loading contract {path}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{path:path}")
async def update_contract(path: str, request: ContractUpdateRequest) -> Dict[str, Any]:
    """
    Update a specific contract.

    Path format: category/name (e.g., "business/project_creation")
    """
    try:
        # Validate YAML first
        validation = await validate_contract(ContractValidateRequest(content=request.content))
        if not validation.valid:
            raise HTTPException(status_code=400, detail=f"YAML invalido: {validation.errors}")

        # Get the file path
        if not path.endswith('.yaml'):
            file_path = CONTRACTS_DIR / f"{path}.yaml"
        else:
            file_path = CONTRACTS_DIR / path

        # Check if file exists
        if not file_path.exists():
            raise HTTPException(status_code=404, detail=f"Contrato nao encontrado: {path}")

        # Create backup if requested
        if request.create_backup:
            backup_dir = CONTRACTS_DIR / ".backups" / path.replace('/', '_')
            backup_dir.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_path = backup_dir / f"{timestamp}.yaml"
            shutil.copy2(file_path, backup_path)
            logger.info(f"Backup created: {backup_path}")

        # Write the content
        file_path.write_text(request.content, encoding='utf-8')

        # Clear the cache
        loader = ContractLoader()
        loader.clear_cache()

        logger.info(f"Contract updated: {path}")

        return {
            "success": True,
            "path": path,
            "message": "Contrato salvo com sucesso"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating contract {path}: {e}")
        raise HTTPException(status_code=500, detail=f"Falha ao salvar contrato: {e}")


@router.delete("/{path:path}")
async def delete_contract(
    path: str,
    backup: bool = Query(True, description="Create backup before deleting")
) -> Dict[str, Any]:
    """
    Delete a contract.

    By default, creates a backup before deletion.
    """
    try:
        # Get the file path
        if not path.endswith('.yaml'):
            file_path = CONTRACTS_DIR / f"{path}.yaml"
        else:
            file_path = CONTRACTS_DIR / path

        # Check if file exists
        if not file_path.exists():
            raise HTTPException(status_code=404, detail=f"Contrato nao encontrado: {path}")

        backup_path = None

        # Create backup if requested
        if backup:
            backup_dir = CONTRACTS_DIR / ".backups" / path.replace('/', '_')
            backup_dir.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_path = backup_dir / f"{timestamp}_deleted.yaml"
            shutil.copy2(file_path, backup_path)
            logger.info(f"Backup created before deletion: {backup_path}")

        # Delete the file
        file_path.unlink()

        # Clear the cache
        loader = ContractLoader()
        loader.clear_cache()

        logger.info(f"Contract deleted: {path}")

        return {
            "success": True,
            "path": path,
            "message": "Contrato excluido com sucesso",
            "backup_path": str(backup_path) if backup_path else None
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting contract {path}: {e}")
        raise HTTPException(status_code=500, detail=f"Falha ao excluir contrato: {e}")


@router.get("/{path:path}/versions")
async def list_contract_versions(path: str) -> List[Dict[str, Any]]:
    """
    List backup versions of a contract.
    """
    try:
        backup_dir = CONTRACTS_DIR / ".backups" / path.replace('/', '_')

        if not backup_dir.exists():
            return []

        versions = []
        for backup_file in sorted(backup_dir.glob("*.yaml"), reverse=True):
            stat = backup_file.stat()
            versions.append({
                "filename": backup_file.name,
                "timestamp": backup_file.stem.split('_')[0] + "_" + backup_file.stem.split('_')[1] if '_' in backup_file.stem else backup_file.stem,
                "size": stat.st_size,
                "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                "is_deleted": "_deleted" in backup_file.name
            })

        return versions

    except Exception as e:
        logger.error(f"Error listing versions for {path}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{path:path}/restore")
async def restore_contract_version(
    path: str,
    filename: str = Query(..., description="Backup filename to restore")
) -> Dict[str, Any]:
    """
    Restore a contract from a backup version.
    """
    try:
        backup_dir = CONTRACTS_DIR / ".backups" / path.replace('/', '_')
        backup_file = backup_dir / filename

        if not backup_file.exists():
            raise HTTPException(status_code=404, detail=f"Backup nao encontrado: {filename}")

        # Get current file path
        if not path.endswith('.yaml'):
            file_path = CONTRACTS_DIR / f"{path}.yaml"
        else:
            file_path = CONTRACTS_DIR / path

        # Create backup of current state before restore
        if file_path.exists():
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            current_backup = backup_dir / f"{timestamp}_before_restore.yaml"
            shutil.copy2(file_path, current_backup)

        # Create parent directories if needed (for deleted contracts)
        file_path.parent.mkdir(parents=True, exist_ok=True)

        # Restore
        shutil.copy2(backup_file, file_path)

        # Clear cache
        loader = ContractLoader()
        loader.clear_cache()

        logger.info(f"Contract restored: {path} from {filename}")

        return {
            "success": True,
            "path": path,
            "restored_from": filename,
            "message": "Contrato restaurado com sucesso"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error restoring contract {path}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
