"""
Tests for PromptLoader - PROMPT #103
Externalize Hardcoded Prompts to YAML Files

Tests:
1. Loading prompt templates
2. Rendering with variables
3. Component inclusion
4. Error handling
5. Caching
"""

import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

from app.prompts.loader import PromptLoader
from app.prompts.models import (
    PromptTemplate,
    PromptMetadata,
    PromptNotFoundError,
    PromptRenderError,
    VariableValidationError,
)


class TestPromptLoader:
    """Tests for PromptLoader class"""

    @pytest.fixture
    def loader(self):
        """Create a PromptLoader instance"""
        return PromptLoader(enable_cache=False)

    @pytest.fixture
    def loader_with_cache(self):
        """Create a PromptLoader with cache enabled"""
        return PromptLoader(enable_cache=True)

    # =====================
    # Test: Load Prompt
    # =====================

    def test_load_existing_prompt(self, loader):
        """Test loading an existing prompt template"""
        template = loader.load("backlog/epic_from_interview")

        assert template is not None
        assert isinstance(template, PromptTemplate)
        assert template.metadata.name == "epic_from_interview"
        assert template.metadata.category == "backlog"
        assert "conversation_text" in template.required_variables

    def test_load_prompt_with_components(self, loader):
        """Test loading a prompt that uses components"""
        template = loader.load("backlog/epic_from_interview")

        # Should have semantic_methodology component
        assert "semantic_methodology" in template.metadata.components

    def test_load_nonexistent_prompt_raises_error(self, loader):
        """Test that loading a nonexistent prompt raises PromptNotFoundError"""
        with pytest.raises(PromptNotFoundError):
            loader.load("nonexistent/prompt")

    def test_load_interview_prompt(self, loader):
        """Test loading interview prompts"""
        template = loader.load("interviews/subtask_focused")

        assert template is not None
        assert template.metadata.category == "interviews"
        assert template.metadata.usage_type == "interview"

    def test_load_card_focused_prompt(self, loader):
        """Test loading card-focused prompts"""
        template = loader.load("interviews/card_focused/bug")

        assert template is not None
        assert "bug" in template.metadata.tags

    # =====================
    # Test: Render Prompt
    # =====================

    def test_render_prompt_with_variables(self, loader):
        """Test rendering a prompt with variables"""
        system_prompt, user_prompt = loader.render(
            "interviews/context_interview_ai",
            {
                "project_name": "Test Project",
                "qa_summary": "Q: What is the project?\nA: A test project.",
                "question_count": 4
            }
        )

        assert "Test Project" in system_prompt
        assert "Q: What is the project?" in system_prompt
        assert "Pergunta 4" in system_prompt

    def test_render_prompt_missing_required_variable(self, loader):
        """Test that missing required variables raise VariableValidationError"""
        with pytest.raises(VariableValidationError) as exc_info:
            loader.render(
                "interviews/context_interview_ai",
                {
                    "project_name": "Test Project"
                    # Missing: qa_summary, question_count
                }
            )

        assert "qa_summary" in str(exc_info.value) or "question_count" in str(exc_info.value)

    def test_render_prompt_with_optional_variables(self, loader):
        """Test rendering with optional variables"""
        # subtask_focused has optional parent_task_context
        system_prompt, user_prompt = loader.render(
            "interviews/subtask_focused",
            {
                "project_context": "Project: Test",
                "question_num": 1,
                "parent_task_context": "Parent: Epic X"
            }
        )

        assert "Parent: Epic X" in system_prompt

    def test_render_prompt_without_optional_variables(self, loader):
        """Test rendering without optional variables (should not fail)"""
        system_prompt, user_prompt = loader.render(
            "interviews/subtask_focused",
            {
                "project_context": "Project: Test",
                "question_num": 1
                # parent_task_context is optional
            }
        )

        assert "Project: Test" in system_prompt

    # =====================
    # Test: Components
    # =====================

    def test_component_loading(self, loader):
        """Test that components are loaded correctly"""
        # Load a component directly
        component = loader._load_component("semantic_methodology")

        assert component is not None
        assert "Metodologia de Referências Semânticas" in component or "METODOLOGIA" in component

    def test_component_inclusion_in_prompt(self, loader):
        """Test that components are included when rendering"""
        template = loader.load("backlog/epic_from_interview")

        # The template uses semantic_methodology component
        if "semantic_methodology" in template.metadata.components:
            system_prompt, _ = loader.render(
                "backlog/epic_from_interview",
                {
                    "conversation_text": "Test conversation",
                    "project_name": "Test Project"
                }
            )

            # Component content should be in the rendered prompt
            assert "N1" in system_prompt or "Nouns" in system_prompt or "identificadores" in system_prompt.lower()

    # =====================
    # Test: Caching
    # =====================

    def test_cache_stores_template(self, loader_with_cache):
        """Test that cache stores loaded templates"""
        # First load
        template1 = loader_with_cache.load("backlog/epic_from_interview")

        # Second load (should hit cache)
        template2 = loader_with_cache.load("backlog/epic_from_interview")

        assert template1 is template2  # Same object from cache

    def test_cache_clear(self, loader_with_cache):
        """Test cache clearing"""
        # Load a template
        loader_with_cache.load("backlog/epic_from_interview")

        # Clear cache
        loader_with_cache.clear_cache()

        # Cache should be empty
        assert len(loader_with_cache._cache) == 0

    # =====================
    # Test: List Prompts
    # =====================

    def test_list_all_prompts(self, loader):
        """Test listing all available prompts"""
        prompts = loader.list_prompts()

        assert len(prompts) > 0
        assert any("backlog" in p for p in prompts)
        assert any("interview" in p for p in prompts)

    def test_list_prompts_by_category(self, loader):
        """Test listing prompts filtered by category"""
        backlog_prompts = loader.list_prompts(category="backlog")

        assert len(backlog_prompts) > 0
        assert all("backlog" in p for p in backlog_prompts)

    # =====================
    # Test: Exists
    # =====================

    def test_exists_returns_true_for_existing(self, loader):
        """Test exists() returns True for existing prompts"""
        assert loader.exists("backlog/epic_from_interview") is True

    def test_exists_returns_false_for_nonexistent(self, loader):
        """Test exists() returns False for nonexistent prompts"""
        assert loader.exists("nonexistent/prompt") is False


