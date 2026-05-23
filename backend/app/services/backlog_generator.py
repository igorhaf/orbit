"""
BacklogGeneratorService
AI-powered backlog generation (Epic -> Story -> Task decomposition)
JIRA Transformation - Phase 2

This module is the main entry point. The service is composed via mixins:
- StoryGenerationMixin  (backlog_stories.py)  -> decompose_epic_to_stories
- TaskGenerationMixin   (backlog_tasks.py)    -> decompose_story_to_tasks, generate_task_from_interview_direct

Utility functions live in backlog_utils.py.
"""

from typing import Dict, List, Optional
from uuid import UUID
from sqlalchemy.orm import Session
import json
import logging

from app.models.task import Task, ItemType, PriorityLevel, TaskStatus
from app.models.interview import Interview
from app.models.spec import Spec, SpecScope
from app.models.project import Project
from app.services.ai_orchestrator import AIOrchestrator
from app.contracts.loader import ContractLoader
from app.prompts import PromptService, get_prompt_service
from app.services.rag_service import RAGService

# Import mixins
from app.services.backlog_stories import StoryGenerationMixin
from app.services.backlog_tasks import TaskGenerationMixin

# Import utility functions and re-export for backward compatibility
from app.services.backlog_utils import (
    get_business_rules_context as _get_business_rules_context_impl,
    strip_markdown_json as _strip_markdown_json_impl,
    convert_semantic_to_human as _convert_semantic_to_human_impl,
    format_conversation,
    build_specs_context,
    build_task_generation_prompt,
    format_conversation_for_task,
    parse_priority,
)

logger = logging.getLogger(__name__)


# Backward-compatible module-level aliases (some external code imports these directly)
def _get_business_rules_context(db: "Session", project_id: UUID, max_rules: int = 15) -> str:
    return _get_business_rules_context_impl(db, project_id, max_rules)


def _strip_markdown_json(content: str) -> str:
    return _strip_markdown_json_impl(content)


def _convert_semantic_to_human(semantic_markdown: str, semantic_map: Dict[str, str]) -> str:
    return _convert_semantic_to_human_impl(semantic_markdown, semantic_map)


