"""
Pydantic models for ORBIT Contract Management System

PROMPT #164 - Contracts Architecture: Unification and Governance

Defines the contract schema with:
- Metadata (name, version, domain, category)
- Governance (status, owner, change_log)
- Semantic Map (N1, P1, C1, etc. from PROMPT #83)
- Rules (validations, constraints)
- Variables (required, optional with types)
- Prompts (system_prompt, user_prompt with Jinja2)
- Validators (JSON schema, regex)
- Execution config (tokens, model, temperature)
"""

from typing import List, Optional, Dict, Any, Literal
from datetime import date
from pydantic import BaseModel, Field


# Domain types
DomainType = Literal["business", "interview", "interviews", "generation", "memory", "component", "components", "commits", "execution", "validation", "pipeline"]
StatusType = Literal["draft", "active", "deprecated"]
ValidatorType = Literal["json_schema", "regex", "semantic_check", "length", "required_fields"]


class ChangeLogEntry(BaseModel):
    """Entry in the contract change log."""
    version: int
    date: str
    author: Optional[str] = None
    changes: str


class ContractGovernance(BaseModel):
    """Governance metadata for a contract."""
    status: StatusType = Field(default="active", description="Contract status")
    owner: Optional[str] = Field(default=None, description="Team or individual owner")
    effective_date: Optional[str] = Field(default=None, description="When contract became effective")
    expires_at: Optional[str] = Field(default=None, description="Optional expiration date")
    change_log: List[ChangeLogEntry] = Field(default_factory=list, description="Version history")


class ContractVariable(BaseModel):
    """Definition of a contract variable."""
    name: str
    type: str = Field(default="string", description="Variable type: string, number, boolean, object, array")
    description: Optional[str] = None
    default: Optional[Any] = None


class ContractVariables(BaseModel):
    """Variables schema for a contract."""
    required: List[ContractVariable] = Field(default_factory=list, description="Required variables")
    optional: List[ContractVariable] = Field(default_factory=list, description="Optional variables")

    def get_required_names(self) -> List[str]:
        """Get list of required variable names."""
        return [v.name for v in self.required]

    def get_optional_names(self) -> List[str]:
        """Get list of optional variable names."""
        return [v.name for v in self.optional]


class ValidationRule(BaseModel):
    """A business validation rule."""
    id: str
    description: str
    expression: Optional[str] = None
    severity: Literal["error", "warning", "info"] = "error"


class Constraint(BaseModel):
    """A business constraint."""
    id: str
    description: str
    applies_to: List[str] = Field(default_factory=list)
    condition: Optional[str] = None


class AccessRule(BaseModel):
    """An access control rule."""
    id: str
    description: str
    roles: List[str] = Field(default_factory=list)
    action: Literal["read", "write", "delete", "execute"] = "read"


class ContractRules(BaseModel):
    """Business rules defined in the contract."""
    validations: List[ValidationRule] = Field(default_factory=list)
    constraints: List[Constraint] = Field(default_factory=list)
    access_control: List[AccessRule] = Field(default_factory=list)


class Validator(BaseModel):
    """Validator definition for contract output."""
    type: ValidatorType
    schema: Optional[Dict[str, Any]] = None
    field: Optional[str] = None
    pattern: Optional[str] = None
    message: Optional[str] = None
    rule: Optional[str] = None
    min_length: Optional[int] = None
    max_length: Optional[int] = None
    required: Optional[List[str]] = None


class ExecutionConfig(BaseModel):
    """Execution configuration for the contract."""
    estimated_tokens: Optional[int] = None
    max_tokens: int = 4000
    recommended_model: Optional[str] = None
    temperature: float = 0.7
    cache_enabled: bool = True
    cache_ttl: int = 86400  # 24 hours


