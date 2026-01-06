"""
Unit tests for ProjectStateDetector
PROMPT #68 - Dual-Mode Interview System
"""

import pytest
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
from sqlalchemy.orm import Session

from app.services.project_state_detector import ProjectStateDetector, ProjectState
from app.models.project import Project


class TestProjectStateDetector:
    """Test ProjectStateDetector service"""

    def setup_method(self):
        """Setup test fixtures"""
        self.db_mock = Mock(spec=Session)
        self.detector = ProjectStateDetector(self.db_mock)

    def test_new_project_empty_folder(self):
        """Test: Empty folder with no stack → NEW_PROJECT"""
        project = Mock(spec=Project)
        project.name = "test-project"
        project.stack_backend = None
        project.stack_database = None
        project.stack_frontend = None
        project.stack_mobile = None

        with patch.object(self.detector, '_has_code_files', return_value=False):
            state = self.detector.detect_state(project)
            assert state == ProjectState.NEW_PROJECT
            assert not self.detector.should_skip_stack_questions(project)

    def test_new_project_no_stack(self):
        """Test: Has stack but no code → NEW_PROJECT (edge case)"""
        project = Mock(spec=Project)
        project.name = "test-project"
        project.stack_backend = "laravel"
        project.stack_database = "postgresql"
        project.stack_frontend = None
        project.stack_mobile = None

        with patch.object(self.detector, '_has_code_files', return_value=False):
            state = self.detector.detect_state(project)
            assert state == ProjectState.NEW_PROJECT
            assert not self.detector.should_skip_stack_questions(project)

    def test_existing_no_stack(self):
        """Test: Has code but no stack → EXISTING_NO_STACK"""
        project = Mock(spec=Project)
        project.name = "test-project"
        project.stack_backend = None
        project.stack_database = None
        project.stack_frontend = None
        project.stack_mobile = None

        with patch.object(self.detector, '_has_code_files', return_value=True):
            state = self.detector.detect_state(project)
            assert state == ProjectState.EXISTING_NO_STACK
            assert self.detector.should_skip_stack_questions(project)

    def test_existing_with_stack(self):
        """Test: Has code AND stack → EXISTING_WITH_STACK"""
        project = Mock(spec=Project)
        project.name = "test-project"
        project.stack_backend = "laravel"
        project.stack_database = "postgresql"
        project.stack_frontend = "nextjs"
        project.stack_mobile = None

        with patch.object(self.detector, '_has_code_files', return_value=True):
            state = self.detector.detect_state(project)
            assert state == ProjectState.EXISTING_WITH_STACK
            assert self.detector.should_skip_stack_questions(project)

    def test_has_stack_configured_backend_and_database(self):
        """Test: Stack configured if backend + database set"""
        project = Mock(spec=Project)
        project.stack_backend = "laravel"
        project.stack_database = "postgresql"
        project.stack_frontend = None  # Frontend optional

        assert self.detector._has_stack_configured(project) is True

    def test_has_stack_configured_missing_backend(self):
        """Test: Stack NOT configured if backend missing"""
        project = Mock(spec=Project)
        project.stack_backend = None
        project.stack_database = "postgresql"
        project.stack_frontend = "nextjs"

        assert self.detector._has_stack_configured(project) is False

    def test_has_stack_configured_missing_database(self):
        """Test: Stack NOT configured if database missing"""
        project = Mock(spec=Project)
        project.stack_backend = "laravel"
        project.stack_database = None
        project.stack_frontend = "nextjs"

        assert self.detector._has_stack_configured(project) is False

    @patch('app.services.project_state_detector.Path')
    def test_has_code_files_php_project(self, mock_path_class):
        """Test: Detect PHP code files"""
        project = Mock(spec=Project)
        project.name = "laravel-project"

        # Mock Path behavior
        mock_path = MagicMock()
        mock_path_class.return_value = mock_path
        mock_path.exists.return_value = True
        mock_path.is_dir.return_value = True

        # Simulate finding *.php files
        def rglob_side_effect(pattern):
            if pattern == "*.php":
                return [Path("/projects/laravel-project/app/Models/User.php")]
            return []

        mock_path.rglob.side_effect = rglob_side_effect

        assert self.detector._has_code_files(project) is True

    @patch('app.services.project_state_detector.Path')
    def test_has_code_files_node_project(self, mock_path_class):
        """Test: Detect package.json"""
        project = Mock(spec=Project)
        project.name = "nextjs-project"

        # Mock Path behavior
        mock_path = MagicMock()
        mock_path_class.return_value = mock_path
        mock_path.exists.return_value = True
        mock_path.is_dir.return_value = True

        # Simulate finding package.json
        def rglob_side_effect(pattern):
            if pattern == "package.json":
                return [Path("/projects/nextjs-project/package.json")]
            return []

        mock_path.rglob.side_effect = rglob_side_effect

        assert self.detector._has_code_files(project) is True

    @patch('app.services.project_state_detector.Path')
    def test_has_code_files_empty_folder(self, mock_path_class):
        """Test: Empty folder → No code files"""
        project = Mock(spec=Project)
        project.name = "empty-project"

        # Mock Path behavior
        mock_path = MagicMock()
        mock_path_class.return_value = mock_path
        mock_path.exists.return_value = True
        mock_path.is_dir.return_value = True
        mock_path.rglob.return_value = []  # No files found

        assert self.detector._has_code_files(project) is False

    @patch('app.services.project_state_detector.Path')
    def test_has_code_files_nonexistent_folder(self, mock_path_class):
        """Test: Nonexistent folder → No code files"""
        project = Mock(spec=Project)
        project.name = "nonexistent-project"

        # Mock Path behavior
        mock_path = MagicMock()
        mock_path_class.return_value = mock_path
        mock_path.exists.return_value = False

        assert self.detector._has_code_files(project) is False

    def test_get_project_info(self):
        """Test: get_project_info returns detailed state info"""
        project = Mock(spec=Project)
        project.name = "test-project"
        project.stack_backend = "laravel"
        project.stack_database = "postgresql"
        project.stack_frontend = "nextjs"
        project.stack_mobile = None

        with patch.object(self.detector, '_has_code_files', return_value=True):
            info = self.detector.get_project_info(project)

            assert info["state"] == ProjectState.EXISTING_WITH_STACK.value
            assert info["has_stack"] is True
            assert info["has_code"] is True
            assert info["should_skip_stack_questions"] is True
            assert info["stack_backend"] == "laravel"
            assert info["stack_database"] == "postgresql"
            assert info["stack_frontend"] == "nextjs"
            assert info["stack_mobile"] is None

    def test_code_patterns_coverage(self):
        """Test: Verify common code patterns are covered"""
        expected_patterns = [
            "*.php",      # Laravel
            "*.js",       # JavaScript
            "*.jsx",      # React
            "*.ts",       # TypeScript
            "*.tsx",      # React TypeScript
            "*.py",       # Python
        ]

        for pattern in expected_patterns:
            assert pattern in self.detector.code_patterns

    def test_config_patterns_coverage(self):
        """Test: Verify common config patterns are covered"""
        expected_patterns = [
            "package.json",
            "composer.json",
            "requirements.txt",
            "Pipfile",
        ]

        for pattern in expected_patterns:
            assert pattern in self.detector.config_patterns
