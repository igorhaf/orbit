"""
ProjectStateDetector Service
PROMPT #68 - Dual-Mode Interview System

Detects project state to determine interview flow:
- NEW_PROJECT: Empty folder OR no stack configured → Requirements interview (Q1-Q7 stack)
- EXISTING_NO_STACK: Has code but stack incomplete → Task-focused interview
- EXISTING_WITH_STACK: Has code AND stack complete → Task-focused interview
"""

from pathlib import Path
from typing import Optional
from sqlalchemy.orm import Session
from enum import Enum

from app.models.project import Project


class ProjectState(str, Enum):
    """Project state classification"""
    NEW_PROJECT = "new_project"  # Empty folder or no stack
    EXISTING_NO_STACK = "existing_no_stack"  # Has code but no stack
    EXISTING_WITH_STACK = "existing_with_stack"  # Has code and stack


class ProjectStateDetector:
    """
    Detects project state to determine appropriate interview flow.

    Detection Logic:
    1. Check if project has stack configured in database
    2. Check if project folder has actual code files
    3. Combine both checks to determine state

    Usage:
        detector = ProjectStateDetector(db)
        if detector.should_skip_stack_questions(project):
            # Use task-focused interview
        else:
            # Use requirements interview (Q1-Q7 stack)
    """

    def __init__(self, db: Session):
        self.db = db

        # Code file patterns to detect
        self.code_patterns = [
            "*.php",      # Laravel backend
            "*.js",       # JavaScript
            "*.jsx",      # React JSX
            "*.ts",       # TypeScript
            "*.tsx",      # React TypeScript
            "*.py",       # Python
            "*.java",     # Java
            "*.rb",       # Ruby
            "*.go",       # Go
            "*.rs",       # Rust
            "*.swift",    # Swift
            "*.kt",       # Kotlin
            "*.cs",       # C#
            "*.cpp",      # C++
            "*.c",        # C
        ]

        # Configuration files that indicate a real project
        self.config_patterns = [
            "package.json",       # Node.js
            "composer.json",      # PHP/Composer
            "requirements.txt",   # Python pip
            "Pipfile",           # Python pipenv
            "pyproject.toml",    # Python poetry
            "Gemfile",           # Ruby
            "Cargo.toml",        # Rust
            "go.mod",            # Go
            "pom.xml",           # Java Maven
            "build.gradle",      # Java Gradle
            ".csproj",           # C# project
        ]

    def detect_state(self, project: Project) -> ProjectState:
        """
        Detect the current state of a project.

        Args:
            project: Project model instance

        Returns:
            ProjectState enum value
        """
        has_stack = self._has_stack_configured(project)
        has_code = self._has_code_files(project)

        if not has_stack and not has_code:
            return ProjectState.NEW_PROJECT
        elif has_code and not has_stack:
            return ProjectState.EXISTING_NO_STACK
        elif has_code and has_stack:
            return ProjectState.EXISTING_WITH_STACK
        else:
            # Has stack but no code (weird edge case, treat as new)
            return ProjectState.NEW_PROJECT

    def should_skip_stack_questions(self, project: Project) -> bool:
        """
        Determine if stack questions (Q1-Q7) should be skipped.

        Returns True if:
        - Project has stack configured in DB AND
        - Project folder has actual code files

        Args:
            project: Project model instance

        Returns:
            True if should skip to task-focused interview
            False if should use requirements interview (Q1-Q7)
        """
        state = self.detect_state(project)
        return state in [ProjectState.EXISTING_NO_STACK, ProjectState.EXISTING_WITH_STACK]

    def _has_stack_configured(self, project: Project) -> bool:
        """
        Check if project has stack configured in database.

        Considers stack "configured" if at least backend and database are set.
        Frontend is optional (backend-only projects are valid).

        Args:
            project: Project model instance

        Returns:
            True if stack is configured
        """
        return bool(
            project.stack_backend and
            project.stack_database
        )

    def _has_code_files(self, project: Project) -> bool:
        """
        Check if project folder contains actual code files.

        Searches for:
        1. Code files (*.php, *.js, *.tsx, *.py, etc.)
        2. Configuration files (package.json, composer.json, etc.)

        Args:
            project: Project model instance

        Returns:
            True if code files found
        """
        project_path = Path(f"/projects/{project.name}")

        # Check if directory exists
        if not project_path.exists() or not project_path.is_dir():
            return False

        # Check for code files
        for pattern in self.code_patterns:
            matches = list(project_path.rglob(pattern))
            if matches:
                # Found code files
                return True

        # Check for config files (stronger indicator)
        for pattern in self.config_patterns:
            matches = list(project_path.rglob(pattern))
            if matches:
                # Found config files
                return True

        # No code or config files found
        return False

    def get_project_info(self, project: Project) -> dict:
        """
        Get detailed information about project state.

        Useful for debugging and logging.

        Args:
            project: Project model instance

        Returns:
            Dict with state info
        """
        state = self.detect_state(project)
        has_stack = self._has_stack_configured(project)
        has_code = self._has_code_files(project)

        return {
            "state": state.value,
            "has_stack": has_stack,
            "has_code": has_code,
            "should_skip_stack_questions": self.should_skip_stack_questions(project),
            "stack_backend": project.stack_backend,
            "stack_database": project.stack_database,
            "stack_frontend": project.stack_frontend,
            "stack_mobile": project.stack_mobile,
        }
