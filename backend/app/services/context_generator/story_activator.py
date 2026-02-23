"""
Story activation and content generation mixin.

Handles activation of suggested stories with full semantic content generation.
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


class StoryActivatorMixin:
    """Mixin providing story activation and rich content generation methods."""

    async def activate_suggested_story(self, story_id: UUID) -> Dict:
        """
        PROMPT #102 - Activate a suggested story and generate draft tasks.

        Similar to activate_suggested_epic but for stories.
        After activation, auto-generates 5-8 draft tasks.

        Args:
            story_id: Story ID to activate

        Returns:
            Dict with activated story data and children_generated count
        """
        # Fetch story
        story = self.db.query(Task).filter(Task.id == story_id).first()
        if not story:
            raise ValueError(f"Story {story_id} não encontrada")

        if story.item_type != ItemType.STORY:
            raise ValueError(f"Item {story_id} não é uma Story (tipo: {story.item_type})")

        # Check if suggested
        is_suggested = (story.labels and "suggested" in story.labels) or story.workflow_state == "draft"
        if not is_suggested:
            raise ValueError(f"Story {story_id} não é um item sugerido")

        # Fetch project - PROMPT #234 SM-2: FOR UPDATE to prevent race on context_locked
        project = self.db.query(Project).with_for_update().filter(Project.id == story.project_id).first()
        if not project:
            raise ValueError(f"Projeto {story.project_id} não encontrado")

        # Generate full story content
        story_content = await self._generate_full_story_content(story, project)

        # PROMPT #175 - Validate and restructure AI response before saving
        story_content = self._validate_and_restructure_content(
            story_content, story.title, story.description, project, item_type="story"
        )

        # Update story
        # PROMPT #232 - REGRA #0: Human data is sacred - never overwrite human edits
        if story.description_edited_by != 'human':
            story.description = story_content.get("description", story.description)
            story.description_edited_by = 'ai'
        else:
            logger.info(f"🛡️ Preserving human-edited description for story '{story.title}'")

        if story.prompt_edited_by != 'human':
            story.generated_prompt = story_content.get("generated_prompt")
            story.prompt_edited_by = 'ai'
        else:
            logger.info(f"🛡️ Preserving human-edited prompt for story '{story.title}'")

        story.acceptance_criteria = story_content.get("acceptance_criteria", [])
        story.story_points = story_content.get("story_points", story.story_points)
        # PROMPT #127 - Track which AI model generated the content
        story.created_by_ai_model = story_content.get("ai_model_used")

        # Store insights
        story.interview_insights = story.interview_insights or {}
        story.interview_insights["semantic_map"] = story_content.get("semantic_map", {})
        story.interview_insights["activated_from_suggestion"] = True
        story.interview_insights["activation_timestamp"] = datetime.utcnow().isoformat()

        # Remove suggested label
        if story.labels and "suggested" in story.labels:
            story.labels = [l for l in story.labels if l != "suggested"]
        story.workflow_state = "open"
        story.updated_at = datetime.utcnow()

        # PROMPT #232 - IC-2 fix: lock context on ANY card activation
        if not project.context_locked:
            project.context_locked = True
            project.context_locked_at = datetime.utcnow()
            logger.info(f"🔒 Context locked for project {project.name} (story activated)")

        self.db.commit()
        self.db.refresh(story)

        logger.info(f"✅ Story activated: {story.title}")

        # PROMPT #127 - Removed auto-generation of draft tasks.
        # Children are now generated on-demand via "Generate Tasks" button.

        # PROMPT #162 - Index activated card in RAG for semantic search
        try:
            rag_service = RAGService(self.db)
            rag_service.store_card(
                card_id=story.id,
                title=story.title,
                description=story.description,
                generated_prompt=story.generated_prompt,
                item_type="story",
                parent_id=story.parent_id,
                labels=story.labels,
                workflow_state=story.workflow_state,
                project_id=story.project_id
            )
            logger.info(f"📇 Story indexed in RAG: {story.title}")
        except Exception as e:
            logger.error(f"❌ Error indexing story in RAG: {str(e)}")

        return {
            "id": str(story.id),
            "title": story.title,
            "description": story.description,
            "generated_prompt": story.generated_prompt,
            "acceptance_criteria": story.acceptance_criteria,
            "story_points": story.story_points,
            "priority": story.priority.value if story.priority else "medium",
            "activated": True,
            "children_generated": 0
        }

    async def _generate_full_story_content(self, story: Task, project: Project, parent_epic: Task = None) -> Dict:
        """
        Generate FULL EPIC-LEVEL content for a story using AI.

        Uses the SAME detailed prompt structure as _generate_full_epic_content.
        Includes ALL parent context (Epic semantic map, project context).

        Args:
            story: The story to generate content for (may only have title)
            project: The project
            parent_epic: The parent Epic (passed directly for full context access)
        """

        # Get parent epic for context - use passed epic or fetch from DB
        if not parent_epic and story.parent_id:
            parent_epic = self.db.query(Task).filter(Task.id == story.parent_id).first()

        epic_semantic_map = {}
        if parent_epic and parent_epic.interview_insights:
            epic_semantic_map = parent_epic.interview_insights.get("semantic_map", {})

        # PROMPT #234 YP-1 - Load story system_prompt from YAML (was hardcoded)
        _story_template = get_prompt_loader().load("context/story_specification")
        system_prompt = _story_template.system_prompt

        # PROMPT #232 - Compressed context replaces NO TRUNCATION pattern
        from app.services.prompt_context_compressor import PromptContextCompressor
        _compressor = PromptContextCompressor(self.db)
        _ctx = _compressor.compress_hierarchy_context(
            item_type="story",
            item_title=story.title,
            project=project,
            parent_card=parent_epic,
            max_context_tokens=8000,
        )

        user_prompt = f"""Gere a ESPECIFICAÇÃO TÉCNICA COMPLETA para a User Story abaixo.

