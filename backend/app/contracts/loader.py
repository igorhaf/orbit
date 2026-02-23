"""
ContractLoader - Loads and renders contracts from the database

PROMPT #164 - Contracts Architecture: Unification and Governance
PROMPT #257 - Contracts in Database + Visual Nodes in AI Flow

Features:
- Database-backed contract storage (replaces YAML files)
- Jinja2 template rendering
- Component inclusion and reuse
- Variable validation
- Caching for performance
- Semantic map support
- Backward compatibility with all existing callers
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

logger = logging.getLogger(__name__)

# Keep CONTRACTS_DIR for backward compatibility (used by some imports)
CONTRACTS_DIR = Path(__file__).parent


def _get_db_session():
    """Get a database session for contract loading."""
    from app.database import SessionLocal
    return SessionLocal()


class ContractLoader:
    """
    Loads and renders contracts from the database with Jinja2 support.

    PROMPT #257: Now reads from PostgreSQL instead of YAML files.
    All existing API (load, load_data, render, render_full, list_contracts) preserved.

    Usage:
        loader = ContractLoader()

        # Load contract metadata
        contract = loader.load("business/project_creation")

        # Render with variables
        system_prompt, user_prompt = loader.render(
            "generation/epic_from_interview",
            {"conversation_text": "...", "project_name": "My Project"}
        )
    """

    def __init__(self, db=None, contracts_dir: Path = None, enable_cache: bool = True):
        """
        Initialize ContractLoader.

        Args:
            db: Optional SQLAlchemy session. If None, creates one internally.
            contracts_dir: Deprecated. Kept for backward compatibility.
            enable_cache: Whether to cache loaded contracts (default True)
        """
        self._db = db
        self._owns_db = False  # Whether we created the session ourselves
        self.contracts_dir = Path(contracts_dir) if contracts_dir else CONTRACTS_DIR
        self.enable_cache = enable_cache
        self._contract_cache: Dict[str, Contract] = {}
        self._component_cache: Dict[str, str] = {}

        # Initialize Jinja2 environment
        self.jinja_env = Environment(
            loader=BaseLoader(),
            trim_blocks=True,
            lstrip_blocks=True,
            autoescape=False,
        )

        logger.debug("ContractLoader initialized (DB-backed)")

    def _get_db(self):
        """Get database session, creating one if needed."""
        if self._db is not None:
            return self._db
        # Create a session for this loader instance
        self._db = _get_db_session()
        self._owns_db = True
        return self._db

    def _db_row_to_contract(self, row) -> Contract:
        """Convert a DB Contract row to a Pydantic Contract object."""
        from app.models.contract import Contract as ContractModel  # SQLAlchemy model

        # Parse variables from JSON
        vars_data = row.variables or {}
        variables = self._parse_variables(vars_data)

        # Parse governance from JSON
        governance = self._parse_governance(row.governance or {})

        # Parse execution from JSON
        execution = self._parse_execution(row.execution or {})

        # Parse rules from JSON
        rules_data = row.rules or {}
        rules = ContractRules(
            validations=rules_data.get('validations', []),
            constraints=rules_data.get('constraints', []),
            access_control=rules_data.get('access_control', [])
        )

        # Build metadata
        metadata = ContractMetadata(
            name=row.name.split('/')[-1] if '/' in row.name else row.name,
            version=row.version or 1,
            domain=row.domain or 'generation',
            category=row.category or '',
            description=row.description or '',
            usage_type=row.usage_type or 'general',
            tags=row.tags or [],
            components=row.components or []
        )

        return Contract(
            metadata=metadata,
            governance=governance,
            semantic_map=row.semantic_map or {},
            rules=rules,
            variables=variables,
            system_prompt=row.system_prompt or '',
            user_prompt=row.user_prompt or '',
            validators=row.validators or [],
            execution=execution,
            data=row.data or {},
            raw_content=None
        )

    def _parse_variables(self, vars_data: Dict) -> ContractVariables:
        """Parse variables from data."""
        required = []
        optional = []

        for var in vars_data.get('required', []):
            if isinstance(var, str):
                required.append(ContractVariable(name=var))
            elif isinstance(var, dict):
                required.append(ContractVariable(**var))

        for var in vars_data.get('optional', []):
            if isinstance(var, str):
                optional.append(ContractVariable(name=var))
            elif isinstance(var, dict):
                optional.append(ContractVariable(**var))

        return ContractVariables(required=required, optional=optional)

    def _parse_governance(self, gov_data: Dict) -> ContractGovernance:
        """Parse governance from data."""
        if not gov_data:
            return ContractGovernance()

        return ContractGovernance(
            status=gov_data.get('status', 'active'),
            owner=gov_data.get('owner'),
            effective_date=gov_data.get('effective_date'),
            expires_at=gov_data.get('expires_at'),
            change_log=gov_data.get('change_log', [])
        )

    def _parse_execution(self, exec_data: Dict) -> ExecutionConfig:
        """Parse execution config from data."""
        if not exec_data:
            return ExecutionConfig()

        return ExecutionConfig(
            estimated_tokens=exec_data.get('estimated_tokens'),
            max_tokens=exec_data.get('max_tokens', 4000),
            recommended_model=exec_data.get('recommended_model'),
            temperature=exec_data.get('temperature', 0.7),
            cache_enabled=exec_data.get('cache_enabled', True),
            cache_ttl=exec_data.get('cache_ttl', 86400)
        )

    def _load_component(self, component_name: str) -> str:
        """
        Load a component's content from the database.

        Components are stored as contracts with domain='component'.
        """
        if self.enable_cache and component_name in self._component_cache:
            return self._component_cache[component_name]

        try:
            from app.models.contract import Contract as ContractModel
            db = self._get_db()

            # Components are stored as "components/{name}"
            full_name = f"components/{component_name}"
            row = db.query(ContractModel).filter_by(name=full_name, is_active=True).first()

            if not row:
                logger.warning(f"Component not found in DB: {component_name}")
                return ""

            # Components use system_prompt as their content
            component_content = row.system_prompt or ''
            if not component_content:
                # Try data.content field
                data = row.data or {}
                component_content = data.get('content', '')

            if self.enable_cache:
                self._component_cache[component_name] = component_content

            return component_content

        except Exception as e:
            logger.error(f"Error loading component {component_name}: {e}")
            return ""

    def load(self, contract_name: str) -> Contract:
        """
        Load a contract by name from the database.

        Args:
            contract_name: Contract identifier (e.g., "business/project_creation")

        Returns:
            Contract object (Pydantic)

        Raises:
            ContractNotFoundError: If contract not found in database
        """
        if self.enable_cache and contract_name in self._contract_cache:
            return self._contract_cache[contract_name]

        try:
            from app.models.contract import Contract as ContractModel
            db = self._get_db()

            row = db.query(ContractModel).filter_by(name=contract_name, is_active=True).first()

            if not row:
                raise ContractNotFoundError(contract_name)

            contract = self._db_row_to_contract(row)

            if self.enable_cache:
                self._contract_cache[contract_name] = contract

            logger.debug(f"Loaded contract from DB: {contract_name}")
            return contract

        except ContractNotFoundError:
            raise
        except Exception as e:
            logger.error(f"Error loading contract {contract_name}: {e}")
            raise ContractNotFoundError(contract_name)

    def load_data(self, contract_name: str) -> Dict[str, Any]:
        """
        Load structured data from a data-only contract.
        Returns the 'data' section of the contract.

        Args:
            contract_name: Contract identifier (e.g., "business/workflow_states")

        Returns:
            Dict with the contract's data payload
        """
        contract = self.load(contract_name)
        return contract.data

    def _render_template(self, template_str: str, variables: Dict[str, Any]) -> str:
        """Render a Jinja2 template string with variables."""
        if not template_str:
            return ""

        try:
            template = self.jinja_env.from_string(template_str)
            return template.render(**variables)
        except TemplateSyntaxError as e:
            logger.error(f"Jinja2 syntax error: {e}")
            raise ContractRenderError("unknown", f"Template syntax error: {e}")
        except Exception as e:
            logger.error(f"Error rendering template: {e}")
            return template_str

    def render(
        self,
        contract_name: str,
        variables: Dict[str, Any] = None,
        strict: bool = False
    ) -> Tuple[str, str]:
        """
        Load and render a contract.

        Args:
            contract_name: Contract identifier (e.g., "generation/epic_from_interview")
            variables: Dictionary of variables to substitute
            strict: If True, raise error on missing required variables

        Returns:
            Tuple of (system_prompt, user_prompt)
        """
        variables = variables or {}

        contract = self.load(contract_name)

        if strict:
            missing = contract.validate_variables(variables)
            if missing:
                raise ContractValidationError(contract_name, [f"Missing variable: {v}" for v in missing])

        # Load components and add to variables
        components = {}
        for component_name in contract.metadata.components:
            components[component_name] = self._load_component(component_name)

        render_vars = {
            **variables,
            'components': components,
            'semantic_map': contract.semantic_map
        }

        system_prompt = self._render_template(contract.system_prompt, render_vars)
        user_prompt = self._render_template(contract.user_prompt, render_vars)

        return system_prompt, user_prompt

    def render_full(
        self,
        contract_name: str,
        variables: Dict[str, Any] = None,
        strict: bool = False
    ) -> RenderedContract:
        """
        Load and render a contract, returning full result object.
        """
        variables = variables or {}
        contract = self.load(contract_name)
        system_prompt, user_prompt = self.render(contract_name, variables, strict)

        return RenderedContract(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            contract_name=contract.metadata.name,
            contract_version=contract.metadata.version,
            domain=contract.metadata.domain,
            usage_type=contract.metadata.usage_type,
            variables_used=variables,
            components_loaded=contract.metadata.components,
            semantic_map=contract.semantic_map
        )

    def clear_cache(self):
        """Clear all cached contracts and components."""
        self._contract_cache.clear()
        self._component_cache.clear()
        logger.info("Contract cache cleared")

    def list_contracts(self, domain: str = None, category: str = None) -> List[str]:
        """
        List available contracts from the database.

        Args:
            domain: Optional domain filter
            category: Optional category filter

        Returns:
            List of contract names
        """
        try:
            from app.models.contract import Contract as ContractModel
            db = self._get_db()

            query = db.query(ContractModel.name).filter_by(is_active=True)

            if domain:
                query = query.filter_by(domain=domain)
            if category:
                query = query.filter(ContractModel.name.like(f"{category}/%"))

            rows = query.order_by(ContractModel.name).all()
            return [row[0] for row in rows]

        except Exception as e:
            logger.error(f"Error listing contracts: {e}")
            return []

    def list_by_usage_type(self, usage_type: str) -> List[str]:
        """
        List contracts filtered by usage_type.

        Args:
            usage_type: The AI Flow usage type (e.g., "content_generation")

        Returns:
            List of contract names
        """
        try:
            from app.models.contract import Contract as ContractModel
            db = self._get_db()

            rows = (
                db.query(ContractModel.name)
                .filter_by(usage_type=usage_type, is_active=True)
                .order_by(ContractModel.name)
                .all()
            )
            return [row[0] for row in rows]

        except Exception as e:
            logger.error(f"Error listing contracts by usage_type: {e}")
            return []

    def exists(self, contract_name: str) -> bool:
        """Check if a contract exists in the database."""
        try:
            from app.models.contract import Contract as ContractModel
            db = self._get_db()
            return db.query(ContractModel).filter_by(name=contract_name, is_active=True).first() is not None
        except Exception:
            return False

    def get_domains(self) -> List[str]:
        """Get list of available domains."""
        return ["business", "interview", "generation", "memory", "component"]

    def get_categories(self) -> List[str]:
        """Get list of available categories from DB."""
        try:
            from app.models.contract import Contract as ContractModel
            db = self._get_db()

            rows = (
                db.query(ContractModel.category)
                .filter_by(is_active=True)
                .distinct()
                .all()
            )
            return sorted(set(row[0] for row in rows if row[0]))

        except Exception as e:
            logger.error(f"Error getting categories: {e}")
            return []

    def __del__(self):
        """Clean up DB session if we own it."""
        if self._owns_db and self._db is not None:
            try:
                self._db.close()
            except Exception:
                pass


# Global singleton instance
_loader_instance: Optional[ContractLoader] = None


def get_contract_loader() -> ContractLoader:
    """Get the global ContractLoader instance."""
    global _loader_instance
    if _loader_instance is None:
        _loader_instance = ContractLoader()
    return _loader_instance
