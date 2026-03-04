"""
Task activation and content generation mixin.

Handles activation of suggested tasks with full semantic content generation.
Extracted from card_activator.py during modularization.
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
from app.prompts.loader import get_prompt_loader  # PROMPT #234 YP-1
from .utils import (
    _robust_json_parse,
    _convert_semantic_to_human,
    _extract_content_from_raw_response,
)

logger = logging.getLogger(__name__)


class TaskActivatorMixin:
    """Mixin providing task activation and rich content generation methods."""

    async def activate_suggested_task(self, task_id: UUID) -> Dict:
        """
        PROMPT #102 - Activate a suggested task with full content generation.

        Tasks are leaf nodes in the hierarchy.

        Args:
            task_id: Task ID to activate

        Returns:
            Dict with activated task data and children_generated count
        """
        # Fetch task
        task = self.db.query(Task).filter(Task.id == task_id).first()
        if not task:
            raise ValueError(f"Task {task_id} não encontrada")

        if task.item_type != ItemType.TASK:
            raise ValueError(f"Item {task_id} não é uma Task (tipo: {task.item_type})")

        # Check if suggested
        is_suggested = (task.labels and "suggested" in task.labels) or task.workflow_state == "draft"
        if not is_suggested:
            raise ValueError(f"Task {task_id} não é um item sugerido")

        # Fetch project - PROMPT #234 SM-2: FOR UPDATE to prevent race on context_locked
        project = self.db.query(Project).with_for_update().filter(Project.id == task.project_id).first()
        if not project:
            raise ValueError(f"Projeto {task.project_id} não encontrado")

        # Fetch parent story and grandparent epic for full context
        parent_story = None
        grandparent_epic = None
        if task.parent_id:
            parent_story = self.db.query(Task).filter(Task.id == task.parent_id).first()
            if parent_story and parent_story.parent_id:
                grandparent_epic = self.db.query(Task).filter(Task.id == parent_story.parent_id).first()

        # Generate full task content with complete hierarchy context
        task_content = await self._generate_full_task_content(task, project, parent_story, grandparent_epic)

        # PROMPT #175 - Validate and restructure AI response before saving
        task_content = self._validate_and_restructure_content(
            task_content, task.title, task.description, project, item_type="task"
        )

        # Update task
        # PROMPT #232 - REGRA #0: Human data is sacred - never overwrite human edits
        if task.description_edited_by != 'human':
            task.description = task_content.get("description", task.description)
            task.description_edited_by = 'ai'
        else:
            logger.info(f"🛡️ Preserving human-edited description for task '{task.title}'")

        if task.prompt_edited_by != 'human':
            task.generated_prompt = task_content.get("generated_prompt")
            task.prompt_edited_by = 'ai'
        else:
            logger.info(f"🛡️ Preserving human-edited prompt for task '{task.title}'")

        task.acceptance_criteria = task_content.get("acceptance_criteria", [])
        task.story_points = task_content.get("story_points", task.story_points)
        # PROMPT #127 - Track which AI model generated the content
        task.created_by_ai_model = task_content.get("ai_model_used")

        # Store insights
        task.interview_insights = task.interview_insights or {}
        task.interview_insights["activated_from_suggestion"] = True
        task.interview_insights["activation_timestamp"] = datetime.utcnow().isoformat()

        # Remove suggested label
        if task.labels and "suggested" in task.labels:
            task.labels = [l for l in task.labels if l != "suggested"]
        task.workflow_state = "open"
        task.updated_at = datetime.utcnow()

        # PROMPT #232 - IC-2 fix: lock context on ANY card activation
        if not project.context_locked:
            project.context_locked = True
            project.context_locked_at = datetime.utcnow()
            logger.info(f"🔒 Context locked for project {project.name} (task activated)")

        self.db.commit()
        self.db.refresh(task)

        logger.info(f"✅ Task activated: {task.title}")

        # Task is a leaf node - no children generated.

        # PROMPT #162 - Index activated card in RAG for semantic search
        try:
            rag_service = RAGService(self.db)
            rag_service.store_card(
                card_id=task.id,
                title=task.title,
                description=task.description,
                generated_prompt=task.generated_prompt,
                item_type="task",
                parent_id=task.parent_id,
                labels=task.labels,
                workflow_state=task.workflow_state,
                project_id=task.project_id
            )
            logger.info(f"📇 Task indexed in RAG: {task.title}")
        except Exception as e:
            logger.error(f"❌ Error indexing task in RAG: {str(e)}")

        return {
            "id": str(task.id),
            "title": task.title,
            "description": task.description,
            "generated_prompt": task.generated_prompt,
            "acceptance_criteria": task.acceptance_criteria,
            "story_points": task.story_points,
            "priority": task.priority.value if task.priority else "medium",
            "activated": True,
            "children_generated": 0
        }

    async def _generate_full_task_content(self, task: Task, project: Project, parent_story: Task = None, grandparent_epic: Task = None) -> Dict:
        """
        Generate FULL EPIC-LEVEL content for a task using AI.

        Uses the SAME detailed prompt structure as _generate_full_epic_content.
        Includes ALL parent context (Epic + Story semantic maps, project context).

        Args:
            task: The task to generate content for (may only have title)
            project: The project
            parent_story: The parent Story (passed directly for full context access)
            grandparent_epic: The grandparent Epic (passed directly for full context access)
        """

        # Get parent story and grandparent epic for full context
        # Use passed parameters or fetch from DB if not provided
        story_semantic_map = {}
        epic_semantic_map = {}

        if not parent_story and task.parent_id:
            parent_story = self.db.query(Task).filter(Task.id == task.parent_id).first()

        if parent_story:
            if parent_story.interview_insights:
                story_semantic_map = parent_story.interview_insights.get("semantic_map", {})
            if not grandparent_epic and parent_story.parent_id:
                grandparent_epic = self.db.query(Task).filter(Task.id == parent_story.parent_id).first()

        if grandparent_epic and grandparent_epic.interview_insights:
            epic_semantic_map = grandparent_epic.interview_insights.get("semantic_map", {})

        # Combine all semantic maps for context
        combined_semantic_map = {**epic_semantic_map, **story_semantic_map}

        # PROMPT #234 YP-1 - Load task system_prompt from YAML (was hardcoded)
        _task_template = get_prompt_loader().load("context/task_specification")
        system_prompt = _task_template.system_prompt

        # PROMPT #232 - Compressed context replaces NO TRUNCATION pattern
        from app.services.prompt_context_compressor import PromptContextCompressor
        _compressor = PromptContextCompressor(self.db)
        _ctx = _compressor.compress_hierarchy_context(
            item_type="task",
            item_title=task.title,
            project=project,
            parent_card=parent_story,
            grandparent_card=grandparent_epic,
            max_context_tokens=6000,
        )

        user_prompt = f"""Gere a ESPECIFICAÇÃO TÉCNICA COMPLETA para esta Task.

