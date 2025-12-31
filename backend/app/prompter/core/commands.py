"""
Command Library for Structured Prompt Templates

Provides a standardized vocabulary of imperative commands for building
structured prompts in the ACTION → STEP → EXPECTED_OUTPUT format.

This enables:
- Clearer, more predictable AI behavior
- Easier debugging (structured steps)
- Reusable command components
- Better validation and testing
"""

from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any, Union
from enum import Enum


class CommandVerb(Enum):
    """
    Standardized imperative verbs for prompt commands.

    Categories:
    - Analysis: Extract, identify, analyze information
    - Transformation: Generate, create, transform content
    - Validation: Ensure, verify, validate correctness
    - Reference: Reference, follow, apply patterns
    - Output: Return, output, format results
    """

    # === Analysis Commands ===
    EXTRACT = "EXTRACT"  # Extract information from source
    IDENTIFY = "IDENTIFY"  # Identify patterns/elements
    ANALYZE = "ANALYZE"  # Analyze structure/content
    DETECT = "DETECT"  # Detect conditions/problems
    CLASSIFY = "CLASSIFY"  # Classify into categories
    PARSE = "PARSE"  # Parse structured data
    INSPECT = "INSPECT"  # Inspect for specific attributes

    # === Transformation Commands ===
    GENERATE = "GENERATE"  # Generate new content
    CREATE = "CREATE"  # Create new structure
    BUILD = "BUILD"  # Build complex artifact
    TRANSFORM = "TRANSFORM"  # Transform format/structure
    CONVERT = "CONVERT"  # Convert type/format
    SYNTHESIZE = "SYNTHESIZE"  # Synthesize from multiple sources
    COMPOSE = "COMPOSE"  # Compose from components
    FORMULATE = "FORMULATE"  # Formulate solution/response

    # === Validation Commands ===
    ENSURE = "ENSURE"  # Ensure condition is met
    VERIFY = "VERIFY"  # Verify criterion
    VALIDATE = "VALIDATE"  # Validate against schema/rules
    CHECK = "CHECK"  # Check presence/absence
    CONFIRM = "CONFIRM"  # Confirm state/condition
    ASSESS = "ASSESS"  # Assess quality/compliance

    # === Reference Commands ===
    REFERENCE = "REFERENCE"  # Reference external source
    FOLLOW = "FOLLOW"  # Follow pattern/guideline
    APPLY = "APPLY"  # Apply rule/pattern
    USE = "USE"  # Use tool/resource
    CONSULT = "CONSULT"  # Consult documentation/source
    INCORPORATE = "INCORPORATE"  # Incorporate from source

    # === Execution Commands ===
    EXECUTE = "EXECUTE"  # Execute operation
    PERFORM = "PERFORM"  # Perform action
    RUN = "RUN"  # Run process
    COMPUTE = "COMPUTE"  # Compute value
    CALCULATE = "CALCULATE"  # Calculate result

    # === Organization Commands ===
    ORGANIZE = "ORGANIZE"  # Organize structure
    STRUCTURE = "STRUCTURE"  # Structure content
    ARRANGE = "ARRANGE"  # Arrange elements
    GROUP = "GROUP"  # Group related items
    CATEGORIZE = "CATEGORIZE"  # Categorize into groups
    PRIORITIZE = "PRIORITIZE"  # Prioritize by importance

    # === Output Commands ===
    RETURN = "RETURN"  # Return result
    OUTPUT = "OUTPUT"  # Produce output
    FORMAT = "FORMAT"  # Format output
    PRESENT = "PRESENT"  # Present information
    DISPLAY = "DISPLAY"  # Display result

    # === Assignment Commands ===
    ASSIGN = "ASSIGN"  # Assign value/property
    DEFINE = "DEFINE"  # Define attribute
    SET = "SET"  # Set value
    ESTABLISH = "ESTABLISH"  # Establish relationship

    # === Filtering Commands ===
    FILTER = "FILTER"  # Filter by criteria
    SELECT = "SELECT"  # Select subset
    EXCLUDE = "EXCLUDE"  # Exclude items
    INCLUDE = "INCLUDE"  # Include items


