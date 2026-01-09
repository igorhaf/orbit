"""
Integration Tests for PromptComposer with Structured Templates

Tests the full pipeline: load structured YAML → parse → render → output
"""

import pytest
import tempfile
import yaml
from pathlib import Path
from unittest.mock import MagicMock
from sqlalchemy.orm import Session

from app.prompter.core.composer import PromptComposer


class TestComposerStructuredIntegration:
    """Integration tests for structured template rendering"""

    def setup_method(self):
        """Setup test environment"""
        # Create temporary directory for templates
        self.temp_dir = tempfile.mkdtemp()
        self.template_dir = Path(self.temp_dir)

        # Mock database session
        self.mock_db = MagicMock(spec=Session)
        self.mock_db.query.return_value.filter.return_value.order_by.return_value.first.return_value = None

        # Create composer
        self.composer = PromptComposer(self.template_dir, self.mock_db)

    def test_render_simple_structured_template(self):
        """Test rendering a simple structured template"""
        # Create structured template YAML
        template_data = {
            "name": "test_structured",
            "version": 2,
            "category": "test",
            "variables_schema": {
                "required": ["input_data"],
                "optional": []
            },
            "action": {
                "name": "DATA_PROCESSING",
                "description": "Process input data and generate output"
            },
            "steps": [
                {
                    "number": 1,
                    "name": "EXTRACT_INFO",
                    "commands": [
                        {
                            "verb": "EXTRACT",
                            "target": "key_fields",
                            "source": "input_data"
                        }
                    ]
                },
                {
                    "number": 2,
                    "name": "VALIDATE",
                    "commands": [
                        {
                            "verb": "VERIFY",
                            "target": "data_completeness"
                        }
                    ]
                }
            ],
            "expected_output": {
                "format": "json",
                "constraints": ["Clean JSON only"]
            }
        }

        # Write template to file
        template_path = self.template_dir / "test_structured.yaml"
        with open(template_path, 'w') as f:
            yaml.dump(template_data, f)

        # Render template
        result = self.composer.render_structured(
            "test_structured",
            {"input_data": "test data"}
        )

        # Verify output
        assert "ACTION: DATA_PROCESSING" in result
        assert "PURPOSE: Process input data and generate output" in result
        assert "STEP 1: EXTRACT_INFO" in result
        assert "EXTRACT key_fields from input_data." in result
        assert "STEP 2: VALIDATE" in result
        assert "VERIFY data_completeness." in result
        assert "EXPECTED_OUTPUT:" in result
        assert "Format: JSON" in result

    def test_render_structured_with_conditionals(self):
        """Test structured template with conditional logic"""
        template_data = {
            "name": "test_conditional",
            "version": 2,
            "variables_schema": {
                "required": ["base_data"],
                "optional": ["extra_context"]
            },
            "action": {
                "name": "CONDITIONAL_PROCESSING"
            },
            "steps": [
                {
                    "number": 1,
                    "name": "ANALYZE",
                    "commands": [
                        {
                            "verb": "ANALYZE",
                            "target": "base_data"
                        }
                    ],
                    "conditionals": [
                        {
                            "condition": "extra_context is provided",
                            "then_commands": [
                                {
                                    "verb": "INCORPORATE",
                                    "target": "additional_insights",
                                    "source": "extra_context"
                                }
                            ]
                        }
                    ]
                }
            ],
            "expected_output": {
                "format": "text"
            }
        }

        template_path = self.template_dir / "test_conditional.yaml"
        with open(template_path, 'w') as f:
            yaml.dump(template_data, f)

        result = self.composer.render_structured(
            "test_conditional",
            {"base_data": "test"}
        )

        assert "STEP 1: ANALYZE" in result
        assert "IF extra_context is provided THEN:" in result
        assert "INCORPORATE additional_insights from extra_context." in result

    def test_render_structured_with_system_context(self):
        """Test structured template with system context"""
        template_data = {
            "name": "test_context",
            "version": 2,
            "variables_schema": {
                "required": ["task"]
            },
            "system_context": "You are an expert {{domain}} specialist.",
            "action": {
                "name": "EXPERT_ANALYSIS"
            },
            "steps": [
                {
                    "number": 1,
                    "name": "PERFORM_TASK",
                    "commands": [
                        {
                            "verb": "EXECUTE",
                            "target": "analysis"
                        }
                    ]
                }
            ],
            "expected_output": {
                "format": "text"
            }
        }

        template_path = self.template_dir / "test_context.yaml"
        with open(template_path, 'w') as f:
            yaml.dump(template_data, f)

        result = self.composer.render_structured(
            "test_context",
            {"task": "analyze data", "domain": "data science"}
        )

        assert "You are an expert data science specialist." in result
        assert "ACTION: EXPERT_ANALYSIS" in result
        # System context should appear before action
        context_pos = result.index("You are an expert")
        action_pos = result.index("ACTION:")
        assert context_pos < action_pos

    def test_render_structured_with_jinja2_variables(self):
        """Test Jinja2 variable substitution in structured template"""
        template_data = {
            "name": "test_variables",
            "version": 2,
            "variables_schema": {
                "required": ["count", "item_type"]
            },
            "action": {
                "name": "ITEM_GENERATION"
            },
            "steps": [
                {
                    "number": 1,
                    "name": "GENERATE_ITEMS",
                    "commands": [
                        {
                            "verb": "GENERATE",
                            "target": "{{count}} {{item_type}} items"
                        }
                    ]
                }
            ],
            "expected_output": {
                "format": "json"
            }
        }

        template_path = self.template_dir / "test_variables.yaml"
        with open(template_path, 'w') as f:
            yaml.dump(template_data, f)

        result = self.composer.render_structured(
            "test_variables",
            {"count": "5-10", "item_type": "product"}
        )

        # Variables should be substituted
        assert "GENERATE 5-10 product items." in result

    def test_fallback_to_legacy_render(self):
        """Test that composer falls back to legacy render for old templates"""
        # Create old-style (non-structured) template
        template_data = {
            "name": "test_legacy",
            "version": 1,
            "variables_schema": {
                "required": ["name"]
            },
            "template_content": "Hello {{name}}!"
        }

        template_path = self.template_dir / "test_legacy.yaml"
        with open(template_path, 'w') as f:
            yaml.dump(template_data, f)

        # render_structured should automatically fallback to legacy render
        result = self.composer.render_structured(
            "test_legacy",
            {"name": "World"}
        )

        assert result == "Hello World!"

    def test_render_structured_with_post_processing(self):
        """Test post-processing is applied to structured templates"""
        template_data = {
            "name": "test_postprocess",
            "version": 2,
            "variables_schema": {
                "required": []
            },
            "action": {
                "name": "TEST"
            },
            "steps": [
                {
                    "number": 1,
                    "name": "STEP",
                    "commands": [
                        {
                            "verb": "RUN",
                            "target": "test"
                        }
                    ]
                }
            ],
            "expected_output": {
                "format": "text"
            },
            "post_process": [
                {
                    "type": "trim_whitespace"
                }
            ]
        }

        template_path = self.template_dir / "test_postprocess.yaml"
        with open(template_path, 'w') as f:
            yaml.dump(template_data, f)

        result = self.composer.render_structured(
            "test_postprocess",
            {}
        )

        # Should not have excessive whitespace
        assert "\n\n\n" not in result

    def test_complex_structured_template_like_task_generation(self):
        """Test a complex structured template similar to task_generation_v2"""
        # This simulates the structure of task_generation_v2.yaml
        template_data = {
            "name": "complex_task_gen",
            "version": 2,
            "variables_schema": {
                "required": ["conversation_text", "project_stack"],
                "optional": ["max_tasks"]
            },
            "system_context": "You are a technical PM specializing in {{project_stack.backend}}.",
            "action": {
                "name": "TASK_GENERATION",
                "description": "Generate actionable micro-tasks from interview"
            },
            "steps": [
                {
                    "number": 1,
                    "name": "CONTEXT_ANALYSIS",
                    "commands": [
                        {
                            "verb": "EXTRACT",
                            "target": "project_requirements",
                            "source": "conversation"
                        },
                        {
                            "verb": "IDENTIFY",
                            "target": "key_features"
                        }
                    ]
                },
                {
                    "number": 2,
                    "name": "TASK_CREATION",
                    "commands": [
                        {
                            "verb": "GENERATE",
                            "target": "6-{{max_tasks|default(15)}} micro-tasks"
                        },
                        {
                            "verb": "PRIORITIZE",
                            "target": "tasks by implementation order"
                        }
                    ]
                }
            ],
            "expected_output": {
                "format": "json",
                "constraints": ["No markdown wrappers", "Clean JSON only"]
            }
        }

        template_path = self.template_dir / "complex_task_gen.yaml"
        with open(template_path, 'w') as f:
            yaml.dump(template_data, f)

        result = self.composer.render_structured(
            "complex_task_gen",
            {
                "conversation_text": "Build product catalog",
                "project_stack": {"backend": "FastAPI"},
                "max_tasks": 10
            }
        )

        # Verify all structured elements are present and variables substituted
        assert "You are a technical PM specializing in FastAPI." in result
        assert "ACTION: TASK_GENERATION" in result
        assert "STEP 1: CONTEXT_ANALYSIS" in result
        assert "STEP 2: TASK_CREATION" in result
        assert "6-10 micro-tasks" in result
        assert "EXPECTED_OUTPUT:" in result

    def test_missing_required_variable(self):
        """Test that missing required variables raise error"""
        template_data = {
            "name": "test_required",
            "version": 2,
            "variables_schema": {
                "required": ["mandatory_field"]
            },
            "action": {"name": "TEST"},
            "steps": [
                {
                    "number": 1,
                    "name": "STEP",
                    "commands": [{"verb": "RUN", "target": "test"}]
                }
            ],
            "expected_output": {"format": "text"}
        }

        template_path = self.template_dir / "test_required.yaml"
        with open(template_path, 'w') as f:
            yaml.dump(template_data, f)

        from app.prompter.core.exceptions import VariableValidationError

        with pytest.raises(VariableValidationError) as exc_info:
            self.composer.render_structured(
                "test_required",
                {}  # Missing mandatory_field
            )

        assert "mandatory_field" in str(exc_info.value)
