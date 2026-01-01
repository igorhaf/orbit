"""
Project Provisioning Service

Automatically creates project scaffolding based on stack configuration
from interview responses. Uses specs from database to determine which
technologies to provision.

PROMPT #59 - Automated Project Provisioning
"""

import os
import subprocess
import logging
from typing import Dict, Optional
from pathlib import Path
from sqlalchemy.orm import Session

from app.models.project import Project
from app.models.spec import Spec

logger = logging.getLogger(__name__)


class ProvisioningService:
    """
    Service for provisioning projects based on stack configuration
    """

    def __init__(self, db: Session):
        self.db = db
        self.scripts_dir = Path(__file__).parent.parent.parent / "provisioning"
        self.projects_dir = Path(__file__).parent.parent.parent.parent / "projects"

    def get_provisioning_script(self, stack: Dict[str, str]) -> Optional[str]:
        """
        Determine which provisioning script to use based on stack configuration

        Args:
            stack: Stack configuration dict with backend, database, frontend, css

        Returns:
            Script filename or None if no matching script
        """
        backend = stack.get("backend", "").lower()
        frontend = stack.get("frontend", "").lower()
        database = stack.get("database", "").lower()

        # Laravel stack
        if backend == "laravel" and database == "postgresql":
            return "laravel_setup.sh"

        # Next.js stack
        elif frontend == "nextjs" and database == "postgresql":
            return "nextjs_setup.sh"

        # FastAPI + React stack
        elif backend == "fastapi" and frontend == "react" and database == "postgresql":
            return "fastapi_react_setup.sh"

        # FastAPI + Next.js (use Next.js script with API integration)
        elif backend == "fastapi" and frontend == "nextjs" and database == "postgresql":
            return "nextjs_setup.sh"  # Can be extended to integrate FastAPI

        else:
            logger.warning(
                f"No provisioning script found for stack: {stack}. "
                f"Supported combinations: Laravel+PostgreSQL, Next.js+PostgreSQL, FastAPI+React+PostgreSQL"
            )
            return None

    def provision_project(self, project: Project) -> Dict[str, any]:
        """
        Provision a project based on its stack configuration

        Args:
            project: Project model instance with stack configuration

        Returns:
            Dict with provisioning results

        Raises:
            ValueError: If stack is not set or script not found
            subprocess.CalledProcessError: If provisioning script fails
        """
        # Validate stack exists
        if not project.stack:
            raise ValueError(f"Project {project.id} has no stack configuration set")

        # Get script
        script_name = self.get_provisioning_script(project.stack)
        if not script_name:
            raise ValueError(
                f"No provisioning script available for stack: {project.stack}"
            )

        script_path = self.scripts_dir / script_name

        # Validate script exists
        if not script_path.exists():
            raise FileNotFoundError(
                f"Provisioning script not found: {script_path}"
            )

        # Ensure projects directory exists
        self.projects_dir.mkdir(parents=True, exist_ok=True)

        # Project name (sanitized)
        project_name = self._sanitize_project_name(project.name)
        project_path = self.projects_dir / project_name

        # Check if project already exists
        if project_path.exists():
            logger.warning(f"Project directory already exists: {project_path}")
            return {
                "success": False,
                "error": f"Project directory '{project_name}' already exists",
                "project_path": str(project_path),
            }

        # Execute provisioning script
        logger.info(f"Provisioning project '{project_name}' with script: {script_name}")

        try:
            result = subprocess.run(
                [str(script_path), project_name],
                cwd=self.scripts_dir,
                capture_output=True,
                text=True,
                timeout=300,  # 5 minutes timeout
                check=True
            )

            logger.info(f"✓ Project '{project_name}' provisioned successfully")
            logger.debug(f"Script output:\n{result.stdout}")

            # Parse credentials from script output (if available)
            credentials = self._parse_credentials(result.stdout)

            return {
                "success": True,
                "project_name": project_name,
                "project_path": str(project_path),
                "script_used": script_name,
                "stack": project.stack,
                "credentials": credentials,
                "next_steps": [
                    f"cd projects/{project_name}",
                    "./setup.sh"
                ],
                "output": result.stdout
            }

        except subprocess.CalledProcessError as e:
            logger.error(f"✗ Provisioning failed: {e.stderr}")
            return {
                "success": False,
                "error": f"Provisioning script failed: {e.stderr}",
                "output": e.stdout,
                "returncode": e.returncode
            }

        except subprocess.TimeoutExpired:
            logger.error(f"✗ Provisioning timeout after 5 minutes")
            return {
                "success": False,
                "error": "Provisioning script timeout (exceeded 5 minutes)",
            }

        except Exception as e:
            logger.error(f"✗ Unexpected error during provisioning: {e}")
            return {
                "success": False,
                "error": f"Unexpected error: {str(e)}"
            }

    def get_available_stacks(self) -> Dict[str, list]:
        """
        Get available technology stacks from specs database

        Returns:
            Dict with available technologies by category
        """
        categories = ["backend", "frontend", "database", "css"]
        available = {}

        for category in categories:
            specs = self.db.query(Spec.name).filter(
                Spec.category == category,
                Spec.is_active == True
            ).distinct().all()

            available[category] = [spec[0] for spec in specs]

        return available

    def validate_stack(self, stack: Dict[str, str]) -> tuple[bool, Optional[str]]:
        """
        Validate if stack configuration is supported

        Args:
            stack: Stack configuration dict

        Returns:
            Tuple of (is_valid, error_message)
        """
        required_keys = ["backend", "database", "frontend", "css"]

        # Check required keys
        for key in required_keys:
            if key not in stack or not stack[key]:
                return False, f"Missing required key: {key}"

        # Check if stack has a provisioning script
        script = self.get_provisioning_script(stack)
        if not script:
            return False, (
                f"Stack combination not supported for provisioning: {stack}. "
                f"Supported: Laravel+PostgreSQL, Next.js+PostgreSQL, FastAPI+React+PostgreSQL"
            )

        # Check if technologies exist in specs
        available = self.get_available_stacks()

        for key, value in stack.items():
            if value.lower() not in available.get(key, []):
                return False, f"Technology '{value}' not found in {key} specs"

        return True, None

    def _sanitize_project_name(self, name: str) -> str:
        """
        Sanitize project name for filesystem

        Args:
            name: Original project name

        Returns:
            Sanitized name (lowercase, alphanumeric + hyphens)
        """
        import re
        # Convert to lowercase
        name = name.lower()
        # Replace spaces and underscores with hyphens
        name = re.sub(r'[\s_]+', '-', name)
        # Remove any character that's not alphanumeric or hyphen
        name = re.sub(r'[^a-z0-9\-]', '', name)
        # Remove consecutive hyphens
        name = re.sub(r'-+', '-', name)
        # Remove leading/trailing hyphens
        name = name.strip('-')
        return name or "project"

    def _parse_credentials(self, output: str) -> Dict[str, str]:
        """
        Parse database credentials from script output

        Args:
            output: Script stdout

        Returns:
            Dict with parsed credentials
        """
        credentials = {}

        # Simple parsing - look for key patterns
        import re

        # Database name
        match = re.search(r'Database:\s*(\w+)', output)
        if match:
            credentials['database'] = match.group(1)

        # Username
        match = re.search(r'User(?:name)?:\s*(\w+)', output)
        if match:
            credentials['username'] = match.group(1)

        # Password
        match = re.search(r'Password:\s*(\S+)', output)
        if match:
            credentials['password'] = match.group(1)

        # Ports
        for service in ['Application', 'Database', 'Adminer', 'Frontend', 'Backend']:
            match = re.search(rf'{service}:\s*(\d+)', output)
            if match:
                credentials[f'{service.lower()}_port'] = match.group(1)

        return credentials


def get_provisioning_service(db: Session) -> ProvisioningService:
    """
    Factory function to get ProvisioningService instance

    Args:
        db: Database session

    Returns:
        ProvisioningService instance
    """
    return ProvisioningService(db)