class TestPromptTemplate:
    """Tests for PromptTemplate model"""

    def test_template_metadata(self):
        """Test template metadata fields"""
        metadata = PromptMetadata(
            name="test_prompt",
            version=1,
            category="test",
            description="Test prompt",
            usage_type="general",
            estimated_tokens=1000,
            tags=["test", "unit"],
            components=["semantic_methodology"]
        )

        assert metadata.name == "test_prompt"
        assert metadata.version == 1
        assert metadata.category == "test"
        assert "test" in metadata.tags


class TestPromptLoaderIntegration:
    """Integration tests for PromptLoader with actual YAML files"""

    @pytest.fixture
    def loader(self):
        return PromptLoader(enable_cache=False)

    def test_all_backlog_prompts_load(self, loader):
        """Test that all backlog prompts load successfully"""
        backlog_prompts = [
            "backlog/epic_from_interview",
            "backlog/stories_from_epic",
            "backlog/tasks_from_story"
        ]

        for prompt_name in backlog_prompts:
            template = loader.load(prompt_name)
            assert template is not None, f"Failed to load {prompt_name}"
            assert template.system_prompt, f"No system_prompt in {prompt_name}"

    def test_all_context_prompts_load(self, loader):
        """Test that all context prompts load successfully"""
        context_prompts = [
            "context/context_generation",
            "context/suggested_epics",
            "context/activate_epic",
            "context/draft_stories",
            "context/draft_tasks",
            "context/draft_subtasks"
        ]

        for prompt_name in context_prompts:
            template = loader.load(prompt_name)
            assert template is not None, f"Failed to load {prompt_name}"

    def test_all_interview_prompts_load(self, loader):
        """Test that all interview prompts load successfully"""
        interview_prompts = [
            "interviews/unified_open",
            "interviews/context_interview_ai",
            "interviews/subtask_focused",
            "interviews/card_focused/bug",
            "interviews/card_focused/feature",
            "interviews/card_focused/bugfix",
            "interviews/card_focused/design",
            "interviews/card_focused/documentation",
            "interviews/card_focused/enhancement",
            "interviews/card_focused/refactor",
            "interviews/card_focused/testing",
            "interviews/card_focused/optimization",
            "interviews/card_focused/security",
            "interviews/card_focused/generic"
        ]

        for prompt_name in interview_prompts:
            template = loader.load(prompt_name)
            assert template is not None, f"Failed to load {prompt_name}"

    def test_all_components_load(self, loader):
        """Test that all components load successfully"""
        components = [
            "semantic_methodology",
            "json_output_rules",
            "project_context"
        ]

        for component_name in components:
            content = loader._load_component(component_name)
            assert content is not None, f"Failed to load component {component_name}"
            assert len(content) > 0, f"Component {component_name} is empty"
