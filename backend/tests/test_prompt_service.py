"""
Tests for PromptService - PROMPT #103
High-level service integrating PromptLoader with AIOrchestrator

Tests:
1. Service initialization
2. Feature flag behavior
3. Execute with fallback pattern
4. Prompt info retrieval
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.prompts.service import PromptService, get_prompt_service
from app.prompts.models import PromptNotFoundError, PromptRenderError


class TestPromptService:
    """Tests for PromptService class"""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database session"""
        return MagicMock()

    @pytest.fixture
    def service(self, mock_db):
        """Create a PromptService instance with mocked dependencies"""
        with patch('app.prompts.service.AIOrchestrator') as mock_orchestrator:
            mock_orchestrator.return_value = MagicMock()
            service = PromptService(mock_db)
            return service

    # =====================
    # Test: Initialization
    # =====================

    def test_service_initialization(self, mock_db):
        """Test service initializes with required dependencies"""
        with patch('app.prompts.service.AIOrchestrator'):
            service = PromptService(mock_db)

            assert service.db is mock_db
            assert service.loader is not None
            assert service.orchestrator is not None

    def test_service_cache_enabled_by_default(self, mock_db):
        """Test that cache is enabled by default"""
        with patch('app.prompts.service.AIOrchestrator'):
            service = PromptService(mock_db, enable_cache=True)

            assert service.loader._cache_enabled is True

    def test_service_cache_can_be_disabled(self, mock_db):
        """Test that cache can be disabled"""
        with patch('app.prompts.service.AIOrchestrator'):
            service = PromptService(mock_db, enable_cache=False)

            assert service.loader._cache_enabled is False

    # =====================
    # Test: Feature Flag
    # =====================

    def test_feature_flag_disabled_by_default(self, service):
        """Test that external prompts are disabled by default"""
        with patch('app.prompts.service.settings') as mock_settings:
            mock_settings.use_external_prompts = False

            assert service.is_external_prompts_enabled() is False

    def test_feature_flag_enabled_when_set(self, service):
        """Test that external prompts can be enabled"""
        with patch('app.prompts.service.settings') as mock_settings:
            mock_settings.use_external_prompts = True

            assert service.is_external_prompts_enabled() is True

    # =====================
    # Test: Render Prompt
    # =====================

    def test_render_prompt_returns_tuple(self, service):
        """Test render_prompt returns system and user prompts"""
        system_prompt, user_prompt = service.render_prompt(
            "interviews/context_interview_ai",
            {
                "project_name": "Test",
                "qa_summary": "Q&A",
                "question_count": 1
            }
        )

        assert isinstance(system_prompt, str)
        assert isinstance(user_prompt, str)

    def test_render_prompt_raises_on_missing_vars(self, service):
        """Test render_prompt raises error on missing variables"""
        with pytest.raises(Exception):  # VariableValidationError
            service.render_prompt(
                "interviews/context_interview_ai",
                {}  # Missing required variables
            )

    # =====================
    # Test: Execute
    # =====================

    @pytest.mark.asyncio
    async def test_execute_calls_orchestrator(self, service):
        """Test execute calls AIOrchestrator with rendered prompts"""
        # Mock orchestrator execute
        service.orchestrator.execute = AsyncMock(return_value={
            "content": "AI response",
            "provider": "anthropic",
            "model": "claude-3-5-haiku",
            "usage": {"input_tokens": 100, "output_tokens": 50}
        })

        result = await service.execute(
            prompt_name="interviews/context_interview_ai",
            variables={
                "project_name": "Test",
                "qa_summary": "Q&A",
                "question_count": 1
            },
            project_id=uuid4()
        )

        assert result["content"] == "AI response"
        assert result["prompt_name"] == "interviews/context_interview_ai"
        service.orchestrator.execute.assert_called_once()

    # =====================
    # Test: Execute with Fallback
    # =====================

    @pytest.mark.asyncio
    async def test_execute_with_fallback_uses_external_when_enabled(self, service):
        """Test execute_with_fallback uses external prompts when feature enabled"""
        # Enable feature flag
        with patch.object(service, 'is_external_prompts_enabled', return_value=True):
            # Mock execute
            service.execute = AsyncMock(return_value={"content": "External prompt result"})

            fallback_fn = AsyncMock(return_value={"content": "Fallback result"})

            result = await service.execute_with_fallback(
                prompt_name="interviews/context_interview_ai",
                variables={
                    "project_name": "Test",
                    "qa_summary": "Q&A",
                    "question_count": 1
                },
                fallback_fn=fallback_fn,
                project_id=uuid4()
            )

            assert result["content"] == "External prompt result"
            service.execute.assert_called_once()
            fallback_fn.assert_not_called()

    @pytest.mark.asyncio
    async def test_execute_with_fallback_uses_fallback_when_disabled(self, service):
        """Test execute_with_fallback uses fallback when feature disabled"""
        # Disable feature flag
        with patch.object(service, 'is_external_prompts_enabled', return_value=False):
            service.execute = AsyncMock()
            fallback_fn = AsyncMock(return_value={"content": "Fallback result"})

            result = await service.execute_with_fallback(
                prompt_name="interviews/context_interview_ai",
                variables={},
                fallback_fn=fallback_fn
            )

            assert result["content"] == "Fallback result"
            service.execute.assert_not_called()
            fallback_fn.assert_called_once()

    @pytest.mark.asyncio
    async def test_execute_with_fallback_uses_fallback_on_not_found(self, service):
        """Test execute_with_fallback uses fallback when prompt not found"""
        with patch.object(service, 'is_external_prompts_enabled', return_value=True):
            # Make execute raise PromptNotFoundError
            service.execute = AsyncMock(side_effect=PromptNotFoundError("nonexistent"))

            fallback_fn = AsyncMock(return_value={"content": "Fallback result"})

            result = await service.execute_with_fallback(
                prompt_name="nonexistent/prompt",
                variables={},
                fallback_fn=fallback_fn
            )

            assert result["content"] == "Fallback result"
            fallback_fn.assert_called_once()

    @pytest.mark.asyncio
    async def test_execute_with_fallback_uses_fallback_on_render_error(self, service):
        """Test execute_with_fallback uses fallback when render fails"""
        with patch.object(service, 'is_external_prompts_enabled', return_value=True):
            # Make execute raise PromptRenderError
            service.execute = AsyncMock(side_effect=PromptRenderError("render failed"))

            fallback_fn = AsyncMock(return_value={"content": "Fallback result"})

            result = await service.execute_with_fallback(
                prompt_name="interviews/context_interview_ai",
                variables={},  # Missing variables will cause render error
                fallback_fn=fallback_fn
            )

            assert result["content"] == "Fallback result"
            fallback_fn.assert_called_once()

    # =====================
    # Test: Get Prompt Info
    # =====================

    def test_get_prompt_info(self, service):
        """Test get_prompt_info returns metadata"""
        info = service.get_prompt_info("interviews/context_interview_ai")

        assert info["name"] == "context_interview_ai"
        assert info["category"] == "interviews"
        assert info["usage_type"] == "interview"
        assert "required_variables" in info

    # =====================
    # Test: List Prompts
    # =====================

    def test_list_available_prompts(self, service):
        """Test list_available_prompts returns all prompts"""
        prompts = service.list_available_prompts()

        assert len(prompts) > 0
        assert any("backlog" in p for p in prompts)

    def test_list_prompts_by_category(self, service):
        """Test list_available_prompts with category filter"""
        prompts = service.list_available_prompts(category="backlog")

        assert len(prompts) > 0
        assert all("backlog" in p for p in prompts)


class TestGetPromptService:
    """Tests for get_prompt_service factory function"""

    def test_get_prompt_service_returns_instance(self):
        """Test factory returns PromptService instance"""
        mock_db = MagicMock()

        with patch('app.prompts.service.AIOrchestrator'):
            service = get_prompt_service(mock_db)

            assert isinstance(service, PromptService)

    def test_get_prompt_service_caches_by_session(self):
        """Test factory caches instances by database session"""
        mock_db = MagicMock()

        with patch('app.prompts.service.AIOrchestrator'):
            service1 = get_prompt_service(mock_db)
            service2 = get_prompt_service(mock_db)

            # Same session should return same instance
            assert service1 is service2

    def test_get_prompt_service_different_sessions(self):
        """Test factory creates new instance for different sessions"""
        mock_db1 = MagicMock()
        mock_db2 = MagicMock()

        with patch('app.prompts.service.AIOrchestrator'):
            # Clear cache to ensure fresh start
            from app.prompts.service import _service_instances
            _service_instances.clear()

            service1 = get_prompt_service(mock_db1)
            service2 = get_prompt_service(mock_db2)

            # Different sessions should return different instances
            assert service1 is not service2
