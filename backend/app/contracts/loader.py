"""
ContractLoader - Loads and renders YAML contract templates

PROMPT #164 - Contracts Architecture: Unification and Governance

Features:
- YAML file parsing with Jinja2 templating
- Component inclusion and reuse
- Variable validation
- Caching for performance
- Semantic map support
- Governance tracking
- Backward compatibility with PromptLoader

Based on PromptLoader (PROMPT #103) but extended for contracts.
"""

import os
import logging
from pathlib import Path
from typing import Dict, Any, Optional, Tuple, List
from functools import lru_cache
from datetime import date

import yaml
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
    ComponentNotFoundError,
)

logger = logging.getLogger(__name__)

# Base directory for contracts
CONTRACTS_DIR = Path(__file__).parent


class ContractLoader:
    """
    Loads and renders YAML contract templates with Jinja2 support.

    Usage:
        loader = ContractLoader()

        # Load contract metadata
        contract = loader.load("business/project_creation")

        # Render with variables
        system_prompt, user_prompt = loader.render(
            "generation/epic_from_interview",
            {"conversation_text": "...", "project_name": "My Project"}
        )

        # Or get full rendered result
        result = loader.render_full(
            "generation/epic_from_interview",
            {"conversation_text": "...", "project_name": "My Project"}
        )
    """

    def __init__(self, contracts_dir: Path = None, enable_cache: bool = True):
        """
        Initialize ContractLoader.

        Args:
            contracts_dir: Directory containing contract YAML files. Defaults to app/contracts/
            enable_cache: Whether to cache loaded contracts (default True)
        """
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

        logger.info(f"ContractLoader initialized with contracts_dir: {self.contracts_dir}")

    def _get_contract_path(self, contract_name: str) -> Path:
        """Get full path for a contract file."""
        # contract_name format: "category/name" -> "category/name.yaml"
        if not contract_name.endswith('.yaml'):
            contract_name = f"{contract_name}.yaml"
        return self.contracts_dir / contract_name

    def _get_component_path(self, component_name: str) -> Path:
        """Get full path for a component file."""
        if not component_name.endswith('.yaml'):
            component_name = f"{component_name}.yaml"
        return self.contracts_dir / "components" / component_name

    def _parse_yaml(self, content: str) -> Dict[str, Any]:
        """Parse YAML content."""
        try:
            return yaml.safe_load(content) or {}
        except yaml.YAMLError as e:
            raise ValueError(f"YAML invalido: {e}")

    def _load_component(self, component_name: str) -> str:
        """
        Load a component's content.

        Args:
            component_name: Name of the component (without .yaml extension)

        Returns:
            Component content as string
        """
        # Check cache
        if self.enable_cache and component_name in self._component_cache:
            return self._component_cache[component_name]

        component_path = self._get_component_path(component_name)

        if not component_path.exists():
            logger.warning(f"Component not found: {component_name}")
            return ""  # Return empty string instead of failing

        try:
            content = component_path.read_text(encoding='utf-8')
            data = self._parse_yaml(content)

            # Components can have 'content' field or 'system_prompt'
            component_content = data.get('content', '')
            if not component_content and 'system_prompt' in data:
                component_content = data.get('system_prompt', '')

            # Cache if enabled
            if self.enable_cache:
                self._component_cache[component_name] = component_content

            return component_content

        except Exception as e:
            logger.error(f"Error loading component {component_name}: {e}")
            return ""

    def _parse_variables(self, vars_data: Dict) -> ContractVariables:
        """Parse variables from YAML data."""
        required = []
        optional = []

        # Handle both old format (list of strings) and new format (list of dicts)
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
        """Parse governance from YAML data."""
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
        """Parse execution config from YAML data."""
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

    def load(self, contract_name: str) -> Contract:
        """
        Load a contract by name.

        Args:
            contract_name: Contract identifier (e.g., "business/project_creation")

        Returns:
            Contract object

        Raises:
            ContractNotFoundError: If contract file doesn't exist
        """
        # Check cache
        if self.enable_cache and contract_name in self._contract_cache:
            return self._contract_cache[contract_name]

        contract_path = self._get_contract_path(contract_name)

        if not contract_path.exists():
            raise ContractNotFoundError(contract_name)

        try:
            content = contract_path.read_text(encoding='utf-8')
            data = self._parse_yaml(content)

            # Determine domain from path or data
            parts = contract_name.split('/')
            inferred_domain = parts[0] if len(parts) > 1 else 'generation'

            # Map folder names to domains
            domain_map = {
                'business': 'business',
                'generation': 'generation',
                'interviews': 'interview',
                'memory': 'memory',
                'commits': 'generation',
                'components': 'component',
                'discovery': 'memory',
                'backlog': 'generation',
                'context': 'generation',
                'execution': 'business',
                'validation': 'business',
            }
            domain = data.get('domain', domain_map.get(inferred_domain, 'generation'))

            # Parse metadata
            metadata = ContractMetadata(
                name=data.get('name', contract_name.split('/')[-1]),
                version=data.get('version', 1),
                domain=domain,
                category=data.get('category', inferred_domain),
                description=data.get('description', ''),
                usage_type=data.get('usage_type', 'general'),
                tags=data.get('tags', []),
                components=data.get('components', [])
            )

            # Parse other sections
            variables = self._parse_variables(data.get('variables', {}))
            governance = self._parse_governance(data.get('governance', {}))
            execution = self._parse_execution(data.get('execution', {}))

            # Handle execution config at root level (backward compatibility)
            if 'estimated_tokens' in data:
                execution.estimated_tokens = data['estimated_tokens']

            # Create contract
            contract = Contract(
                metadata=metadata,
                governance=governance,
                semantic_map=data.get('semantic_map', {}),
                rules=ContractRules(
                    validations=data.get('rules', {}).get('validations', []),
                    constraints=data.get('rules', {}).get('constraints', []),
                    access_control=data.get('rules', {}).get('access_control', [])
                ),
                variables=variables,
                system_prompt=data.get('system_prompt', ''),
                user_prompt=data.get('user_prompt', ''),
                validators=data.get('validators', []),
                execution=execution,
                data=data.get('data', {}),
                raw_content=content
            )

            # Cache if enabled
            if self.enable_cache:
                self._contract_cache[contract_name] = contract

            logger.debug(f"Loaded contract: {contract_name}")
            return contract

        except ContractNotFoundError:
            raise
        except Exception as e:
            logger.error(f"Error loading contract {contract_name}: {e}")
            raise ContractNotFoundError(contract_name)

    def load_data(self, contract_name: str) -> Dict[str, Any]:
        """
        PROMPT #256 - Load structured data from a data-only contract.
        Returns the 'data' section of the contract YAML.
        Useful for business rules, thresholds, configs that aren't AI prompts.

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
            # Return original template if rendering fails
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

        Raises:
            ContractNotFoundError: If contract file doesn't exist
            ContractValidationError: If strict=True and required variables are missing
        """
        variables = variables or {}

        # Load contract
        contract = self.load(contract_name)

        # Validate required variables if strict mode
        if strict:
            missing = contract.validate_variables(variables)
            if missing:
                raise ContractValidationError(contract_name, [f"Missing variable: {v}" for v in missing])

        # Load components and add to variables
        components = {}
        for component_name in contract.metadata.components:
            components[component_name] = self._load_component(component_name)

        # Add components and semantic_map to render context
        render_vars = {
            **variables,
            'components': components,
            'semantic_map': contract.semantic_map
        }

        # Render system and user prompts
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

        Args:
            contract_name: Contract identifier
            variables: Dictionary of variables to substitute
            strict: If True, raise error on missing required variables

        Returns:
            RenderedContract object with all metadata
        """
        variables = variables or {}

        # Load contract
        contract = self.load(contract_name)

        # Render
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
        List available contracts.

        Args:
            domain: Optional domain filter (business, interview, generation, memory, component)
            category: Optional category filter

        Returns:
            List of contract names
        """
        contracts = []

        for yaml_file in self.contracts_dir.rglob("*.yaml"):
            # Skip schema files
            if "schema" in yaml_file.parts:
                continue

            # Get relative path without extension
            rel_path = yaml_file.relative_to(self.contracts_dir)
            contract_name = str(rel_path.with_suffix(''))

            # Skip if it's not in a subdirectory (like __init__.py level files)
            if '/' not in contract_name and '\\' not in contract_name:
                continue

            # Filter by category if specified
            if category:
                if not contract_name.startswith(f"{category}/"):
                    continue

            # Filter by domain if specified
            if domain:
                try:
                    contract = self.load(contract_name)
                    if contract.domain != domain:
                        continue
                except Exception:
                    continue

            contracts.append(contract_name)

        return sorted(contracts)

    def exists(self, contract_name: str) -> bool:
        """Check if a contract exists."""
        return self._get_contract_path(contract_name).exists()

    def get_domains(self) -> List[str]:
        """Get list of available domains."""
        return ["business", "interview", "generation", "memory", "component"]

    def get_categories(self) -> List[str]:
        """Get list of available categories (top-level folders)."""
        categories = set()
        for item in self.contracts_dir.iterdir():
            if item.is_dir() and not item.name.startswith('_') and not item.name.startswith('.'):
                if item.name not in ['schema', '__pycache__']:
                    categories.add(item.name)
        return sorted(categories)


# Global singleton instance
_loader_instance: Optional[ContractLoader] = None


def get_contract_loader() -> ContractLoader:
    """Get the global ContractLoader instance."""
    global _loader_instance
    if _loader_instance is None:
        _loader_instance = ContractLoader()
    return _loader_instance
