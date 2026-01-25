"""
Pydantic models for ORBIT Prompt Management System

PROMPT #103 - Externalize Hardcoded Prompts to YAML Files
"""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class PromptVariables(BaseModel):
    """Schema for prompt variables"""
    required: List[str] = Field(default_factory=list, description="Required variables")
    optional: List[str] = Field(default_factory=list, description="Optional variables")


class PromptMetadata(BaseModel):
    """Metadata for a prompt template"""
    name: str = Field(..., description="Unique prompt identifier")
    version: int = Field(default=1, description="Version number")
    category: str = Field(..., description="Category (backlog, context, interviews, etc.)")
    description: str = Field(default="", description="Human-readable description")
    usage_type: str = Field(default="general", description="AI usage type for orchestrator")
    estimated_tokens: Optional[int] = Field(default=None, description="Estimated token count")
    tags: List[str] = Field(default_factory=list, description="Tags for filtering")
    variables: PromptVariables = Field(default_factory=PromptVariables)
    components: List[str] = Field(default_factory=list, description="Component references")


class PromptTemplate(BaseModel):
    """Complete prompt template with metadata and content"""
    metadata: PromptMetadata
    system_prompt: str = Field(default="", description="System prompt content")
    user_prompt: str = Field(default="", description="User prompt content")
    raw_content: Optional[str] = Field(default=None, description="Original YAML content")

    @property
    def name(self) -> str:
        return self.metadata.name

    @property
    def usage_type(self) -> str:
        return self.metadata.usage_type

    @property
    def required_variables(self) -> List[str]:
        return self.metadata.variables.required

    @property
    def optional_variables(self) -> List[str]:
        return self.metadata.variables.optional

    def validate_variables(self, variables: Dict[str, Any]) -> List[str]:
        """
        Validate that all required variables are provided.

        Returns:
            List of missing required variables (empty if all provided)
        """
        missing = []
        for var in self.required_variables:
            if var not in variables or variables[var] is None:
                missing.append(var)
        return missing


class RenderedPrompt(BaseModel):
    """Result of rendering a prompt template"""
    system_prompt: str
    user_prompt: str
    template_name: str
    template_version: int
    usage_type: str
    variables_used: Dict[str, Any] = Field(default_factory=dict)
    components_loaded: List[str] = Field(default_factory=list)


class PromptLoadError(Exception):
    """Raised when a prompt cannot be loaded"""
    def __init__(self, prompt_name: str, reason: str):
        self.prompt_name = prompt_name
        self.reason = reason
        super().__init__(f"Failed to load prompt '{prompt_name}': {reason}")


class PromptRenderError(Exception):
    """Raised when a prompt cannot be rendered"""
    def __init__(self, prompt_name: str, reason: str, missing_vars: List[str] = None):
        self.prompt_name = prompt_name
        self.reason = reason
        self.missing_vars = missing_vars or []
        super().__init__(f"Failed to render prompt '{prompt_name}': {reason}")


class PromptNotFoundError(PromptLoadError):
    """Raised when a prompt file is not found"""
    def __init__(self, prompt_name: str):
        super().__init__(prompt_name, "Prompt file not found")


class ComponentNotFoundError(PromptLoadError):
    """Raised when a component file is not found"""
    def __init__(self, component_name: str, prompt_name: str):
        self.component_name = component_name
        super().__init__(prompt_name, f"Component '{component_name}' not found")


class VariableValidationError(PromptRenderError):
    """Raised when required variables are missing"""
    def __init__(self, prompt_name: str, missing_vars: List[str]):
        super().__init__(
            prompt_name,
            f"Missing required variables: {', '.join(missing_vars)}",
            missing_vars
        )
