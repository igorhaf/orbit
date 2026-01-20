"""
ContextGeneratorService
PROMPT #89 - Generate project context from Context Interview
PROMPT #92 - Generate suggested epics from context
PROMPT #94 - Activate/Reject suggested epics

This service processes the Context Interview and generates:
- context_semantic: Structured semantic text for AI consumption
- context_human: Human-readable project description
- suggested_epics: List of macro-level epics covering all project modules

The context is the foundational, immutable description of the project
that guides all subsequent interviews and card generation.
"""

from typing import Dict, List, Optional
from uuid import UUID, uuid4
from datetime import datetime
from sqlalchemy.orm import Session
import json
import logging
import re

from app.models.project import Project
from app.models.interview import Interview, InterviewStatus
from app.models.task import Task, TaskStatus, ItemType, PriorityLevel
from app.services.ai_orchestrator import AIOrchestrator
from app.prompter.facade import PrompterFacade

logger = logging.getLogger(__name__)


def _strip_markdown_json(content: str) -> str:
    """
    Remove markdown code blocks from JSON response.
    AI sometimes returns JSON wrapped in ```json ... ``` blocks.
    """
    content = re.sub(r'^```json\s*\n?', '', content, flags=re.MULTILINE)
    content = re.sub(r'\n?```\s*$', '', content, flags=re.MULTILINE)
    return content.strip()


def _convert_semantic_to_human(semantic_text: str, semantic_map: Dict[str, str]) -> str:
    """
    PROMPT #89 - Convert semantic text to human-readable text.

    This function transforms semantic references (identifiers like N1, P1, etc.)
    into their actual meanings, creating natural prose.

    Args:
        semantic_text: Text with semantic identifiers
        semantic_map: Dictionary mapping identifiers to meanings

    Returns:
        Human-readable text with identifiers replaced
    """
    if not semantic_map or not semantic_text:
        return semantic_text or ""

    human_text = semantic_text

    # Sort identifiers by length (longest first) to avoid partial replacements
    sorted_identifiers = sorted(semantic_map.keys(), key=len, reverse=True)

    for identifier in sorted_identifiers:
        meaning = semantic_map[identifier]
        pattern = rf'\b{re.escape(identifier)}\b'
        human_text = re.sub(pattern, meaning, human_text)

    # Clean up multiple consecutive newlines
    human_text = re.sub(r'\n{3,}', '\n\n', human_text)

    return human_text.strip()