A Story deve ter o MESMO NÍVEL DE DETALHAMENTO do Epic pai.
Os critérios de aceitação devem ser ESPECÍFICOS para esta Story, não genéricos.

## CONTEXTO DO PROJETO
**Nome:** {project.name}
**Contexto:**
{(project.context_human or project.context_semantic or 'Não disponível')[:3000]}

{_ctx.parent_context}
{_ctx.semantic_map_text}

{_ctx.business_rules}
{f'ATENÇÃO: As regras de negócio acima DEVEM influenciar esta Story.' if _ctx.business_rules and 'Consulte' not in _ctx.business_rules else ''}

## STORY A ESPECIFICAR
**Título da Story:** {story.title}

## REGRAS OBRIGATÓRIAS

1. **REUTILIZE os identificadores do Epic** (N1, N2, ATTR1, RN1, etc.)
2. **ESTENDA com NOVOS identificadores específicos desta Story** (ex: se Epic tem N1-N5, adicione N6-N10)
3. **Critérios de Aceitação ESPECÍFICOS** - baseados no título e contexto da Story, NÃO genéricos como "funcionalidade implementada"
4. **description_markdown MÍNIMO 1500 caracteres** com estrutura completa
5. **MÍNIMO 20 identificadores** no mapa semântico
6. **MÍNIMO 5 critérios de aceitação** específicos e mensuráveis
7. **Inclua**: campos com tipos de dados, regras de negócio, telas/componentes, endpoints API

## EXEMPLO DE CRITÉRIOS DE ACEITAÇÃO ESPECÍFICOS (para uma Story de cadastro de usuário):
- "AC1: Formulário de cadastro exibe campos nome, email, senha e confirmação de senha"
- "AC2: Email é validado com formato correto e verificação de unicidade no banco"
- "AC3: Senha deve ter mínimo 8 caracteres, incluindo letra maiúscula e número"
- "AC4: Após cadastro bem-sucedido, usuário recebe email de confirmação"
- "AC5: Usuário não confirmado não consegue fazer login"

## EXEMPLO DE CRITÉRIOS GENERICOS (NÃO USE):
- "Funcionalidade implementada" [RUIM]
- "Testes passam" [RUIM]
- "Código revisado" [RUIM]

