# memory — 2026-02-21

**Model:** claudio/claude-sonnet-4-6
**Status:** success
**Tokens:** 0 in / 0 out | Cost: $0.0000

## System Prompt

Você é um ANALISTA DE NEGÓCIOS experiente analisando código-fonte para extrair regras de negócio FUNCIONAIS.

Sua perspectiva é de NEGÓCIO, não de tecnologia. Imagine que você está escrevendo um documento
para o GERENTE DE PRODUTO ou DONO DO NEGÓCIO que não entende código.

EXTRAIA regras que respondam:
- O que o USUÁRIO pode ou não pode fazer?
- Quais são as PERMISSÕES e RESTRIÇÕES de acesso?
- Como funcionam os FLUXOS e PROCESSOS do sistema?
- Quais CÁLCULOS de negócio existem (preços, comissões, notas)?
- Quais LIMITES e QUOTAS o sistema impõe?
- Quais VALIDAÇÕES afetam a experiência do usuário?
- Como as ENTIDADES do negócio se relacionam?

IGNORE COMPLETAMENTE (não são regras de negócio):
- Tipos de campos (booleano, string, integer)
- Configurações de framework (drivers, sessões, guards, middleware)
- Detalhes de banco (foreign keys, NOT NULL, migrations)
- CSS, layout, estilização
- Logs, cache, filas, timeouts
- Imports, dependências, bibliotecas
- Configurações de ambiente (.env, configs)
- Código boilerplate ou padrões técnicos

FORMATO das regras (escreva como linguagem de negócio):
✅ BOM: "O aluno só pode avaliar um curso após completar pelo menos 50% das aulas"
✅ BOM: "O instrutor recebe 70% do valor de cada inscrição em seu curso"
✅ BOM: "Cupons de desconto expiram após a data limite definida pelo instrutor"
❌ RUIM: "O campo 'rating' deve ser um integer entre 1 e 5"
❌ RUIM: "A tabela enrollments tem foreign key para courses"
❌ RUIM: "O guard 'web' usa driver de sessão"

Responda APENAS em JSON válido, sem markdown, sem explicações adicionais.

## User Prompt

Arquivo: backend/app/services/context_generator/card_activator.py
Linguagem: python

