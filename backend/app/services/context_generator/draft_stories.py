"""
Draft story generation mixin.

Handles generation of draft stories from epics, including fallback logic.
Extracted from draft_generator.py during modularization.
"""

from typing import Dict, List, Optional, Any
from uuid import UUID, uuid4
from datetime import datetime
from sqlalchemy.orm import Session
import json
import logging
import re

from app.models.project import Project
from app.models.task import Task, TaskStatus, ItemType, PriorityLevel
from app.services.ai_orchestrator import AIOrchestrator
from app.services.rag_service import RAGService
from .utils import (
    _robust_json_parse,
    _strip_emojis,
    _convert_semantic_to_human,
    _extract_content_from_raw_response,
)
from .draft_helpers import (
    _build_existing_children_text,
    _build_full_hierarchy_text,
    _build_wiki_context_text,
    _is_title_duplicate,
)

logger = logging.getLogger(__name__)


class DraftStoriesMixin:
    """Mixin providing draft story generation methods."""

    async def _generate_draft_stories(
        self,
        epic: Task,
        project: Project,
        count: int = 15
    ) -> List[Task]:
        """
        PROMPT #257 - Generate stories with FULL CONTENT using stories_from_epic.yaml.

        Uses the existing rich YAML prompt to generate complete Stories
        with description, semantic_map, acceptance_criteria, and story_points.

        Args:
            epic: The activated epic
            project: The project with context
            count: Number of stories to generate (default 15)

        Returns:
            List of created Story tasks with full content
        """
        logger.info(f"Generating {count} stories with full content for: {epic.title}")

        # Extract epic's semantic map for context
        epic_semantic_map = {}
        if epic.interview_insights and isinstance(epic.interview_insights, dict):
            epic_semantic_map = epic.interview_insights.get("semantic_map", {})

        semantic_map_text = ""
        if epic_semantic_map:
            semantic_map_text = "\nMAPA SEMÂNTICO DO EPIC:\n"
            semantic_map_text += json.dumps(epic_semantic_map, indent=2, ensure_ascii=False)

        # PROMPT #252 - Fetch RELEVANT business rules from RAG using semantic search
        business_rules_text = ""
        try:
            rag_service = RAGService(self.db)
            # Use epic title + description as semantic query to get RELEVANT rules
            search_query = f"{epic.title} {(epic.description or '')[:500]}"
            rules = rag_service.get_business_rules(
                project_id=project.id,
                query=search_query,
                top_k=50,
                similarity_threshold=0.3
            )
            if rules:
                business_rules_text = rag_service.format_business_rules_for_prompt(rules, max_chars=10000)
                logger.info(f"Injected {len(rules)} relevant business rules for epic: {epic.title[:40]}")
        except Exception as e:
            logger.warning(f"Could not fetch business rules for stories: {e}")

        # PROMPT #252 - Build context: existing children, hierarchy, wiki
        existing_children_text = _build_existing_children_text(self.db, epic.id)
        full_hierarchy_text = _build_full_hierarchy_text(self.db, epic)
        wiki_search = f"{epic.title} {(epic.description or '')[:200]}"
        wiki_context_text = _build_wiki_context_text(self.db, project, wiki_search)

        if existing_children_text:
            logger.info(f"Passing {existing_children_text.count(chr(10))+1} existing children as dedup context")
        if wiki_context_text:
            logger.info(f"Injected wiki context ({len(wiki_context_text)} chars) for epic: {epic.title[:40]}")

        try:
            # PROMPT #257 - Use PromptLoader with stories_from_epic.yaml
            from app.prompts.loader import get_prompt_loader
            loader = get_prompt_loader()

            system_prompt, user_prompt = loader.render(
                "backlog/stories_from_epic",
                {
                    "epic_title": epic.title,
                    "epic_description": (epic.description or "Não especificada")[:5000],
                    "epic_story_points": epic.story_points or 13,
                    "epic_priority": epic.priority.value if epic.priority else "medium",
                    "epic_acceptance_criteria": "\n".join(epic.acceptance_criteria or []),
                    "semantic_map_text": semantic_map_text,
                    "epic_interview_insights": json.dumps(epic.interview_insights, ensure_ascii=False) if epic.interview_insights else "",
                    "business_rules_text": business_rules_text,
                    "existing_children_text": existing_children_text,
                    "wiki_context_text": wiki_context_text,
                    "full_hierarchy_text": full_hierarchy_text,
                    "count": count,
                    "rag_context": "",
                }
            )

            orchestrator = AIOrchestrator(self.db)
            response = await orchestrator.execute(
                usage_type=self._get_usage_type(),
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=16384,
                enable_rag=True,
                project_id=str(project.id)
            )

            response_content = response.get("content", "")
            stories_data = self._parse_json_response(response_content)

            if not stories_data or not isinstance(stories_data, list):
                logger.warning("AI did not return valid stories array, trying to extract from raw content")
                # Try to extract content from raw response before falling back
                extracted = _extract_content_from_raw_response(response_content)
                if extracted and isinstance(extracted, list):
                    stories_data = extracted
                else:
                    return await self._generate_draft_stories_fallback(epic, project, count)

            stories_data = stories_data[:count]
            logger.info(f"Generated {len(stories_data)} complete story objects for epic: {epic.title}")

            # Create Story tasks with full content
            created_stories = []
            skipped_count = 0
            batch_titles: List[str] = []  # PROMPT #253 - Track titles in current batch
            rag_svc = RAGService(self.db)

            for i, story_data in enumerate(stories_data):
                try:
                    if isinstance(story_data, str):
                        story_data = {"title": story_data}

                    story_title = story_data.get("title", f"Story {i+1}")

                    # PROMPT #253 - Local dedup: check DB siblings + current batch (no RAG lag)
                    if _is_title_duplicate(story_title, epic.id, self.db, batch_titles):
                        logger.info(f"Skipping duplicate story (local dedup): '{story_title[:50]}...'")
                        skipped_count += 1
                        continue

                    # PROMPT #162 - Also check RAG for cross-parent similarity
                    similar_cards = rag_svc.find_similar_cards(
                        title=story_title,
                        description=None,
                        project_id=epic.project_id,
                        item_type="story",
                        similarity_threshold=0.85,
                        top_k=1
                    )
                    if similar_cards:
                        logger.info(f"Skipping similar story (RAG): '{story_title[:50]}...'")
                        skipped_count += 1
                        continue

                    # Extract content from AI response
                    # PROMPT #233 - PD-3 fix: generated_prompt = semantic, description = human-readable
                    generated_prompt = story_data.get("description_markdown", story_data.get("description", ""))
                    story_semantic_map = story_data.get("semantic_map", {})
                    description = _convert_semantic_to_human(generated_prompt, story_semantic_map) if generated_prompt else ""
                    acceptance_criteria = story_data.get("acceptance_criteria", [])
                    story_points = story_data.get("story_points", 5)
                    priority_str = story_data.get("priority", "medium").lower()

                    # Map priority string to enum
                    priority_map = {
                        "critical": PriorityLevel.CRITICAL,
                        "high": PriorityLevel.HIGH,
                        "medium": PriorityLevel.MEDIUM,
                        "low": PriorityLevel.LOW,
                        "trivial": PriorityLevel.TRIVIAL,
                    }
                    priority = priority_map.get(priority_str, PriorityLevel.MEDIUM)

                    story = Task(
                        project_id=epic.project_id,
                        parent_id=epic.id,
                        item_type=ItemType.STORY,
                        title=story_title,
                        description=description or f"Story derivada do Epic: {epic.title}",
                        generated_prompt=generated_prompt,
                        acceptance_criteria=acceptance_criteria,
                        story_points=story_points if isinstance(story_points, int) else 5,
                        priority=priority,
                        labels=["suggested"],
                        workflow_state="draft",
                        status=TaskStatus.BACKLOG,
                        order=i,
                        reporter="system",
                        # PROMPT #233 - PD-2 fix: mark as AI-generated for REGRA #0
                        description_edited_by='ai',
                        prompt_edited_by='ai',
                        interview_insights={
                            "derived_from_epic": str(epic.id),
                            "semantic_map": story_semantic_map,
                        },
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow()
                    )
                    self.db.add(story)
                    created_stories.append(story)
                    batch_titles.append(story_title)  # PROMPT #253 - Track for batch dedup
                    logger.info(f"Created story {i+1}/{len(stories_data)}: {story_title[:50]}...")

                except Exception as story_error:
                    logger.error(f"Error creating story '{story_data}': {str(story_error)}")

            if skipped_count > 0:
                logger.info(f"Skipped {skipped_count} duplicate stories (local+RAG dedup)")

            # Final dedup pass: re-check within created batch to catch AI-generated duplicates
            # that slipped through (e.g. identical titles returned by the AI)
            if created_stories:
                final_stories = []
                for story in created_stories:
                    if _is_title_duplicate(story.title, epic.id, self.db, [s.title for s in final_stories]):
                        logger.info(f"Final dedup: removing duplicate story '{story.title[:50]}...'")
                        self.db.expunge(story)
                        skipped_count += 1
                    else:
                        final_stories.append(story)
                created_stories = final_stories

            self.db.commit()
            logger.info(f"Created {len(created_stories)} stories with full content")
            return created_stories

        except Exception as e:
            logger.error(f"Error generating stories: {str(e)}")
            import traceback
            traceback.print_exc()
            return await self._generate_draft_stories_fallback(epic, project, count)

    async def _generate_draft_stories_fallback(
        self,
        epic: Task,
        project: Project,
        count: int = 15
    ) -> List[Task]:
        """Fallback: create stories with contextual titles when AI fails."""
        fallback_titles = self._generate_fallback_story_titles(epic)
        created_stories = []
        for i, title in enumerate(fallback_titles[:min(5, count)]):
            story = Task(
                project_id=epic.project_id,
                parent_id=epic.id,
                item_type=ItemType.STORY,
                title=title,
                description=f"Story derivada do Epic **{epic.title}**. {(epic.description or '')[:300]}",
                generated_prompt="",
                acceptance_criteria=[],
                story_points=5,
                priority=PriorityLevel.MEDIUM,
                labels=["suggested"],
                workflow_state="draft",
                status=TaskStatus.BACKLOG,
                order=i,
                interview_insights={"derived_from_epic": str(epic.id)}
            )
            self.db.add(story)
            created_stories.append(story)

        self.db.commit()
        return created_stories

    def _generate_fallback_story_titles(self, epic: Task) -> List[str]:
        """Generate fallback story titles based on epic context.

        PROMPT #252 - Uses epic description to extract meaningful story titles
        instead of generic CRUD templates."""
        base_title = epic.title.replace("Epic: ", "").replace("Módulo: ", "")
        desc = (epic.description or "")[:2000]

        # Try to extract meaningful concepts from the description
        titles = []

        # If we have a rich description, extract key concepts from bold items
        import re
        bold_items = re.findall(r'\*\*([^*]+)\*\*', desc)
        if bold_items:
            for item in bold_items[:10]:
                # Skip items that are section headers
                item_clean = item.strip().rstrip(':')
                if len(item_clean) > 5 and len(item_clean) < 80:
                    titles.append(f"{item_clean} para {base_title}")

        # If no bold items found, try bullet points
        if not titles:
            bullets = re.findall(r'[-•]\s+(.+?)(?:\n|$)', desc)
            for bullet in bullets[:10]:
                clean = bullet.strip()
                if len(clean) > 10 and len(clean) < 100:
                    titles.append(clean)

        # Final fallback with contextual titles
        if not titles:
            titles = [
                f"Configuração e setup de {base_title}",
                f"Implementação core de {base_title}",
                f"Integração de {base_title} com o sistema",
                f"Validações e regras de {base_title}",
                f"Testes e qualidade de {base_title}",
            ]

        return titles
