from typing import Dict, Type
from .base import StackOrchestrator
from .php_mysql import PHPMySQLOrchestrator
from .nextjs_postgres import NextPostgresOrchestrator

class OrchestratorRegistry:
    """Registry central de orquestradores disponíveis"""

    _orchestrators: Dict[str, Type[StackOrchestrator]] = {
        "php_mysql": PHPMySQLOrchestrator,
        "nextjs_postgres": NextPostgresOrchestrator,
    }

    @classmethod
    def get_orchestrator(cls, stack_key: str) -> StackOrchestrator:
        """
        Retorna instância do orquestrador

        Raises:
            ValueError: Se stack não existe
        """
        if stack_key not in cls._orchestrators:
            available = ", ".join(cls._orchestrators.keys())
            raise ValueError(
                f"Orchestrator '{stack_key}' not found. "
                f"Available: {available}"
            )

        orchestrator_class = cls._orchestrators[stack_key]
        return orchestrator_class()

    @classmethod
    def list_available(cls) -> Dict[str, Dict[str, str]]:
        """Lista orquestradores disponíveis com metadados"""
        result = {}

        for key, orchestrator_class in cls._orchestrators.items():
            instance = orchestrator_class()
            result[key] = {
                "name": instance.stack_name,
                "description": instance.stack_description,
                "version": instance.version
            }

        return result

    @classmethod
    def register(cls, key: str, orchestrator_class: Type[StackOrchestrator]):
        """
        Registra novo orquestrador dinamicamente
        Útil para plugins/extensões
        """
        cls._orchestrators[key] = orchestrator_class

    @classmethod
    def unregister(cls, key: str):
        """
        Remove orquestrador do registro

        Args:
            key: Chave do orquestrador a remover

        Raises:
            ValueError: Se orquestrador não existe
        """
        if key not in cls._orchestrators:
            raise ValueError(f"Orchestrator '{key}' not found in registry")

        del cls._orchestrators[key]
