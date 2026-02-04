"""
ORBIT Contracts System

PROMPT #164 - Contracts Architecture: Unification and Governance

This package provides a unified contract management system that:
1. Documents business rules in YAML contracts
2. Integrates with Memory Scan for contract-based analysis
3. Provides full CRUD for contract management
4. Replaces the legacy prompter/ folder

Usage:
    from app.contracts import ContractLoader, get_contract_loader

    loader = get_contract_loader()

    # Load a contract
    contract = loader.load("business/project_creation")

    # Render with variables
    system_prompt, user_prompt = loader.render(
        "generation/epic_from_interview",
        {"conversation_text": "...", "project_name": "My Project"}
    )
"""

from app.contracts.loader import ContractLoader, get_contract_loader, CONTRACTS_DIR
from app.contracts.models import (
    Contract,
    ContractMetadata,
    ContractVariables,
    ContractGovernance,
    ContractRules,
    RenderedContract,
    ContractNotFoundError,
    ContractRenderError,
    ContractValidationError,
)

__all__ = [
    # Loader
    "ContractLoader",
    "get_contract_loader",
    "CONTRACTS_DIR",
    # Models
    "Contract",
    "ContractMetadata",
    "ContractVariables",
    "ContractGovernance",
    "ContractRules",
    "RenderedContract",
    # Exceptions
    "ContractNotFoundError",
    "ContractRenderError",
    "ContractValidationError",
]