class ContractMetadata(BaseModel):
    """Metadata for a contract."""
    name: str = Field(..., description="Unique contract identifier")
    version: int = Field(default=1, description="Version number")
    domain: DomainType = Field(default="generation", description="Contract domain")
    category: str = Field(..., description="Category folder")
    description: str = Field(default="", description="Human-readable description")
    usage_type: str = Field(default="general", description="AI usage type for orchestrator")
    tags: List[str] = Field(default_factory=list, description="Tags for filtering")
    components: List[str] = Field(default_factory=list, description="Component references")


class Contract(BaseModel):
    """Complete contract definition."""
    # Metadata
    metadata: ContractMetadata

    # Governance
    governance: ContractGovernance = Field(default_factory=ContractGovernance)

    # Semantic Map (PROMPT #83 methodology)
    semantic_map: Dict[str, str] = Field(default_factory=dict, description="Semantic identifiers map")

    # Business Rules
    rules: ContractRules = Field(default_factory=ContractRules)

    # Variables
    variables: ContractVariables = Field(default_factory=ContractVariables)

    # Prompts
    system_prompt: str = Field(default="", description="System prompt content")
    user_prompt: str = Field(default="", description="User prompt content")

    # Validators
    validators: List[Validator] = Field(default_factory=list)

    # Execution config
    execution: ExecutionConfig = Field(default_factory=ExecutionConfig)

    # Structured data (for data-only contracts like business rules, thresholds, configs)
    # PROMPT #256 - Arbitrary structured data that isn't prompts
    data: Dict[str, Any] = Field(default_factory=dict, description="Structured data payload")

    # Raw content
    raw_content: Optional[str] = Field(default=None, description="Original YAML content")

    @property
    def name(self) -> str:
        return self.metadata.name

    @property
    def domain(self) -> str:
        return self.metadata.domain

    @property
    def category(self) -> str:
        return self.metadata.category

    @property
    def usage_type(self) -> str:
        return self.metadata.usage_type

    @property
    def required_variables(self) -> List[str]:
        return self.variables.get_required_names()

    @property
    def optional_variables(self) -> List[str]:
        return self.variables.get_optional_names()

    def validate_variables(self, variables: Dict[str, Any]) -> List[str]:
        """
        Validate that all required variables are provided.

        Returns:
            List of missing required variables (empty if all provided)
        """
        missing = []
        for var_name in self.required_variables:
            if var_name not in variables or variables[var_name] is None:
                missing.append(var_name)
        return missing


class RenderedContract(BaseModel):
    """Result of rendering a contract."""
    system_prompt: str
    user_prompt: str
    contract_name: str
    contract_version: int
    domain: str
    usage_type: str
    variables_used: Dict[str, Any] = Field(default_factory=dict)
    components_loaded: List[str] = Field(default_factory=list)
    semantic_map: Dict[str, str] = Field(default_factory=dict)


# Exceptions

class ContractError(Exception):
    """Base exception for contract errors."""
    pass


class ContractNotFoundError(ContractError):
    """Raised when a contract file is not found."""
    def __init__(self, contract_name: str):
        self.contract_name = contract_name
        super().__init__(f"Contrato não encontrado: '{contract_name}'")


class ContractRenderError(ContractError):
    """Raised when a contract cannot be rendered."""
    def __init__(self, contract_name: str, reason: str, missing_vars: List[str] = None):
        self.contract_name = contract_name
        self.reason = reason
        self.missing_vars = missing_vars or []
        super().__init__(f"Falha ao renderizar contrato '{contract_name}': {reason}")


class ContractValidationError(ContractError):
    """Raised when contract validation fails."""
    def __init__(self, contract_name: str, errors: List[str]):
        self.contract_name = contract_name
        self.errors = errors
        super().__init__(f"Validação de contrato falhou para '{contract_name}': {', '.join(errors)}")


class ComponentNotFoundError(ContractError):
    """Raised when a component file is not found."""
    def __init__(self, component_name: str, contract_name: str):
        self.component_name = component_name
        self.contract_name = contract_name
        super().__init__(f"Componente '{component_name}' não encontrado (referenciado por '{contract_name}')")
