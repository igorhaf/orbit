"""
ContextGeneratorService - Main facade class.

Composes all context generation functionality via mixins:
- ContextInterviewMixin: Context interview processing and locking
- BusinessRulesMixin: Business rule classification into Epic > Story
- CardActivatorMixin: Epic/Story/Task/Subtask activation with rich content
- DraftGeneratorMixin: Draft generation, batch processing, incremental epics

Extracted from monolithic context_generator.py during modularization (PROMPT #249).
"""

from sqlalchemy.orm import Session
import logging

from app.services.ai_orchestrator import AIOrchestrator
# PROMPT #164 - PrompterFacade is deprecated, graceful fallback to AIOrchestrator
try:
    from app.prompter.facade import PrompterFacade
    PROMPTER_AVAILABLE = True
except ImportError:
    PROMPTER_AVAILABLE = False
    PrompterFacade = None
from app.prompts import get_prompt_service

from .context_interview import ContextInterviewMixin
from .business_rules import BusinessRulesMixin
from .card_activator import CardActivatorMixin
from .draft_generator import DraftGeneratorMixin

logger = logging.getLogger(__name__)


class ContextGeneratorService(
    ContextInterviewMixin,
    BusinessRulesMixin,
    CardActivatorMixin,
    DraftGeneratorMixin,
):
    """
    Service for generating project context, business rule cards,
    and hierarchical card activation.

    Composes functionality from focused mixin modules.
    """

    def __init__(self, db: Session):
        self.db = db
        # PROMPT #164 - PrompterFacade deprecated, graceful fallback
        if PROMPTER_AVAILABLE and PrompterFacade:
            try:
                self.prompter = PrompterFacade(db)
            except RuntimeError:
                self.prompter = None
        else:
            self.prompter = None
        self.orchestrator = AIOrchestrator(db)
        # PROMPT #103 - Use PromptService for external prompts
        self.prompt_service = get_prompt_service(db)
