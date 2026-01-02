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
        self.scripts_dir = Path(__file__).parent.parent.parent / "scripts"
        # Projects created in /projects/ which is mounted from ./projects/ on host
        # Docker volume: ./projects:/projects → projects go to /projects/ (host: ./projects/)
        self.projects_dir = Path("/projects")

    def get_provisioning_scripts(self, stack: Dict[str, str]) -> list[str]:
        """
        Determine which provisioning scripts to run based on stack configuration

        New Architecture (PROMPT #51):
        - Each technology has its own script
        - Scripts are executed in sequence
        - Tailwind is handled within Next.js script (component, not service)

        Args:
            stack: Stack configuration dict with backend, database, frontend, css

        Returns:
            List of script filenames to execute in order
        """
        scripts = []

        backend = stack.get("backend", "").lower()
        frontend = stack.get("frontend", "").lower()
        database = stack.get("database", "").lower()
        css = stack.get("css", "").lower()

        # Validate supported stack
        if backend != "laravel" or frontend != "nextjs" or database != "postgresql":
            logger.warning(
                f"Unsupported stack combination: {stack}. "
                f"Only Laravel + Next.js + PostgreSQL is currently supported."
            )
            return []

        # Tailwind is a component of frontend, not a separate service
        # It's installed automatically by nextjs_setup.sh
        if css != "tailwind":
            logger.warning(
                f"CSS framework '{css}' not supported. Only Tailwind CSS is supported (installed with Next.js)."
            )

        # Scripts executed in order:
        # 1. Laravel backend
        scripts.append("laravel_setup.sh")

        # 2. Next.js frontend (includes Tailwind installation)
        scripts.append("nextjs_setup.sh")

        # 3. Docker configuration
        scripts.append("docker_setup.sh")

        logger.info(f"Provisioning scripts for {stack}: {scripts}")
        return scripts

    def provision_project(self, project: Project) -> Dict[str, any]:
        """
        Provision a project based on its stack configuration

        New Architecture (PROMPT #51):
        - Executes multiple scripts in sequence (Laravel, Next.js, Docker)
        - Each script creates its own folder (backend/, frontend/, devops/)
        - Aggregates outputs from all scripts

        Args:
            project: Project model instance with stack configuration

        Returns:
            Dict with provisioning results

        Raises:
            ValueError: If stack is not set or scripts not found
        """
        # Validate stack exists
        if not project.stack:
            raise ValueError(f"Project {project.id} has no stack configuration set")

        # Get scripts to execute
        script_names = self.get_provisioning_scripts(project.stack)
        if not script_names:
            raise ValueError(
                f"No provisioning scripts available for stack: {project.stack}"
            )

        # Ensure projects directory exists
        self.projects_dir.mkdir(parents=True, exist_ok=True)

        # Use project folder from database (already sanitized and stored)
        if not project.project_folder:
            raise ValueError(
                f"Project '{project.name}' has no folder path defined in database"
            )

        project_name = project.project_folder
        project_path = self.projects_dir / project_name

        # Check if project folder exists (it should, created during project creation)
        if not project_path.exists():
            logger.error(f"Project directory not found: {project_path}")
            # Create it if missing (fallback)
            project_path.mkdir(parents=True, exist_ok=True)
            logger.info(f"Created missing project directory: {project_path}")

        # Execute all provisioning scripts in sequence
        logger.info(f"Provisioning project '{project_name}' with {len(script_names)} scripts")

        all_outputs = []
        credentials = {}

        try:
            for script_name in script_names:
                script_path = self.scripts_dir / script_name

                # Validate script exists
                if not script_path.exists():
                    raise FileNotFoundError(
                        f"Provisioning script not found: {script_path}"
                    )

                logger.info(f"Executing script: {script_name}")

                # Execute from backend root (/app/) so scripts can access files
                backend_root = self.scripts_dir.parent  # /app/scripts -> /app/

                result = subprocess.run(
                    [str(script_path), project_name],
                    cwd=backend_root,
                    capture_output=True,
                    text=True,
                    timeout=300,  # 5 minutes timeout per script
                    check=True
                )

                logger.info(f"✓ Script '{script_name}' completed successfully")
                logger.debug(f"Script output:\n{result.stdout}")

                all_outputs.append(f"=== {script_name} ===\n{result.stdout}")

                # Parse credentials from script output
                script_credentials = self._parse_credentials(result.stdout)
                credentials.update(script_credentials)

            # All scripts succeeded
            combined_output = "\n\n".join(all_outputs)

            return {
                "success": True,
                "project_name": project_name,
                "project_path": str(project_path),
                "scripts_executed": script_names,
                "stack": project.stack,
                "credentials": credentials,
                "next_steps": [
                    f"cd projects/{project_name}",
                    "docker-compose up -d",
                    "docker-compose exec backend php artisan migrate"
                ],
                "output": combined_output
            }

        except subprocess.CalledProcessError as e:
            logger.error(f"✗ Provisioning failed during {script_name}: {e.stderr}")
            return {
                "success": False,
                "error": f"Script '{script_name}' failed: {e.stderr}",
                "output": e.stdout,
                "returncode": e.returncode
            }

        except subprocess.TimeoutExpired:
            logger.error(f"✗ Script '{script_name}' timeout after 5 minutes")
            return {
                "success": False,
                "error": f"Script '{script_name}' timeout (exceeded 5 minutes)",
            }

        except FileNotFoundError as e:
            logger.error(f"✗ {e}")
            return {
                "success": False,
                "error": str(e)
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
            if key not in stack or stack[key] is None or not stack[key]:
                return False, (
                    f"Automatic provisioning skipped - '{key}' not specified. "
                    f"User can provision manually or restart interview with stack choices."
                )

        # Check if stack has provisioning scripts
        scripts = self.get_provisioning_scripts(stack)
        if not scripts:
            return False, (
                f"Stack combination not supported for provisioning: {stack}. "
                f"Supported: Laravel + Next.js + PostgreSQL + Tailwind"
            )

        # Check if technologies exist in specs
        # Allow "none" as valid value for backend/frontend (means no backend/frontend)
        available = self.get_available_stacks()

        for key, value in stack.items():
            # Skip validation for "none" - it's a valid special value
            if value.lower() == "none":
                continue

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