Retorne APENAS o JSON, sem explicações."""

        try:
            # PROMPT #100: Disable cache for individual content generation
            # Semantic cache matches similar prompts, causing duplicate content
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
                result = _robust_json_parse(content, context=f"story_content:{story.title[:30]}")
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
            logger.warning(f"⚠️ Story JSON parsing failed, extracting clean content from raw response")
            raw_content = content.strip() if content else ""
            extracted = _extract_content_from_raw_response(raw_content, story.title, "Story")

            if extracted:
                # Successfully extracted clean content from raw response
                extracted.setdefault("acceptance_criteria", [
                    f"AC1: {story.title} completamente implementada",
                    "AC2: Testes unitários cobrindo os fluxos principais",
                    "AC3: Integração com módulos dependentes verificada",
                    "AC4: Interface de usuário funcional e responsiva",
                    "AC5: Documentação técnica atualizada"
                ])
                # PROMPT #180 - Append criteria to generated_prompt
                ac_list = extracted.get("acceptance_criteria", [])
                if ac_list and "## Critérios de Aceitação" not in extracted.get("generated_prompt", ""):
                    extracted["generated_prompt"] = extracted.get("generated_prompt", "") + "\n\n## Critérios de Aceitação\n\n" + "".join(f"- {ac}\n" for ac in ac_list)
                extracted.setdefault("semantic_map", epic_semantic_map)
                extracted.setdefault("story_points", story.story_points or 5)
                extracted.setdefault("interview_insights", {"derived_from_epic": str(parent_epic.id) if parent_epic else None})
                extracted["ai_model_used"] = ai_model_used
                return extracted

            # No usable content extracted - build from parent context
            epic_desc = (parent_epic.description or parent_epic.generated_prompt or "") if parent_epic else ""
            project_ctx = (project.context_human or project.context_semantic or "")[:2000]
            story_ac = [
                f"AC1: {story.title} completamente implementada",
                "AC2: Testes unitários cobrindo os fluxos principais",
                "AC3: Integração com módulos dependentes verificada",
                "AC4: Interface de usuário funcional e responsiva",
                "AC5: Documentação técnica atualizada"
            ]
            fallback_desc = (
                f"# Story: {story.title}\n\n"
                f"## Visão Geral\n\n"
                f"{story.description or story.title}\n\n"
                f"## Contexto do Epic\n\n"
                f"**{parent_epic.title if parent_epic else 'N/A'}**\n\n"
                f"{epic_desc[:2000]}\n\n"
                f"## Contexto do Projeto\n\n"
                f"{project_ctx}\n\n"
            )
            # PROMPT #180 - Include criteria in generated_prompt
            fallback_prompt = fallback_desc + "## Critérios de Aceitação\n\n" + "".join(f"- {ac}\n" for ac in story_ac)
            return {
                "description": fallback_desc.rstrip() + "\n\n*Conteúdo gerado como fallback. Edite para adicionar detalhes técnicos.*",
                "generated_prompt": fallback_prompt,
                "acceptance_criteria": story_ac,
                "semantic_map": epic_semantic_map,
                "story_points": story.story_points or 5,
                "interview_insights": {"derived_from_epic": str(parent_epic.id) if parent_epic else None},
                "ai_model_used": ai_model_used  # PROMPT #127
            }

        except Exception as e:
            logger.error(f"Error generating story content: {e}")
            # PROMPT #178 - Even on exception, provide meaningful content from parent context
            epic_desc = ""
            if story.parent_id:
                try:
                    pe = self.db.query(Task).filter(Task.id == story.parent_id).first()
                    if pe:
                        epic_desc = f"## Contexto do Epic\n\n**{pe.title}**\n\n{(pe.description or pe.generated_prompt or '')[:2000]}"
                except Exception:
                    pass
            project_ctx = (project.context_human or project.context_semantic or "")[:1500] if project else ""
            fallback = (
                f"# Story: {story.title}\n\n"
                f"{story.description or ''}\n\n"
                f"{epic_desc}\n\n"
                f"## Contexto do Projeto\n\n{project_ctx}\n\n"
                f"*Conteúdo gerado como fallback após erro. Edite para adicionar detalhes.*"
            )
            return {
                "description": fallback,
                "generated_prompt": fallback,
                "acceptance_criteria": [f"{story.title} implementada e funcional"],
                "semantic_map": {},
                "story_points": story.story_points or 5,
                "ai_model_used": None  # PROMPT #127
            }
