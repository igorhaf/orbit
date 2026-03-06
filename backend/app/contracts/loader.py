"""
ContractLoader - Loads and renders contracts from hardcoded Python constants.

All contracts are stored as Python string/dict constants in domain modules.
This loader provides the same API as the original DB-backed loader
but reads from an in-memory registry instead of PostgreSQL.

Consolidation: DB → Python constants (no more dynamic DB loading).
"""

import logging
from pathlib import Path
from typing import Dict, Any, Optional, Tuple, List

from jinja2 import Environment, BaseLoader, TemplateSyntaxError

from app.contracts.models import (
    Contract,
    ContractMetadata,
    ContractVariables,
    ContractVariable,
    ContractGovernance,
    ContractRules,
    ExecutionConfig,
    RenderedContract,
    ContractNotFoundError,
    ContractRenderError,
    ContractValidationError,
)
from app.prompts.components import ALL_COMPONENTS

logger = logging.getLogger(__name__)

# Keep for backward compatibility
CONTRACTS_DIR = Path(__file__).parent

# ---------------------------------------------------------------------------
# Build the global contract registry from all domain modules
# ---------------------------------------------------------------------------
_REGISTRY: Dict[str, Dict[str, Any]] = {}


def _build_registry() -> Dict[str, Dict[str, Any]]:
    """Lazily build the contract registry from all domain modules."""
    if _REGISTRY:
        return _REGISTRY

    from app.contracts.interviews_contracts import CONTRACTS as interviews
    from app.contracts.generation_contracts import CONTRACTS as generation
    from app.contracts.memory_contracts import CONTRACTS as memory
    from app.contracts.pipeline_contracts import CONTRACTS as pipeline
    from app.contracts.business_contracts import CONTRACTS as business
    from app.contracts.execution_contracts import CONTRACTS as execution
    from app.contracts.validation_contracts import CONTRACTS as validation
    from app.contracts.commits_contracts import CONTRACTS as commits
    from app.contracts.components_contracts import CONTRACTS as components

    for module_contracts in (interviews, generation, memory, pipeline,
                             business, execution, validation, commits, components):
        _REGISTRY.update(module_contracts)

    logger.info(f"Contract registry built with {len(_REGISTRY)} contracts")
    return _REGISTRY


# ---------------------------------------------------------------------------
# Jinja2 environment
# ---------------------------------------------------------------------------
_jinja_env = Environment(
    loader=BaseLoader(),
    trim_blocks=True,
    lstrip_blocks=True,
    autoescape=False,
)


def _render_template(template_str: str, variables: Dict[str, Any]) -> str:
    """Render a Jinja2 template string with variables."""
    if not template_str:
        return ""
    try:
        template = _jinja_env.from_string(template_str)
        return template.render(**variables)
    except TemplateSyntaxError as e:
        logger.error(f"Jinja2 syntax error: {e}")
        raise ContractRenderError("unknown", f"Template syntax error: {e}")
    except Exception as e:
        logger.error(f"Error rendering template: {e}")
        return template_str


