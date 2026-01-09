"""
Tests for Prompter Validation Pipeline

Tests the validation system for response quality control.
"""

import pytest
import json
from app.prompter.orchestration.validation import (
    ValidationResult,
    EmptyResponseValidator,
    LengthValidator,
    JSONValidator,
    TruncationValidator,
    FormatValidator,
    ValidationPipeline,
    get_pipeline,
)


class TestValidationResult:
    """Test ValidationResult dataclass"""

    def test_success_result(self):
        """Test creating success result"""
        result = ValidationResult.success(score=0.9, metadata={"test": "data"})
        assert result.passed is True
        assert result.score == 0.9
        assert result.errors == []
        assert result.metadata == {"test": "data"}

    def test_failure_result(self):
        """Test creating failure result"""
        result = ValidationResult.failure(
            errors=["Error 1", "Error 2"],
            score=0.3,
            metadata={"test": "data"}
        )
        assert result.passed is False
        assert result.score == 0.3
        assert len(result.errors) == 2

    def test_add_warning(self):
        """Test adding warnings"""
        result = ValidationResult.success()
        result.add_warning("Warning message")
        assert len(result.warnings) == 1
        assert result.warnings[0] == "Warning message"

    def test_merge_results(self):
        """Test merging validation results"""
        result1 = ValidationResult.success(score=0.9)
        result2 = ValidationResult.failure(errors=["Error"], score=0.5)

        result1.merge(result2)
        assert result1.passed is False  # Failed because result2 failed
        assert result1.score == 0.5  # Min of 0.9 and 0.5
        assert len(result1.errors) == 1


class TestEmptyResponseValidator:
    """Test EmptyResponseValidator"""

    def test_empty_response(self):
        """Test validation fails for empty response"""
        validator = EmptyResponseValidator()
        result = validator.validate("", {})
        assert result.passed is False
        assert "empty" in result.errors[0].lower()

    def test_whitespace_only_response(self):
        """Test validation fails for whitespace-only response"""
        validator = EmptyResponseValidator()
        result = validator.validate("   \n  ", {})
        assert result.passed is False

    def test_valid_response(self):
        """Test validation passes for non-empty response"""
        validator = EmptyResponseValidator()
        result = validator.validate("Valid response", {})
        assert result.passed is True


class TestLengthValidator:
    """Test LengthValidator"""

    def test_too_short(self):
        """Test validation fails for too short response"""
        validator = LengthValidator(min_length=50)
        result = validator.validate("Short", {})
        assert result.passed is False
        assert "too short" in result.errors[0].lower()

    def test_too_long(self):
        """Test validation fails for too long response"""
        validator = LengthValidator(min_length=10, max_length=50)
        result = validator.validate("A" * 100, {})
        assert result.passed is False
        assert "too long" in result.errors[0].lower()

    def test_valid_length(self):
        """Test validation passes for valid length"""
        validator = LengthValidator(min_length=10, max_length=100)
        result = validator.validate("This is a valid length response", {})
        assert result.passed is True


class TestJSONValidator:
    """Test JSONValidator"""

    def test_valid_json(self):
        """Test validation passes for valid JSON"""
        validator = JSONValidator()
        response = json.dumps({"tasks": [{"title": "Test"}]})
        result = validator.validate(response, {})
        assert result.passed is True

    def test_invalid_json(self):
        """Test validation fails for invalid JSON"""
        validator = JSONValidator()
        result = validator.validate("Not a JSON", {})
        assert result.passed is False
        assert "invalid json" in result.errors[0].lower()

    def test_json_with_markdown_wrapper(self):
        """Test validation handles JSON wrapped in markdown"""
        validator = JSONValidator()
        response = "```json\n{\"tasks\": []}\n```"
        result = validator.validate(response, {})
        # Should extract and validate JSON
        assert result.passed is True
        assert len(result.warnings) > 0  # Warning about markdown wrapper

    def test_required_fields(self):
        """Test validation checks for required fields"""
        validator = JSONValidator(required_fields=["tasks", "status"])
        response = json.dumps({"tasks": []})  # Missing 'status'
        result = validator.validate(response, {})
        assert result.passed is False
        assert "missing required fields" in result.errors[0].lower()

    def test_required_fields_present(self):
        """Test validation passes when required fields present"""
        validator = JSONValidator(required_fields=["tasks"])
        response = json.dumps({"tasks": [], "extra": "field"})
        result = validator.validate(response, {})
        assert result.passed is True


