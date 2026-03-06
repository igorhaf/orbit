"""
Draft generation and batch processing mixin.

Handles generation of suggested epics, draft stories/tasks,
incremental epic generation, and cards from memory.
Extracted from context_generator.py during modularization (PROMPT #249).

Sub-modules:
- draft_helpers.py: Shared helper functions (dedup, hierarchy, wiki context)
- draft_stories.py: DraftStoriesMixin (story generation from epics)
- draft_tasks.py: DraftTasksMixin (task generation from stories)
"""

from typing import Dict, List, Optional, Any
from uuid import UUID, uuid4
from datetime import datetime
from sqlalchemy.orm import Session
import asyncio
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
    _strip_markdown_json,
    _convert_semantic_to_human,
    _extract_content_from_raw_response,
)
from .draft_stories import DraftStoriesMixin
from .draft_tasks import DraftTasksMixin

logger = logging.getLogger(__name__)


class DraftGeneratorMixin(DraftStoriesMixin, DraftTasksMixin):
    """Mixin providing draft generation and batch processing methods.

    Composes story and task generation from sub-mixins:
    - DraftStoriesMixin: _generate_draft_stories, fallback methods
    - DraftTasksMixin: _generate_draft_tasks, fallback methods

    Epic generation, suggested epics, incremental generation,
    and cards-from-memory remain in this class.
    """

    def _get_usage_type(self) -> str:
        """Return usage_type for AI calls. Supports temporary override via _usage_type_override."""
        return getattr(self, "_usage_type_override", None) or "prompt_generation"

    async def generate_suggested_epics(
        self,
        project_id: UUID,
        context_human: str,
        interview_insights: Dict
    ) -> List[Dict]:
        """
        PROMPT #92 - Generate suggested epics from project context.
        PROMPT #121 - Exclude existing features from memory scan.

        Generates a comprehensive list of macro-level epics (modules) that
        cover the entire scope of the project based on the context interview.

        IMPORTANT (PROMPT #121): Features already existing in the code (detected
        by memory scan) are NOT included as suggested epics. These are already
        documented as closed cards (PROMPT #120). Suggested epics are only for
        NEW functionality to be developed.

        All epics are created as suggestions (inactive) with labels=["suggested"].
        They appear grayed out in the UI until the user activates them.

        Args:
            project_id: Project ID
            context_human: Human-readable project context
            interview_insights: Insights extracted from the context interview

        Returns:
            List of suggested epic dictionaries
        """
        # PROMPT #121 - Get existing features from memory scan
        project = self.db.query(Project).filter(Project.id == project_id).first()
        existing_features = []
        existing_business_rules = []
        if project and project.initial_memory_context:
            memory_ctx = project.initial_memory_context
            existing_features = memory_ctx.get("key_features", [])
            existing_business_rules = memory_ctx.get("business_rules", [])

        # Build section about existing features
        # PROMPT #185 - Removed emojis from prompts
        existing_section = ""
        if existing_features or existing_business_rules:
            existing_section = """

ATENÇÃO - FUNCIONALIDADES JA EXISTENTES NO CÓDIGO:
As seguintes funcionalidades JA FORAM IMPLEMENTADAS e verificadas no código-fonte.
NÃO gere epicos para estas features - elas ja existem e estao documentadas como cards fechados.
Sugira apenas funcionalidades NOVAS que ainda precisam ser desenvolvidas."""

            if existing_features:
                existing_section += "\n\nFEATURES JA IMPLEMENTADAS (não sugerir epicos para estas):"
                for f in existing_features:
                    existing_section += f"\n- [JA EXISTE] {f}"

            if existing_business_rules:
                existing_section += "\n\nREGRAS DE NEGOCIO JA IMPLEMENTADAS (não sugerir epicos para estas):"
                for rule in existing_business_rules[:5]:  # Limit to first 5 for brevity
                    existing_section += f"\n- [JA EXISTE] {rule[:100]}..."

        system_prompt = """Você é um arquiteto de software especialista em decomposição de sistemas.

Sua tarefa é analisar o contexto de um projeto e gerar uma lista de Épicos (módulos macro) para NOVAS funcionalidades a serem desenvolvidas.

REGRAS CRÍTICAS:
1. NÃO sugira épicos para funcionalidades que JÁ EXISTEM no código (marcadas com [JA EXISTE])
2. Sugira APENAS épicos para funcionalidades NOVAS que ainda precisam ser desenvolvidas
3. Se uma feature já existe ([JA EXISTE]), NÃO inclua épico similar ou relacionado
4. Foque em melhorias, extensões e novas capacidades que o sistema AINDA NÃO TEM

MODO INSIGHTS - GERAÇÃO CRIATIVA:
Você NÃO é um decompositor mecânico. Pense como um CTO estratégico:
- Sugira épicos que tragam INSIGHTS NOVOS sobre o que o sistema precisa
- Considere: observabilidade, segurança, performance, automação, developer experience
- Proponha módulos que um time junior esqueceria (auditoria, feature flags, A/B testing)
- Pense em: "O que tornaria este sistema realmente PROFISSIONAL e ESCALÁVEL?"

REGRAS GERAIS:
1. Cada épico representa um MÓDULO ou ÁREA FUNCIONAL macro do sistema
2. Use nomes CURTOS e DESCRITIVOS para os épicos (máx 50 caracteres)
3. A descrição deve ser detalhada (3-5 frases) explicando escopo, valor e impacto
4. Ordene por prioridade/dependência lógica (fundacionais primeiro)

FORMATO DE RESPOSTA (JSON):
```json
{
    "epics": [
        {
            "title": "Nova Funcionalidade X",
            "description": "Descrição da nova funcionalidade que ainda não existe no sistema.",
            "priority": "high",
            "order": 1
        }
    ]
}
```

PRIORIDADES VÁLIDAS: critical, high, medium, low

IMPORTANTE:
- Se o sistema já tem muitas features implementadas, é normal ter POUCOS épicos sugeridos
- Pode retornar lista vazia se todas as features principais já existem
- NÃO repita funcionalidades existentes com nomes diferentes
- Retorne APENAS o JSON, sem texto adicional
- NUNCA use emojis ou símbolos especiais nos títulos ou descrições"""

        # Build user prompt with context
        key_features = interview_insights.get("key_features", [])
        target_users = interview_insights.get("target_users", [])

        features_text = "\n".join([f"- {f}" for f in key_features]) if key_features else "Não especificadas"
        users_text = "\n".join([f"- {u}" for u in target_users]) if target_users else "Não especificados"

        user_prompt = f"""Análise o seguinte contexto de projeto e gere épicos apenas para NOVAS funcionalidades:

## CONTEXTO DO PROJETO
{context_human}

## FUNCIONALIDADES DESEJADAS (da entrevista)
{features_text}

## USUÁRIOS DO SISTEMA
{users_text}
{existing_section}

Gere a lista de Épicos apenas para funcionalidades NOVAS que ainda não existem no sistema.
Se todas as principais features já existem, retorne uma lista com poucos ou nenhum épico."""

        # Call AI
        messages = [{"role": "user", "content": user_prompt}]

        response = await self.orchestrator.execute(
            usage_type=self._get_usage_type(),
            messages=messages,
            system_prompt=system_prompt,
            max_tokens=16384,
            enable_rag=True,  # PROMPT #124 - Enable RAG for context generation
            project_id=str(project.id)  # PROMPT #125 - Log to prompts table
        )

        # Parse response
        response_text = response.get("content", "")
        response_text = _strip_markdown_json(response_text)

        try:
            result = json.loads(response_text)
            epics = result.get("epics", [])
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse epic suggestions as JSON: {e}")
            logger.error(f"Response text: {response_text[:500]}...")
            # Return empty list on error - don't fail the whole process
            return []

        # Save epics to database
        saved_epics = []
        priority_map = {
            "critical": PriorityLevel.CRITICAL,
            "high": PriorityLevel.HIGH,
            "medium": PriorityLevel.MEDIUM,
            "low": PriorityLevel.LOW
        }

        for i, epic_data in enumerate(epics):
            try:
                epic = Task(
                    id=uuid4(),
                    project_id=project_id,
                    title=epic_data.get("title", f"Épico {i+1}")[:255],
                    description=epic_data.get("description", ""),
                    item_type=ItemType.EPIC,
                    status=TaskStatus.BACKLOG,
                    priority=priority_map.get(epic_data.get("priority", "medium"), PriorityLevel.MEDIUM),
                    order=epic_data.get("order", i + 1),
                    labels=["suggested"],  # Mark as suggested (inactive)
                    workflow_state="draft",  # Draft state for suggested items
                    reporter="system",
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                self.db.add(epic)
                saved_epics.append({
                    "id": str(epic.id),
                    "title": epic.title,
                    "description": epic.description,
                    "priority": epic_data.get("priority", "medium"),
                    "order": epic.order
                })
            except Exception as e:
                logger.error(f"Failed to create epic '{epic_data.get('title')}': {e}")
                continue

        self.db.commit()

        logger.info(f"Generated {len(saved_epics)} suggested epics for project {project_id}")

        return saved_epics

    async def generate_children(self, parent_id: UUID, count: int = 10) -> Dict:
        """
        PROMPT #127 - Generate draft children for an approved item on-demand.

        Called via "Generate Stories/Tasks" button in the UI.
        The parent must be an approved (non-draft) item.

        Epic -> generates Stories
        Story -> generates Tasks
        Task -> leaf node (no children)

        Args:
            parent_id: The parent item ID
            count: Number of children to generate

        Returns:
            Dict with children_generated count
        """
        parent = self.db.query(Task).filter(Task.id == parent_id).first()
        if not parent:
            raise ValueError(f"Item {parent_id} não encontrado")

        project = self.db.query(Project).filter(Project.id == parent.project_id).first()
        if not project:
            raise ValueError(f"Projeto {parent.project_id} não encontrado")

        if parent.item_type == ItemType.EPIC:
            children = await self._generate_draft_stories(parent, project, count=count)
        elif parent.item_type == ItemType.STORY:
            children = await self._generate_draft_tasks(parent, project, count=count)
        else:
            raise ValueError(f"Não é possível gerar filhos para item_type={parent.item_type.value}")

        child_type = {
            ItemType.EPIC: "stories",
            ItemType.STORY: "tasks",
        }.get(parent.item_type, "items")

        logger.info(f"Generated {len(children)} {child_type} for {parent.item_type.value}: {parent.title}")

        return {
            "parent_id": str(parent.id),
            "parent_title": parent.title,
            "children_generated": len(children),
            "child_type": child_type,
        }

    def _parse_json_response(self, content: str) -> Any:
        """Parse JSON from AI response, handling various formats."""
        import re

        # Remove markdown code blocks
        content = re.sub(r'```json\s*', '', content)
        content = re.sub(r'```\s*', '', content)
        content = content.strip()

        try:
            return json.loads(content)
        except json.JSONDecodeError:
            # Try to find JSON array in content
            match = re.search(r'\[[\s\S]*\]', content)
            if match:
                try:
                    return json.loads(match.group())
                except json.JSONDecodeError:
                    pass
            return None

    async def generate_cards_from_memory(
        self,
        project_id: UUID,
        job_manager=None,
        job_id: Optional[UUID] = None,
        epic_count: int = 10
    ) -> Dict:
        """
        PROMPT #153 - Generate suggested epics and business rule cards from memory scan.
        PROMPT #155 - Now supports incremental epic generation with progress updates.

        This method generates cards using ONLY the memory scan data (initial_memory_context),
        without requiring a Context Interview to be completed. This allows cards to be
        generated in background immediately after the memory scan finishes.

        Two types of cards are generated:
        1. **Business Rule Cards (closed)**: Rules verified in existing code
        2. **Suggested Epics (drafts)**: New functionality to be developed

        Args:
            project_id: Project ID
            job_manager: Optional JobManager for progress updates (PROMPT #155)
            job_id: Optional job UUID for progress updates (PROMPT #155)

        Returns:
            Dict with generation results:
            {
                "success": True/False,
                "business_rule_cards": [...],
                "suggested_epics": [...],
                "context_auto_generated": True/False
            }
        """
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            logger.error(f"Project {project_id} not found for card generation")
            return {"success": False, "error": "Projeto não encontrado"}

        if not project.initial_memory_context:
            logger.warning(f"Project {project_id} has no memory context for card generation")
            return {"success": False, "error": "Nenhum contexto de memória disponível"}

        logger.info(f"Starting card generation from memory for project: {project.name}")

        result = {
            "success": True,
            "business_rule_cards": [],
            "suggested_epics": [],
            "context_auto_generated": False
        }

        # PROMPT #156 - Check only for suggested epics, not all cards.
        # Business rule cards are generated first and should not block epic generation.
        existing_suggested_epics = self.db.query(Task).filter(
            Task.project_id == project_id,
            Task.labels.contains(["suggested"]),
            Task.item_type == ItemType.EPIC
        ).count()

        if existing_suggested_epics > 0:
            logger.info(f"Project {project_id} already has {existing_suggested_epics} suggested epics, skipping epic generation")
            # Still allow business rule cards to be regenerated if missing
            result["skipped_epics"] = True

        # Step 1: Generate rich context from memory scan (if no context exists)
        # PROMPT #264 - Use rich context (4 AI calls: architecture, business domain,
        # features, consolidation) instead of basic deterministic auto-context
        if not project.context_semantic:
            try:
                rich_context = await self.generate_rich_context_from_memory(
                    project_id=project_id,
                    progress_callback=None,
                    ai_timeout=120
                )
                result["context_auto_generated"] = True
                logger.info(f"Rich context generated for project {project.name}")
            except Exception as e:
                logger.warning(f"Rich context failed, falling back to auto-context: {e}")
                # Fallback to basic deterministic context
                try:
                    auto_context = await self._generate_auto_context_from_memory(project)
                    result["context_auto_generated"] = True
                    logger.info(f"Auto-generated context (fallback) for project {project.name}")
                except Exception as e2:
                    logger.warning(f"Auto-context also failed: {e2}")
                    # Continue anyway - we can still generate cards

        # Step 2: Generate business rule cards (closed)
        try:
            business_rule_cards = await self.generate_business_rule_cards(project_id)
            result["business_rule_cards"] = business_rule_cards
            logger.info(f"Generated {len(business_rule_cards)} business rule cards")
        except Exception as e:
            logger.error(f"Failed to generate business rule cards: {e}")

        # Step 3: Generate suggested epics from memory context
        # PROMPT #156 - Skip only if suggested epics already exist
        # PROMPT #155 - Use incremental generation if job_manager is provided
        if result.get("skipped_epics"):
            logger.info("Skipping epic generation - suggested epics already exist")
        else:
            try:
                if job_manager and job_id:
                    # Calculate batches from epic_count
                    import math
                    epics_per_batch = min(epic_count, 5)
                    max_batches = math.ceil(epic_count / epics_per_batch) if epics_per_batch > 0 else 1
                    logger.info(f"Epic generation: {epic_count} epics requested ({max_batches} batches x {epics_per_batch})")
                    # Incremental generation with WebSocket updates
                    epic_result = await self.generate_epics_incrementally(
                        project=project,
                        job_manager=job_manager,
                        job_id=job_id,
                        max_batches=max_batches,
                        epics_per_batch=epics_per_batch
                    )
                    result["suggested_epics"] = epic_result.get("epics", [])
                    result["batches_processed"] = epic_result.get("batches_processed", 0)
                    logger.info(f"Generated {len(result['suggested_epics'])} suggested epics (incremental)")
                else:
                    # Legacy single-call generation
                    suggested_epics = await self._generate_suggested_epics_from_memory(project)
                    result["suggested_epics"] = suggested_epics
                    logger.info(f"Generated {len(suggested_epics)} suggested epics")
            except Exception as e:
                logger.error(f"Failed to generate suggested epics: {e}")

        logger.info(f"Card generation complete for project {project.name}")
        logger.info(f"   - Business Rules: {len(result['business_rule_cards'])}")
        logger.info(f"   - Suggested Epics: {len(result['suggested_epics'])}")

        return result

    async def _generate_suggested_epics_from_memory(self, project: Project) -> List[Dict]:
        """
        PROMPT #153 - Generate suggested epics from memory scan data.

        Uses AI to analyze the memory scan results and suggest new epics
        for functionality that doesn't exist yet in the codebase.

        Args:
            project: Project instance with initial_memory_context

        Returns:
            List of suggested epic dictionaries
        """
        memory_ctx = project.initial_memory_context
        if not memory_ctx:
            return []

        existing_features = memory_ctx.get("key_features", [])
        existing_rules = memory_ctx.get("business_rules", [])
        interview_context = memory_ctx.get("interview_context", "")
        stack_info = memory_ctx.get("stack_info", {})

        # Build the prompt
        system_prompt = """Você é um CTO estratégico e consultor de produto sênior.

Sua tarefa é analisar o contexto de um projeto existente e sugerir épicos (módulos macro)
que tragam INSIGHTS VALIOSOS e IDEIAS CRIATIVAS para evoluir o sistema.

MODO INSIGHTS:
Pense como um consultor sênior que analisa o sistema e sugere:
- Módulos que o time não pensou mas são essenciais (observabilidade, auditoria, chaos testing)
- Melhorias de arquitetura que escalam (CQRS, event sourcing, cache distribuído)
- Automações que economizam tempo (CI/CD avançado, auto-scaling, alertas inteligentes)
- Funcionalidades de produto que diferenciam (analytics, A/B testing, feature flags)
Cada épico deve ser um INSIGHT que faça o PO pensar "isso é importante".

REGRAS CRÍTICAS:
1. As funcionalidades listadas JÁ EXISTEM no código - NÃO sugira épicos para elas
2. Sugira APENAS épicos para funcionalidades NOVAS que agregariam valor REAL
3. Foque em: observabilidade, segurança, performance, automação, DX, analytics
4. Sugira entre 5 e 15 épicos, priorizados por valor de negócio

FORMATO DE RESPOSTA (JSON):
```json
{
    "epics": [
        {
            "title": "Título do Épico",
            "description": "Descrição detalhada (3-5 frases) com escopo, valor de negócio e impacto técnico",
            "priority": "high|medium|low",
            "order": 1
        }
    ]
}
```

IMPORTANTE:
- Retorne APENAS o JSON, sem texto adicional
- Prioridades: high (essencial), medium (importante), low (nice-to-have)
- Ordene por prioridade e dependência lógica
- Cada description deve ter NO MÍNIMO 200 caracteres"""

        # Build user prompt with context
        user_parts = [
            "## Análise do Projeto",
            f"**Nome:** {project.name}",
            ""
        ]

        if stack_info.get("detected_stack"):
            user_parts.append(f"**Stack:** {stack_info['detected_stack']}")

        if interview_context:
            user_parts.extend(["", "## Descrição do Sistema", interview_context])

        if existing_features:
            user_parts.extend(["", "## Funcionalidades JÁ EXISTENTES (NÃO sugerir épicos para estas):"])
            for f in existing_features:
                user_parts.append(f"- [JA EXISTE] {f}")

        if existing_rules:
            user_parts.extend(["", "## Regras de Negócio JÁ IMPLEMENTADAS:"])
            for rule in existing_rules[:10]:
                user_parts.append(f"- {rule[:100]}...")

        user_parts.extend([
            "",
            "## Sua Tarefa",
            "Sugira épicos para NOVAS funcionalidades que MELHORARIAM este sistema.",
            "Lembre-se: as features listadas acima JÁ EXISTEM - foque em funcionalidades NOVAS."
        ])

        user_prompt = "\n".join(user_parts)

        try:
            response = await self.orchestrator.execute(
                usage_type=self._get_usage_type(),
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=8192,
                project_id=str(project.id)  # PROMPT #125 - Log to prompts table
            )

            content = response.get("content", "")
            result = _robust_json_parse(content, "suggested_epics_from_memory")

            epics = result.get("epics", []) if result else []

            # Create epic records
            saved_epics = []
            for i, epic_data in enumerate(epics):
                title = epic_data.get("title", f"Épico {i+1}")
                description = epic_data.get("description", "")
                priority_str = epic_data.get("priority", "medium").lower()
                order = epic_data.get("order", i + 1)

                # Map priority string to enum
                priority_map = {
                    "critical": PriorityLevel.CRITICAL,
                    "high": PriorityLevel.HIGH,
                    "medium": PriorityLevel.MEDIUM,
                    "low": PriorityLevel.LOW
                }
                priority = priority_map.get(priority_str, PriorityLevel.MEDIUM)

                # Create task record
                epic = Task(
                    id=uuid4(),
                    project_id=project.id,
                    title=title,
                    description=description,
                    item_type=ItemType.EPIC,
                    status=TaskStatus.TODO,
                    priority=priority,
                    order=order + 100,  # After business rule cards
                    labels=["suggested"],  # Mark as suggested
                    workflow_state="draft",  # Draft state - not active
                    reporter="system",
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                self.db.add(epic)

                saved_epics.append({
                    "id": str(epic.id),
                    "title": title,
                    "description": description,
                    "priority": priority_str,
                    "order": order
                })

            self.db.commit()
            logger.info(f"Created {len(saved_epics)} suggested epics for project {project.name}")

            return saved_epics

        except Exception as e:
            logger.error(f"Error generating suggested epics from memory: {e}")
            return []

    # =========================================================================
    # PROMPT #155 - INCREMENTAL EPIC GENERATION
    # =========================================================================

    async def generate_epics_incrementally(
        self,
        project: Project,
        job_manager,
        job_id: UUID,
        max_batches: int = 4,
        epics_per_batch: int = 5
    ) -> Dict[str, Any]:
        """
        PROMPT #155 - Incremental epic generation.

        Generates epics in smaller batches, saving each batch to the database
        and notifying the frontend via WebSocket after each batch.

        Args:
            project: Project instance
            job_manager: JobManager instance for progress updates
            job_id: UUID of the current job
            max_batches: Maximum number of batches to generate (default: 4)
            epics_per_batch: Number of epics per batch (default: 5)

        Returns:
            Dict with success status, total_epics, batches_processed, and epics list
        """
        all_epics = []
        existing_titles = set()  # Avoid duplicates between batches
        batches_processed = 0

        # Get memory context for prompt building
        memory_ctx = project.initial_memory_context or {}
        existing_features = memory_ctx.get("key_features", [])
        interview_context = memory_ctx.get("interview_context", "")
        stack_info = memory_ctx.get("stack_info", {})

        for batch_num in range(1, max_batches + 1):
            batches_processed = batch_num

            # Calculate and update progress
            progress = (batch_num / max_batches) * 90  # Max 90%, save 10% for finalization
            job_manager.update_progress(
                job_id,
                progress,
                f"Generating epics (batch {batch_num}/{max_batches})..."
            )

            # Generate batch of epics
            batch_epics = await self._generate_epic_batch(
                project=project,
                batch_number=batch_num,
                epics_per_batch=epics_per_batch,
                existing_titles=existing_titles,
                existing_features=existing_features,
                interview_context=interview_context,
                stack_info=stack_info
            )

            if not batch_epics:
                # AI indicated no more relevant epics
                logger.info(f"Batch {batch_num}: No more epics to generate")
                break

            # Save epics to database immediately
            saved_epics = self._save_epic_batch(project, batch_epics)
            all_epics.extend(saved_epics)

            # Update set of existing titles to avoid duplicates
            for epic in batch_epics:
                existing_titles.add(epic.get("title", "").lower())

            # Broadcast to frontend (epics created in this batch)
            await self._broadcast_epic_batch(project.id, saved_epics, batch_num, max_batches)

            logger.info(f"Batch {batch_num}: Generated {len(saved_epics)} epics")

        return {
            "success": True,
            "total_epics": len(all_epics),
            "batches_processed": batches_processed,
            "epics": all_epics
        }

    async def _generate_epic_batch(
        self,
        project: Project,
        batch_number: int,
        epics_per_batch: int,
        existing_titles: set,
        existing_features: List[str],
        interview_context: str,
        stack_info: Dict
    ) -> List[Dict]:
        """
        PROMPT #155 - Generate a batch of epics, excluding already generated titles.

        Args:
            project: Project instance
            batch_number: Current batch number (1-based)
            epics_per_batch: Number of epics to generate
            existing_titles: Set of lowercase titles already generated
            existing_features: List of features that already exist in code
            interview_context: AI analysis of the codebase
            stack_info: Stack detection info

        Returns:
            List of epic dictionaries or empty list if no more epics
        """
        # Build exclusion list from already generated epics
        exclude_list = "\n".join([f"- {t}" for t in existing_titles]) if existing_titles else "Nenhum ainda"

        # Build exclusion list from existing features (from memory scan)
        features_list = "\n".join([f"- [JA EXISTE] {f}" for f in existing_features]) if existing_features else "Nenhuma"

        system_prompt = f"""Você é um CTO estratégico e consultor de produto sênior.
Gere até {epics_per_batch} épicos de software para o projeto.

## MODO INSIGHTS - GERAÇÃO CRIATIVA:
Você NÃO é um decompositor mecânico. Pense estrategicamente:
- Sugira épicos que tragam INSIGHTS NOVOS sobre o que o sistema precisa
- Considere: observabilidade, segurança avançada, performance, automação, DX
- Proponha módulos que um time junior esqueceria (auditoria, feature flags, chaos testing)
- Pense em: "O que tornaria este sistema PROFISSIONAL e ESCALÁVEL?"
- Cada épico deve ser uma ideia que faça o PO pensar "isso é importante, não tinha pensado nisso"

## REGRAS CRÍTICAS:

1. Gere entre 1 e {epics_per_batch} épicos nesta resposta (quanto mais relevantes, melhor)
2. NÃO repita épicos já gerados em batches anteriores (lista abaixo)
3. NÃO sugira épicos para funcionalidades que JÁ EXISTEM no código
4. Se não houver mais épicos RELEVANTES a sugerir, retorne "has_more": false com a lista parcial
5. Responda APENAS com JSON válido, sem texto adicional

## ÉPICOS JÁ GERADOS (NÃO REPETIR):
{exclude_list}

## FUNCIONALIDADES JÁ EXISTENTES NO CÓDIGO (NÃO CRIAR ÉPICOS PARA ESTAS):
{features_list}

## FORMATO DE RESPOSTA:
```json
{{
    "epics": [
        {{
            "title": "Título claro e conciso",
            "description": "Descrição detalhada do módulo (3-5 frases cobrindo escopo, objetivo, valor de negócio e impacto técnico)",
            "priority": "high|medium|low"
        }}
    ],
    "has_more": true
}}
```

Se não houver mais épicos relevantes, retorne os que encontrar com "has_more": false.
Retorne lista vazia SOMENTE se realmente não existir nenhum épico novo a sugerir.

IMPORTANTE:
- Foque em: integrações, automações, observabilidade, segurança, performance, developer experience
- Prioridades: high (essencial), medium (importante), low (nice-to-have)
- Cada description deve ter NO MÍNIMO 200 caracteres com detalhes do escopo e VALOR que agrega
- Seja específico, prático e CRIATIVO - gere insights, não boilerplate"""

        # Build user prompt
        user_parts = [f"## Projeto: {project.name}"]

        if stack_info.get("detected_stack"):
            user_parts.append(f"**Stack:** {stack_info['detected_stack']}")

        if interview_context:
            user_parts.extend(["", "## Descrição do Sistema:", interview_context[:2000]])  # Limit context size

        user_parts.extend([
            "",
            f"## Tarefa",
            f"Gere o lote {batch_number} de {epics_per_batch} épicos para NOVAS funcionalidades.",
            "Lembre-se: não repita épicos já gerados e não sugira funcionalidades existentes."
        ])

        user_prompt = "\n".join(user_parts)

        try:
            response = await self.orchestrator.execute(
                usage_type=self._get_usage_type(),
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=8192,
                project_id=str(project.id)  # PROMPT #125 - Log to prompts table
            )

            content = response.get("content", "")
            result = _robust_json_parse(content, f"epic_batch_{batch_number}")

            epics = result.get("epics", []) if result else []

            # Check if AI indicated no more epics
            has_more = result.get("has_more", True) if result else True
            if not has_more and not epics:
                return []

            return epics

        except Exception as e:
            logger.error(f"Error generating epic batch {batch_number}: {e}")
            return []

    def _save_epic_batch(self, project: Project, epics: List[Dict]) -> List[Dict]:
        """
        PROMPT #155 - Save a batch of epics to the database as drafts.

        Args:
            project: Project instance
            epics: List of epic dictionaries from AI

        Returns:
            List of saved epic dictionaries with IDs
        """
        saved = []
        base_order = 100  # Start after business rule cards

        for i, epic_data in enumerate(epics):
            # PROMPT #175 - Validate batch epic fields
            title = (epic_data.get("title") or f"Untitled Epic").strip()[:255]
            if not title or title == "Untitled Epic":
                title = f"Epic {i + 1} - {project.name}"
                logger.warning(f"  Batch epic has empty/default title, using fallback: {title}")
            description = (epic_data.get("description") or "")
            priority_str = (epic_data.get("priority") or "medium").lower()

            # Map priority string to enum
            priority_map = {
                "critical": PriorityLevel.CRITICAL,
                "high": PriorityLevel.HIGH,
                "medium": PriorityLevel.MEDIUM,
                "low": PriorityLevel.LOW
            }
            priority = priority_map.get(priority_str, PriorityLevel.MEDIUM)

            task = Task(
                id=uuid4(),
                project_id=project.id,
                title=title,
                description=description,
                item_type=ItemType.EPIC,
                status=TaskStatus.TODO,
                priority=priority,
                order=base_order + i,
                labels=["suggested"],
                workflow_state="draft",
                reporter="system",
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            self.db.add(task)

            saved.append({
                "id": str(task.id),
                "title": task.title,
                "description": task.description,
                "priority": priority_str,
                "item_type": "epic",
                "workflow_state": "draft",
                "labels": ["suggested"]
            })

        self.db.commit()
        return saved

    async def _broadcast_epic_batch(
        self,
        project_id: UUID,
        epics: List[Dict],
        batch_num: int,
        total_batches: int
    ):
        """
        PROMPT #155 - Broadcast newly created epics to frontend via WebSocket.

        Args:
            project_id: UUID of the project
            epics: List of saved epic dictionaries
            batch_num: Current batch number
            total_batches: Total number of batches
        """
        try:
            from app.api.websocket import broadcast_job_event

            await broadcast_job_event("epics_batch_created", {
                "project_id": str(project_id),
                "batch_number": batch_num,
                "total_batches": total_batches,
                "epics_count": len(epics),
                "epics": epics
            })

            logger.debug(f"Broadcast epic batch {batch_num}: {len(epics)} epics")

        except Exception as e:
            logger.warning(f"Failed to broadcast epic batch: {e}")
