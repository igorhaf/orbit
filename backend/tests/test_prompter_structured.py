"""
Tests for Structured Prompt Templates (ACTION/STEP/EXPECTED_OUTPUT format)
"""

import pytest
from app.prompter.core.commands import (
    CommandVerb,
    Command,
    Conditional,
    Step,
    Action,
    ExpectedOutput,
    StructuredPrompt,
    parse_command_from_dict,
    parse_conditional_from_dict,
    parse_step_from_dict,
    parse_action_from_dict,
    parse_expected_output_from_dict,
    parse_structured_prompt_from_dict
)


class TestCommand:
    """Test Command class"""

    def test_simple_command_render(self):
        """Test rendering a simple command"""
        cmd = Command(
            verb=CommandVerb.EXTRACT,
            target="project_requirements",
            source="conversation"
        )

        result = cmd.render()
        assert result == "EXTRACT project_requirements from conversation."

    def test_command_without_source(self):
        """Test command without source"""
        cmd = Command(
            verb=CommandVerb.ENSURE,
            target="tasks are actionable and atomic"
        )

        result = cmd.render()
        assert result == "ENSURE tasks are actionable and atomic."

    def test_command_with_constraints(self):
        """Test command with constraints"""
        cmd = Command(
            verb=CommandVerb.GENERATE,
            target="6-15 micro-tasks",
            constraints=["atomic", "actionable"]
        )

        result = cmd.render()
        assert "GENERATE 6-15 micro-tasks." in result
        assert "Constraints: atomic, actionable" in result

    def test_command_to_dict(self):
        """Test command serialization"""
        cmd = Command(
            verb=CommandVerb.ANALYZE,
            target="code_structure",
            source="repository"
        )

        data = cmd.to_dict()
        assert data["verb"] == "ANALYZE"
        assert data["target"] == "code_structure"
        assert data["source"] == "repository"

    def test_parse_command_from_dict(self):
        """Test parsing command from dictionary"""
        data = {
            "verb": "EXTRACT",
            "target": "requirements",
            "source": "interview"
        }

        cmd = parse_command_from_dict(data)
        assert cmd.verb == CommandVerb.EXTRACT
        assert cmd.target == "requirements"
        assert cmd.source == "interview"


class TestConditional:
    """Test Conditional class"""

    def test_simple_conditional_render(self):
        """Test rendering a simple conditional"""
        cond = Conditional(
            condition="specs_context is provided",
            then_commands=[
                Command(CommandVerb.REFERENCE, "framework_patterns", source="specs")
            ]
        )

        result = cond.render()
        assert "IF specs_context is provided THEN:" in result
        assert "REFERENCE framework_patterns from specs." in result

    def test_conditional_with_else(self):
        """Test conditional with ELSE branch"""
        cond = Conditional(
            condition="use_cache is true",
            then_commands=[
                Command(CommandVerb.USE, "cached_result")
            ],
            else_commands=[
                Command(CommandVerb.EXECUTE, "fresh_request")
            ]
        )

        result = cond.render()
        assert "IF use_cache is true THEN:" in result
        assert "USE cached_result." in result
        assert "ELSE:" in result
        assert "EXECUTE fresh_request." in result

    def test_conditional_to_dict(self):
        """Test conditional serialization"""
        cond = Conditional(
            condition="test condition",
            then_commands=[Command(CommandVerb.RUN, "action")]
        )

        data = cond.to_dict()
        assert data["condition"] == "test condition"
        assert len(data["then"]) == 1
        assert data["then"][0]["verb"] == "RUN"


class TestStep:
    """Test Step class"""

    def test_simple_step_render(self):
        """Test rendering a simple step"""
        step = Step(
            number=1,
            name="CONTEXT_ANALYSIS",
            commands=[
                Command(CommandVerb.EXTRACT, "requirements", source="conversation"),
                Command(CommandVerb.IDENTIFY, "key_features")
            ]
        )

        result = step.render()
        assert "STEP 1: CONTEXT_ANALYSIS" in result
        assert "EXTRACT requirements from conversation." in result
        assert "IDENTIFY key_features." in result

    def test_step_with_description(self):
        """Test step with description"""
        step = Step(
            number=2,
            name="VALIDATION",
            description="Validate input data against schema",
            commands=[
                Command(CommandVerb.VERIFY, "data_completeness")
            ]
        )

        result = step.render()
        assert "STEP 2: VALIDATION" in result
        assert "Validate input data against schema" in result

    def test_step_with_conditionals(self):
        """Test step with conditional logic"""
        step = Step(
            number=3,
            name="PROCESSING",
            commands=[
                Command(CommandVerb.TRANSFORM, "data")
            ],
            conditionals=[
                Conditional(
                    condition="verbose is true",
                    then_commands=[Command(CommandVerb.OUTPUT, "detailed_logs")]
                )
            ]
        )

        result = step.render()
        assert "STEP 3: PROCESSING" in result
        assert "IF verbose is true THEN:" in result

    def test_step_to_dict(self):
        """Test step serialization"""
        step = Step(
            number=1,
            name="TEST_STEP",
            commands=[Command(CommandVerb.RUN, "test")]
        )

        data = step.to_dict()
        assert data["number"] == 1
        assert data["name"] == "TEST_STEP"
        assert len(data["commands"]) == 1


class TestAction:
    """Test Action class"""

    def test_simple_action_render(self):
        """Test rendering a simple action"""
        action = Action(
            name="TASK_GENERATION",
            description="Generate actionable tasks from requirements"
        )

        result = action.render()
        assert "ACTION: TASK_GENERATION" in result
        assert "PURPOSE: Generate actionable tasks from requirements" in result

    def test_action_without_description(self):
        """Test action without description"""
        action = Action(name="DATA_ANALYSIS")

        result = action.render()
        assert "ACTION: DATA_ANALYSIS" in result
        assert "PURPOSE:" not in result

    def test_action_to_dict(self):
        """Test action serialization"""
        action = Action(
            name="CODE_REVIEW",
            description="Review code quality",
            category="validation"
        )

        data = action.to_dict()
        assert data["name"] == "CODE_REVIEW"
        assert data["description"] == "Review code quality"
        assert data["category"] == "validation"


