"""
Validation Pipeline for Response Quality Control

Extensible validation system with:
- Base validator interface
- Built-in validators (JSON, length, format, content)
- Composable validation pipeline
- Pre-configured pipelines for common use cases
"""

import json
import re
from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional
from dataclasses import dataclass


@dataclass
class ValidationResult:
    """Result of a validation check"""

    passed: bool
    score: float  # 0.0 to 1.0
    errors: List[str]
    warnings: List[str]
    metadata: Dict[str, Any]

    @classmethod
    def success(cls, score: float = 1.0, metadata: Dict[str, Any] = None):
        """Create successful validation result"""
        return cls(
            passed=True,
            score=score,
            errors=[],
            warnings=[],
            metadata=metadata or {},
        )

    @classmethod
    def failure(cls, errors: List[str], score: float = 0.0, metadata: Dict[str, Any] = None):
        """Create failed validation result"""
        return cls(
            passed=False,
            score=score,
            errors=errors,
            warnings=[],
            metadata=metadata or {},
        )

    def add_warning(self, warning: str):
        """Add a warning (doesn't fail validation)"""
        self.warnings.append(warning)

    def merge(self, other: "ValidationResult"):
        """Merge another validation result into this one"""
        self.passed = self.passed and other.passed
        self.score = min(self.score, other.score)
        self.errors.extend(other.errors)
        self.warnings.extend(other.warnings)
        self.metadata.update(other.metadata)


class BaseValidator(ABC):
    """Base class for all validators"""

    def __init__(self, weight: float = 1.0):
        """
        Initialize validator

        Args:
            weight: Weight for this validator in pipeline (0.0 to 1.0)
        """
        self.weight = weight

    @abstractmethod
    def validate(self, response: str, context: Dict[str, Any]) -> ValidationResult:
        """
        Validate response

        Args:
            response: AI response to validate
            context: Additional context (usage_type, expected_format, etc.)

        Returns:
            ValidationResult
        """
        pass


class EmptyResponseValidator(BaseValidator):
    """Validates that response is not empty"""

    def validate(self, response: str, context: Dict[str, Any]) -> ValidationResult:
        if not response or not response.strip():
            return ValidationResult.failure(
                errors=["Response is empty"],
                metadata={"validator": "empty_response"},
            )

        return ValidationResult.success(metadata={"validator": "empty_response"})


class LengthValidator(BaseValidator):
    """Validates response length is within acceptable range"""

    def __init__(
        self,
        min_length: int = 50,
        max_length: Optional[int] = None,
        weight: float = 1.0,
    ):
        """
        Initialize length validator

        Args:
            min_length: Minimum acceptable length in characters
            max_length: Maximum acceptable length in characters (None = no limit)
            weight: Validator weight
        """
        super().__init__(weight)
        self.min_length = min_length
        self.max_length = max_length

    def validate(self, response: str, context: Dict[str, Any]) -> ValidationResult:
        length = len(response)
        errors = []
        score = 1.0

        # Check minimum
        if length < self.min_length:
            errors.append(f"Response too short ({length} < {self.min_length} chars)")
            score = length / self.min_length  # Proportional penalty

        # Check maximum
        if self.max_length and length > self.max_length:
            errors.append(f"Response too long ({length} > {self.max_length} chars)")
            score = min(score, self.max_length / length)

        if errors:
            return ValidationResult.failure(
                errors=errors,
                score=score,
                metadata={"validator": "length", "length": length},
            )

        return ValidationResult.success(metadata={"validator": "length", "length": length})


