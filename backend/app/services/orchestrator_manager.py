"""
OrchestratorManager Service
Manages dynamic loading and registration of custom orchestrators
"""

import logging
import importlib.util
import sys
from pathlib import Path
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session

from app.models.project_analysis import ProjectAnalysis
from app.orchestrators.registry import OrchestratorRegistry
from app.config import settings

logger = logging.getLogger(__name__)


class OrchestratorManager:
    """
    Manages lifecycle of custom orchestrators
    """

    def __init__(self, db: Session):
        self.db = db
        self.orchestrators_dir = Path(settings.generated_orchestrators_dir)

    async def register_from_analysis(self, analysis_id: str) -> Dict[str, Any]:
        """
        Load and register orchestrator from ProjectAnalysis

        Args:
            analysis_id: UUID of ProjectAnalysis

        Returns:
            {
                "success": true,
                "orchestrator_key": "...",
                "message": "..."
            }
        """

        # Find analysis
        analysis = self.db.query(ProjectAnalysis).filter(
            ProjectAnalysis.id == analysis_id
        ).first()

        if not analysis:
            raise ValueError(f"Analysis not found: {analysis_id}")

        if not analysis.orchestrator_generated:
            raise ValueError("Orchestrator not yet generated for this analysis")

        if not analysis.orchestrator_key:
            raise ValueError("Orchestrator key missing")

        if not analysis.orchestrator_code:
            raise ValueError("Orchestrator code missing")

        # Get file path
        file_path = self.orchestrators_dir / f"{analysis.orchestrator_key}.py"

        if not file_path.exists():
            # Try to recreate from stored code
            file_path.write_text(analysis.orchestrator_code, encoding="utf-8")

        # Load and register
        try:
            self._load_orchestrator_from_file(
                file_path,
                analysis.orchestrator_key
            )

            logger.info(f"Registered orchestrator: {analysis.orchestrator_key}")

            return {
                "success": True,
                "orchestrator_key": analysis.orchestrator_key,
                "message": f"Orchestrator '{analysis.orchestrator_key}' registered successfully"
            }

        except Exception as e:
            logger.error(f"Failed to register orchestrator: {e}")
            raise ValueError(f"Failed to register orchestrator: {str(e)}")

    def _load_orchestrator_from_file(self, file_path: Path, orchestrator_key: str):
        """
        Dynamically load Python orchestrator from file

        Uses importlib to load module and extract orchestrator class
        """

        try:
            # Load module dynamically
            spec = importlib.util.spec_from_file_location(
                f"custom_orchestrators.{orchestrator_key}",
                file_path
            )

            if not spec or not spec.loader:
                raise ImportError(f"Failed to load spec from {file_path}")

            module = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = module
            spec.loader.exec_module(module)

            # Find orchestrator class (should end with "Orchestrator")
            orchestrator_class = None
            for attr_name in dir(module):
                attr = getattr(module, attr_name)
                if (isinstance(attr, type) and
                    attr_name.endswith("Orchestrator") and
                    attr_name != "StackOrchestrator"):
                    orchestrator_class = attr
                    break

            if not orchestrator_class:
                raise ImportError("No orchestrator class found in module")

            # Register in registry
            OrchestratorRegistry.register(orchestrator_key, orchestrator_class)

            logger.info(f"Loaded orchestrator: {orchestrator_key} ({orchestrator_class.__name__})")

        except Exception as e:
            logger.error(f"Failed to load orchestrator from {file_path}: {e}")
            raise

    async def reload_all_custom_orchestrators(self) -> Dict[str, Any]:
        """
        Reload all generated orchestrators on startup

        Scans database for orchestrators and loads them

        Returns:
            {
                "loaded": 5,
                "failed": 1,
                "orchestrator_keys": [...]
            }
        """

        logger.info("Reloading all custom orchestrators...")

        # Find all analyses with generated orchestrators
        analyses = self.db.query(ProjectAnalysis).filter(
            ProjectAnalysis.orchestrator_generated == True,
            ProjectAnalysis.orchestrator_key.isnot(None)
        ).all()

        loaded = []
        failed = []

        for analysis in analyses:
            try:
                file_path = self.orchestrators_dir / f"{analysis.orchestrator_key}.py"

                # Recreate file if missing
                if not file_path.exists() and analysis.orchestrator_code:
                    file_path.write_text(analysis.orchestrator_code, encoding="utf-8")

                if file_path.exists():
                    self._load_orchestrator_from_file(file_path, analysis.orchestrator_key)
                    loaded.append(analysis.orchestrator_key)
                else:
                    logger.warning(f"Orchestrator file missing: {analysis.orchestrator_key}")
                    failed.append(analysis.orchestrator_key)

            except Exception as e:
                logger.error(f"Failed to load orchestrator {analysis.orchestrator_key}: {e}")
                failed.append(analysis.orchestrator_key)

        result = {
            "loaded": len(loaded),
            "failed": len(failed),
            "orchestrator_keys": loaded
        }

        logger.info(f"Loaded {len(loaded)} orchestrators, {len(failed)} failed")

        return result

    async def unregister(self, orchestrator_key: str) -> Dict[str, Any]:
        """
        Unregister an orchestrator

        Args:
            orchestrator_key: Key of orchestrator to unregister

        Returns:
            {
                "success": true,
                "message": "..."
            }
        """

        try:
            OrchestratorRegistry.unregister(orchestrator_key)

            logger.info(f"Unregistered orchestrator: {orchestrator_key}")

            return {
                "success": True,
                "message": f"Orchestrator '{orchestrator_key}' unregistered"
            }

        except Exception as e:
            logger.error(f"Failed to unregister orchestrator: {e}")
            raise ValueError(f"Failed to unregister: {str(e)}")