A Task deve ter o MESMO NÍVEL DE DETALHAMENTO do Epic e da Story pai.
Os critérios de aceitação devem ser TÉCNICOS e ESPECÍFICOS para esta Task.

## CONTEXTO DO PROJETO
**Nome:** {project.name}

**Contexto do Projeto:**
{project.context_human or project.context_semantic or 'Não disponível'}

{_ctx.parent_context}
{_ctx.semantic_map_text}

{_ctx.business_rules}

## TASK A ESPECIFICAR
**Título da Task:** {task.title}

## REGRAS OBRIGATÓRIAS

1. **REUTILIZE os identificadores do Epic/Story** (N1, N2, ATTR1, API1, etc.)
2. **ESTENDA com identificadores TÉCNICOS** (FILE1, FUNC1, CLASS1, TEST1, etc.)
3. **Critérios de Aceitação TÉCNICOS** - específicos para implementação
4. **description_markdown MÍNIMO 1200 caracteres** com estrutura técnica completa
5. **MÍNIMO 15 identificadores** no mapa semântico
6. **MÍNIMO 4 critérios de aceitação** técnicos e mensuráveis
7. **INCLUA**: arquivos específicos, funções com assinaturas, código de exemplo

## EXEMPLO DE CRITÉRIOS DE ACEITAÇÃO TÉCNICOS:
- "AC1: Endpoint POST /api/users retorna 201 com dados do usuário criado"
- "AC2: Validação retorna 400 se email inválido ou já existente"
- "AC3: Testes unitários cobrem casos de sucesso e erro"
- "AC4: Logs de criação de usuário registrados corretamente"

## EXEMPLO DE CRITÉRIOS GENÉRICOS (NÃO USE):
- "Implementação completa" ❌
- "Código revisado" ❌
- "Funciona corretamente" ❌