class TestTruncationValidator:
    """Test TruncationValidator"""

    def test_truncated_with_ellipsis(self):
        """Test detection of truncation with ellipsis"""
        validator = TruncationValidator()
        result = validator.validate("Response text...", {})
        assert result.passed is False
        assert "truncated" in result.errors[0].lower()

    def test_not_truncated(self):
        """Test validation passes for non-truncated response"""
        validator = TruncationValidator()
        result = validator.validate("Complete response text.", {})
        assert result.passed is True

    def test_near_max_tokens_warning(self):
        """Test warning when near max tokens"""
        validator = TruncationValidator(max_tokens=100)
        # ~95 tokens (4 chars per token estimate)
        long_response = "A" * 380
        result = validator.validate(long_response, {})
        # Should pass but with warning
        assert len(result.warnings) > 0


class TestFormatValidator:
    """Test FormatValidator"""

    def test_json_format_with_wrapper(self):
        """Test JSON format validation detects markdown wrapper"""
        validator = FormatValidator(expected_format="json")
        result = validator.validate("```json\n{\"test\": 1}\n```", {})
        assert result.passed is False
        assert "wrapped" in result.errors[0].lower()

    def test_json_format_with_text_before(self):
        """Test JSON format validation detects text before JSON"""
        validator = FormatValidator(expected_format="json")
        result = validator.validate("Here is the JSON:\n{\"test\": 1}", {})
        assert result.passed is False

    def test_valid_json_format(self):
        """Test JSON format validation passes for clean JSON"""
        validator = FormatValidator(expected_format="json")
        result = validator.validate('{"test": 1}', {})
        assert result.passed is True


class TestValidationPipeline:
    """Test ValidationPipeline composition"""

    def test_pipeline_runs_all_validators(self):
        """Test pipeline runs all validators"""
        validators = [
            EmptyResponseValidator(),
            LengthValidator(min_length=10),
        ]
        pipeline = ValidationPipeline(validators)

        result = pipeline.validate("Valid response text", {})
        assert result.passed is True
        assert len(result.metadata["validators_run"]) == 2

    def test_pipeline_aggregates_errors(self):
        """Test pipeline aggregates errors from all validators"""
        validators = [
            LengthValidator(min_length=100),  # Will fail
            JSONValidator(required_fields=["test"]),  # Will fail
        ]
        pipeline = ValidationPipeline(validators)

        result = pipeline.validate('{"other": 1}', {})
        assert result.passed is False
        assert len(result.errors) >= 2  # At least 2 errors

    def test_pipeline_weighted_score(self):
        """Test pipeline calculates weighted score"""
        validators = [
            EmptyResponseValidator(weight=1.0),  # Will pass
            LengthValidator(min_length=1000, weight=0.5),  # Will fail
        ]
        pipeline = ValidationPipeline(validators)

        result = pipeline.validate("Short but not empty", {})
        # Score should be weighted average
        assert 0 < result.score < 1


class TestPipelineFactory:
    """Test pre-configured pipeline factory"""

    def test_get_task_generation_pipeline(self):
        """Test task generation pipeline"""
        pipeline = get_pipeline("task_generation")
        assert pipeline is not None

        # Should pass valid JSON with tasks (make it long enough)
        valid_response = json.dumps({
            "tasks": [
                {
                    "title": "Test task with sufficient detail",
                    "description": "This is a comprehensive description that provides enough context and details to pass the minimum length validation requirements for the task generation pipeline."
                }
            ]
        })
        result = pipeline.validate(valid_response, {})
        assert result.passed is True

        # Should fail invalid response
        result = pipeline.validate("Not JSON", {})
        assert result.passed is False

    def test_get_interview_pipeline(self):
        """Test interview pipeline"""
        pipeline = get_pipeline("interview")
        assert pipeline is not None

        # Should pass reasonable interview question (make it long enough)
        result = pipeline.validate(
            "What are the main features of your project and how do you envision them working together?",
            {}
        )
        assert result.passed is True

    def test_get_generic_pipeline(self):
        """Test generic pipeline"""
        pipeline = get_pipeline("generic")
        assert pipeline is not None

        # Should pass any reasonable response
        result = pipeline.validate("This is a generic response.", {})
        assert result.passed is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