class TestExpectedOutput:
    """Test ExpectedOutput class"""

    def test_simple_output_render(self):
        """Test rendering expected output"""
        output = ExpectedOutput(
            format="json",
            constraints=["No markdown wrappers", "Clean JSON only"]
        )

        result = output.render()
        assert "EXPECTED_OUTPUT:" in result
        assert "Format: JSON" in result
        assert "Constraints:" in result
        assert "No markdown wrappers" in result

    def test_output_with_schema(self):
        """Test output with schema"""
        output = ExpectedOutput(
            format="json",
            schema={
                "type": "object",
                "properties": {
                    "name": {"type": "string"}
                }
            }
        )

        result = output.render()
        assert "Schema:" in result
        assert '"type": "object"' in result

    def test_output_to_dict(self):
        """Test output serialization"""
        output = ExpectedOutput(
            format="text",
            constraints=["Max 500 words"]
        )

        data = output.to_dict()
        assert data["format"] == "text"
        assert data["constraints"] == ["Max 500 words"]


class TestStructuredPrompt:
    """Test complete StructuredPrompt"""

    def test_full_structured_prompt_render(self):
        """Test rendering a complete structured prompt"""
        prompt = StructuredPrompt(
            action=Action(
                name="TASK_ANALYSIS",
                description="Analyze tasks for optimization"
            ),
            steps=[
                Step(
                    number=1,
                    name="DATA_COLLECTION",
                    commands=[
                        Command(CommandVerb.EXTRACT, "task_metrics", source="database")
                    ]
                ),
                Step(
                    number=2,
                    name="ANALYSIS",
                    commands=[
                        Command(CommandVerb.ANALYZE, "performance_patterns"),
                        Command(CommandVerb.IDENTIFY, "bottlenecks")
                    ]
                )
            ],
            expected_output=ExpectedOutput(
                format="json",
                constraints=["Include confidence scores"]
            )
        )

        result = prompt.render()

        # Verify all sections are present
        assert "ACTION: TASK_ANALYSIS" in result
        assert "STEP 1: DATA_COLLECTION" in result
        assert "STEP 2: ANALYSIS" in result
        assert "EXPECTED_OUTPUT:" in result
        assert "Format: JSON" in result

    def test_structured_prompt_with_system_context(self):
        """Test prompt with system context"""
        prompt = StructuredPrompt(
            system_context="You are a data analyst specializing in performance optimization.",
            action=Action(name="OPTIMIZE"),
            steps=[
                Step(
                    number=1,
                    name="MEASURE",
                    commands=[Command(CommandVerb.COMPUTE, "baseline_metrics")]
                )
            ],
            expected_output=ExpectedOutput(format="text")
        )

        result = prompt.render()
        assert "You are a data analyst" in result
        assert result.index("You are a data analyst") < result.index("ACTION: OPTIMIZE")

    def test_structured_prompt_to_dict(self):
        """Test full prompt serialization"""
        prompt = StructuredPrompt(
            action=Action(name="TEST"),
            steps=[
                Step(
                    number=1,
                    name="STEP1",
                    commands=[Command(CommandVerb.RUN, "test")]
                )
            ],
            expected_output=ExpectedOutput(format="json")
        )

        data = prompt.to_dict()
        assert "action" in data
        assert "steps" in data
        assert "expected_output" in data
        assert data["action"]["name"] == "TEST"

    def test_parse_structured_prompt_from_dict(self):
        """Test parsing complete prompt from dictionary"""
        data = {
            "action": {
                "name": "GENERATE_REPORT",
                "description": "Generate analysis report"
            },
            "steps": [
                {
                    "number": 1,
                    "name": "COLLECT_DATA",
                    "commands": [
                        {
                            "verb": "EXTRACT",
                            "target": "metrics",
                            "source": "database"
                        }
                    ]
                }
            ],
            "expected_output": {
                "format": "pdf",
                "constraints": ["Include charts"]
            }
        }

        prompt = parse_structured_prompt_from_dict(data)
        assert prompt.action.name == "GENERATE_REPORT"
        assert len(prompt.steps) == 1
        assert prompt.steps[0].name == "COLLECT_DATA"
        assert prompt.expected_output.format == "pdf"


class TestCommandVerb:
    """Test CommandVerb enum"""

    def test_all_verb_categories_exist(self):
        """Test that all verb categories are available"""
        # Analysis
        assert CommandVerb.EXTRACT
        assert CommandVerb.IDENTIFY
        assert CommandVerb.ANALYZE

        # Transformation
        assert CommandVerb.GENERATE
        assert CommandVerb.CREATE
        assert CommandVerb.TRANSFORM

        # Validation
        assert CommandVerb.ENSURE
        assert CommandVerb.VERIFY
        assert CommandVerb.VALIDATE

        # Reference
        assert CommandVerb.REFERENCE
        assert CommandVerb.FOLLOW
        assert CommandVerb.APPLY

        # Output
        assert CommandVerb.RETURN
        assert CommandVerb.OUTPUT
        assert CommandVerb.FORMAT

    def test_verb_value_format(self):
        """Test that verb values are uppercase"""
        assert CommandVerb.EXTRACT.value == "EXTRACT"
        assert CommandVerb.GENERATE.value == "GENERATE"
        assert CommandVerb.VERIFY.value == "VERIFY"
