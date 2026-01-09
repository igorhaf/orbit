"""
SpecWriter Service
Writes framework specifications to JSON files.
Handles Create, Update, Delete operations for Admin UI.

PROMPT #62 - Week 1 Day 5-6: Added support for project-specific specs
- create_project_spec(): Write specs to /app/specs/projects/{project_id}/
"""

import json
import logging
from pathlib import Path
from typing import Dict, Optional, List
from datetime import datetime
from uuid import UUID

from app.services.spec_loader import get_spec_loader, SpecData

logger = logging.getLogger(__name__)


class SpecWriter:
    """
    Writes specifications to JSON files

    Handles CRUD operations for specs via Admin UI:
    - Create: Write new spec JSON file
    - Update: Modify existing spec JSON file
    - Delete: Remove spec JSON file
    - Reload: Trigger SpecLoader cache refresh

    Directory structure:
        backend/specs/
        ├── backend/laravel/
        │   ├── controller.json
        │   └── ...
        └── ...

    Usage:
        writer = SpecWriter()

        # Create new spec
        writer.create_spec({
            "category": "backend",
            "name": "laravel",
            "spec_type": "service",
            "title": "Service Class",
            "content": "...",
            ...
        })

        # Update existing spec
        writer.update_spec("backend", "laravel", "controller", {
            "title": "Updated Controller",
            "content": "..."
        })

        # Delete spec
        writer.delete_spec("backend", "laravel", "controller")
    """

    def __init__(self, specs_dir: Optional[Path] = None):
        """
        Initialize SpecWriter

        Args:
            specs_dir: Path to specs directory (default: /app/specs in container)
        """
        if specs_dir is None:
            specs_dir = Path("/app/specs")

        self.specs_dir = Path(specs_dir)
        self.meta_dir = self.specs_dir / "_meta"

        logger.info(f"SpecWriter initialized with specs_dir: {self.specs_dir}")

    def _get_spec_file_path(self, category: str, name: str, spec_type: str) -> Path:
        """
        Get file path for a spec

        Args:
            category: Framework category (backend, frontend, database, css)
            name: Framework name (laravel, nextjs, postgresql, tailwind)
            spec_type: Spec type (controller, model, page, etc.)

        Returns:
            Path to spec JSON file
        """
        return self.specs_dir / category / name / f"{spec_type}.json"

    def _get_project_spec_file_path(self, project_id: UUID, category: str, spec_type: str) -> Path:
        """
        Get file path for a project-specific spec (PROMPT #62)

        Args:
            project_id: Project UUID
            category: Spec category (custom, service, component, etc.)
            spec_type: Spec type (api_endpoint, data_model, etc.)

        Returns:
            Path to project spec JSON file

        Example:
            /app/specs/projects/{project-uuid}/custom/api_endpoint.json
        """
        return self.specs_dir / "projects" / str(project_id) / category / f"{spec_type}.json"

    def create_spec(self, spec_data: Dict) -> bool:
        """
        Create a new spec JSON file

        Args:
            spec_data: Dictionary with spec data (must include: category, name,
                      spec_type, title, description, content, language)

        Returns:
            True if successful, False otherwise

        Raises:
            ValueError: If required fields are missing
            FileExistsError: If spec file already exists
        """
        # Validate required fields
        required_fields = ["category", "name", "spec_type", "title", "content", "language"]
        missing_fields = [f for f in required_fields if f not in spec_data]

        if missing_fields:
            raise ValueError(f"Missing required fields: {', '.join(missing_fields)}")

        category = spec_data["category"]
        name = spec_data["name"]
        spec_type = spec_data["spec_type"]

        # Get file path
        spec_file = self._get_spec_file_path(category, name, spec_type)

        # Check if file already exists
        if spec_file.exists():
            raise FileExistsError(f"Spec already exists: {category}/{name}/{spec_type}")

        # Create directory if needed
        spec_file.parent.mkdir(parents=True, exist_ok=True)

        # Build spec JSON structure
        now = datetime.utcnow().isoformat() + "Z"

        spec_json = {
            "id": f"{name}-{spec_type}",
            "category": category,
            "name": name,
            "spec_type": spec_type,
            "title": spec_data["title"],
            "description": spec_data.get("description", ""),
            "content": spec_data["content"],
            "language": spec_data["language"],
            "framework_version": spec_data.get("framework_version"),
            "ignore_patterns": spec_data.get("ignore_patterns", []),
            "file_extensions": spec_data.get("file_extensions", []),
            "is_active": spec_data.get("is_active", True),
            "metadata": {
                "created_at": now,
                "updated_at": now
            }
        }

        # Write JSON file
        try:
            with open(spec_file, 'w', encoding='utf-8') as f:
                json.dump(spec_json, f, indent=2, ensure_ascii=False)

            logger.info(f"✅ Created spec: {category}/{name}/{spec_type}")

            # Update frameworks.json count
            self._update_framework_count(category, name, increment=1)

            # Reload SpecLoader cache
            self._reload_cache()

            return True

        except Exception as e:
            logger.error(f"❌ Failed to create spec {category}/{name}/{spec_type}: {e}")
            # Clean up file if it was created
            if spec_file.exists():
                spec_file.unlink()
            raise

    def create_project_spec(self, spec_data: Dict, project_id: UUID) -> bool:
        """
        Create a project-specific spec JSON file (PROMPT #62)

        Project specs are stored separately from framework specs:
        /app/specs/projects/{project_id}/{category}/{spec_type}.json

        Args:
            spec_data: Dictionary with spec data (must include: category, name,
                      spec_type, title, description, content, language)
            project_id: Project UUID

        Returns:
            True if successful

        Raises:
            ValueError: If required fields are missing
            FileExistsError: If spec file already exists
        """
        # Validate required fields
        required_fields = ["category", "name", "spec_type", "title", "content", "language"]
        missing_fields = [f for f in required_fields if f not in spec_data]

        if missing_fields:
            raise ValueError(f"Missing required fields: {', '.join(missing_fields)}")

        category = spec_data["category"]
        spec_type = spec_data["spec_type"]

        # Get project spec file path
        spec_file = self._get_project_spec_file_path(project_id, category, spec_type)

        # Check if file already exists
        if spec_file.exists():
            raise FileExistsError(
                f"Project spec already exists: projects/{project_id}/{category}/{spec_type}"
            )

        # Create directory if needed
        spec_file.parent.mkdir(parents=True, exist_ok=True)

        # Build spec JSON structure (similar to framework specs)
        now = datetime.utcnow().isoformat() + "Z"

        spec_json = {
            "id": f"{spec_data['name']}-{spec_type}",
            "category": category,
            "name": spec_data["name"],
            "spec_type": spec_type,
            "title": spec_data["title"],
            "description": spec_data.get("description", ""),
            "content": spec_data["content"],
            "language": spec_data["language"],
            "framework_version": spec_data.get("framework_version"),
            "ignore_patterns": spec_data.get("ignore_patterns", []),
            "file_extensions": spec_data.get("file_extensions", []),
            "is_active": spec_data.get("is_active", True),
            "project_id": str(project_id),
            "scope": "project",
            "discovery_metadata": spec_data.get("discovery_metadata"),
            "metadata": {
                "created_at": now,
                "updated_at": now
            }
        }

        # Write JSON file
        try:
            with open(spec_file, 'w', encoding='utf-8') as f:
                json.dump(spec_json, f, indent=2, ensure_ascii=False)

            logger.info(f"✅ Created project spec: projects/{project_id}/{category}/{spec_type}")

            # Reload SpecLoader cache
            self._reload_cache()

            return True

        except Exception as e:
            logger.error(
                f"❌ Failed to create project spec "
                f"projects/{project_id}/{category}/{spec_type}: {e}"
            )
            # Clean up file if it was created
            if spec_file.exists():
                spec_file.unlink()
            raise

    def update_spec(
        self,
        category: str,
        name: str,
        spec_type: str,
        updates: Dict
    ) -> bool:
        """
        Update an existing spec JSON file

        Args:
            category: Framework category
            name: Framework name
            spec_type: Spec type
            updates: Dictionary with fields to update

        Returns:
            True if successful, False otherwise

        Raises:
            FileNotFoundError: If spec file doesn't exist
        """
        spec_file = self._get_spec_file_path(category, name, spec_type)

        if not spec_file.exists():
            raise FileNotFoundError(f"Spec not found: {category}/{name}/{spec_type}")

        try:
            # Read existing spec
            with open(spec_file, 'r', encoding='utf-8') as f:
                spec_json = json.load(f)

            # Update fields
            updatable_fields = [
                "title", "description", "content", "language",
                "framework_version", "ignore_patterns", "file_extensions", "is_active"
            ]

            for field in updatable_fields:
                if field in updates:
                    spec_json[field] = updates[field]

            # Update timestamp
            spec_json["metadata"]["updated_at"] = datetime.utcnow().isoformat() + "Z"

            # Write updated JSON
            with open(spec_file, 'w', encoding='utf-8') as f:
                json.dump(spec_json, f, indent=2, ensure_ascii=False)

            logger.info(f"✅ Updated spec: {category}/{name}/{spec_type}")

            # Reload SpecLoader cache
            self._reload_cache()

            return True

        except Exception as e:
            logger.error(f"❌ Failed to update spec {category}/{name}/{spec_type}: {e}")
            raise

    def delete_spec(self, category: str, name: str, spec_type: str) -> bool:
        """
        Delete a spec JSON file

        Args:
            category: Framework category
            name: Framework name
            spec_type: Spec type

        Returns:
            True if successful, False otherwise

        Raises:
            FileNotFoundError: If spec file doesn't exist
        """
        spec_file = self._get_spec_file_path(category, name, spec_type)

        if not spec_file.exists():
            raise FileNotFoundError(f"Spec not found: {category}/{name}/{spec_type}")

        try:
            # Delete file
            spec_file.unlink()

            logger.info(f"✅ Deleted spec: {category}/{name}/{spec_type}")

            # Update frameworks.json count
            self._update_framework_count(category, name, increment=-1)

            # Clean up empty directories
            if not list(spec_file.parent.iterdir()):
                spec_file.parent.rmdir()
                logger.info(f"   Removed empty directory: {spec_file.parent}")

            # Reload SpecLoader cache
            self._reload_cache()

            return True

        except Exception as e:
            logger.error(f"❌ Failed to delete spec {category}/{name}/{spec_type}: {e}")
            raise

    def _update_framework_count(self, category: str, name: str, increment: int) -> None:
        """
        Update spec count in frameworks.json

        Args:
            category: Framework category
            name: Framework name
            increment: Amount to increment (+1 for create, -1 for delete)
        """
        frameworks_file = self.meta_dir / "frameworks.json"

        try:
            if not frameworks_file.exists():
                logger.warning("frameworks.json not found, skipping count update")
                return

            with open(frameworks_file, 'r', encoding='utf-8') as f:
                frameworks_data = json.load(f)

            # Find and update framework
            for fw in frameworks_data.get("frameworks", []):
                if fw["category"] == category and fw["name"] == name:
                    fw["spec_count"] = max(0, fw.get("spec_count", 0) + increment)
                    break

            # Write updated frameworks.json
            with open(frameworks_file, 'w', encoding='utf-8') as f:
                json.dump(frameworks_data, f, indent=2, ensure_ascii=False)

            logger.debug(f"Updated framework count for {category}/{name}: {increment:+d}")

        except Exception as e:
            logger.error(f"Failed to update framework count: {e}")
            # Don't raise - this is not critical

    def _reload_cache(self) -> None:
        """Reload SpecLoader cache after write operations"""
        try:
            spec_loader = get_spec_loader()
            spec_loader.reload()
            logger.debug("SpecLoader cache reloaded")
        except Exception as e:
            logger.error(f"Failed to reload SpecLoader cache: {e}")
            # Don't raise - cache will be reloaded on next use


# Global instance (singleton pattern)
_spec_writer_instance: Optional[SpecWriter] = None


def get_spec_writer() -> SpecWriter:
    """
    Get global SpecWriter instance (singleton)

    Returns:
        SpecWriter instance

    Usage:
        from app.services.spec_writer import get_spec_writer

        writer = get_spec_writer()
        writer.create_spec({...})
    """
    global _spec_writer_instance

    if _spec_writer_instance is None:
        _spec_writer_instance = SpecWriter()

    return _spec_writer_instance