class BacklogGeneratorService(StoryGenerationMixin, TaskGenerationMixin):
    """Service for AI-powered backlog generation with user approval"""

    def __init__(self, db: Session):
        self.db = db
        # PROMPT #164 - PrompterFacade removed; AIOrchestrator handles caching/RAG/everything
        self.orchestrator = AIOrchestrator(db)
        # PROMPT #103 - Use PromptService for external prompts
        self.prompt_service = get_prompt_service(db)
        # PROMPT #258 - ContractLoader for externalized prompts
        self._contract_loader = ContractLoader(db)

    async def generate_epic_from_interview(
        self,
        interview_id: UUID,
        project_id: UUID
    ) -> Dict:
        """
        Generate Epic suggestion from Interview conversation using AI

        Flow:
        1. Fetch interview conversation
        2. AI analyzes conversation and extracts Epic
        3. Returns JSON suggestion (NOT created in DB)
        4. User reviews and approves via API

        Args:
            interview_id: Interview ID to analyze
            project_id: Project ID

        Returns:
            Dict with Epic suggestion:
            {
                "title": str,
                "description": str,
                "story_points": int,
                "priority": str,
                "acceptance_criteria": [str, str, ...],
                "interview_insights": {
                    "key_requirements": [...],
                    "business_goals": [...],
                    "technical_constraints": [...]
                },
                "interview_question_ids": [question_index, ...]
            }

        Raises:
            ValueError: If interview not found or empty
        """
        # 1. Fetch interview
        interview = self.db.query(Interview).filter(Interview.id == interview_id).first()
        if not interview:
            raise ValueError(f"Entrevista {interview_id} não encontrada")

        conversation = interview.conversation_data
        if not conversation or len(conversation) == 0:
            raise ValueError(f"Entrevista {interview_id} não possui dados de conversa")

        # 2. Build AI prompt (EM PORTUGUES - PROMPT #83 - Semantic References Methodology)
        # PROMPT #236 - Externalized to YAML (backlog/epic_from_interview)
        from app.prompts.loader import get_prompt_loader
        _loader = get_prompt_loader()

        # PROMPT #232 - Compressed context replaces full conversation + business rules
        from app.services.prompt_context_compressor import PromptContextCompressor
        _project = self.db.query(Project).filter(Project.id == project_id).first()
        _compressor = PromptContextCompressor(self.db)
        _ctx = _compressor.compress_hierarchy_context(
            item_type="epic",
            item_title="",
            project=_project,
            conversation=conversation,
            max_context_tokens=10000,
        )

        # Fallback: if conversation wasn't compressed (short), format raw
        _conversation_text = _ctx.conversation_summary or self._format_conversation(conversation)

        system_prompt, user_prompt = _loader.render(
            "backlog/epic_from_interview",
            {
                "conversation_text": _conversation_text,
                "business_rules_text": _ctx.business_rules or "",
            }
        )

        # 3. Call AI via AIOrchestrator (PROMPT #164 - PrompterFacade removed)
        logger.info(f"🎯 Generating Epic from Interview {interview_id}...")

        orch_result = await self.orchestrator.execute(
            usage_type="prompt_generation",
            messages=[{"role": "user", "content": user_prompt}],
            system_prompt=system_prompt,
            project_id=project_id,
            interview_id=interview_id,
            metadata={"operation": "generate_epic_from_interview"},
            enable_rag=True
        )
        result = {
            "response": orch_result["content"],
            "input_tokens": orch_result.get("usage", {}).get("input_tokens", 0),
            "output_tokens": orch_result.get("usage", {}).get("output_tokens", 0),
            "model": orch_result.get("db_model_name", "unknown"),
        }

        # 4. Parse AI response
        try:
            # Strip markdown code blocks if present
            clean_json = _strip_markdown_json(result["response"])
            epic_suggestion = json.loads(clean_json)

            # PROMPT #85/86 - Dual output: Semantic prompt + Human description
            # - generated_prompt: Semantic markdown (for child card generation)
            # - description: Human-readable text (for reading)
            if "description_markdown" in epic_suggestion and "semantic_map" in epic_suggestion:
                # Store semantic markdown as the output prompt (Prompt tab)
                epic_suggestion["generated_prompt"] = epic_suggestion["description_markdown"]

                # Convert semantic to human-readable text (Description tab)
                epic_suggestion["description"] = _convert_semantic_to_human(
                    epic_suggestion["description_markdown"],
                    epic_suggestion["semantic_map"]
                )

                logger.info("✅ PROMPT #85/86: Converted semantic -> human description")
            elif "description_markdown" in epic_suggestion:
                # Fallback: no semantic_map, use description_markdown as-is
                epic_suggestion["description"] = epic_suggestion["description_markdown"]
                epic_suggestion["generated_prompt"] = epic_suggestion["description_markdown"]

            # Add semantic_map to interview_insights for traceability
            if "semantic_map" in epic_suggestion:
                if "interview_insights" not in epic_suggestion:
                    epic_suggestion["interview_insights"] = {}
                epic_suggestion["interview_insights"]["semantic_map"] = epic_suggestion["semantic_map"]

            # Add metadata
            epic_suggestion["_metadata"] = {
                "source": "interview",
                "interview_id": str(interview_id),
                "ai_model": result.get("model", "unknown"),
                "input_tokens": result.get("input_tokens", 0),
                "output_tokens": result.get("output_tokens", 0),
                "cache_hit": result.get("cache_hit", False),
                "cache_type": result.get("cache_type", None),
                "uses_semantic_references": "semantic_map" in epic_suggestion  # PROMPT #83
            }

            logger.info(f"✅ Epic generated: {epic_suggestion['title']} (cache: {result.get('cache_hit', False)})")
            return epic_suggestion

        except json.JSONDecodeError as e:
            logger.error(f"❌ Failed to parse AI response as JSON: {e}")
            logger.error(f"AI response: {result.get('response', result.get('content', ''))}")
            raise ValueError(f"IA não retornou JSON válido: {str(e)}")

    # Delegate helper methods to utility functions for backward compatibility
    def _format_conversation(self, conversation: List[Dict]) -> str:
        return format_conversation(conversation)

    def _build_specs_context(self, specs: List[Spec], story: Task, max_specs: int = 10) -> str:
        return build_specs_context(specs, story, max_specs)

    def _build_task_generation_prompt(self, project: Project, task_type: str) -> str:
        return build_task_generation_prompt(project, task_type)

    def _format_conversation_for_task(self, conversation: list) -> str:
        return format_conversation_for_task(conversation)

    def _parse_priority(self, priority_str: str) -> PriorityLevel:
        return parse_priority(priority_str)
