from typing import Dict, List
from app.orchestrators.registry import OrchestratorRegistry
from sqlalchemy.orm import Session
import logging

logger = logging.getLogger(__name__)

class TaskDecomposer:
    """
    Decompõe spec em tasks atômicas usando orquestrador especializado
    """

    def __init__(self, db: Session):
        self.db = db

    def decompose(
        self,
        stack_key: str,
        spec: Dict
    ) -> List[Dict]:
        """
        Decompõe spec em tasks (3-5k tokens cada)
        """

        # Pega orquestrador
        orchestrator = OrchestratorRegistry.get_orchestrator(stack_key)

        logger.info(f"Decomposing spec for {orchestrator.stack_name}...")

        # Usa método de decomposição especializado
        tasks = orchestrator.decompose_spec(spec)

        logger.info(f"✅ Generated {len(tasks)} tasks")

        return tasks
