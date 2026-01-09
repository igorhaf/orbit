"""
Orchestrators package
Cada orquestrador é especialista em uma stack específica
"""

from .base import StackOrchestrator
from .registry import OrchestratorRegistry

__all__ = ['StackOrchestrator', 'OrchestratorRegistry']
