"""
Draft task generation mixin.

Handles generation of draft tasks from stories, including fallback logic.
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


class DraftTasksMixin:
    """Mixin providing draft task generation methods."""

    async def _generate_draft_tasks(
        self,
        story: Task,
        project: Project,
        count: int = 8
    ) -> List[Task]:
        """
        PROMPT #257 - Generate tasks with FULL CONTENT using tasks_from_story.yaml.

        Args:
            story: The activated story
            project: The project with context
            count: Number of tasks to generate (default 8)

        Returns:
            List of created Task items with full content
        """
        logger.info(f"Generating {count} tasks with full content for story: {story.title}")

        # Get parent epic and story semantic maps for context
        parent_epic = None
        epic_semantic_map = {}
        story_semantic_map = {}

        if story.parent_id:
            parent_epic = self.db.query(Task).filter(Task.id == story.parent_id).first()
            if parent_epic and parent_epic.interview_insights:
                epic_semantic_map = parent_epic.interview_insights.get("semantic_map", {})

        if story.interview_insights:
            story_semantic_map = story.interview_insights.get("semantic_map", {})

        combined_semantic_map = {**epic_semantic_map, **story_semantic_map}
        semantic_map_text = ""
        if combined_semantic_map:
            semantic_map_text = "\nMAPA SEMÂNTICO DO EPIC/STORY:\n"
            semantic_map_text += json.dumps(combined_semantic_map, indent=2, ensure_ascii=False)

        # PROMPT #252 - Fetch RELEVANT business rules from RAG using semantic search
        business_rules_text = ""
        try:
            rag_service = RAGService(self.db)
            # Use story title + description + parent epic title as semantic query
            epic_title = parent_epic.title if parent_epic else ""
            search_query = f"{epic_title} {story.title} {(story.description or '')[:500]}"
            rules = rag_service.get_business_rules(
                project_id=project.id,
                query=search_query,
                top_k=50,
                similarity_threshold=0.3
            )
            if rules:
                business_rules_text = rag_service.format_business_rules_for_prompt(rules, max_chars=10000)
                logger.info(f"Injected {len(rules)} relevant business rules for story: {story.title[:40]}")
        except Exception as e:
            logger.warning(f"Could not fetch business rules for tasks: {e}")

        # PROMPT #252 - Build context: existing children, hierarchy, wiki
        existing_children_text = _build_existing_children_text(self.db, story.id)
        full_hierarchy_text = _build_full_hierarchy_text(self.db, story)
        epic_title = parent_epic.title if parent_epic else ""
        wiki_search = f"{epic_title} {story.title} {(story.description or '')[:200]}"
        wiki_context_text = _build_wiki_context_text(self.db, project, wiki_search)

        if existing_children_text:
            logger.info(f"Passing {existing_children_text.count(chr(10))+1} existing children as dedup context for story: {story.title[:40]}")
        if wiki_context_text:
            logger.info(f"Injected wiki context ({len(wiki_context_text)} chars) for story: {story.title[:40]}")

        try:
            # PROMPT #257 - Use PromptLoader with tasks_from_story.yaml
            from app.prompts.loader import get_prompt_loader
            loader = get_prompt_loader()

            system_prompt, user_prompt = loader.render(
                "backlog/tasks_from_story",
                {
                    "story_title": story.title,
                    "story_description": (story.description or "Não especificada")[:5000],
                    "story_story_points": story.story_points or 8,
                    "story_priority": story.priority.value if story.priority else "medium",
                    "story_acceptance_criteria": "\n".join(story.acceptance_criteria or []),
                    "semantic_map_text": semantic_map_text,
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
            tasks_data = self._parse_json_response(response_content)

            if not tasks_data or not isinstance(tasks_data, list):
                logger.warning("AI did not return valid tasks array, falling back to title-only")
                return self._generate_draft_tasks_fallback(story)

            tasks_data = tasks_data[:count]
            logger.info(f"Generated {len(tasks_data)} complete task objects for story: {story.title}")

            # Create Task objects with full content
            created_tasks = []
            skipped_count = 0
            batch_titles: List[str] = []  # PROMPT #253 - Track titles in current batch
            rag_svc = RAGService(self.db)

            for i, task_data in enumerate(tasks_data):
                try:
                    if isinstance(task_data, str):
                        task_data = {"title": task_data}

                    task_title = task_data.get("title", f"Task {i+1}")

                    # PROMPT #253 - Local dedup: check DB siblings + current batch (no RAG lag)
                    if _is_title_duplicate(task_title, story.id, self.db, batch_titles):
                        logger.info(f"Skipping duplicate task (local dedup): '{task_title[:50]}...'")
                        skipped_count += 1
                        continue

                    # PROMPT #162 - Also check RAG for cross-parent similarity
                    similar_cards = rag_svc.find_similar_cards(
                        title=task_title,
                        description=None,
                        project_id=story.project_id,
                        item_type="task",
                        similarity_threshold=0.85,
                        top_k=1
                    )
                    if similar_cards:
                        logger.info(f"Skipping similar task (RAG): '{task_title[:50]}...'")
                        skipped_count += 1
                        continue

                    # PROMPT #233 - PD-3 fix: generated_prompt = semantic, description = human-readable
                    generated_prompt = task_data.get("description_markdown", task_data.get("description", ""))
                    task_semantic_map = task_data.get("semantic_map", {})
                    description = _convert_semantic_to_human(generated_prompt, task_semantic_map) if generated_prompt else ""
                    acceptance_criteria = task_data.get("acceptance_criteria", [])
                    story_points = task_data.get("story_points", 3)
                    priority_str = task_data.get("priority", "medium").lower()

                    priority_map = {
                        "critical": PriorityLevel.CRITICAL,
                        "high": PriorityLevel.HIGH,
                        "medium": PriorityLevel.MEDIUM,
                        "low": PriorityLevel.LOW,
                        "trivial": PriorityLevel.TRIVIAL,
                    }
                    priority = priority_map.get(priority_str, story.priority or PriorityLevel.MEDIUM)

                    task = Task(
                        project_id=story.project_id,
                        parent_id=story.id,
                        item_type=ItemType.TASK,
                        title=task_title,
                        description=description or f"Task derivada da Story: {story.title}",
                        generated_prompt=generated_prompt,
                        acceptance_criteria=acceptance_criteria,
                        story_points=story_points if isinstance(story_points, int) else 3,
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
                            "derived_from_story": str(story.id),
                            "semantic_map": task_semantic_map,
                        },
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow()
                    )
                    self.db.add(task)
                    created_tasks.append(task)
                    batch_titles.append(task_title)  # PROMPT #253 - Track for batch dedup
                    logger.info(f"Created task {i+1}/{len(tasks_data)}: {task_title[:50]}...")

                except Exception as task_error:
                    logger.error(f"Error creating task '{task_data}': {str(task_error)}")

            if skipped_count > 0:
                logger.info(f"Skipped {skipped_count} duplicate tasks (local+RAG dedup)")

            # Final dedup pass: re-check within created batch to catch AI-generated duplicates
            if created_tasks:
                parent_id = created_tasks[0].parent_id
                final_tasks = []
                for task in created_tasks:
                    if _is_title_duplicate(task.title, parent_id, self.db, [t.title for t in final_tasks]):
                        logger.info(f"Final dedup: removing duplicate task '{task.title[:50]}...'")
                        self.db.expunge(task)
                        skipped_count += 1
                    else:
                        final_tasks.append(task)
                created_tasks = final_tasks

            self.db.commit()
            logger.info(f"Created {len(created_tasks)} tasks with full content")
            return created_tasks

        except Exception as e:
            logger.error(f"Error generating tasks: {str(e)}")
            import traceback
            traceback.print_exc()
            return self._generate_draft_tasks_fallback(story)

    def _generate_draft_tasks_fallback(self, story: Task) -> List[Task]:
        """Fallback: create tasks with basic titles when AI fails."""
        fallback_titles = self._generate_fallback_task_titles(story)
        created_tasks = []
        for i, title in enumerate(fallback_titles[:5]):
            task = Task(
                project_id=story.project_id,
                parent_id=story.id,
                item_type=ItemType.TASK,
                title=title,
                description=f"Task derivada da Story **{story.title}**. {(story.description or '')[:300]}",
                generated_prompt="",
                acceptance_criteria=[],
                story_points=3,
                priority=story.priority or PriorityLevel.MEDIUM,
                labels=["suggested"],
                workflow_state="draft",
                status=TaskStatus.BACKLOG,
                order=i,
                interview_insights={"derived_from_story": str(story.id)}
            )
            self.db.add(task)
            created_tasks.append(task)
        self.db.commit()
        return created_tasks

    def _generate_fallback_task_titles(self, story: Task) -> List[str]:
        """Generate fallback task titles based on story context.

        PROMPT #252 - Uses story description to extract meaningful task titles
        instead of generic templates."""
        base_title = story.title[:50] if story.title else "funcionalidade"
        desc = (story.description or "")[:2000]

        import re
        titles = []

        # Extract from bold items in description
        bold_items = re.findall(r'\*\*([^*]+)\*\*', desc)
        if bold_items:
            for item in bold_items[:8]:
                item_clean = item.strip().rstrip(':')
                if len(item_clean) > 5 and len(item_clean) < 80:
                    titles.append(f"Implementar {item_clean}")

        # Extract from bullet points
        if not titles:
            bullets = re.findall(r'[-•]\s+(.+?)(?:\n|$)', desc)
            for bullet in bullets[:8]:
                clean = bullet.strip()
                if len(clean) > 10 and len(clean) < 100:
                    titles.append(clean)

        # Contextual fallback
        if not titles:
            titles = [
                f"Modelagem de dados para {base_title}",
                f"Lógica de negócio para {base_title}",
                f"API e integração de {base_title}",
                f"Interface de {base_title}",
                f"Testes de {base_title}",
            ]

        return titles