# ---------------------------------------------------------------------------
# ContractLoader — same public API, backed by Python constants
# ---------------------------------------------------------------------------
class ContractLoader:
    """
    Loads and renders contracts from hardcoded Python constants.

    Usage:
        loader = ContractLoader()
        system_prompt, user_prompt = loader.render(
            "generation/epic_from_interview",
            {"conversation_text": "...", "project_name": "My Project"}
        )
    """

    def __init__(self, db=None, contracts_dir: Path = None, enable_cache: bool = True):
        """Initialize ContractLoader. Arguments kept for backward compatibility."""
        self._registry = _build_registry()

    def load(self, contract_name: str) -> Contract:
        """
        Load a contract by name.

        Args:
            contract_name: Contract identifier (e.g., "business/project_creation")

        Returns:
            Contract object (Pydantic)

        Raises:
            ContractNotFoundError: If contract not found
        """
        entry = self._registry.get(contract_name)
        if entry is None:
            raise ContractNotFoundError(contract_name)

        name = contract_name.split("/")[-1] if "/" in contract_name else contract_name
        domain = contract_name.split("/")[0] if "/" in contract_name else "generation"

        metadata = ContractMetadata(
            name=name,
            version=1,
            domain=domain,
            category="",
            description="",
            usage_type=entry.get("usage_type", "general"),
            tags=[],
            components=[],
        )

        return Contract(
            metadata=metadata,
            governance=ContractGovernance(),
            semantic_map=entry.get("semantic_map", {}),
            rules=ContractRules(),
            variables=ContractVariables(),
            system_prompt=entry.get("system", ""),
            user_prompt=entry.get("user", ""),
            validators=[],
            execution=ExecutionConfig(),
            data=entry.get("data", {}),
        )

    def load_data(self, contract_name: str) -> Dict[str, Any]:
        """Load structured data from a data-only contract."""
        entry = self._registry.get(contract_name)
        if entry is None:
            raise ContractNotFoundError(contract_name)
        return entry.get("data", {})

    def render(
        self,
        contract_name: str,
        variables: Dict[str, Any] = None,
        strict: bool = False,
    ) -> Tuple[str, str]:
        """
        Render a contract with variables.

        Args:
            contract_name: Contract identifier
            variables: Dictionary of variables to substitute
            strict: If True, raise error on missing required variables

        Returns:
            Tuple of (system_prompt, user_prompt)
        """
        variables = variables or {}
        entry = self._registry.get(contract_name)
        if entry is None:
            raise ContractNotFoundError(contract_name)

        render_vars = {**variables, "components": ALL_COMPONENTS}

        system_prompt = _render_template(entry.get("system", ""), render_vars)
        user_prompt = _render_template(entry.get("user", ""), render_vars)

        return system_prompt, user_prompt

    def render_full(
        self,
        contract_name: str,
        variables: Dict[str, Any] = None,
        strict: bool = False,
    ) -> RenderedContract:
        """Render and return full RenderedContract object."""
        variables = variables or {}
        system_prompt, user_prompt = self.render(contract_name, variables, strict)
        entry = self._registry.get(contract_name, {})

        return RenderedContract(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            contract_name=contract_name.split("/")[-1],
            contract_version=1,
            domain=contract_name.split("/")[0] if "/" in contract_name else "generation",
            usage_type=entry.get("usage_type", "general"),
            variables_used=variables,
            components_loaded=[],
            semantic_map=entry.get("semantic_map", {}),
        )

    def clear_cache(self):
        """No-op — constants don't need cache clearing."""
        pass

    def list_contracts(self, domain: str = None, category: str = None) -> List[str]:
        """List available contract names."""
        names = sorted(self._registry.keys())
        if domain:
            names = [n for n in names if n.startswith(f"{domain}/")]
        if category:
            names = [n for n in names if n.startswith(f"{category}/")]
        return names

    def list_by_usage_type(self, usage_type: str) -> List[str]:
        """List contracts filtered by usage_type."""
        return sorted(
            name for name, entry in self._registry.items()
            if entry.get("usage_type") == usage_type
        )

    def exists(self, contract_name: str) -> bool:
        """Check if a contract exists in the registry."""
        return contract_name in self._registry

    def get_domains(self) -> List[str]:
        """Get list of available domains."""
        domains = set()
        for name in self._registry:
            if "/" in name:
                domains.add(name.split("/")[0])
        return sorted(domains)

    def get_categories(self) -> List[str]:
        """Get list of available categories."""
        return self.get_domains()


# Global singleton instance
_loader_instance: Optional[ContractLoader] = None


def get_contract_loader() -> ContractLoader:
    """Get the global ContractLoader instance."""
    global _loader_instance
    if _loader_instance is None:
        _loader_instance = ContractLoader()
    return _loader_instance