class ContextGeneratorService:
    """
    Service for generating project context from Context Interview.

    PROMPT #89 - Context Interview: Foundational Project Description

    This service:
    1. Analyzes the Context Interview conversation
    2. Generates structured semantic text (for AI)
    3. Converts to human-readable description
    4. Saves both to the Project model
    """

    def __init__(self, db: Session):
        self.db = db
        try:
            self.prompter = PrompterFacade(db)
        except RuntimeError:
            self.prompter = None
        self.orchestrator = AIOrchestrator(db)

    async def generate_context_from_interview(
        self,
        interview_id: UUID,
        project_id: UUID
    ) -> Dict:
        """
        Generate project context from Context Interview conversation.

        PROMPT #89 - Context Interview Processing

        Flow:
        1. Validate interview (must be context mode, have enough messages)
        2. AI analyzes conversation and generates structured context
        3. Extract semantic map and create human-readable version
        4. Save to Project model
        5. Mark interview as completed

        Args:
            interview_id: Context Interview ID
            project_id: Project ID

        Returns:
            {
                "context_semantic": str,
                "context_human": str,
                "semantic_map": Dict[str, str],
                "interview_insights": {
                    "project_vision": str,
                    "problem_statement": str,
                    "key_features": [str, ...],
                    "target_users": [str, ...],
                    "success_criteria": [str, ...]
                }
            }

        Raises:
            ValueError: If interview not found, wrong mode, or insufficient data
        """
        # 1. Validate interview
        interview = self.db.query(Interview).filter(Interview.id == interview_id).first()
        if not interview:
            raise ValueError(f"Interview {interview_id} not found")

        # Accept both "context" and "meta_prompt" modes for compatibility
        if interview.interview_mode not in ["context", "meta_prompt"]:
            raise ValueError(
                f"Interview {interview_id} is not a context interview "
                f"(mode: {interview.interview_mode}). Only 'context' mode supported."
            )

        # Minimum 6 messages (3 Q&A pairs - Q1, Q2, Q3 at least)
        if not interview.conversation_data or len(interview.conversation_data) < 6:
            raise ValueError(
                f"Interview {interview_id} has insufficient data. "
                f"Need at least 6 messages (3 Q&A pairs), got {len(interview.conversation_data or [])}."
            )

        # 2. Get project
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        # Check if context is already locked
        if project.context_locked:
            raise ValueError(
                f"Project {project_id} context is already locked. "
                "Cannot regenerate context after first epic is created."
            )

        # 3. Build conversation summary for AI
        conversation_summary = self._build_conversation_summary(interview.conversation_data)

        # 4. Generate context using AI
        context_result = await self._generate_context_with_ai(
            project=project,
            conversation_summary=conversation_summary
        )

        # 5. Save to project
        project.context_semantic = context_result["context_semantic"]
        project.context_human = context_result["context_human"]
        project.description = context_result["context_human"]  # Also update description

        # 6. Mark interview as completed
        interview.status = InterviewStatus.COMPLETED

        self.db.commit()

        logger.info(f"✅ Context generated for project {project.name}")
        logger.info(f"   - Semantic: {len(context_result['context_semantic'])} chars")
        logger.info(f"   - Human: {len(context_result['context_human'])} chars")

        # 7. PROMPT #92 - Generate suggested epics from context
        try:
            suggested_epics = await self.generate_suggested_epics(
                project_id=project_id,
                context_human=context_result["context_human"],
                interview_insights=context_result.get("interview_insights", {})
            )
            context_result["suggested_epics"] = suggested_epics
            logger.info(f"   - Suggested Epics: {len(suggested_epics)}")
        except Exception as e:
            logger.error(f"Failed to generate suggested epics: {e}")
            context_result["suggested_epics"] = []

        return context_result

    def _build_conversation_summary(self, conversation_data: List[Dict]) -> str:
        """
        Build a structured summary of the conversation for AI processing.

        Args:
            conversation_data: List of conversation messages

        Returns:
            Formatted conversation summary
        """
        summary_parts = []

        for i, msg in enumerate(conversation_data):
            role = msg.get("role", "unknown")
            content = msg.get("content", "")

            if role == "assistant":
                # AI question
                summary_parts.append(f"**Pergunta:** {content}")
            elif role == "user":
                # User answer
                summary_parts.append(f"**Resposta:** {content}")
                summary_parts.append("")  # Empty line between Q&A pairs

        return "\n".join(summary_parts)

    async def _generate_context_with_ai(
        self,
        project: Project,
        conversation_summary: str
    ) -> Dict:
        """
        Use AI to generate structured context from conversation.

        Args:
            project: Project instance
            conversation_summary: Formatted conversation summary

        Returns:
            Dict with context_semantic, context_human, semantic_map, and insights
        """
        system_prompt = """Você é um especialista em análise de requisitos de software.

Sua tarefa é analisar uma entrevista de contexto de projeto e gerar:

1. **CONTEXTO SEMÂNTICO** (context_semantic):
   - Texto estruturado com identificadores semânticos
   - Use identificadores como: N1 (nome), P1 (problema), V1 (visão), U1 (usuário), F1 (funcionalidade)
   - Inclua um Mapa Semântico no final com todas as definições

2. **MAPA SEMÂNTICO** (semantic_map):
   - Dicionário JSON mapeando cada identificador para seu significado
   - Exemplo: {"N1": "Sistema de Vendas", "P1": "Gestão de estoque ineficiente"}

3. **INSIGHTS DA ENTREVISTA** (interview_insights):
   - project_vision: Visão geral do projeto
   - problem_statement: Problema que o projeto resolve
   - key_features: Lista de funcionalidades principais
   - target_users: Tipos de usuários do sistema
   - success_criteria: Critérios de sucesso

FORMATO DE RESPOSTA (JSON):
```json
{
    "context_semantic": "## Contexto do Projeto\\n\\n### Visão\\nN1 é um sistema que resolve P1...\\n\\n### Usuários\\n- U1: ...\\n\\n## Mapa Semântico\\n- **N1**: Nome do projeto\\n- **P1**: Problema principal",
    "semantic_map": {
        "N1": "Nome do Projeto",
        "P1": "Problema principal",
        "V1": "Visão do projeto",
        "U1": "Primeiro tipo de usuário",
        "F1": "Primeira funcionalidade"
    },
    "interview_insights": {
        "project_vision": "Desenvolver um sistema...",
        "problem_statement": "Atualmente o cliente enfrenta...",
        "key_features": ["Feature 1", "Feature 2"],
        "target_users": ["Admin", "Usuário Final"],
        "success_criteria": ["Reduzir tempo de...", "Aumentar eficiência..."]
    }
}
```

IMPORTANTE:
- O context_semantic deve ser rico e detalhado (mínimo 500 caracteres)
- Use português brasileiro
- Os identificadores devem ser concisos (2-3 caracteres)
- O Mapa Semântico deve estar DENTRO do context_semantic no final
- Retorne APENAS o JSON, sem texto adicional"""

        user_prompt = f"""Analise a seguinte entrevista de contexto para o projeto "{project.name}":

{conversation_summary}

Gere o contexto semântico estruturado, o mapa semântico e os insights conforme especificado."""

        # Call AI
        messages = [{"role": "user", "content": user_prompt}]

        response = await self.orchestrator.execute(
            usage_type="prompt_generation",
            messages=messages,
            system_prompt=system_prompt,
            max_tokens=4000
            # Note: temperature is configured in the AI model settings in the database
        )

        # Parse response
        response_text = response.get("content", "")
        response_text = _strip_markdown_json(response_text)

        try:
            result = json.loads(response_text)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse AI response as JSON: {e}")
            logger.error(f"Response text: {response_text[:500]}...")
            raise ValueError("AI response was not valid JSON. Please try again.")

        # Validate required fields
        if "context_semantic" not in result:
            raise ValueError("AI response missing 'context_semantic' field")

        semantic_map = result.get("semantic_map", {})
        context_semantic = result["context_semantic"]

        # Convert semantic to human-readable
        context_human = _convert_semantic_to_human(context_semantic, semantic_map)

        # Remove the Mapa Semântico section from human text
        context_human = re.sub(
            r'##\s*Mapa\s*Sem[aâ]ntico\s*\n+(?:[-*]\s*\*\*[^*]+\*\*:[^\n]*\n*)*',
            '',
            context_human,
            flags=re.IGNORECASE | re.MULTILINE
        )
        context_human = context_human.strip()

        return {
            "context_semantic": context_semantic,
            "context_human": context_human,
            "semantic_map": semantic_map,
            "interview_insights": result.get("interview_insights", {})
        }

    async def generate_suggested_epics(
        self,
        project_id: UUID,
        context_human: str,
        interview_insights: Dict
    ) -> List[Dict]:
        """
        PROMPT #92 - Generate suggested epics from project context.

        Generates a comprehensive list of macro-level epics (modules) that
        cover the entire scope of the project based on the context interview.

        All epics are created as suggestions (inactive) with labels=["suggested"].
        They appear grayed out in the UI until the user activates them.

        Args:
            project_id: Project ID
            context_human: Human-readable project context
            interview_insights: Insights extracted from the context interview

        Returns:
            List of suggested epic dictionaries
        """
        system_prompt = """Você é um arquiteto de software especialista em decomposição de sistemas.

Sua tarefa é analisar o contexto de um projeto e gerar uma lista ABRANGENTE de Épicos (módulos macro) que cubram TODO o escopo do sistema.

REGRAS:
1. Cada épico representa um MÓDULO ou ÁREA FUNCIONAL macro do sistema
2. A lista deve ser COMPLETA - cobrir 100% das funcionalidades mencionadas no contexto
3. Pense em termos de módulos de software (Autenticação, Dashboard, Relatórios, Configurações, etc.)
4. Inclua também épicos de infraestrutura se relevante (Setup Inicial, Deploy, Integrações)
5. Use nomes CURTOS e DESCRITIVOS para os épicos (máx 50 caracteres)
6. A descrição deve ser breve (1-2 frases) explicando o escopo do módulo
7. Ordene por prioridade/dependência lógica (fundacionais primeiro)

FORMATO DE RESPOSTA (JSON):
```json
{
    "epics": [
        {
            "title": "Autenticação e Autorização",
            "description": "Sistema de login, registro, recuperação de senha e controle de permissões por perfil.",
            "priority": "critical",
            "order": 1
        },
        {
            "title": "Dashboard Principal",
            "description": "Tela inicial com indicadores chave, resumos e acesso rápido às principais funcionalidades.",
            "priority": "high",
            "order": 2
        }
    ]
}
```

PRIORIDADES VÁLIDAS: critical, high, medium, low

IMPORTANTE:
- Gere entre 8 e 20 épicos dependendo da complexidade do projeto
- Cubra TODAS as áreas mencionadas no contexto
- Inclua épicos implícitos (toda aplicação precisa de autenticação, configurações, etc.)
- Retorne APENAS o JSON, sem texto adicional"""

        # Build user prompt with context
        key_features = interview_insights.get("key_features", [])
        target_users = interview_insights.get("target_users", [])

        features_text = "\n".join([f"- {f}" for f in key_features]) if key_features else "Não especificadas"
        users_text = "\n".join([f"- {u}" for u in target_users]) if target_users else "Não especificados"

        user_prompt = f"""Analise o seguinte contexto de projeto e gere a lista completa de Épicos:

## CONTEXTO DO PROJETO
{context_human}

## FUNCIONALIDADES IDENTIFICADAS
{features_text}

## USUÁRIOS DO SISTEMA
{users_text}

Gere a lista de Épicos (módulos macro) que cubra 100% do escopo deste projeto."""

        # Call AI
        messages = [{"role": "user", "content": user_prompt}]

        response = await self.orchestrator.execute(
            usage_type="prompt_generation",
            messages=messages,
            system_prompt=system_prompt,
            max_tokens=4000
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

        logger.info(f"✅ Generated {len(saved_epics)} suggested epics for project {project_id}")

        return saved_epics

    async def lock_context(self, project_id: UUID) -> bool:
        """
        Lock the project context, making it immutable.

        PROMPT #89 - Context is locked automatically when first epic is generated.

        Args:
            project_id: Project ID

        Returns:
            True if locked successfully

        Raises:
            ValueError: If project not found or context already locked
        """
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        if project.context_locked:
            logger.warning(f"Project {project_id} context is already locked")
            return True

        if not project.context_semantic:
            raise ValueError(
                f"Cannot lock context for project {project_id}: no context generated yet"
            )

        project.context_locked = True
        project.context_locked_at = datetime.utcnow()
        self.db.commit()

        logger.info(f"🔒 Context locked for project {project.name}")

        return True

    def is_context_ready(self, project_id: UUID) -> bool:
        """
        Check if project context is ready (generated and optionally locked).

        Args:
            project_id: Project ID

        Returns:
            True if context_semantic is not empty
        """
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return False

        return bool(project.context_semantic)

    def is_context_locked(self, project_id: UUID) -> bool:
        """
        Check if project context is locked.

        Args:
            project_id: Project ID

        Returns:
            True if context is locked
        """
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return False

        return project.context_locked

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
            raise ValueError(f"Item {epic_id} not found")

        # Check if it's a suggested item
        is_suggested = (
            epic.labels and "suggested" in epic.labels
        ) or epic.workflow_state == "draft"

        if not is_suggested:
            raise ValueError(
                f"Item {epic_id} is not a suggested item. "
                "It may have already been activated."
            )

        # 2. Fetch project and context
        project = self.db.query(Project).filter(Project.id == epic.project_id).first()
        if not project:
            raise ValueError(f"Project {epic.project_id} not found")

        if not project.context_semantic:
            raise ValueError(
                f"Project {project.id} has no context. "
                "Please complete the Context Interview first."
            )

        # 3. Generate full epic content using AI
        epic_content = await self._generate_full_epic_content(
            project=project,
            epic_title=epic.title,
            epic_description=epic.description
        )

        # 4. Update epic with generated content
        epic.description = epic_content["description"]
        epic.generated_prompt = epic_content["generated_prompt"]
        epic.acceptance_criteria = epic_content.get("acceptance_criteria", [])
        epic.story_points = epic_content.get("story_points")

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
        if not project.context_locked and epic.item_type == ItemType.EPIC:
            project.context_locked = True
            project.context_locked_at = datetime.utcnow()
            logger.info(f"🔒 Context locked for project {project.name} (first item activated)")

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

        return {
            "id": str(epic.id),
            "title": epic.title,
            "description": epic.description,
            "generated_prompt": epic.generated_prompt,
            "semantic_map": epic_content.get("semantic_map", {}),
            "acceptance_criteria": epic.acceptance_criteria,
            "story_points": epic.story_points,
            "priority": epic.priority.value if epic.priority else "medium",
            "activated": True
        }

    async def _generate_full_epic_content(
        self,
        project: Project,
        epic_title: str,
        epic_description: str
    ) -> Dict:
        """
        Generate full epic content using AI and project context.

        Uses PROMPT #83 Semantic References Methodology to generate:
        - Semantic markdown (generated_prompt) for AI consumption
        - Human description for reading
        - Acceptance criteria
        - Story points estimation
        - Interview insights (key requirements, business goals, technical constraints)

        PROMPT #95 - Enhanced to match the rich structure from Epic Interview flow.

        Args:
            project: Project instance with context
            epic_title: Epic title (from suggested epic)
            epic_description: Epic minimal description (from suggested epic)

        Returns:
            Dict with full epic content
        """
        # PROMPT #95 - Use the same rich structure as backlog_generator.py
        system_prompt = """Você é um Product Owner especialista analisando contexto de projeto para gerar Epics completos.

METODOLOGIA DE REFERÊNCIAS SEMÂNTICAS:

Esta metodologia funciona da seguinte forma:

1. O texto principal utiliza **identificadores simbólicos** (ex: N1, N2, P1, E1, D1, S1, C1) como **referências semânticas**
2. Esses identificadores **NÃO são variáveis, exemplos ou placeholders**
3. Cada identificador possui um **significado único e imutável** definido em um **Mapa Semântico**
4. O texto narrativo deve ser interpretado **exclusivamente** com base nessas definições
5. **Não faça inferências** fora do que está explicitamente definido no Mapa Semântico
6. **Não substitua** os identificadores por seus significados no texto
7. Caso haja ambiguidade, ela deve ser apontada, não resolvida automaticamente
8. Caso seja necessário criar novos conceitos, eles devem ser introduzidos como novos identificadores e definidos separadamente

**Categorias de Identificadores:**
- **N** (Nouns/Entidades): N1, N2, N3... = Usuários, sistemas, entidades de domínio
- **P** (Processes/Processos): P1, P2, P3... = Processos de negócio, fluxos, workflows
- **E** (Endpoints): E1, E2, E3... = APIs, rotas, endpoints
- **D** (Data/Dados): D1, D2, D3... = Tabelas, estruturas de dados, schemas
- **S** (Services/Serviços): S1, S2, S3... = Serviços, integrações, bibliotecas
- **C** (Constraints/Critérios): C1, C2, C3... = Regras de negócio, validações, restrições
- **AC** (Acceptance Criteria): AC1, AC2, AC3... = Critérios de aceitação numerados
- **F** (Features/Funcionalidades): F1, F2, F3... = Funcionalidades específicas
- **M** (Metrics/Métricas): M1, M2, M3... = Métricas, KPIs, indicadores

**Objetivo desta metodologia:**
- Reduzir ambiguidade semântica
- Manter consistência conceitual
- Permitir edição posterior manual do código
- Garantir rastreabilidade entre texto e implementação

Sua tarefa:
1. Analise o contexto do projeto e o épico sugerido
2. Crie um **Mapa Semântico** definindo TODOS os identificadores usados (mínimo 15-20 identificadores)
3. Escreva a narrativa completa do Epic usando APENAS esses identificadores
4. Extraia critérios de aceitação claros (usando identificadores AC1, AC2, AC3...)
5. Extraia insights chave: requisitos, objetivos de negócio, restrições técnicas
6. Estime story points (1-21, escala Fibonacci) baseado na complexidade do Epic
7. Sugira prioridade (critical, high, medium, low, trivial)

IMPORTANTE:
- Um Epic representa um grande corpo de trabalho (múltiplas Stories)
- Foque em VALOR DE NEGÓCIO e RESULTADOS PARA O USUÁRIO
- Use identificadores semânticos em TODO o texto (narrativa, critérios, insights)
- Seja específico e acionável nos critérios de aceitação
- TUDO DEVE SER EM PORTUGUÊS (título, descrição, critérios, identificadores)
- A descrição deve ser RICA e DETALHADA (mínimo 800 caracteres)

Retorne APENAS JSON válido (sem markdown code blocks, sem explicação):
{
    "title": "Título do Epic (conciso, focado em negócio) - EM PORTUGUÊS",
    "semantic_map": {
        "N1": "Definição clara da entidade 1",
        "N2": "Definição clara da entidade 2",
        "P1": "Definição clara do processo 1",
        "E1": "Definição clara do endpoint 1",
        "D1": "Definição clara da estrutura de dados 1",
        "S1": "Definição clara do serviço 1",
        "C1": "Definição clara do critério/regra 1",
        "AC1": "Critério de aceitação 1",
        "AC2": "Critério de aceitação 2"
    },
    "description_markdown": "# Epic: [Título]\\n\\n## Mapa Semântico\\n\\n- **N1**: [definição]\\n- **N2**: [definição]\\n- **P1**: [definição]\\n...\\n\\n## Descrição\\n\\n[Narrativa usando APENAS identificadores do mapa semântico. Ex: 'Este Epic implementa P1 para N1, permitindo que N2 gerencie D1 via E1.']\\n\\n## Critérios de Aceitação\\n\\n1. **AC1**: [critério usando identificadores]\\n2. **AC2**: [critério usando identificadores]\\n...\\n\\n## Insights da Entrevista\\n\\n**Requisitos-Chave:**\\n- [requisito usando identificadores]\\n...\\n\\n**Objetivos de Negócio:**\\n- [objetivo usando identificadores]\\n...\\n\\n**Restrições Técnicas:**\\n- [restrição usando identificadores]\\n...",
    "story_points": 13,
    "priority": "high",
    "acceptance_criteria": [
        "AC1: [Critério específico mensurável usando identificadores semânticos]",
        "AC2: [Critério específico mensurável usando identificadores semânticos]",
        "AC3: [Critério específico mensurável usando identificadores semânticos]"
    ],
    "interview_insights": {
        "key_requirements": ["[requisito usando identificadores]", "[requisito usando identificadores]"],
        "business_goals": ["[objetivo usando identificadores]", "[objetivo usando identificadores]"],
        "technical_constraints": ["[restrição usando identificadores]", "[restrição usando identificadores]"]
    }
}

**REGRAS CRÍTICAS:**
- description_markdown deve conter TODO o conteúdo formatado em Markdown
- O Mapa Semântico deve estar TANTO no description_markdown quanto no campo semantic_map do JSON
- Use identificadores semânticos em TODOS os textos (title pode ser em linguagem natural, mas description/criteria/insights devem usar identificadores)
- NUNCA substitua identificadores por seus significados - mantenha sempre os identificadores no texto
- A seção "Insights da Entrevista" é OBRIGATÓRIA com Requisitos-Chave, Objetivos de Negócio e Restrições Técnicas
"""

        user_prompt = f"""Gere o conteúdo completo para este Epic sugerido usando a Metodologia de Referências Semânticas.

## CONTEXTO DO PROJETO
**Nome:** {project.name}
**Descrição:** {project.description or 'Não especificada'}

**Contexto Semântico do Projeto (USE ESTES IDENTIFICADORES SE APLICÁVEL):**
{project.context_semantic or 'Não disponível'}

**Contexto Legível do Projeto:**
{project.context_human or 'Não disponível'}

## EPIC SUGERIDO
**Título:** {epic_title}
**Descrição Inicial:** {epic_description}

## INSTRUÇÕES
1. **REUTILIZE** identificadores do contexto semântico do projeto quando aplicável
2. **ESTENDA** o mapa com novos identificadores específicos para este Epic
3. Crie um Mapa Semântico COMPLETO (mínimo 15-20 identificadores)
4. Gere uma descrição RICA e DETALHADA usando identificadores semânticos
5. Defina critérios de aceitação claros e mensuráveis (AC1, AC2, AC3...)
6. Inclua seção de Insights com Requisitos-Chave, Objetivos de Negócio e Restrições Técnicas
7. Estime story points baseado na complexidade

LEMBRE-SE:
- TODO O CONTEÚDO DEVE SER EM PORTUGUÊS
- Use identificadores semânticos em TODA a narrativa
- NUNCA substitua identificadores por seus significados
- A descrição deve ter MÍNIMO 800 caracteres
- A seção de Insights da Entrevista é OBRIGATÓRIA

Retorne o Epic completo como JSON seguindo EXATAMENTE o schema fornecido no system prompt."""

        # Call AI - PROMPT #95: Increased max_tokens to 6000 for richer content
        messages = [{"role": "user", "content": user_prompt}]

        response = await self.orchestrator.execute(
            usage_type="prompt_generation",
            messages=messages,
            system_prompt=system_prompt,
            max_tokens=6000  # Increased from 4000 to allow for richer content
        )

        # Parse response - PROMPT #95: Enhanced JSON extraction
        response_text = response.get("content", "")
        original_response = response_text  # Keep original for debugging
        logger.info(f"📥 Raw AI response length: {len(response_text)} chars")

        # Step 0: Try parsing raw response before any transformation
        result = None
        parse_method = "none"

        try:
            result = json.loads(response_text)
            parse_method = "raw_direct"
            logger.info("✅ JSON parsed from raw response directly")
        except json.JSONDecodeError as e:
            logger.debug(f"Raw parse failed: {e}")

        # Step 1: Strip markdown code blocks
        if result is None:
            response_text = _strip_markdown_json(response_text)

        # Step 2: Try multiple JSON extraction strategies

        # Strategy 1: Direct JSON parse after strip
        if result is None:
            try:
                result = json.loads(response_text)
                parse_method = "direct"
                logger.info("✅ JSON parsed directly after strip")
            except json.JSONDecodeError as e:
                logger.debug(f"Direct parse failed: {e}")

        # Strategy 2: Extract JSON object with regex (greedy)
        if result is None:
            json_match = re.search(r'\{[\s\S]*\}', response_text)
            if json_match:
                try:
                    result = json.loads(json_match.group(0))
                    parse_method = "regex_greedy"
                    logger.info("✅ JSON extracted with greedy regex")
                except json.JSONDecodeError:
                    pass

        # Strategy 3: Find balanced braces (handles nested objects)
        if result is None:
            brace_start = response_text.find('{')
            if brace_start != -1:
                brace_count = 0
                brace_end = brace_start
                for i, char in enumerate(response_text[brace_start:], start=brace_start):
                    if char == '{':
                        brace_count += 1
                    elif char == '}':
                        brace_count -= 1
                        if brace_count == 0:
                            brace_end = i + 1
                            break
                if brace_end > brace_start:
                    try:
                        result = json.loads(response_text[brace_start:brace_end])
                        parse_method = "balanced_braces"
                        logger.info("✅ JSON extracted with balanced braces")
                    except json.JSONDecodeError:
                        pass

        # Strategy 4: Try to fix common JSON issues
        if result is None:
            # Remove trailing commas before closing braces/brackets
            fixed_text = re.sub(r',\s*([}\]])', r'\1', response_text)
            # Try parsing fixed text
            json_match = re.search(r'\{[\s\S]*\}', fixed_text)
            if json_match:
                try:
                    result = json.loads(json_match.group(0))
                    parse_method = "fixed_trailing_commas"
                    logger.info("✅ JSON parsed after fixing trailing commas")
                except json.JSONDecodeError as e:
                    logger.debug(f"Trailing comma fix failed: {e}")

        # Strategy 5: Fix unescaped newlines in JSON strings
        if result is None:
            # This is a common issue where AI returns JSON with literal newlines in strings
            # instead of \n escape sequences
            try:
                # Replace literal newlines inside strings with \n
                # This is a heuristic approach - find strings and escape their newlines
                fixed_text = response_text

                # First, try to find the JSON object
                json_match = re.search(r'\{[\s\S]*\}', fixed_text)
                if json_match:
                    json_str = json_match.group(0)

                    # Try to fix common issues:
                    # 1. Replace literal \n with \\n in strings (already escaped but not properly)
                    # 2. Try to load with strict=False

                    # Attempt 1: Replace problematic characters
                    json_str_fixed = json_str.replace('\r\n', '\\n').replace('\r', '\\n')

                    try:
                        result = json.loads(json_str_fixed)
                        parse_method = "fixed_newlines"
                        logger.info("✅ JSON parsed after fixing newlines")
                    except json.JSONDecodeError:
                        # Attempt 2: More aggressive fix - escape all unescaped newlines
                        # Find all strings and properly escape them
                        pass

            except Exception as e:
                logger.debug(f"Newline fix failed: {e}")

        # Strategy 6: Last resort - try Python's ast.literal_eval for simple cases
        if result is None:
            try:
                import ast
                # This can handle some cases where json.loads fails
                result = ast.literal_eval(response_text)
                if isinstance(result, dict):
                    parse_method = "ast_literal_eval"
                    logger.info("✅ JSON parsed with ast.literal_eval")
                else:
                    result = None
            except:
                pass

        if result:
            logger.info(f"✅ AI response parsed successfully (method: {parse_method})")
            logger.info(f"   - title: {result.get('title', 'N/A')}")
            logger.info(f"   - semantic_map keys: {list(result.get('semantic_map', {}).keys())}")
            logger.info(f"   - description_markdown length: {len(result.get('description_markdown', ''))}")
            logger.info(f"   - acceptance_criteria count: {len(result.get('acceptance_criteria', []))}")
            logger.info(f"   - story_points: {result.get('story_points', 'N/A')}")
            logger.info(f"   - interview_insights keys: {list(result.get('interview_insights', {}).keys())}")
        else:
            # All parsing strategies failed
            logger.error(f"❌ Failed to parse AI response as JSON after all strategies")
            logger.error(f"Response text (first 1500 chars): {response_text[:1500]}...")

            # Fallback: create meaningful content from the epic data and project context
            # PROMPT #95 - Enhanced fallback with rich structure
            logger.warning("Using fallback content generation...")

            # Build a meaningful description from the context with Semantic References structure
            fallback_description = f"""# Epic: {epic_title}

## Mapa Semântico

- **N1**: {project.name}
- **E1**: {epic_title}
- **P1**: Processo principal de implementação
- **D1**: Dados e estruturas do módulo
- **S1**: Serviços e integrações necessárias
- **C1**: Funcionalidades devem estar completas
- **C2**: Código deve seguir padrões de qualidade
- **AC1**: E1 deve estar completamente implementado
- **AC2**: D1 deve estar corretamente estruturado
- **AC3**: S1 deve estar integrado com o sistema

## Descrição

Este Epic implementa E1 como parte de N1, seguindo P1 para garantir a entrega de valor ao usuário. O módulo gerencia D1 e integra S1 para fornecer as funcionalidades necessárias.

{epic_description}

O desenvolvimento segue C1 e C2 para garantir qualidade e consistência com o restante do sistema.

## Critérios de Aceitação

1. **AC1**: E1 deve estar completamente implementado com todas as funcionalidades descritas
2. **AC2**: D1 deve estar corretamente estruturado e validado
3. **AC3**: S1 deve estar integrado e funcionando com os demais módulos

## Insights da Entrevista

**Requisitos-Chave:**
- E1 deve atender aos requisitos de negócio de N1
- P1 deve seguir as melhores práticas de desenvolvimento
- D1 deve estar bem documentado

**Objetivos de Negócio:**
- Entregar E1 com valor ao usuário final
- Garantir escalabilidade de S1
- Manter qualidade conforme C1 e C2

**Restrições Técnicas:**
- E1 deve ser compatível com a arquitetura existente
- D1 deve seguir os padrões de dados do projeto
- S1 deve ter performance adequada
"""

            result = {
                "title": epic_title,
                "semantic_map": {
                    "N1": project.name,
                    "E1": epic_title,
                    "P1": "Processo principal de implementação",
                    "D1": "Dados e estruturas do módulo",
                    "S1": "Serviços e integrações necessárias",
                    "C1": "Funcionalidades devem estar completas",
                    "C2": "Código deve seguir padrões de qualidade",
                    "AC1": "E1 deve estar completamente implementado",
                    "AC2": "D1 deve estar corretamente estruturado",
                    "AC3": "S1 deve estar integrado com o sistema"
                },
                "description_markdown": fallback_description,
                "acceptance_criteria": [
                    "AC1: E1 deve estar completamente implementado com todas as funcionalidades descritas",
                    "AC2: D1 deve estar corretamente estruturado e validado",
                    "AC3: S1 deve estar integrado e funcionando com os demais módulos"
                ],
                "story_points": 13,
                "interview_insights": {
                    "key_requirements": [
                        "E1 deve atender aos requisitos de negócio de N1",
                        "P1 deve seguir as melhores práticas de desenvolvimento",
                        "D1 deve estar bem documentado"
                    ],
                    "business_goals": [
                        "Entregar E1 com valor ao usuário final",
                        "Garantir escalabilidade de S1",
                        "Manter qualidade conforme C1 e C2"
                    ],
                    "technical_constraints": [
                        "E1 deve ser compatível com a arquitetura existente",
                        "D1 deve seguir os padrões de dados do projeto",
                        "S1 deve ter performance adequada"
                    ]
                }
            }

        # Extract and process content
        semantic_map = result.get("semantic_map", {})
        description_markdown = result.get("description_markdown", "")

        # generated_prompt = semantic markdown (for AI/child cards)
        generated_prompt = description_markdown

        # description = human-readable (converted from semantic)
        description = _convert_semantic_to_human(description_markdown, semantic_map)

        # Remove Mapa Semântico section from human description
        description = re.sub(
            r'##\s*Mapa\s*Sem[aâ]ntico\s*\n+(?:[-*]\s*\*\*[^*]+\*\*:[^\n]*\n*)*',
            '',
            description,
            flags=re.IGNORECASE | re.MULTILINE
        )
        description = description.strip()

        # PROMPT #95 - Include interview_insights in return
        return {
            "title": result.get("title", epic_title),
            "description": description,
            "generated_prompt": generated_prompt,
            "semantic_map": semantic_map,
            "acceptance_criteria": result.get("acceptance_criteria", []),
            "story_points": result.get("story_points"),
            "interview_insights": result.get("interview_insights", {})
        }

    async def reject_suggested_epic(self, epic_id: UUID) -> bool:
        """
        PROMPT #94 - Reject (delete) a suggested item.

        Works with any item type (Epic, Story, Task, Subtask).

        Args:
            epic_id: Item ID to reject (named epic_id for backwards compatibility)

        Returns:
            True if deleted successfully

        Raises:
            ValueError: If item not found or not a suggested item
        """
        # Fetch item
        epic = self.db.query(Task).filter(Task.id == epic_id).first()
        if not epic:
            raise ValueError(f"Item {epic_id} not found")

        # Check if it's a suggested item
        is_suggested = (
            epic.labels and "suggested" in epic.labels
        ) or epic.workflow_state == "draft"

        if not is_suggested:
            raise ValueError(
                f"Item {epic_id} is not a suggested item. "
                "Only suggested items can be rejected."
            )

        item_title = epic.title

        # Delete the item
        self.db.delete(epic)
        self.db.commit()

        logger.info(f"❌ Suggested item rejected and deleted: {item_title}")

        return True