Retorne APENAS o JSON, sem explicações."""

        try:
            # PROMPT #100: Disable cache for individual content generation
            orchestrator = AIOrchestrator(self.db, enable_cache=False)
            response = await orchestrator.execute(
                usage_type="prompt_generation",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=16384,
                enable_rag=True,  # PROMPT #124 - Enable RAG for context generation
                project_id=str(project.id)  # PROMPT #125 - Log to prompts table
            )

            # PROMPT #127 - Capture AI model used for tracking
            ai_model_used = response.get("model", "unknown")

            content = response.get("content", "")
            # PROMPT #178 - Use robust parser (8 strategies) instead of simple _parse_json_response
            try:
                result = _robust_json_parse(content, context=f"task_content:{task.title[:30]}")
            except ValueError:
                result = None

            if result and isinstance(result, dict):
                # Convert semantic to human description
                semantic_map = result.get("semantic_map", {})
                description_markdown = result.get("description_markdown", "")
                result["description"] = _convert_semantic_to_human(description_markdown, semantic_map)
                # PROMPT #180 - Include acceptance criteria in generated_prompt
                acceptance_criteria = result.get("acceptance_criteria", [])
                prompt_with_criteria = description_markdown
                if acceptance_criteria:
                    prompt_with_criteria += "\n\n## Critérios de Aceitação\n\n"
                    for ac in acceptance_criteria:
                        prompt_with_criteria += f"- {ac}\n"
                result["generated_prompt"] = prompt_with_criteria
                result["ai_model_used"] = ai_model_used  # PROMPT #127
                return result

            # PROMPT #179 - Extract clean content from raw response (never dump raw JSON)
            logger.warning(f"⚠️ Task JSON parsing failed, extracting clean content from raw response")
            raw_content = content.strip() if content else ""
            extracted = _extract_content_from_raw_response(raw_content, task.title, "Task")

            if extracted:
                extracted.setdefault("acceptance_criteria", [
                    f"AC1: {task.title} implementada",
                    "AC2: Testes unitários adicionados",
                    "AC3: Code review aprovado",
                    "AC4: Sem bugs ou regressões"
                ])
                # PROMPT #180 - Append criteria to generated_prompt
                ac_list = extracted.get("acceptance_criteria", [])
                if ac_list and "## Critérios de Aceitação" not in extracted.get("generated_prompt", ""):
                    extracted["generated_prompt"] = extracted.get("generated_prompt", "") + "\n\n## Critérios de Aceitação\n\n" + "".join(f"- {ac}\n" for ac in ac_list)
                extracted.setdefault("semantic_map", combined_semantic_map)
                extracted.setdefault("story_points", task.story_points or 3)
                extracted["ai_model_used"] = ai_model_used
                return extracted

            # No usable content extracted - build from parent context
            story_desc = (parent_story.description or parent_story.generated_prompt or "") if parent_story else ""
            epic_desc = (grandparent_epic.description or grandparent_epic.generated_prompt or "") if grandparent_epic else ""
            task_ac = [
                f"AC1: {task.title} implementada",
                "AC2: Testes unitários adicionados",
                "AC3: Code review aprovado",
                "AC4: Sem bugs ou regressões"
            ]
            fallback_desc = (
                f"# Task: {task.title}\n\n"
                f"## Visão Geral\n\n{task.description or task.title}\n\n"
                f"## Contexto da Story\n\n**{parent_story.title if parent_story else 'N/A'}**\n\n"
                f"{story_desc[:1500]}\n\n"
                f"## Contexto do Epic\n\n**{grandparent_epic.title if grandparent_epic else 'N/A'}**\n\n"
                f"{epic_desc[:1000]}\n\n"
            )
            # PROMPT #180 - Include criteria in generated_prompt
            fallback_prompt = fallback_desc + "## Critérios de Aceitação\n\n" + "".join(f"- {ac}\n" for ac in task_ac)
            return {
                "description": fallback_desc.rstrip() + "\n\n*Conteúdo gerado como fallback. Edite para adicionar detalhes técnicos.*",
                "generated_prompt": fallback_prompt,
                "acceptance_criteria": task_ac,
                "semantic_map": combined_semantic_map,
                "story_points": task.story_points or 3,
                "ai_model_used": ai_model_used  # PROMPT #127
            }

        except Exception as e:
            logger.error(f"Error generating task content: {e}")
            # PROMPT #178 - Provide meaningful content from parent context even on exception
            story_ctx = ""
            if task.parent_id:
                try:
                    ps = self.db.query(Task).filter(Task.id == task.parent_id).first()
                    if ps:
                        story_ctx = f"## Contexto da Story\n\n**{ps.title}**\n\n{(ps.description or ps.generated_prompt or '')[:1500]}"
                except Exception:
                    pass
            fallback = (
                f"# Task: {task.title}\n\n"
                f"{task.description or ''}\n\n"
                f"{story_ctx}\n\n"
                f"*Conteúdo gerado como fallback após erro. Edite para adicionar detalhes.*"
            )
            return {
                "description": fallback,
                "generated_prompt": fallback,
                "acceptance_criteria": [f"{task.title} implementada"],
                "story_points": task.story_points or 2,
                "ai_model_used": None  # PROMPT #127
            }

