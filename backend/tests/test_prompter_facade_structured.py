"""
Tests for PrompterFacade with Structured Templates Feature Flags

Verifies that feature flags are correctly loaded and applied.
These are unit tests that verify flag logic without loading actual templates.
"""

import pytest
import os
from unittest.mock import MagicMock, patch
from sqlalchemy.orm import Session

from app.prompter.facade import PrompterFacade


class TestPrompterFacadeFeatureFlags:
    """Test PrompterFacade feature flag initialization"""

    def setup_method(self):
        """Setup test environment"""
        self.mock_db = MagicMock(spec=Session)

    @patch.dict(os.environ, {
        "PROMPTER_USE_TEMPLATES": "true",
        "PROMPTER_USE_STRUCTURED_TEMPLATES": "false"
    })
    def test_structured_flag_false_when_set(self):
        """Test that structured templates flag is false when disabled"""
        facade = PrompterFacade(self.mock_db)

        assert facade.use_templates is True
        assert facade.use_structured_templates is False
        assert facade.composer is not None

    @patch.dict(os.environ, {
        "PROMPTER_USE_TEMPLATES": "true",
        "PROMPTER_USE_STRUCTURED_TEMPLATES": "true"
    })
    def test_structured_flag_true_when_set(self):
        """Test that structured templates flag is true when enabled"""
        facade = PrompterFacade(self.mock_db)

        assert facade.use_templates is True
        assert facade.use_structured_templates is True
        assert facade.composer is not None

    @patch.dict(os.environ, {
        "PROMPTER_USE_TEMPLATES": "false",
        "PROMPTER_USE_STRUCTURED_TEMPLATES": "true"
    })
    def test_structured_flag_ignored_when_templates_disabled(self):
        """Test that structured flag is ignored when templates are disabled"""
        facade = PrompterFacade(self.mock_db)

        assert facade.use_templates is False
        assert facade.use_structured_templates is True
        assert facade.composer is None  # Composer not initialized when templates disabled

    @patch.dict(os.environ, {})  # No env vars set
    def test_default_flags_are_false(self):
        """Test that all flags default to false when not set"""
        facade = PrompterFacade(self.mock_db)

        assert facade.use_templates is False
        assert facade.use_structured_templates is False
        assert facade.use_cache is False
        assert facade.use_batching is False
        assert facade.use_tracing is False

    @patch.dict(os.environ, {
        "PROMPTER_USE_TEMPLATES": "TRUE",  # Test case insensitivity
        "PROMPTER_USE_STRUCTURED_TEMPLATES": "True"
    })
    def test_flags_are_case_insensitive(self):
        """Test that flag values are case insensitive"""
        facade = PrompterFacade(self.mock_db)

        assert facade.use_templates is True
        assert facade.use_structured_templates is True

    @patch.dict(os.environ, {
        "PROMPTER_USE_TEMPLATES": "yes",  # Invalid value
        "PROMPTER_USE_STRUCTURED_TEMPLATES": "1"  # Invalid value
    })
    def test_invalid_flag_values_default_to_false(self):
        """Test that invalid flag values are treated as false"""
        facade = PrompterFacade(self.mock_db)

        # Only "true" (case insensitive) should enable flags
        assert facade.use_templates is False
        assert facade.use_structured_templates is False
