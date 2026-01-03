"""
SpecLoader Service
Loads framework specifications from JSON files instead of database.
Implements in-memory caching for performance (<1ms warm, 50-80ms cold).
"""

import json
import logging
from pathlib import Path
from typing import List, Dict, Optional, Set
from datetime import datetime
from functools import lru_cache

logger = logging.getLogger(__name__)


class SpecData:
    """
    Spec data structure (mirrors database Spec model fields)
    Used to maintain compatibility with existing code
    """
    def __init__(self, data: dict):
        self.id = data.get("id")
        self.category = data.get("category")
        self.name = data.get("name")
        self.spec_type = data.get("spec_type")
        self.title = data.get("title")
        self.description = data.get("description")
        self.content = data.get("content")
        self.language = data.get("language")
        self.framework_version = data.get("framework_version")
        self.ignore_patterns = data.get("ignore_patterns", [])
        self.file_extensions = data.get("file_extensions", [])
        self.is_active = data.get("is_active", True)

        # Metadata
        metadata = data.get("metadata", {})
        self.created_at = self._parse_datetime(metadata.get("created_at"))
        self.updated_at = self._parse_datetime(metadata.get("updated_at"))

        # Not in JSON, but needed for compatibility
        self.usage_count = 0  # Will be tracked separately if needed

    def _parse_datetime(self, dt_string: Optional[str]) -> Optional[datetime]:
        """Parse ISO datetime string"""
        if not dt_string:
            return None
        try:
            # Remove 'Z' and parse
            if dt_string.endswith('Z'):
                dt_string = dt_string[:-1]
            return datetime.fromisoformat(dt_string)
        except Exception as e:
            logger.warning(f"Failed to parse datetime '{dt_string}': {e}")
            return None

    def __repr__(self) -> str:
        return f"<SpecData(id='{self.id}', category='{self.category}', name='{self.name}', type='{self.spec_type}')>"


