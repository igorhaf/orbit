"""
BacklogGeneratorService
AI-powered backlog generation (Epic → Story → Task decomposition)
JIRA Transformation - Phase 2
"""

from typing import Dict, List, Optional
from uuid import UUID
from sqlalchemy.orm import Session
import json
import logging

from app.models.task import Task, ItemType, PriorityLevel
from app.models.interview import Interview
from app.models.spec import Spec, SpecScope
from app.models.project import Project
from app.services.ai_orchestrator import AIOrchestrator
from app.prompter.facade import PrompterFacade
from app.services.spec_loader import get_spec_loader

logger = logging.getLogger(__name__)


def _strip_markdown_json(content: str) -> str:
    """
    Remove markdown code blocks from JSON response.

    AI sometimes returns JSON wrapped in ```json ... ``` blocks.
    This function strips those markers to get pure JSON.

    Args:
        content: Raw AI response that may contain markdown

    Returns:
        Clean JSON string without markdown markers
    """
    import re

    # Remove ```json and ``` markers
    content = re.sub(r'^```json\s*\n?', '', content, flags=re.MULTILINE)
    content = re.sub(r'\n?```\s*$', '', content, flags=re.MULTILINE)

    return content.strip()


class BacklogGeneratorService:
    """Service for AI-powered backlog generation with user approval"""

    def __init__(self, db: Session):
        self.db = db
        # PROMPT #54.3 - Use PrompterFacade for cache support
        self.prompter = PrompterFacade(db)
        # Keep orchestrator as fallback
        self.orchestrator = AIOrchestrator(db)

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
            raise ValueError(f"Interview {interview_id} not found")

        conversation = interview.conversation_data
        if not conversation or len(conversation) == 0:
            raise ValueError(f"Interview {interview_id} has no conversation data")

        # 2. Build AI prompt
        system_prompt = """You are an expert Product Owner analyzing interview conversations to extract Epic-level requirements.

Your task:
1. Analyze the entire conversation and identify the main EPIC (high-level business goal)
2. Extract acceptance criteria (what defines "done" for this Epic)
3. Extract key insights: requirements, business goals, technical constraints
4. Estimate story points (1-21, Fibonacci scale) based on Epic complexity
5. Suggest priority (critical, high, medium, low, trivial)

IMPORTANT:
- An Epic represents a large body of work (multiple Stories)
- Focus on BUSINESS VALUE and USER OUTCOMES
- Be specific and actionable in acceptance criteria
- Extract actual quotes/insights from the conversation

Return ONLY valid JSON (no markdown, no explanation):
{
    "title": "Epic Title (concise, business-focused)",
    "description": "Detailed Epic description explaining the business goal and user value",
    "story_points": 13,
    "priority": "high",
    "acceptance_criteria": [
        "Specific measurable criterion 1",
        "Specific measurable criterion 2",
        "Specific measurable criterion 3"
    ],
    "interview_insights": {
        "key_requirements": ["requirement 1", "requirement 2"],
        "business_goals": ["goal 1", "goal 2"],
        "technical_constraints": ["constraint 1", "constraint 2"]
    },
    "interview_question_ids": [0, 2, 5]
}

interview_question_ids should be the indexes of conversation messages that are most relevant to this Epic.
"""

        # Convert conversation to readable format
        conversation_text = self._format_conversation(conversation)

        user_prompt = f"""Analyze this interview conversation and extract the main Epic:

CONVERSATION:
{conversation_text}

Return the Epic as JSON following the schema provided in the system prompt."""

        # 3. Call AI (PROMPT #54.3 - Using PrompterFacade for cache support)
        logger.info(f"🎯 Generating Epic from Interview {interview_id}...")

        try:
            result = await self.prompter.execute_prompt(
                prompt=user_prompt,
                usage_type="prompt_generation",
                system_prompt=system_prompt,
                project_id=str(project_id),
                interview_id=str(interview_id),
                metadata={"operation": "generate_epic_from_interview"}
            )
        except RuntimeError:
            # Fallback to direct orchestrator if PrompterFacade not initialized
            logger.warning("PrompterFacade not available, using direct AIOrchestrator")
            result = await self.orchestrator.execute(
                usage_type="prompt_generation",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                project_id=project_id,
                interview_id=interview_id,
                metadata={"operation": "generate_epic_from_interview"}
            )
            # Normalize result format
            result = {"response": result["content"], "input_tokens": result.get("usage", {}).get("input_tokens", 0), "output_tokens": result.get("usage", {}).get("output_tokens", 0), "model": result.get("db_model_name", "unknown")}

        # 4. Parse AI response
        try:
            # Strip markdown code blocks if present
            clean_json = _strip_markdown_json(result["response"])
            epic_suggestion = json.loads(clean_json)

            # Add metadata
            epic_suggestion["_metadata"] = {
                "source": "interview",
                "interview_id": str(interview_id),
                "ai_model": result.get("model", "unknown"),
                "input_tokens": result.get("input_tokens", 0),
                "output_tokens": result.get("output_tokens", 0),
                "cache_hit": result.get("cache_hit", False),
                "cache_type": result.get("cache_type", None)
            }

            logger.info(f"✅ Epic generated: {epic_suggestion['title']} (cache: {result.get('cache_hit', False)})")
            return epic_suggestion

        except json.JSONDecodeError as e:
            logger.error(f"❌ Failed to parse AI response as JSON: {e}")
            logger.error(f"AI response: {result.get('response', result.get('content', ''))}")
            raise ValueError(f"AI did not return valid JSON: {str(e)}")

    async def decompose_epic_to_stories(
        self,
        epic_id: UUID,
        project_id: UUID
    ) -> List[Dict]:
        """
        Decompose Epic into Story suggestions using AI

        Flow:
        1. Fetch Epic details
        2. AI decomposes Epic into Stories
        3. Returns array of Story suggestions (NOT created in DB)
        4. User reviews and approves via API

        Args:
            epic_id: Epic ID to decompose
            project_id: Project ID

        Returns:
            List of Story suggestions:
            [
                {
                    "title": str,
                    "description": str,
                    "story_points": int,
                    "priority": str,
                    "acceptance_criteria": [str, ...],
                    "interview_insights": {...},
                    "parent_id": epic_id
                },
                ...
            ]

        Raises:
            ValueError: If Epic not found or not an Epic type
        """
        # 1. Fetch Epic
        epic = self.db.query(Task).filter(
            Task.id == epic_id,
            Task.item_type == ItemType.EPIC
        ).first()

        if not epic:
            raise ValueError(f"Epic {epic_id} not found or is not an Epic")

        # 2. Build AI prompt
        system_prompt = """You are an expert Product Owner decomposing Epics into Stories.

Your task:
1. Break down the Epic into 3-7 STORIES (user-facing features)
2. Each Story should be independently deliverable
3. Each Story should deliver user value
4. Stories should be estimated in story points (1-8, Fibonacci)
5. Inherit priority from Epic (adjust if needed)

IMPORTANT:
- A Story represents a user-facing feature (can be completed in 1-2 weeks)
- Follow User Story format: "As a [user], I want [feature] so that [benefit]"
- Each Story must have clear acceptance criteria
- Stories should be independent (minimal dependencies)

Return ONLY valid JSON array (no markdown, no explanation):
[
    {
        "title": "Story Title (User Story format)",
        "description": "As a [user], I want [feature] so that [benefit]. Include implementation details here.",
        "story_points": 5,
        "priority": "high",
        "acceptance_criteria": [
            "Criterion 1",
            "Criterion 2"
        ],
        "interview_insights": {
            "derived_from_epic": true,
            "epic_requirements": ["requirement this story addresses"]
        }
    }
]
"""

        user_prompt = f"""Decompose this Epic into Stories:

EPIC DETAILS:
Title: {epic.title}
Description: {epic.description}
Story Points: {epic.story_points}
Priority: {epic.priority.value if epic.priority else 'medium'}

Acceptance Criteria:
{json.dumps(epic.acceptance_criteria, indent=2) if epic.acceptance_criteria else 'None'}

Interview Insights:
{json.dumps(epic.interview_insights, indent=2) if epic.interview_insights else 'None'}

Return 3-7 Stories as JSON array following the schema provided."""

        # 3. Call AI (PROMPT #54.3 - Using PrompterFacade for cache support)
        logger.info(f"🎯 Decomposing Epic {epic_id} into Stories...")

        try:
            result = await self.prompter.execute_prompt(
                prompt=user_prompt,
                usage_type="prompt_generation",
                system_prompt=system_prompt,
                project_id=str(project_id),
                metadata={
                    "operation": "decompose_epic_to_stories",
                    "epic_id": str(epic_id)
                }
            )
        except RuntimeError:
            # Fallback to direct orchestrator if PrompterFacade not initialized
            logger.warning("PrompterFacade not available, using direct AIOrchestrator")
            result = await self.orchestrator.execute(
                usage_type="prompt_generation",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                project_id=project_id,
                metadata={
                    "operation": "decompose_epic_to_stories",
                    "epic_id": str(epic_id)
                }
            )
            # Normalize result format
            result = {"response": result["content"], "input_tokens": result.get("usage", {}).get("input_tokens", 0), "output_tokens": result.get("usage", {}).get("output_tokens", 0), "model": result.get("db_model_name", "unknown")}

        # 4. Parse AI response
        try:
            # Strip markdown code blocks if present
            clean_json = _strip_markdown_json(result["response"])
            stories_suggestions = json.loads(clean_json)

            if not isinstance(stories_suggestions, list):
                raise ValueError("AI response is not a list")

            # Add metadata and parent_id to each Story
            for story in stories_suggestions:
                story["parent_id"] = str(epic_id)
                story["_metadata"] = {
                    "source": "epic_decomposition",
                    "epic_id": str(epic_id),
                    "ai_model": result.get("model", "unknown"),
                    "input_tokens": result.get("input_tokens", 0),
                    "output_tokens": result.get("output_tokens", 0),
                    "cache_hit": result.get("cache_hit", False),
                    "cache_type": result.get("cache_type", None)
                }

            logger.info(f"✅ Generated {len(stories_suggestions)} Stories from Epic (cache: {result.get('cache_hit', False)})")
            return stories_suggestions

        except json.JSONDecodeError as e:
            logger.error(f"❌ Failed to parse AI response as JSON: {e}")
            logger.error(f"AI response: {result.get('response', result.get('content', ''))}")
            raise ValueError(f"AI did not return valid JSON: {str(e)}")

    async def decompose_story_to_tasks(
        self,
        story_id: UUID,
        project_id: UUID
    ) -> List[Dict]:
        """
        Decompose Story into Task suggestions using AI (FUNCTIONAL ONLY)

        PROMPT #54.2 - FIX: Specs removed from decomposition
        - This stage is FUNCTIONAL (WHAT needs to be done)
        - Specs are only used during EXECUTION (HOW to implement)

        Flow:
        1. Fetch Story details
        2. AI decomposes Story into Tasks (functional description)
        3. Returns array of Task suggestions (NOT created in DB)
        4. User reviews and approves via API

        Args:
            story_id: Story ID to decompose
            project_id: Project ID

        Returns:
            List of Task suggestions:
            [
                {
                    "title": str,
                    "description": str,
                    "story_points": int,
                    "priority": str,
                    "acceptance_criteria": [str, ...],
                    "parent_id": story_id
                },
                ...
            ]

        Raises:
            ValueError: If Story not found or not a Story type
        """
        # 1. Fetch Story
        story = self.db.query(Task).filter(
            Task.id == story_id,
            Task.item_type == ItemType.STORY
        ).first()

        if not story:
            raise ValueError(f"Story {story_id} not found or is not a Story")

        # 2. Build AI prompt (FUNCTIONAL ONLY - no specs at this stage)
        # PROMPT #54.2 - FIX: Specs removed from decomposition (only for execution)
        system_prompt = """You are an expert Product Owner decomposing Stories into Tasks.

Your task:
1. Break down the Story into 3-10 TASKS (implementation steps)
2. Each Task should be specific and actionable (completable in 1-3 days)
3. Estimate story points for each Task (1-3, Fibonacci)
4. Maintain priority from Story

IMPORTANT:
- A Task is a concrete implementation step (what needs to be built)
- Be SPECIFIC: "Create User CRUD API endpoints" not "Create backend"
- Focus on WHAT needs to be done, not HOW (technical details come during execution)
- Tasks should have clear acceptance criteria (testable outcomes)
- Avoid framework-specific details (e.g., don't mention Laravel/React/etc.)

Return ONLY valid JSON array (no markdown, no explanation):
[
    {
        "title": "Specific Task Title",
        "description": "What needs to be implemented (functional description, not technical).",
        "story_points": 2,
        "priority": "high",
        "acceptance_criteria": [
            "Testable criterion 1",
            "Testable criterion 2"
        ]
    }
]
"""

        user_prompt = f"""Decompose this Story into Tasks:

STORY DETAILS:
Title: {story.title}
Description: {story.description}
Story Points: {story.story_points}
Priority: {story.priority.value if story.priority else 'medium'}

Acceptance Criteria:
{json.dumps(story.acceptance_criteria, indent=2) if story.acceptance_criteria else 'None'}

Return 3-10 Tasks as JSON array following the schema provided."""

        # 4. Call AI (PROMPT #54.3 - Using PrompterFacade for cache support)
        logger.info(f"🎯 Decomposing Story {story_id} into Tasks...")

        try:
            result = await self.prompter.execute_prompt(
                prompt=user_prompt,
                usage_type="prompt_generation",
                system_prompt=system_prompt,
                project_id=str(project_id),
                metadata={
                    "operation": "decompose_story_to_tasks",
                    "story_id": str(story_id)
                }
            )
        except RuntimeError:
            # Fallback to direct orchestrator if PrompterFacade not initialized
            logger.warning("PrompterFacade not available, using direct AIOrchestrator")
            result = await self.orchestrator.execute(
                usage_type="prompt_generation",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                project_id=project_id,
                metadata={
                    "operation": "decompose_story_to_tasks",
                    "story_id": str(story_id)
                }
            )
            # Normalize result format
            result = {"response": result["content"], "input_tokens": result.get("usage", {}).get("input_tokens", 0), "output_tokens": result.get("usage", {}).get("output_tokens", 0), "model": result.get("db_model_name", "unknown")}

        # 5. Parse AI response
        try:
            # Strip markdown code blocks if present
            clean_json = _strip_markdown_json(result["response"])
            tasks_suggestions = json.loads(clean_json)

            if not isinstance(tasks_suggestions, list):
                raise ValueError("AI response is not a list")

            # Add metadata and parent_id to each Task
            for task in tasks_suggestions:
                task["parent_id"] = str(story_id)
                task["_metadata"] = {
                    "source": "story_decomposition",
                    "story_id": str(story_id),
                    "ai_model": result.get("model", "unknown"),
                    "input_tokens": result.get("input_tokens", 0),
                    "output_tokens": result.get("output_tokens", 0),
                    "cache_hit": result.get("cache_hit", False),
                    "cache_type": result.get("cache_type", None)
                }

            logger.info(f"✅ Generated {len(tasks_suggestions)} Tasks from Story (cache: {result.get('cache_hit', False)})")
            return tasks_suggestions

        except json.JSONDecodeError as e:
            logger.error(f"❌ Failed to parse AI response as JSON: {e}")
            logger.error(f"AI response: {result.get('response', result.get('content', ''))}")
            raise ValueError(f"AI did not return valid JSON: {str(e)}")

    def _format_conversation(self, conversation: List[Dict]) -> str:
        """
        Format interview conversation for AI consumption

        Args:
            conversation: List of message dicts with role/content

        Returns:
            Formatted conversation string
        """
        formatted = []
        for i, msg in enumerate(conversation):
            role = msg.get("role", "unknown").upper()
            content = msg.get("content", "")
            formatted.append(f"[{i}] {role}: {content}")

        return "\n\n".join(formatted)

    def _build_specs_context(
        self,
        specs: List[Spec],
        story: Task,
        max_specs: int = 10
    ) -> str:
        """
        Build Specs context for AI (relevant specs only)

        Strategy:
        1. Filter specs by relevance (keywords in story title/description)
        2. Limit to max_specs to avoid token bloat
        3. Format for AI consumption

        Args:
            specs: List of available Specs
            story: Story being decomposed
            max_specs: Maximum number of specs to include

        Returns:
            Formatted specs context string
        """
        if not specs:
            return "FRAMEWORK SPECIFICATIONS:\nNone available."

        # Simple relevance scoring (keyword matching)
        story_text = f"{story.title} {story.description}".lower()

        scored_specs = []
        for spec in specs:
            score = 0
            spec_keywords = [
                spec.category.lower(),
                spec.name.lower(),
                spec.spec_type.lower()
            ]

            for keyword in spec_keywords:
                if keyword in story_text:
                    score += 1

            scored_specs.append((score, spec))

        # Sort by score (descending) and take top N
        scored_specs.sort(key=lambda x: x[0], reverse=True)
        top_specs = [spec for _, spec in scored_specs[:max_specs]]

        # Format specs
        formatted = ["FRAMEWORK SPECIFICATIONS (follow these patterns):"]
        for spec in top_specs:
            # PROMPT #54 - Token Optimization: Only add "..." if actually truncated
            content = spec.content[:500]
            truncated_suffix = "..." if len(spec.content) > 500 else ""

            formatted.append(f"""
---
Category: {spec.category}
Framework: {spec.name}
Type: {spec.spec_type}
Title: {spec.title}

Specification:
{content}{truncated_suffix}
---
""")

        return "\n".join(formatted)