class JSONValidator(BaseValidator):
    """Validates response is valid JSON with expected structure"""

    def __init__(
        self,
        required_fields: Optional[List[str]] = None,
        schema: Optional[Dict[str, Any]] = None,
        weight: float = 1.0,
    ):
        """
        Initialize JSON validator

        Args:
            required_fields: List of required top-level fields
            schema: JSON schema for validation (future enhancement)
            weight: Validator weight
        """
        super().__init__(weight)
        self.required_fields = required_fields or []
        self.schema = schema

    def validate(self, response: str, context: Dict[str, Any]) -> ValidationResult:
        errors = []
        warnings = []
        score = 1.0

        # Try to parse JSON
        try:
            parsed = json.loads(response)
        except json.JSONDecodeError as e:
            # Check if response is wrapped in markdown code blocks
            if "```" in response:
                warnings.append("Response wrapped in markdown code blocks")
                # Try to extract JSON from code blocks
                json_match = re.search(r"```(?:json)?\s*\n(.*?)\n```", response, re.DOTALL)
                if json_match:
                    try:
                        parsed = json.loads(json_match.group(1))
                        score -= 0.1  # Small penalty for incorrect format
                    except json.JSONDecodeError:
                        return ValidationResult.failure(
                            errors=[f"Invalid JSON in code block: {e}"],
                            metadata={"validator": "json"},
                        )
                else:
                    return ValidationResult.failure(
                        errors=[f"Could not extract JSON from code blocks: {e}"],
                        metadata={"validator": "json"},
                    )
            else:
                return ValidationResult.failure(
                    errors=[f"Invalid JSON: {e}"],
                    metadata={"validator": "json"},
                )

        # Check required fields
        if self.required_fields:
            missing_fields = [field for field in self.required_fields if field not in parsed]
            if missing_fields:
                errors.append(f"Missing required fields: {missing_fields}")
                score -= 0.2 * len(missing_fields)

        # TODO: JSON schema validation (future enhancement)
        # if self.schema:
        #     validate_schema(parsed, self.schema)

        if errors:
            return ValidationResult.failure(
                errors=errors,
                score=max(0.0, score),
                metadata={"validator": "json", "warnings": warnings},
            )

        result = ValidationResult.success(
            score=score, metadata={"validator": "json", "parsed": parsed}
        )
        for warning in warnings:
            result.add_warning(warning)
        return result


class TruncationValidator(BaseValidator):
    """Validates response is not truncated"""

    def __init__(self, max_tokens: int = 4000, weight: float = 1.0):
        """
        Initialize truncation validator

        Args:
            max_tokens: Maximum tokens for response
            weight: Validator weight
        """
        super().__init__(weight)
        self.max_tokens = max_tokens

    def validate(self, response: str, context: Dict[str, Any]) -> ValidationResult:
        errors = []
        warnings = []
        score = 1.0

        # Check for common truncation indicators
        truncation_indicators = [
            "...",
            "[truncated]",
            "[continued in next response]",
        ]

        for indicator in truncation_indicators:
            if response.strip().endswith(indicator):
                errors.append(f"Response appears truncated (ends with '{indicator}')")
                score -= 0.3

        # Check if response is suspiciously close to max length
        # Rough estimate: 4 chars per token
        estimated_tokens = len(response) / 4
        if estimated_tokens >= self.max_tokens * 0.95:
            warnings.append(
                f"Response very close to max tokens "
                f"(~{estimated_tokens:.0f}/{self.max_tokens})"
            )
            score -= 0.1

        if errors:
            return ValidationResult.failure(
                errors=errors,
                score=score,
                metadata={"validator": "truncation", "warnings": warnings},
            )

        result = ValidationResult.success(score=score, metadata={"validator": "truncation"})
        for warning in warnings:
            result.add_warning(warning)
        return result


class FormatValidator(BaseValidator):
    """Validates response follows expected format patterns"""

    def __init__(self, expected_format: str, weight: float = 1.0):
        """
        Initialize format validator

        Args:
            expected_format: Expected format (json, markdown, plain, etc.)
            weight: Validator weight
        """
        super().__init__(weight)
        self.expected_format = expected_format

    def validate(self, response: str, context: Dict[str, Any]) -> ValidationResult:
        errors = []
        warnings = []
        score = 1.0

        # JSON format
        if self.expected_format == "json":
            # Should NOT have markdown wrapper
            if response.strip().startswith("```"):
                errors.append("JSON response wrapped in markdown code blocks")
                score -= 0.2

            # Should NOT have explanatory text before/after JSON
            if not response.strip().startswith("{") and not response.strip().startswith("["):
                errors.append("JSON response contains text before JSON object")
                score -= 0.2

        # Markdown format
        elif self.expected_format == "markdown":
            # Should have markdown elements
            markdown_indicators = ["#", "**", "-", "*", ">", "```"]
            if not any(indicator in response for indicator in markdown_indicators):
                warnings.append("Response appears to be plain text, not markdown")
                score -= 0.1

        # Plain text format
        elif self.expected_format == "plain":
            # Should NOT have markdown or code blocks
            if "```" in response or response.count("#") > 2:
                warnings.append("Plain text response contains markdown formatting")
                score -= 0.1

        if errors:
            return ValidationResult.failure(
                errors=errors,
                score=score,
                metadata={"validator": "format", "expected": self.expected_format},
            )

        result = ValidationResult.success(
            score=score,
            metadata={"validator": "format", "expected": self.expected_format},
        )
        for warning in warnings:
            result.add_warning(warning)
        return result