```
"""
Card activation and content generation mixin.

Handles activation of suggested epics/stories/tasks/subtasks
with full semantic content generation.
Extracted from context_generator.py during modularization (PROMPT #249).
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
from app.services.rag_service import RAGService
from app.prompts.loader import get_prompt_loader  # PROMPT #234 YP-1
from .utils import (
    _robust_json_parse,
    _strip_emojis,
    _convert_semantic_to_human,
    _extract_content_from_raw_response,
)

logger = logging.getLogger(__name__)


class CardActivatorMixin:
    """Mixin providing card activation and rich content generation methods."""

    async def activate_suggested_epic(self, epic_id: UUID) -> Dict:
        """
        PROMPT #94 - Activate a suggested item by generating full content.

        Takes a suggested item (with labels=["suggested"] and workflow_state="draft")
        and generates full semantic content using the project context.

        Works with any item type (Epic, Story, Task, Subtask).

        Flow:
        1. Validate item is a suggested item
        2. Fetch project context
        3. Generate full item content using AI (semantic markdown + human description)
        4. Update item with generated content
        5. Remove "suggested" label and change workflow_state to "open"
        6. Lock project context if this is the first activated item (for Epics)

        Args:
            epic_id: Item ID to activate (named epic_id for backwards compatibility)

        Returns:
            Dict with activated item data:
            {
                "id": str,
                "title": str,
                "description": str,
                "generated_prompt": str,
                "semantic_map": Dict,
                "acceptance_criteria": List[str],
                "story_points": int,
                "priority": str,
                "activated": True
            }

        Raises:
            ValueError: If item not found, not suggested, or project has no context
        """
        # 1. Fetch item
        epic = self.db.query(Task).filter(Task.id == epic_id).first()
        if not epic:
            raise ValueError(f"Item {epic_id} não encontrado")

        # Check if it's a suggested item
        is_suggested = (
            epic.labels and "suggested" in epic.labels
        ) or epic.workflow_state == "draft"

        if not is_suggested:
            raise ValueError(
                f"Item {epic_id} não é um item sugerido. "
                "Pode ja ter sido ativado."
            )

        # 2. Fetch project and context
        # PROMPT #234 SM-2: Use FOR UPDATE to prevent race condition on context_locked
        project = self.db.query(Project).with_for_update().filter(Project.id == epic.project_id).first()
        if not project:
            raise ValueError(f"Projeto {epic.project_id} não encontrado")

        # PROMPT #247 - context_semantic is manual, no fallback auto-generation
        if not project.context_semantic:
            raise ValueError(
                f"Projeto {project.id} não tem contexto. "
                "Execute um scan de memória ou aguarde o pipeline RAG processar os arquivos."
            )

        # 3. Generate full epic content using AI
        epic_content = await self._generate_full_epic_content(
            project=project,
            epic_title=epic.title,
            epic_description=epic.description
        )

        # 3.5. Validate and restructure AI response
        epic_content = self._validate_and_restructure_content(
            epic_content, epic.title, epic.description, project
        )

        # 4. Update epic with generated content
        # PROMPT #232 - REGRA #0: Human data is sacred - never overwrite human edits
        if epic.description_edited_by != 'human':
            epic.description = epic_content["description"]
            epic.description_edited_by = 'ai'
        else:
            logger.info(f"🛡️ Preserving human-edited description for epic '{epic.title}'")

        if epic.prompt_edited_by != 'human':
            epic.generated_prompt = epic_content["generated_prompt"]
            epic.prompt_edited_by = 'ai'
        else:
            logger.info(f"🛡️ Preserving human-edited prompt for epic '{epic.title}'")

        epic.acceptance_criteria = epic_content.get("acceptance_criteria", [])
        epic.story_points = epic_content.get("story_points")
        # PROMPT #127 - Track which AI model generated the content
        epic.created_by_ai_model = epic_content.get("ai_model_used")

        # PROMPT #95 - Store complete interview_insights for traceability
        # Includes semantic_map, key_requirements, business_goals, technical_constraints
        epic.interview_insights = epic.interview_insights or {}
        epic.interview_insights["semantic_map"] = epic_content.get("semantic_map", {})
        epic.interview_insights["activated_from_suggestion"] = True
        epic.interview_insights["activation_timestamp"] = datetime.utcnow().isoformat()

        # Merge additional interview_insights from AI response
        ai_insights = epic_content.get("interview_insights", {})
        if ai_insights:
            epic.interview_insights["key_requirements"] = ai_insights.get("key_requirements", [])
            epic.interview_insights["business_goals"] = ai_insights.get("business_goals", [])
            epic.interview_insights["technical_constraints"] = ai_insights.get("technical_constraints", [])

        # 5. Remove "suggested" label and change workflow_state
        if epic.labels and "suggested" in epic.labels:
            epic.labels = [l for l in epic.labels if l != "suggested"]
        epic.workflow_state = "open"
        epic.updated_at = datetime.utcnow()

        # 6. Lock project context (first item activated = context locked)
        # PROMPT #232 - IC-2 fix: lock context on ANY card activation, not just Epic
        if not project.context_locked:
            project.context_locked = True
            project.context_locked_at = datetime.utcnow()
            logger.info(f"🔒 Context locked for project {project.name} (first item activated)")

            # PROMPT #162 - Index project context in RAG for cross-project learning
            try:
                rag_service = RAGService(self.db)
                rag_service.store_project_context(
                    project_id=project.id,
                    context_semantic=project.context_semantic,
                    context_human=project.context_human or ""
                )
                logger.info(f"📚 Project context indexed in RAG: {project.name}")
            except Exception as e:
                logger.error(f"❌ Error indexing context in RAG: {str(e)}")

        # PROMPT #126 - Update project status to "active" when first epic is approved
        if epic.item_type == ItemType.EPIC and hasattr(project, 'status'):
            from app.models.project import ProjectStatus
            if project.status != ProjectStatus.active:
                project.status = ProjectStatus.active
                logger.info(f"✅ Project status changed to 'active': {project.name}")

        self.db.commit()
        self.db.refresh(epic)

        # PROMPT #95 - Enhanced logging
        logger.info(f"✅ Item activated: {epic.title} ({epic.item_type.value if epic.item_type else 'unknown'})")
        logger.info(f"   - Description: {len(epic.description or '')} chars")
        logger.info(f"   - Description preview: {(epic.description or '')[:300]}...")
        logger.info(f"   - Generated Prompt: {len(epic.generated_prompt or '')} chars")
        logger.info(f"   - Generated Prompt preview: {(epic.generated_prompt or '')[:300]}...")
        logger.info(f"   - Acceptance Criteria: {len(epic.acceptance_criteria or [])} items")
        logger.info(f"   - Story Points: {epic.story_points}")
        logger.info(f"   - Labels: {epic.labels}")
        logger.info(f"   - Workflow State: {epic.workflow_state}")
        logger.info(f"   - Interview Insights keys: {list(epic.interview_insights.keys()) if epic.interview_insights else []}")
        if epic.interview_insights:
            logger.info(f"   - Key Requirements: {len(epic.interview_insights.get('key_requirements', []))} items")
            logger.info(f"   - Business Goals: {len(epic.interview_insights.get('business_goals', []))} items")
            logger.info(f"   - Technical Constraints: {len(epic.interview_insights.get('technical_constraints', []))} items")

        # PROMPT #264 - Re-enable auto-generation of draft children after activation
        # (Previously disabled by PROMPT #127)
        children_count = 0
        try:
            if epic.item_type == ItemType.EPIC:
                children = await self._generate_draft_stories(epic, project, count=10)
                children_count = len(children)
            elif epic.item_type == ItemType.STORY:
                children = await self._generate_draft_tasks(epic, project, count=8)
                children_count = len(children)
            elif epic.item_type == ItemType.TASK:
                children = await self._generate_draft_subtasks(epic, project, count=5)
                children_count = len(children)
            logger.info(f"✅ Auto-generated {children_count} draft children for {epic.title}")
        except Exception as e:
            logger.warning(f"⚠️ Auto-generation of children failed (non-blocking): {e}")

        # PROMPT #162 - Index activated card in RAG for semantic search
        try:
            rag_service = RAGService(self.db)
            rag_service.store_card(
                card_id=epic.id,
                title=epic.title,
                description=epic.description,
                generated_prompt=epic.generated_prompt,
                item_type=epic.item_type.value if epic.item_type else "epic",
                parent_id=epic.parent_id,
                labels=epic.labels,
                workflow_state=epic.workflow_state,
                project_id=epic.project_id
            )
            logger.info(f"📇 Epic indexed in RAG: {epic.title}")
        except Exception as e:
            logger.error(f"❌ Error indexing epic in RAG: {str(e)}")
            # Don't fail activation if RAG indexing fails

        return {
            "id": str(epic.id),
            "title": epic.title,
            "description": epic.description,
            "generated_prompt": epic.generated_prompt,
            "semantic_map": epic_content.get("semantic_map", {}),
            "acceptance_criteria": epic.acceptance_criteria,
            "story_points": epic.story_points,
            "priority": epic.priority.value if epic.priority else "medium",
            "activated": True,
            "children_generated": children_count
        }
    def _validate_and_restructure_content(
        self,
        content: Dict,
        title: str,
        original_description: str,
        project: Project,
        item_type: str = "epic"
    ) -> Dict:
        """
        PROMPT #173/#175 - Validate and restructure AI-generated content.

        Ensures all required fields are present and non-empty.
        If critical fields are empty/missing, rebuilds them from available data.
        Type-aware defaults based on item_type (epic/story/task/subtask).

        Required contract:
        - description: non-empty string (human-readable)
        - generated_prompt: non-empty string (semantic markdown for AI)
        - acceptance_criteria: list with at least 1 item
        - story_points: integer > 0 (skipped for subtask)
        """
        # PROMPT #175 - Type-aware defaults
        ITEM_DEFAULTS = {
            "epic":    {"min_description": 50, "min_prompt": 50, "default_story_points": 13},
            "story":   {"min_description": 50, "min_prompt": 50, "default_story_points": 8},
            "task":    {"min_description": 30, "min_prompt": 30, "default_story_points": 3},
            "subtask": {"min_description": 20, "min_prompt": 20, "default_story_points": None},
        }
        defaults = ITEM_DEFAULTS.get(item_type, ITEM_DEFAULTS["epic"])
        MIN_DESCRIPTION_LEN = defaults["min_description"]
        MIN_PROMPT_LEN = defaults["min_prompt"]
        default_story_points = defaults["default_story_points"]

        description = content.get("description", "") or ""
        generated_prompt = content.get("generated_prompt", "") or ""
        acceptance_criteria = content.get("acceptance_criteria", []) or []
        story_points = content.get("story_points")
        semantic_map = content.get("semantic_map", {}) or {}
        interview_insights = content.get("interview_insights", {}) or {}

        issues = []

        # --- Validate description ---
        if len(description.strip()) < MIN_DESCRIPTION_LEN:
            issues.append(f"description too short ({len(description.strip())} chars)")

            # Restructure: rebuild from generated_prompt or semantic_map
            if len(generated_prompt.strip()) >= MIN_PROMPT_LEN:
                description = generated_prompt
                logger.info("  Restructured: description rebuilt from generated_prompt")
            elif semantic_map:
                # Build description from semantic map entries
                desc_parts = [f"# {title}\n"]
                for key, value in semantic_map.items():
                    desc_parts.append(f"- **{key}**: {value}")
                description = "\n".join(desc_parts)
                logger.info("  Restructured: description rebuilt from semantic_map")
            else:
                # Last resort: use original description + project context
                project_context = (project.context_human or project.context_semantic or "")[:1000]
                description = (
                    f"# {title}\n\n"
                    f"## Visão Geral\n\n"
                    f"{original_description or 'Módulo do sistema.'}\n\n"
                    f"## Contexto do Projeto\n\n"
                    f"Parte do projeto **{project.name}**.\n\n"
                    f"{project_context}\n\n"
                    f"*Conteúdo gerado automaticamente. Edite para adicionar detalhes técnicos.*"
                )
                logger.info("  Restructured: description rebuilt from title + project context")

        # --- Validate generated_prompt ---
        if len(generated_prompt.strip()) < MIN_PROMPT_LEN:
            issues.append(f"generated_prompt too short ({len(generated_prompt.strip())} chars)")

            # Restructure: use description as prompt
            if len(description.strip()) >= MIN_PROMPT_LEN:
                generated_prompt = description
                logger.info("  Restructured: generated_prompt copied from description")

        # 
```

Extraia as regras de negócio FUNCIONAIS deste arquivo.
Escreva cada regra como se explicasse para um GERENTE DE PRODUTO.
Responda em JSON com este formato exato:

{
  "business_rules": [
    {
      "rule_text": "Descrição funcional da regra em linguagem de negócio",
      "rule_type": "domain|validation|constraint|workflow|permission|calculation",
      "confidence": "high|medium|low",
      "source_context": "trecho relevante do código (max 100 chars)"
    }
  ],
  "entities_found": ["Entidade1", "Entidade2"],
  "file_purpose": "Breve descrição do propósito do arquivo (1 frase)",
  "file_layer": "schema|routes|logic|presentation|config"
}

Se não houver regras de negócio FUNCIONAIS, retorne: {"business_rules": [], "entities_found": [], "file_purpose": "..."}
Arquivos de configuração, estilização e infraestrutura geralmente NÃO contêm regras de negócio.

## Response