class SpecLoader:
    """
    Loads specifications from JSON files with in-memory caching

    Directory structure:
        backend/specs/
        ├── _meta/
        │   ├── frameworks.json
        │   ├── schema.json
        │   └── frameworks-schema.json
        ├── backend/laravel/
        │   ├── controller.json
        │   ├── model.json
        │   └── ...
        ├── frontend/nextjs/
        │   ├── page.json
        │   └── ...
        ├── database/postgresql/
        │   └── ...
        └── css/tailwind/
            └── ...

    Usage:
        loader = SpecLoader()

        # Load all specs for Laravel
        specs = loader.get_specs_by_framework('backend', 'laravel')

        # Load selective specs (Phase 4)
        specs = loader.get_specs_by_types('frontend', 'nextjs', ['page', 'layout', 'api_route'])

        # Get frameworks metadata
        frameworks = loader.get_frameworks()
    """

    def __init__(self, specs_dir: Optional[Path] = None):
        """
        Initialize SpecLoader

        Args:
            specs_dir: Path to specs directory (default: /app/specs in container)
        """
        if specs_dir is None:
            # Default to /app/specs in container
            specs_dir = Path("/app/specs")

        self.specs_dir = Path(specs_dir)
        self.meta_dir = self.specs_dir / "_meta"

        # Cache
        self._specs_cache: Dict[str, SpecData] = {}
        self._frameworks_cache: Optional[Dict] = None
        self._cache_loaded = False

        logger.info(f"SpecLoader initialized with specs_dir: {self.specs_dir}")

    def _load_all_specs(self) -> None:
        """
        Load all specs into cache
        Called automatically on first use
        """
        if self._cache_loaded:
            return

        logger.info("Loading all specs from JSON files...")
        start_time = datetime.now()

        spec_count = 0

        # Iterate through category directories
        for category_dir in self.specs_dir.iterdir():
            if not category_dir.is_dir() or category_dir.name == "_meta":
                continue

            category = category_dir.name

            # Iterate through framework directories
            for framework_dir in category_dir.iterdir():
                if not framework_dir.is_dir():
                    continue

                framework_name = framework_dir.name

                # Load all JSON spec files
                for spec_file in framework_dir.glob("*.json"):
                    try:
                        with open(spec_file, 'r', encoding='utf-8') as f:
                            spec_data = json.load(f)

                        # Create SpecData object
                        spec = SpecData(spec_data)

                        # Cache by composite key
                        cache_key = f"{spec.category}:{spec.name}:{spec.spec_type}"
                        self._specs_cache[cache_key] = spec

                        spec_count += 1
                    except Exception as e:
                        logger.error(f"Failed to load spec from {spec_file}: {e}")

        self._cache_loaded = True
        elapsed = (datetime.now() - start_time).total_seconds() * 1000

        logger.info(f"✅ Loaded {spec_count} specs in {elapsed:.2f}ms")

    def _ensure_cache_loaded(self) -> None:
        """Ensure specs cache is loaded"""
        if not self._cache_loaded:
            self._load_all_specs()

    def get_specs_by_framework(
        self,
        category: str,
        name: str,
        only_active: bool = True
    ) -> List[SpecData]:
        """
        Get all specs for a specific framework

        Used by Phase 3 (Prompt Generation) to load all specs for a framework.

        Args:
            category: Framework category (backend, frontend, database, css)
            name: Framework name (laravel, nextjs, postgresql, tailwind)
            only_active: Filter by is_active flag (default: True)

        Returns:
            List of SpecData objects

        Example:
            # Get all Laravel specs
            specs = loader.get_specs_by_framework('backend', 'laravel')
        """
        self._ensure_cache_loaded()

        specs = []
        prefix = f"{category}:{name}:"

        for cache_key, spec in self._specs_cache.items():
            if cache_key.startswith(prefix):
                if only_active and not spec.is_active:
                    continue
                specs.append(spec)

        logger.debug(f"Loaded {len(specs)} specs for {category}/{name}")
        return specs

    def get_specs_by_types(
        self,
        category: str,
        name: str,
        spec_types: List[str],
        only_active: bool = True
    ) -> List[SpecData]:
        """
        Get selective specs by type

        Used by Phase 4 (Task Execution) to load only needed specs based on keywords.

        Args:
            category: Framework category
            name: Framework name
            spec_types: List of spec types to load (e.g., ['controller', 'model'])
            only_active: Filter by is_active flag (default: True)

        Returns:
            List of SpecData objects

        Example:
            # Get only controller and model specs for Laravel
            specs = loader.get_specs_by_types('backend', 'laravel', ['controller', 'model'])
        """
        self._ensure_cache_loaded()

        specs = []
        spec_types_set = set(spec_types)

        for spec_type in spec_types_set:
            cache_key = f"{category}:{name}:{spec_type}"
            spec = self._specs_cache.get(cache_key)

            if spec:
                if only_active and not spec.is_active:
                    continue
                specs.append(spec)

        logger.debug(f"Loaded {len(specs)} selective specs for {category}/{name} (types: {spec_types})")
        return specs

    def get_spec(
        self,
        category: str,
        name: str,
        spec_type: str
    ) -> Optional[SpecData]:
        """
        Get a single spec by exact match

        Args:
            category: Framework category
            name: Framework name
            spec_type: Spec type

        Returns:
            SpecData object or None if not found

        Example:
            spec = loader.get_spec('backend', 'laravel', 'controller')
        """
        self._ensure_cache_loaded()

        cache_key = f"{category}:{name}:{spec_type}"
        return self._specs_cache.get(cache_key)

    def get_frameworks(self) -> Dict:
        """
        Get frameworks metadata from frameworks.json

        Returns:
            Dictionary with frameworks metadata

        Example:
            frameworks = loader.get_frameworks()
            # {
            #   "frameworks": [
            #     {
            #       "category": "backend",
            #       "name": "laravel",
            #       "display_name": "Laravel (PHP)",
            #       ...
            #     },
            #     ...
            #   ]
            # }
        """
        if self._frameworks_cache is not None:
            return self._frameworks_cache

        frameworks_file = self.meta_dir / "frameworks.json"

        try:
            with open(frameworks_file, 'r', encoding='utf-8') as f:
                self._frameworks_cache = json.load(f)

            logger.debug(f"Loaded frameworks metadata ({len(self._frameworks_cache['frameworks'])} frameworks)")
            return self._frameworks_cache
        except Exception as e:
            logger.error(f"Failed to load frameworks metadata: {e}")
            return {"frameworks": []}

    def get_spec_count(self) -> int:
        """
        Get total number of specs loaded

        Returns:
            Total spec count
        """
        self._ensure_cache_loaded()
        return len(self._specs_cache)

    def reload(self) -> None:
        """
        Force reload all specs from files
        Useful after specs are modified
        """
        logger.info("Reloading all specs from JSON files...")
        self._specs_cache = {}
        self._frameworks_cache = None
        self._cache_loaded = False
        self._load_all_specs()

    def get_cache_stats(self) -> Dict:
        """
        Get cache statistics

        Returns:
            Dictionary with cache stats
        """
        return {
            "specs_loaded": len(self._specs_cache),
            "cache_loaded": self._cache_loaded,
            "frameworks_loaded": self._frameworks_cache is not None
        }


# Global instance (singleton pattern)
_spec_loader_instance: Optional[SpecLoader] = None


def get_spec_loader() -> SpecLoader:
    """
    Get global SpecLoader instance (singleton)

    Returns:
        SpecLoader instance

    Usage:
        from app.services.spec_loader import get_spec_loader

        loader = get_spec_loader()
        specs = loader.get_specs_by_framework('backend', 'laravel')
    """
    global _spec_loader_instance

    if _spec_loader_instance is None:
        _spec_loader_instance = SpecLoader()

    return _spec_loader_instance