class ValidationPipeline:
    """
    Composable validation pipeline

    Runs multiple validators and aggregates results.
    """

    def __init__(self, validators: List[BaseValidator]):
        """
        Initialize pipeline

        Args:
            validators: List of validators to run
        """
        self.validators = validators

    def validate(self, response: str, context: Dict[str, Any] = None) -> ValidationResult:
        """
        Run all validators and aggregate results

        Args:
            response: Response to validate
            context: Additional context

        Returns:
            Aggregated validation result
        """
        context = context or {}

        # Initialize aggregate result
        aggregate = ValidationResult.success(metadata={"validators_run": []})

        total_weight = sum(v.weight for v in self.validators)
        weighted_score = 0.0

        # Run each validator
        for validator in self.validators:
            result = validator.validate(response, context)

            # Track which validators ran
            aggregate.metadata["validators_run"].append(
                result.metadata.get("validator", validator.__class__.__name__)
            )

            # Merge errors and warnings
            aggregate.errors.extend(result.errors)
            aggregate.warnings.extend(result.warnings)

            # Update passed flag
            if not result.passed:
                aggregate.passed = False

            # Calculate weighted score
            weighted_score += result.score * validator.weight

        # Calculate final score
        if total_weight > 0:
            aggregate.score = weighted_score / total_weight
        else:
            aggregate.score = 1.0

        return aggregate


# Pre-configured pipelines for common use cases

def get_task_generation_pipeline() -> ValidationPipeline:
    """Validation pipeline for task generation responses"""
    return ValidationPipeline(
        [
            EmptyResponseValidator(weight=1.0),
            FormatValidator(expected_format="json", weight=0.8),
            JSONValidator(required_fields=["tasks"], weight=1.0),
            LengthValidator(min_length=100, weight=0.6),
            TruncationValidator(max_tokens=4000, weight=0.8),
        ]
    )


def get_interview_pipeline() -> ValidationPipeline:
    """Validation pipeline for interview question responses"""
    return ValidationPipeline(
        [
            EmptyResponseValidator(weight=1.0),
            LengthValidator(min_length=50, max_length=2000, weight=0.7),
            TruncationValidator(max_tokens=2000, weight=0.6),
        ]
    )


def get_code_execution_pipeline() -> ValidationPipeline:
    """Validation pipeline for code execution responses"""
    return ValidationPipeline(
        [
            EmptyResponseValidator(weight=1.0),
            FormatValidator(expected_format="json", weight=0.8),
            JSONValidator(required_fields=["result", "status"], weight=1.0),
            TruncationValidator(max_tokens=4000, weight=0.7),
        ]
    )


def get_generic_pipeline() -> ValidationPipeline:
    """Generic validation pipeline for general responses"""
    return ValidationPipeline(
        [
            EmptyResponseValidator(weight=1.0),
            LengthValidator(min_length=20, weight=0.5),
            TruncationValidator(max_tokens=4000, weight=0.6),
        ]
    )


# Pipeline factory
PIPELINES = {
    "task_generation": get_task_generation_pipeline,
    "interview": get_interview_pipeline,
    "code_execution": get_code_execution_pipeline,
    "generic": get_generic_pipeline,
}


def get_pipeline(usage_type: str = "generic") -> ValidationPipeline:
    """
    Get validation pipeline for usage type

    Args:
        usage_type: Type of usage (task_generation, interview, etc.)

    Returns:
        ValidationPipeline instance
    """
    pipeline_factory = PIPELINES.get(usage_type, get_generic_pipeline)
    return pipeline_factory()