@dataclass
class Command:
    """
    Represents a single imperative command in a prompt.

    Examples:
        Command(CommandVerb.EXTRACT, "project_requirements", source="conversation")
        → "EXTRACT project_requirements from conversation."

        Command(CommandVerb.ENSURE, "tasks are actionable and atomic")
        → "ENSURE tasks are actionable and atomic."

        Command(CommandVerb.GENERATE, "6-15 micro-tasks", constraints=["atomic", "actionable"])
        → "GENERATE 6-15 micro-tasks.
           Constraints: atomic, actionable"
    """

    verb: CommandVerb
    target: str
    source: Optional[str] = None
    constraints: Optional[List[str]] = None
    context: Optional[Dict[str, Any]] = None

    def render(self, indent: int = 0) -> str:
        """
        Render command to text format.

        Args:
            indent: Number of spaces to indent

        Returns:
            Formatted command string
        """
        prefix = " " * indent
        text = f"{prefix}{self.verb.value} {self.target}"

        if self.source:
            text += f" from {self.source}"

        text += "."

        # Add constraints if present
        if self.constraints:
            text += f"\n{prefix}Constraints: {', '.join(self.constraints)}"

        return text

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization"""
        return {
            "verb": self.verb.value,
            "target": self.target,
            "source": self.source,
            "constraints": self.constraints,
            "context": self.context
        }


@dataclass
class Conditional:
    """
    Represents conditional logic in a prompt (IF/THEN/ELSE).

    Examples:
        Conditional(
            condition="specs_context is provided",
            then_commands=[Command(CommandVerb.REFERENCE, "framework_patterns", source="specs")]
        )
        → "IF specs_context is provided THEN:
             - REFERENCE framework_patterns from specs."
    """

    condition: str
    then_commands: List[Command]
    else_commands: Optional[List[Command]] = None

    def render(self, indent: int = 0) -> str:
        """
        Render conditional to text format.

        Args:
            indent: Number of spaces to indent

        Returns:
            Formatted conditional string
        """
        prefix = " " * indent
        text = f"{prefix}IF {self.condition} THEN:\n"

        for cmd in self.then_commands:
            text += f"{prefix}  - {cmd.render()}\n"

        if self.else_commands:
            text += f"{prefix}ELSE:\n"
            for cmd in self.else_commands:
                text += f"{prefix}  - {cmd.render()}\n"

        return text.rstrip()

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization"""
        return {
            "condition": self.condition,
            "then": [cmd.to_dict() for cmd in self.then_commands],
            "else": [cmd.to_dict() for cmd in self.else_commands] if self.else_commands else None
        }


@dataclass
class Step:
    """
    Represents a single step in a multi-step prompt.

    Examples:
        Step(
            number=1,
            name="CONTEXT_ANALYSIS",
            commands=[
                Command(CommandVerb.EXTRACT, "project_requirements", source="conversation"),
                Command(CommandVerb.IDENTIFY, "key_features and functionalities")
            ]
        )
        → "STEP 1: CONTEXT_ANALYSIS
           EXTRACT project_requirements from conversation.
           IDENTIFY key_features and functionalities."
    """

    number: int
    name: str
    commands: List[Command] = field(default_factory=list)
    conditionals: Optional[List[Conditional]] = None
    description: Optional[str] = None

    def render(self, indent: int = 0) -> str:
        """
        Render step to text format.

        Args:
            indent: Number of spaces to indent

        Returns:
            Formatted step string
        """
        prefix = " " * indent
        text = f"{prefix}STEP {self.number}: {self.name}\n"

        if self.description:
            text += f"{prefix}{self.description}\n\n"

        for cmd in self.commands:
            text += f"{prefix}{cmd.render()}\n"

        if self.conditionals:
            text += "\n"
            for cond in self.conditionals:
                text += f"{cond.render(indent)}\n"

        return text.rstrip()

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization"""
        return {
            "number": self.number,
            "name": self.name,
            "description": self.description,
            "commands": [cmd.to_dict() for cmd in self.commands],
            "conditionals": [cond.to_dict() for cond in self.conditionals] if self.conditionals else None
        }


@dataclass
class Action:
    """
    Represents the main action/purpose of a prompt.

    Examples:
        Action(
            name="TASK_GENERATION",
            description="Generate actionable micro-tasks from interview conversation"
        )
        → "ACTION: TASK_GENERATION
           PURPOSE: Generate actionable micro-tasks from interview conversation"
    """

    name: str
    description: Optional[str] = None
    category: Optional[str] = None  # e.g., "analysis", "generation", "validation"

    def render(self, indent: int = 0) -> str:
        """
        Render action to text format.

        Args:
            indent: Number of spaces to indent

        Returns:
            Formatted action string
        """
        prefix = " " * indent
        text = f"{prefix}ACTION: {self.name}\n"

        if self.description:
            text += f"{prefix}PURPOSE: {self.description}\n"

        return text.rstrip()

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization"""
        return {
            "name": self.name,
            "description": self.description,
            "category": self.category
        }


@dataclass
class ExpectedOutput:
    """
    Represents the expected output specification.

    Examples:
        ExpectedOutput(
            format="json",
            constraints=["No markdown wrappers", "Clean JSON only"],
            schema={"type": "array", "items": {"type": "object"}}
        )
        → "EXPECTED_OUTPUT:
           Format: JSON
           Constraints:
             - No markdown wrappers
             - Clean JSON only
           Schema: {...}"
    """

    format: str  # json, text, markdown, code, etc.
    constraints: Optional[List[str]] = None
    schema: Optional[Dict[str, Any]] = None
    example: Optional[str] = None

    def render(self, indent: int = 0) -> str:
        """
        Render expected output to text format.

        Args:
            indent: Number of spaces to indent

        Returns:
            Formatted expected output string
        """
        prefix = " " * indent
        text = f"{prefix}EXPECTED_OUTPUT:\n"

        if self.format:
            text += f"{prefix}Format: {self.format.upper()}\n"

        if self.constraints:
            text += f"{prefix}Constraints:\n"
            for constraint in self.constraints:
                text += f"{prefix}  - {constraint}\n"

        if self.schema:
            import json
            schema_str = json.dumps(self.schema, indent=2)
            text += f"{prefix}Schema: {schema_str}\n"

        if self.example:
            text += f"{prefix}Example:\n{self.example}\n"

        return text.rstrip()

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization"""
        return {
            "format": self.format,
            "constraints": self.constraints,
            "schema": self.schema,
            "example": self.example
        }


@dataclass
class StructuredPrompt:
    """
    Complete structured prompt with ACTION → STEPS → EXPECTED_OUTPUT.

    This is the main class for building structured prompts programmatically.
    """

    action: Action
    steps: List[Step]
    expected_output: ExpectedOutput
    system_context: Optional[str] = None

    def render(self) -> str:
        """
        Render complete structured prompt.

        Returns:
            Full formatted prompt string
        """
        parts = []

        # System context (if provided)
        if self.system_context:
            parts.append(self.system_context)
            parts.append("")

        # Action
        parts.append(self.action.render())
        parts.append("")

        # Steps
        for step in self.steps:
            parts.append(step.render())
            parts.append("")

        # Expected output
        parts.append(self.expected_output.render())

        return "\n".join(parts)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization"""
        return {
            "action": self.action.to_dict(),
            "steps": [step.to_dict() for step in self.steps],
            "expected_output": self.expected_output.to_dict(),
            "system_context": self.system_context
        }


# === Helper Functions ===

def parse_command_from_dict(data: Dict[str, Any]) -> Command:
    """Parse Command from dictionary"""
    return Command(
        verb=CommandVerb(data["verb"]),
        target=data["target"],
        source=data.get("source"),
        constraints=data.get("constraints"),
        context=data.get("context")
    )


def parse_conditional_from_dict(data: Dict[str, Any]) -> Conditional:
    """Parse Conditional from dictionary"""
    # Support both "then"/"else" (from to_dict) and "then_commands"/"else_commands" (from YAML)
    then_key = "then_commands" if "then_commands" in data else "then"
    else_key = "else_commands" if "else_commands" in data else "else"

    return Conditional(
        condition=data["condition"],
        then_commands=[parse_command_from_dict(cmd) for cmd in data[then_key]],
        else_commands=[parse_command_from_dict(cmd) for cmd in data[else_key]] if data.get(else_key) else None
    )


def parse_step_from_dict(data: Dict[str, Any]) -> Step:
    """Parse Step from dictionary"""
    return Step(
        number=data["number"],
        name=data["name"],
        description=data.get("description"),
        commands=[parse_command_from_dict(cmd) for cmd in data["commands"]],
        conditionals=[parse_conditional_from_dict(cond) for cond in data["conditionals"]]
        if data.get("conditionals") else None
    )


def parse_action_from_dict(data: Dict[str, Any]) -> Action:
    """Parse Action from dictionary"""
    return Action(
        name=data["name"],
        description=data.get("description"),
        category=data.get("category")
    )


def parse_expected_output_from_dict(data: Dict[str, Any]) -> ExpectedOutput:
    """Parse ExpectedOutput from dictionary"""
    return ExpectedOutput(
        format=data["format"],
        constraints=data.get("constraints"),
        schema=data.get("schema"),
        example=data.get("example")
    )


def parse_structured_prompt_from_dict(data: Dict[str, Any]) -> StructuredPrompt:
    """Parse complete StructuredPrompt from dictionary"""
    return StructuredPrompt(
        action=parse_action_from_dict(data["action"]),
        steps=[parse_step_from_dict(step) for step in data["steps"]],
        expected_output=parse_expected_output_from_dict(data["expected_output"]),
        system_context=data.get("system_context")
    )
