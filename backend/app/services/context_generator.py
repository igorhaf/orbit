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

from typing import Dict, List, Optional, Any
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
from app.prompts import PromptService, get_prompt_service

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
        # PROMPT #103 - Use PromptService for external prompts
        self.prompt_service = get_prompt_service(db)

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

        # PROMPT #102 - Auto-generate draft stories after epic activation
        draft_stories = []
        if epic.item_type == ItemType.EPIC:
            try:
                draft_stories = await self._generate_draft_stories(epic, project)
                logger.info(f"📝 Generated {len(draft_stories)} draft stories for epic: {epic.title}")
            except Exception as e:
                logger.error(f"❌ Error generating draft stories: {str(e)}")
                # Don't fail the activation if story generation fails

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
            "children_generated": len(draft_stories)  # PROMPT #102 - Report how many children were generated
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
        # PROMPT #96 - Enhanced prompt for DETAILED epic content generation
        system_prompt = """Você é um Arquiteto de Software e Product Owner especialista gerando especificações técnicas DETALHADAS para Epics.

OBJETIVO: Gerar uma especificação COMPLETA e DETALHADA do módulo/funcionalidade, incluindo:
- Campos e atributos com tipos de dados
- Regras de negócio específicas
- Fluxos e estados
- Interface do usuário
- Integrações e APIs
- Validações e constraints

METODOLOGIA DE REFERÊNCIAS SEMÂNTICAS:

**Categorias de Identificadores (use TODAS que forem aplicáveis):**

**Entidades e Dados:**
- **N** (Nouns/Entidades): N1, N2... = Entidades de domínio (Ex: N1=Usuário, N2=Imóvel)
- **ATTR** (Atributos): ATTR1, ATTR2... = Campos/atributos específicos (Ex: ATTR1=nome:string, ATTR2=email:string)
- **D** (Data/Estruturas): D1, D2... = Tabelas, schemas, models (Ex: D1=tabela_usuarios)
- **ENUM** (Enumerações): ENUM1, ENUM2... = Valores fixos (Ex: ENUM1=TipoUsuario[admin,corretor,cliente])
- **REL** (Relacionamentos): REL1, REL2... = Relações entre entidades (Ex: REL1=N1 possui muitos N2)

**Lógica e Regras:**
- **RN** (Regras de Negócio): RN1, RN2... = Regras específicas (Ex: RN1=Email deve ser único)
- **VAL** (Validações): VAL1, VAL2... = Validações de entrada (Ex: VAL1=CPF válido)
- **CALC** (Cálculos): CALC1, CALC2... = Fórmulas e cálculos (Ex: CALC1=comissão=valor*0.05)
- **COND** (Condições): COND1, COND2... = Condições lógicas (Ex: COND1=se status=ativo)

**Fluxos e Processos:**
- **P** (Processos): P1, P2... = Fluxos de trabalho (Ex: P1=Cadastro de imóvel)
- **EST** (Estados): EST1, EST2... = Estados possíveis (Ex: EST1=rascunho, EST2=publicado)
- **TRANS** (Transições): TRANS1, TRANS2... = Transições de estado (Ex: TRANS1=EST1→EST2)
- **STEP** (Etapas): STEP1, STEP2... = Passos do processo (Ex: STEP1=preencher dados)

**Interface:**
- **TELA** (Telas): TELA1, TELA2... = Telas/páginas (Ex: TELA1=Dashboard, TELA2=Listagem)
- **COMP** (Componentes): COMP1, COMP2... = Componentes UI (Ex: COMP1=FormularioCadastro)
- **BTN** (Botões/Ações): BTN1, BTN2... = Ações do usuário (Ex: BTN1=Salvar, BTN2=Cancelar)
- **FILTRO** (Filtros): FILTRO1... = Filtros disponíveis (Ex: FILTRO1=por status)

**Integrações:**
- **API** (Endpoints): API1, API2... = Endpoints REST (Ex: API1=POST /usuarios)
- **S** (Serviços): S1, S2... = Serviços externos (Ex: S1=serviço de email)
- **EVENTO** (Eventos): EVENTO1... = Eventos do sistema (Ex: EVENTO1=usuario_criado)

**Critérios:**
- **AC** (Acceptance Criteria): AC1, AC2... = Critérios de aceitação
- **PERF** (Performance): PERF1... = Requisitos de performance
- **SEG** (Segurança): SEG1... = Requisitos de segurança

Sua tarefa:
1. Analise o contexto do projeto e o épico sugerido
2. Crie um **Mapa Semântico EXTENSO** com MÍNIMO 25-35 identificadores
3. DETALHE especificamente:
   - TODOS os campos/atributos com seus TIPOS DE DADOS
   - TODAS as regras de negócio com condições específicas
   - TODOS os estados e transições
   - TODAS as telas e componentes principais
   - TODOS os endpoints necessários
4. Escreva a descrição usando APENAS identificadores do mapa
5. Defina critérios de aceitação específicos e mensuráveis

ESTRUTURA OBRIGATÓRIA DO description_markdown:

```
# Epic: [Título]

## Mapa Semântico

### Entidades
- **N1**: [entidade]
- **N2**: [entidade]

### Atributos de [Entidade Principal]
- **ATTR1**: [campo]: [tipo] - [descrição]
- **ATTR2**: [campo]: [tipo] - [descrição]
...

### Enumerações
- **ENUM1**: [nome][valor1, valor2, valor3]
...

### Regras de Negócio
- **RN1**: [regra específica]
- **RN2**: [regra específica]
...

### Validações
- **VAL1**: [validação]
...

### Estados e Transições
- **EST1**: [estado1]
- **EST2**: [estado2]
- **TRANS1**: EST1 → EST2 quando [condição]
...

### Telas e Componentes
- **TELA1**: [nome da tela] - [descrição]
- **COMP1**: [componente] em TELA1
...

### Endpoints
- **API1**: [método] [rota] - [descrição]
...

## Descrição Funcional

[Narrativa DETALHADA usando os identificadores. Descreva o fluxo completo,
como as telas interagem, quais validações são aplicadas em cada etapa,
como os estados mudam, etc.]

## Fluxo Principal

1. STEP1: [descrição usando identificadores]
2. STEP2: [descrição usando identificadores]
...

## Critérios de Aceitação

1. **AC1**: [critério específico e mensurável]
2. **AC2**: [critério específico e mensurável]
...

## Regras de Negócio Detalhadas

### RN1: [Nome da Regra]
- **Condição**: [quando se aplica]
- **Ação**: [o que acontece]
- **Exceção**: [casos especiais]

...

## Especificação de Dados

### Tabela: [nome]
| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| ATTR1 | string | Sim | ... |
| ATTR2 | integer | Não | ... |

## Considerações Técnicas

- [consideração 1]
- [consideração 2]
```

Retorne APENAS JSON válido (sem markdown code blocks):
{
    "title": "Título do Epic",
    "semantic_map": {
        "N1": "...", "N2": "...",
        "ATTR1": "campo: tipo - descrição",
        "RN1": "regra específica",
        "EST1": "estado", "TRANS1": "transição",
        "TELA1": "tela", "API1": "endpoint"
    },
    "description_markdown": "[MARKDOWN COMPLETO seguindo a estrutura acima]",
    "story_points": 13,
    "priority": "high",
    "acceptance_criteria": ["AC1: critério", "AC2: critério"],
    "interview_insights": {
        "key_requirements": ["requisito 1", "requisito 2"],
        "business_goals": ["objetivo 1", "objetivo 2"],
        "technical_constraints": ["restrição 1", "restrição 2"]
    }
}

**REGRAS CRÍTICAS:**
- MÍNIMO 25 identificadores no mapa semântico
- DETALHE campos com TIPOS DE DADOS (string, integer, boolean, date, etc)
- DETALHE regras de negócio com CONDIÇÕES ESPECÍFICAS
- INCLUA telas e componentes UI
- INCLUA endpoints da API
- A descrição deve ter MÍNIMO 1500 caracteres
- TUDO EM PORTUGUÊS
"""

        user_prompt = f"""Gere a ESPECIFICAÇÃO TÉCNICA COMPLETA para este Epic/Módulo.

## CONTEXTO DO PROJETO
**Nome:** {project.name}
**Descrição:** {project.description or 'Não especificada'}

**Contexto Semântico do Projeto (REUTILIZE estes identificadores):**
{project.context_semantic or 'Não disponível'}

**Contexto Legível do Projeto:**
{project.context_human or 'Não disponível'}

## EPIC/MÓDULO A ESPECIFICAR
**Título:** {epic_title}
**Descrição Inicial:** {epic_description}

## REQUISITOS DA ESPECIFICAÇÃO

Você DEVE incluir detalhes sobre:

### 1. MODELO DE DADOS (obrigatório)
- Liste TODOS os campos/atributos necessários
- Especifique o TIPO DE DADO de cada campo (string, integer, boolean, date, decimal, text, json, etc)
- Indique se é obrigatório ou opcional
- Descreva validações específicas de cada campo

### 2. REGRAS DE NEGÓCIO (obrigatório)
- Liste TODAS as regras de negócio do módulo
- Especifique CONDIÇÕES de cada regra (quando se aplica)
- Especifique AÇÕES de cada regra (o que acontece)
- Especifique EXCEÇÕES (casos especiais)

### 3. ESTADOS E FLUXOS (obrigatório)
- Liste TODOS os estados possíveis
- Especifique TODAS as transições entre estados
- Indique as CONDIÇÕES para cada transição

### 4. INTERFACE DO USUÁRIO (obrigatório)
- Liste TODAS as telas necessárias
- Descreva os componentes principais de cada tela
- Indique os botões e ações disponíveis
- Descreva filtros e ordenações

### 5. ENDPOINTS DA API (obrigatório)
- Liste TODOS os endpoints REST necessários
- Especifique método HTTP e rota
- Descreva parâmetros de entrada e saída

### 6. INTEGRAÇÕES (se aplicável)
- Serviços externos necessários
- Eventos do sistema

## FORMATO DE SAÍDA

Use a estrutura EXATA especificada no system prompt:
- Mapa semântico com MÍNIMO 25 identificadores
- Seções: Entidades, Atributos, Enumerações, Regras, Validações, Estados, Telas, Endpoints
- Tabela de especificação de dados
- Fluxo principal detalhado

## EXEMPLO DE NÍVEL DE DETALHE ESPERADO

Para um módulo de "Cadastro de Imóveis", esperamos ver:
- ATTR1: titulo: string(100) - Título do anúncio, obrigatório
- ATTR2: descricao: text - Descrição detalhada, obrigatório, mínimo 50 caracteres
- ATTR3: preco: decimal(10,2) - Valor do imóvel em reais
- ATTR4: tipo: enum[casa,apartamento,terreno,comercial] - Tipo do imóvel
- ATTR5: quartos: integer - Número de quartos, 0-10
- ATTR6: banheiros: integer - Número de banheiros, 0-10
- ATTR7: area_m2: decimal(8,2) - Área em metros quadrados
- ATTR8: endereco_cep: string(8) - CEP, validação de formato
- RN1: Preço deve ser maior que zero
- RN2: Área deve ser maior que zero
- EST1: rascunho, EST2: pendente_aprovacao, EST3: publicado, EST4: vendido
- TELA1: Lista de Imóveis com filtros por tipo, preço, localização
- TELA2: Formulário de Cadastro com wizard de 3 etapas
- API1: GET /imoveis - listar com paginação e filtros
- API2: POST /imoveis - criar novo imóvel
- API3: PUT /imoveis/:id - atualizar imóvel

GERE ESTE NÍVEL DE DETALHE PARA O MÓDULO "{epic_title}".

Retorne como JSON seguindo o schema do system prompt."""

        # Call AI - PROMPT #96: Increased max_tokens to 8000 for detailed specs
        messages = [{"role": "user", "content": user_prompt}]

        response = await self.orchestrator.execute(
            usage_type="prompt_generation",
            messages=messages,
            system_prompt=system_prompt,
            max_tokens=8000  # Increased to allow for detailed specifications
        )

        # Parse response - PROMPT #95: Enhanced JSON extraction
        response_text = response.get("content", "")
        original_response = response_text  # Keep original for debugging
        logger.info(f"📥 Raw AI response length: {len(response_text)} chars")

        # Step 0: Try parsing raw response before any transformation
        result = None
        parse_method = "none"
        last_error = None

        try:
            result = json.loads(response_text)
            parse_method = "raw_direct"
            logger.info("✅ JSON parsed from raw response directly")
        except json.JSONDecodeError as e:
            last_error = e
            logger.warning(f"Raw parse failed at position {e.pos}: {e.msg}")

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
                last_error = e
                logger.warning(f"Direct parse failed at position {e.pos}/{len(response_text)}: {e.msg}")
                # Show context around error position
                start = max(0, e.pos - 50)
                end = min(len(response_text), e.pos + 50)
                logger.warning(f"Context around error: ...{response_text[start:end]}...")

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
                json_match = re.search(r'\{[\s\S]*\}', response_text)
                if json_match:
                    json_str = json_match.group(0)

                    # Aggressive approach: escape all literal newlines that appear within strings
                    # by finding string boundaries and escaping newlines inside them
                    fixed_chars = []
                    in_string = False
                    escape_next = False

                    for char in json_str:
                        if escape_next:
                            fixed_chars.append(char)
                            escape_next = False
                            continue

                        if char == '\\':
                            fixed_chars.append(char)
                            escape_next = True
                            continue

                        if char == '"' and not escape_next:
                            in_string = not in_string
                            fixed_chars.append(char)
                            continue

                        if in_string and char == '\n':
                            fixed_chars.append('\\n')
                            continue

                        if in_string and char == '\r':
                            continue  # Skip carriage returns

                        if in_string and char == '\t':
                            fixed_chars.append('\\t')
                            continue

                        fixed_chars.append(char)

                    json_str_fixed = ''.join(fixed_chars)

                    try:
                        result = json.loads(json_str_fixed)
                        parse_method = "fixed_newlines_aggressive"
                        logger.info("✅ JSON parsed after aggressive newline fix")
                    except json.JSONDecodeError as e:
                        logger.warning(f"Aggressive newline fix failed at {e.pos}: {e.msg}")

            except Exception as e:
                logger.warning(f"Newline fix failed: {e}")

        # Strategy 6: Try to truncate at the last valid JSON point
        if result is None:
            try:
                json_match = re.search(r'\{[\s\S]*', response_text)
                if json_match:
                    json_str = json_match.group(0)

                    # Find the position of the error and try truncating before it
                    for truncate_at in range(len(json_str), max(len(json_str) - 500, 0), -10):
                        test_str = json_str[:truncate_at]
                        # Try to close any open structures
                        open_braces = test_str.count('{') - test_str.count('}')
                        open_brackets = test_str.count('[') - test_str.count(']')
                        open_quotes = test_str.count('"') % 2

                        if open_quotes == 1:
                            test_str += '"'
                        test_str += ']' * open_brackets
                        test_str += '}' * open_braces

                        try:
                            result = json.loads(test_str)
                            # Verify it has required fields
                            if isinstance(result, dict) and ('description_markdown' in result or 'semantic_map' in result):
                                parse_method = "truncated_recovery"
                                logger.info(f"✅ JSON recovered by truncating at position {truncate_at}")
                                break
                            else:
                                result = None
                        except:
                            continue
            except Exception as e:
                logger.warning(f"Truncation recovery failed: {e}")

        # Strategy 7: Last resort - try Python's ast.literal_eval for simple cases
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

            # PROMPT #101 FIX (v2): Extract acceptance_criteria from multiple sources if empty
            # When JSON is truncated, acceptance_criteria field is lost
            if not result.get('acceptance_criteria'):
                extracted_criteria = []

                # Strategy 1: Extract from semantic_map (AC1, AC2, etc. keys)
                if result.get('semantic_map'):
                    semantic_map = result.get('semantic_map', {})
                    for key in sorted(semantic_map.keys()):
                        if key.startswith('AC') and len(key) > 2 and key[2:].replace('.', '').isdigit():
                            extracted_criteria.append(f"{key}: {semantic_map[key]}")
                    if extracted_criteria:
                        logger.info(f"   - Found {len(extracted_criteria)} AC keys in semantic_map")

                # Strategy 2: Extract from description_markdown
                if not extracted_criteria and result.get('description_markdown'):
                    desc = result.get('description_markdown', '')
                    # Look for "## Critérios de Aceitação" section
                    criteria_section = re.search(
                        r'##\s*(?:Critérios de Aceitação|Acceptance Criteria|Critérios)\s*\n((?:[\s\S](?!##))*)',
                        desc,
                        re.IGNORECASE
                    )
                    if criteria_section:
                        criteria_text = criteria_section.group(1)
                        # Extract lines that look like criteria (numbered, bulleted, or with AC prefix)
                        for line in criteria_text.split('\n'):
                            line = line.strip()
                            # Match patterns like: "1. **AC1**: ...", "- AC1: ...", "* [x] ...", etc.
                            if line and (
                                re.match(r'^\d+\.\s*\*?\*?AC\d+', line, re.IGNORECASE) or
                                re.match(r'^[-*]\s*\*?\*?AC\d+', line, re.IGNORECASE) or
                                re.match(r'^\d+\.\s*\[[ xX]?\]', line) or
                                re.match(r'^[-*]\s*\[[ xX]?\]', line)
                            ):
                                # Clean up the line
                                criterion = re.sub(r'^[\d\.\-\*\s\[\]xX]+', '', line).strip()
                                criterion = re.sub(r'^\*+', '', criterion).strip()
                                if criterion and len(criterion) > 5:
                                    extracted_criteria.append(criterion)
                        if extracted_criteria:
                            logger.info(f"   - Found {len(extracted_criteria)} criteria in description_markdown")

                # Apply extracted criteria
                if extracted_criteria:
                    result['acceptance_criteria'] = extracted_criteria[:15]  # Limit to 15 criteria
                    logger.info(f"   - acceptance_criteria RECOVERED: {len(result['acceptance_criteria'])} items")
        else:
            # All parsing strategies failed
            logger.error(f"❌ Failed to parse AI response as JSON after all strategies")
            logger.error(f"Response text (first 1500 chars): {response_text[:1500]}...")

            # Fallback: PROMPT #96 - Try to extract content from raw response
            logger.warning("🔄 JSON parsing failed - attempting to extract content from raw response...")

            # Try to extract useful content from the response even if JSON parsing failed
            # The AI might have returned text that contains useful information

            # Extract project context
            project_context = project.context_human or project.description or ""

            # PROMPT #96 - Better fallback: Make a simpler request to the AI
            # asking just for a text description without JSON
            logger.info("📤 Attempting simplified AI request for epic content...")

            # Extract key info from project context for better prompting
            context_preview = project_context[:3000] if project_context else "Não disponível"

            simple_system_prompt = f"""Você é um Arquiteto de Software Sênior com 20 anos de experiência.

Sua tarefa é escrever uma ESPECIFICAÇÃO TÉCNICA COMPLETA E DETALHADA para um módulo de software.

REGRAS IMPORTANTES:
1. Seja EXTREMAMENTE ESPECÍFICO - use nomes reais de campos, tabelas, endpoints
2. NÃO use placeholders genéricos como "campo1", "tabela1", "endpoint1"
3. BASEIE-SE no contexto do projeto para gerar nomes e estruturas realistas
4. Cada seção deve ter MÍNIMO 5 itens detalhados
5. Use Markdown formatado corretamente
6. Responda APENAS em PORTUGUÊS

CONTEXTO DO PROJETO PARA REFERÊNCIA:
{context_preview}

Use este contexto para gerar especificações REALISTAS e ESPECÍFICAS para o módulo solicitado."""

            simple_prompt = f"""# Especificação Técnica: {epic_title}

**Projeto:** {project.name}

**Descrição do Módulo:** {epic_description}

Por favor, gere uma especificação técnica COMPLETA e DETALHADA para este módulo seguindo EXATAMENTE esta estrutura:

---

## 1. VISÃO GERAL
Escreva 2-3 parágrafos explicando:
- O propósito principal do módulo
- Como ele se integra com o restante do sistema
- O valor que ele entrega para o usuário

---

## 2. MODELO DE DADOS

### Entidade Principal: [Nome da Entidade]
| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| id | uuid | Sim | Identificador único |
| ... | ... | ... | ... |

Liste MÍNIMO 10 campos com seus tipos de dados reais (string, text, integer, boolean, decimal, date, datetime, json, enum, etc.)

### Relacionamentos
- [Entidade] tem muitos [Outra Entidade]
- etc.

---

## 3. REGRAS DE NEGÓCIO

Liste MÍNIMO 8 regras de negócio específicas no formato:
- **RN1 - [Nome]**: [Descrição detalhada da regra, quando se aplica, o que acontece]
- **RN2 - [Nome]**: ...

---

## 4. ESTADOS E TRANSIÇÕES

### Estados Possíveis
| Estado | Descrição | Ações Permitidas |
|--------|-----------|------------------|
| ... | ... | ... |

### Fluxo de Transições
1. [Estado A] → [Estado B]: quando [condição]
2. ...

---

## 5. INTERFACE DO USUÁRIO

### Telas Principais
1. **[Nome da Tela]**
   - Propósito: ...
   - Componentes: ...
   - Ações disponíveis: ...

Liste MÍNIMO 4 telas com detalhes.

### Componentes Reutilizáveis
- [Componente 1]: [descrição]
- ...

---

## 6. API REST

### Endpoints
| Método | Rota | Descrição | Request Body | Response |
|--------|------|-----------|--------------|----------|
| GET | /api/... | ... | - | Lista de ... |
| POST | /api/... | ... | {{ campo1, campo2 }} | Objeto criado |
| ... | ... | ... | ... | ... |

Liste MÍNIMO 6 endpoints.

---

## 7. VALIDAÇÕES E ERROS

### Validações de Entrada
- [Campo]: [Validação] - Mensagem de erro
- ...

### Códigos de Erro
- 400: ...
- 404: ...
- ...

---

## 8. CRITÉRIOS DE ACEITAÇÃO

Liste MÍNIMO 8 critérios de aceitação específicos e mensuráveis:
1. [ ] ...
2. [ ] ...

---

## 9. CONSIDERAÇÕES TÉCNICAS

- Segurança: ...
- Performance: ...
- Escalabilidade: ...
- Integrações: ...

---

GERE A ESPECIFICAÇÃO COMPLETA AGORA, preenchendo TODOS os campos com dados REALISTAS baseados no contexto do projeto "{project.name}"."""

            try:
                simple_messages = [{"role": "user", "content": simple_prompt}]
                simple_response = await self.orchestrator.execute(
                    usage_type="prompt_generation",
                    messages=simple_messages,
                    system_prompt=simple_system_prompt,
                    max_tokens=6000  # Increased to allow more detailed response
                )

                raw_content = simple_response.get("content", "")
                logger.info(f"✅ Simplified request returned {len(raw_content)} chars")

                if len(raw_content) > 500:
                    # Use the raw content as the description
                    fallback_description = f"# Epic: {epic_title}\n\n{raw_content}"

                    # Try to extract acceptance criteria from the response
                    extracted_criteria = []
                    criteria_match = re.search(
                        r'(?:CRITÉRIOS DE ACEITAÇÃO|ACCEPTANCE CRITERIA)[:\s]*\n((?:[\-\*\d\.\[\]]+[^\n]+\n?)+)',
                        raw_content,
                        re.IGNORECASE
                    )
                    if criteria_match:
                        criteria_text = criteria_match.group(1)
                        # Extract each criterion
                        for line in criteria_text.split('\n'):
                            line = line.strip()
                            if line and (line.startswith('-') or line.startswith('*') or
                                        line.startswith('[') or re.match(r'^\d+\.', line)):
                                # Clean up the criterion text
                                criterion = re.sub(r'^[\-\*\[\]\d\.\s]+', '', line).strip()
                                if criterion and len(criterion) > 10:
                                    extracted_criteria.append(criterion)

                    logger.info(f"   - Extracted {len(extracted_criteria)} acceptance criteria from response")

                    # Try to extract key requirements from "Regras de Negócio" section
                    extracted_requirements = []
                    rules_match = re.search(
                        r'(?:REGRAS DE NEGÓCIO|BUSINESS RULES)[:\s]*\n((?:[\-\*]+\s*\*\*RN\d+[^\n]+\n?)+)',
                        raw_content,
                        re.IGNORECASE
                    )
                    if rules_match:
                        rules_text = rules_match.group(1)
                        for line in rules_text.split('\n'):
                            if '**RN' in line or '- RN' in line:
                                rule = re.sub(r'^[\-\*\s]+\*\*RN\d+[^:]*:\*\*\s*', '', line).strip()
                                if rule and len(rule) > 10:
                                    extracted_requirements.append(rule[:200])

                    result = {
                        "title": epic_title,
                        "semantic_map": {},
                        "description_markdown": fallback_description,
                        "acceptance_criteria": extracted_criteria[:10] if extracted_criteria else [
                            f"Módulo {epic_title} completamente implementado",
                            "Todos os endpoints funcionando corretamente",
                            "Interface de usuário responsiva e intuitiva",
                            "Testes automatizados com cobertura adequada",
                            "Documentação atualizada"
                        ],
                        "story_points": 13,
                        "interview_insights": {
                            "key_requirements": extracted_requirements[:5] if extracted_requirements else [
                                f"Implementar {epic_title} conforme especificação",
                                "Seguir padrões de código do projeto"
                            ],
                            "business_goals": [
                                f"Entregar funcionalidade completa de {epic_title}",
                                "Melhorar experiência do usuário"
                            ],
                            "technical_constraints": [
                                "Compatível com arquitetura existente",
                                "Performance adequada"
                            ]
                        }
                    }
                    logger.info("✅ Using simplified AI response as fallback content")
                else:
                    raise ValueError("Response too short")

            except Exception as fallback_error:
                logger.error(f"❌ Simplified request also failed: {fallback_error}")

                # Last resort: use project context to build something meaningful
                fallback_description = f"""# Epic: {epic_title}

## Visão Geral

{epic_description}

## Contexto do Projeto

Este módulo faz parte do projeto **{project.name}**.

{project_context[:2000] if project_context else 'Contexto não disponível.'}

## Próximos Passos

Para completar a especificação deste módulo, é necessário definir:
- Modelo de dados com campos e tipos
- Regras de negócio específicas
- Estados e transições
- Telas e componentes de interface
- Endpoints da API

⚠️ **Nota**: Esta é uma especificação preliminar. A geração automática de conteúdo detalhado falhou.
Por favor, edite manualmente para adicionar os detalhes técnicos necessários.
"""

                result = {
                    "title": epic_title,
                    "semantic_map": {},
                    "description_markdown": fallback_description,
                    "acceptance_criteria": [
                        "Módulo deve estar completamente implementado",
                        "Testes devem cobrir os principais fluxos",
                        "Documentação deve estar atualizada"
                    ],
                    "story_points": 13,
                    "interview_insights": {
                        "key_requirements": [
                            f"Implementar {epic_title} conforme especificação",
                            "Seguir padrões de código do projeto",
                            "Garantir integração com módulos existentes"
                        ],
                        "business_goals": [
                            f"Entregar funcionalidade de {epic_title}",
                            "Melhorar experiência do usuário",
                            "Atender requisitos do negócio"
                        ],
                        "technical_constraints": [
                            f"{epic_title} deve ser compatível com a arquitetura existente",
                            "Deve seguir os padrões de dados do projeto",
                            "Deve ter performance adequada"
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

    # ============================================================
    # PROMPT #102 - Hierarchical Draft Generation
    # Auto-generate child cards when parent is activated
    # EACH CARD gets FULL EPIC-LEVEL content (generated individually)
    # ============================================================

    async def _generate_draft_stories(
        self,
        epic: Task,
        project: Project
    ) -> List[Task]:
        """
        PROMPT #102 - Generate 15-20 stories with FULL EPIC-LEVEL content.

        NEW APPROACH: Generate each story INDIVIDUALLY with full detail.
        1. First: Generate list of 15-20 story TITLES
        2. Then: For EACH title, generate FULL content (same as Epic)

        This ensures each story has the SAME level of detail as an Epic.

        Args:
            epic: The activated epic
            project: The project with context

        Returns:
            List of created Story tasks with FULL content
        """
        logger.info(f"📝 Generating stories with FULL EPIC-LEVEL content for: {epic.title}")

        # Extract epic's semantic map for context
        epic_semantic_map = {}
        if epic.interview_insights and isinstance(epic.interview_insights, dict):
            epic_semantic_map = epic.interview_insights.get("semantic_map", {})

        # ============================================================
        # STEP 1: Generate only TITLES (15-20 story titles)
        # ============================================================
        titles_system_prompt = """Você é um Product Owner especialista em decomposição de Epics.

TAREFA: Decomponha o Epic em 15-20 User Stories. Retorne APENAS os TÍTULOS.

FORMATO OBRIGATÓRIO de cada título:
"Como [tipo de usuário], eu quero [funcionalidade específica], para [benefício]"

**REGRAS:**
- Cada Story deve cobrir uma funcionalidade DISTINTA e ESPECÍFICA
- Stories devem ser independentes quando possível
- Cubra TODOS os aspectos do Epic: CRUD, validações, integrações, UI, relatórios
- Inclua Stories para: configuração, listagem, criação, edição, exclusão, busca, filtros, relatórios, integrações, notificações

Retorne APENAS um array JSON com os títulos:
["título 1", "título 2", ..., "título N"]

NÃO inclua nenhuma explicação, apenas o array JSON."""

        semantic_map_text = ""
        if epic_semantic_map:
            semantic_map_text = "\n\nMAPA SEMÂNTICO DO EPIC:\n"
            semantic_map_text += json.dumps(epic_semantic_map, indent=2, ensure_ascii=False)

        titles_user_prompt = f"""Decomponha este Epic em 15-20 User Stories.

## EPIC
**Título:** {epic.title}
**Descrição:** {epic.description or 'Não especificada'}
**Especificação:** {(epic.generated_prompt or '')[:2000]}
{semantic_map_text}

## CONTEXTO DO PROJETO
**Nome:** {project.name}
**Contexto:** {(project.context_human or project.context_semantic or 'Não disponível')[:2000]}

Retorne APENAS o array JSON com 15-20 títulos de Stories no formato User Story."""

        try:
            orchestrator = AIOrchestrator(self.db)

            # Get titles first
            titles_response = await orchestrator.execute(
                usage_type="prompt_generation",
                messages=[{"role": "user", "content": titles_user_prompt}],
                system_prompt=titles_system_prompt,
                max_tokens=2000
            )

            titles_content = titles_response.get("content", "")
            story_titles = self._parse_json_response(titles_content)

            if not story_titles or not isinstance(story_titles, list):
                logger.warning("AI did not return valid titles array, using fallback titles")
                story_titles = self._generate_fallback_story_titles(epic)

            story_titles = story_titles[:20]
            logger.info(f"📋 Generated {len(story_titles)} story titles for epic: {epic.title}")

            # ============================================================
            # STEP 2: Create SIMPLE drafts (title only) - PROMPT #107
            # Full content is generated ONLY when user approves the item
            # ============================================================
            created_stories = []
            for i, title in enumerate(story_titles):
                try:
                    # Create simple draft story with just title and placeholder description
                    # Full content will be generated when user activates/approves this story
                    story = Task(
                        project_id=epic.project_id,
                        parent_id=epic.id,
                        item_type=ItemType.STORY,
                        title=title if isinstance(title, str) else f"Story {i+1}",
                        description="Conteúdo será gerado ao aprovar.",  # Simple placeholder
                        generated_prompt="",  # Empty until approved
                        acceptance_criteria=[],
                        story_points=5,
                        priority=PriorityLevel.MEDIUM,
                        labels=["suggested"],
                        workflow_state="draft",
                        status=TaskStatus.BACKLOG,
                        order=i,
                        reporter="system",
                        interview_insights={"derived_from_epic": str(epic.id)},
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow()
                    )
                    self.db.add(story)
                    created_stories.append(story)
                    logger.info(f"📝 Created draft story {i+1}/{len(story_titles)}: {title[:50] if isinstance(title, str) else 'Story'}...")

                except Exception as story_error:
                    logger.error(f"❌ Error creating draft story '{title}': {str(story_error)}")

            self.db.commit()
            logger.info(f"✅ Created {len(created_stories)} story DRAFTS (lightweight, content on approval)")
            return created_stories

        except Exception as e:
            logger.error(f"❌ Error generating draft stories: {str(e)}")
            import traceback
            traceback.print_exc()

            # Fallback: create basic stories with titles only
            fallback_titles = self._generate_fallback_story_titles(epic)
            created_stories = []
            for i, title in enumerate(fallback_titles[:5]):
                story = Task(
                    project_id=epic.project_id,
                    parent_id=epic.id,
                    item_type=ItemType.STORY,
                    title=title,
                    description="Conteúdo será gerado ao aprovar.",
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
        """Generate fallback story titles when AI fails."""
        base_title = epic.title.replace("Epic: ", "").replace("Módulo: ", "")
        return [
            f"Como usuário, eu quero configurar {base_title}, para personalizar o sistema",
            f"Como usuário, eu quero visualizar lista de {base_title}, para acompanhar dados",
            f"Como usuário, eu quero criar registros em {base_title}, para adicionar informações",
            f"Como usuário, eu quero editar registros de {base_title}, para atualizar dados",
            f"Como usuário, eu quero excluir registros de {base_title}, para remover dados obsoletos",
            f"Como usuário, eu quero buscar em {base_title}, para encontrar dados específicos",
            f"Como usuário, eu quero filtrar {base_title} por status, para organizar visualização",
            f"Como usuário, eu quero exportar dados de {base_title}, para análise externa",
            f"Como usuário, eu quero importar dados para {base_title}, para carga em massa",
            f"Como usuário, eu quero validar dados de {base_title}, para garantir integridade",
            f"Como administrador, eu quero gerenciar permissões de {base_title}, para controle de acesso",
            f"Como usuário, eu quero receber notificações de {base_title}, para acompanhamento",
            f"Como usuário, eu quero ver histórico de {base_title}, para auditoria",
            f"Como usuário, eu quero gerar relatórios de {base_title}, para análise",
            f"Como usuário, eu quero integrar {base_title} com outros módulos, para automação"
        ]

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

    async def _generate_draft_tasks(
        self,
        story: Task,
        project: Project
    ) -> List[Task]:
        """
        PROMPT #102 - Generate 5-8 DETAILED draft tasks for an activated story.

        Tasks are created with FULL CONTENT (same level of detail as Epics/Stories):
        - labels=["suggested"]
        - workflow_state="draft"
        - parent_id=story.id
        - item_type=TASK
        - FULL semantic_map, description_markdown, acceptance_criteria, generated_prompt

        Args:
            story: The activated story
            project: The project with context

        Returns:
            List of created draft Task items
        """
        logger.info(f"📝 Generating DETAILED draft tasks for story: {story.title}")

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

        # ============================================================
        # STEP 1: Generate only TITLES (5-8 task titles)
        # ============================================================
        titles_system_prompt = """Você é um Tech Lead especialista em decomposição de User Stories.

TAREFA: Decomponha a User Story em 5-8 Tasks técnicas. Retorne APENAS os TÍTULOS.

FORMATO: Cada título deve descrever uma tarefa técnica específica e implementável.

**TIPOS DE TASKS A INCLUIR:**
- Modelagem de dados (criar/modificar models, migrations)
- Implementação de API (endpoints, controllers)
- Implementação de UI (componentes, páginas)
- Validações e regras de negócio
- Integrações (serviços externos, outros módulos)
- Testes (unitários, integração)
- Configurações e setup

Retorne APENAS um array JSON com os títulos:
["título 1", "título 2", ..., "título N"]

NÃO inclua nenhuma explicação, apenas o array JSON."""

        combined_semantic_map = {**epic_semantic_map, **story_semantic_map}
        semantic_map_text = ""
        if combined_semantic_map:
            semantic_map_text = "\n\nMAPA SEMÂNTICO DO EPIC/STORY:\n"
            semantic_map_text += json.dumps(combined_semantic_map, indent=2, ensure_ascii=False)

        epic_context = ""
        if parent_epic:
            epic_context = f"\n## EPIC PAI\n**Título:** {parent_epic.title}\n**Descrição:** {(parent_epic.description or 'N/A')[:500]}\n"

        titles_user_prompt = f"""Decomponha esta User Story em 5-8 Tasks técnicas.

## STORY
**Título:** {story.title}
**Descrição:** {story.description or 'Não especificada'}
**Especificação:** {(story.generated_prompt or '')[:1500]}
{epic_context}
{semantic_map_text}

## CONTEXTO DO PROJETO
{(project.context_human or project.context_semantic or 'Não disponível')[:1500]}

Retorne APENAS o array JSON com 5-8 títulos de Tasks técnicas."""

        try:
            orchestrator = AIOrchestrator(self.db)

            # Get titles first
            titles_response = await orchestrator.execute(
                usage_type="prompt_generation",
                messages=[{"role": "user", "content": titles_user_prompt}],
                system_prompt=titles_system_prompt,
                max_tokens=1500
            )

            titles_content = titles_response.get("content", "")
            task_titles = self._parse_json_response(titles_content)

            if not task_titles or not isinstance(task_titles, list):
                logger.warning("AI did not return valid task titles array, using fallback titles")
                task_titles = self._generate_fallback_task_titles(story)

            task_titles = task_titles[:8]
            logger.info(f"📋 Generated {len(task_titles)} task titles for story: {story.title}")

            # ============================================================
            # STEP 2: Create SIMPLE drafts (title only) - PROMPT #107
            # Full content is generated ONLY when user approves the item
            # ============================================================
            created_tasks = []
            for i, title in enumerate(task_titles):
                try:
                    # Create simple draft task with just title and placeholder description
                    # Full content will be generated when user activates/approves this task
                    task = Task(
                        project_id=story.project_id,
                        parent_id=story.id,
                        item_type=ItemType.TASK,
                        title=title if isinstance(title, str) else f"Task {i+1}",
                        description="Conteúdo será gerado ao aprovar.",  # Simple placeholder
                        generated_prompt="",  # Empty until approved
                        acceptance_criteria=[],
                        story_points=3,
                        priority=story.priority or PriorityLevel.MEDIUM,
                        labels=["suggested"],
                        workflow_state="draft",
                        status=TaskStatus.BACKLOG,
                        order=i,
                        reporter="system",
                        interview_insights={"derived_from_story": str(story.id)},
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow()
                    )
                    self.db.add(task)
                    created_tasks.append(task)
                    logger.info(f"📝 Created draft task {i+1}/{len(task_titles)}: {title[:50] if isinstance(title, str) else 'Task'}...")

                except Exception as task_error:
                    logger.error(f"❌ Error creating draft task '{title}': {str(task_error)}")

            self.db.commit()
            logger.info(f"✅ Created {len(created_tasks)} task DRAFTS (lightweight, content on approval)")
            return created_tasks

        except Exception as e:
            logger.error(f"❌ Error generating draft tasks: {str(e)}")
            import traceback
            traceback.print_exc()
            return []

    def _generate_fallback_task_titles(self, story: Task) -> List[str]:
        """Generate fallback task titles when AI fails."""
        base_title = story.title[:50] if story.title else "funcionalidade"
        return [
            "Criar modelo de dados e migrations",
            "Implementar endpoints da API REST",
            "Criar componentes de UI",
            "Implementar validações e regras de negócio",
            "Escrever testes unitários",
            "Implementar integração com serviços",
            "Documentar implementação"
        ]

    async def _generate_draft_subtasks(
        self,
        task: Task,
        project: Project
    ) -> List[Task]:
        """
        PROMPT #102 - Generate 3-5 DETAILED draft subtasks for an activated task.

        Subtasks are created with FULL CONTENT (same level of detail as other items):
        - labels=["suggested"]
        - workflow_state="draft"
        - parent_id=task.id
        - item_type=SUBTASK
        - FULL semantic_map, description_markdown, acceptance_criteria, generated_prompt

        Args:
            task: The activated task
            project: The project with context

        Returns:
            List of created draft Subtask items
        """
        logger.info(f"📝 Generating DETAILED draft subtasks for task: {task.title}")

        # Get task semantic map for context
        task_semantic_map = {}
        if task.interview_insights:
            task_semantic_map = task.interview_insights.get("semantic_map", {})

        # Get parent story and great-grandparent epic for full hierarchy context
        parent_story = None
        great_grandparent_epic = None
        if task.parent_id:
            parent_story = self.db.query(Task).filter(Task.id == task.parent_id).first()
            if parent_story and parent_story.parent_id:
                great_grandparent_epic = self.db.query(Task).filter(Task.id == parent_story.parent_id).first()

        # ============================================================
        # STEP 1: Generate only TITLES (3-5 subtask titles)
        # ============================================================
        titles_system_prompt = """Você é um Desenvolvedor Sênior especialista em decomposição de Tasks.

TAREFA: Decomponha a Task em 3-5 Subtasks atômicas. Retorne APENAS os TÍTULOS.

FORMATO: Cada título deve descrever uma ação específica e implementável.

**TIPOS DE SUBTASKS A INCLUIR:**
- Implementação de função/método específico
- Configuração de dependência/biblioteca
- Criação/modificação de arquivo
- Implementação de validação
- Tratamento de erro específico
- Escrita de teste
- Refatoração de código

Retorne APENAS um array JSON com os títulos:
["título 1", "título 2", ..., "título N"]

NÃO inclua nenhuma explicação, apenas o array JSON."""

        semantic_map_text = ""
        if task_semantic_map:
            semantic_map_text = "\n\nMAPA SEMÂNTICO DA TASK:\n"
            semantic_map_text += json.dumps(task_semantic_map, indent=2, ensure_ascii=False)

        titles_user_prompt = f"""Decomponha esta Task em 3-5 Subtasks atômicas.

## TASK
**Título:** {task.title}
**Descrição:** {task.description or 'Não especificada'}
**Especificação:** {(task.generated_prompt or '')[:1000]}
{semantic_map_text}

Retorne APENAS o array JSON com 3-5 títulos de Subtasks."""

        try:
            orchestrator = AIOrchestrator(self.db)

            # Get titles first
            titles_response = await orchestrator.execute(
                usage_type="prompt_generation",
                messages=[{"role": "user", "content": titles_user_prompt}],
                system_prompt=titles_system_prompt,
                max_tokens=1000
            )

            titles_content = titles_response.get("content", "")
            subtask_titles = self._parse_json_response(titles_content)

            if not subtask_titles or not isinstance(subtask_titles, list):
                logger.warning("AI did not return valid subtask titles array, using fallback titles")
                subtask_titles = self._generate_fallback_subtask_titles(task)

            subtask_titles = subtask_titles[:5]
            logger.info(f"📋 Generated {len(subtask_titles)} subtask titles for task: {task.title}")

            # ============================================================
            # STEP 2: Create SIMPLE drafts (title only) - PROMPT #107
            # Full content is generated ONLY when user approves the item
            # ============================================================
            created_subtasks = []
            for i, title in enumerate(subtask_titles):
                try:
                    # Create simple draft subtask with just title and placeholder description
                    # Full content will be generated when user activates/approves this subtask
                    subtask = Task(
                        project_id=task.project_id,
                        parent_id=task.id,
                        item_type=ItemType.SUBTASK,
                        title=title if isinstance(title, str) else f"Subtask {i+1}",
                        description="Conteúdo será gerado ao aprovar.",  # Simple placeholder
                        generated_prompt="",  # Empty until approved
                        acceptance_criteria=[],
                        story_points=1,
                        priority=task.priority or PriorityLevel.MEDIUM,
                        labels=["suggested"],
                        workflow_state="draft",
                        status=TaskStatus.BACKLOG,
                        order=i,
                        reporter="system",
                        interview_insights={"derived_from_task": str(task.id)},
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow()
                    )
                    self.db.add(subtask)
                    created_subtasks.append(subtask)
                    logger.info(f"📝 Created draft subtask {i+1}/{len(subtask_titles)}: {title[:50] if isinstance(title, str) else 'Subtask'}...")

                except Exception as subtask_error:
                    logger.error(f"❌ Error creating draft subtask '{title}': {str(subtask_error)}")

            self.db.commit()
            logger.info(f"✅ Created {len(created_subtasks)} subtask DRAFTS (lightweight, content on approval)")
            return created_subtasks

        except Exception as e:
            logger.error(f"❌ Error generating draft subtasks: {str(e)}")
            import traceback
            traceback.print_exc()
            return []

    def _generate_fallback_subtask_titles(self, task: Task) -> List[str]:
        """Generate fallback subtask titles when AI fails."""
        base_title = task.title[:30] if task.title else "item"
        return [
            f"Implementar lógica principal de {base_title}",
            f"Adicionar validações para {base_title}",
            f"Escrever testes para {base_title}",
            f"Documentar {base_title}"
        ]

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
            raise ValueError(f"Story {story_id} not found")

        if story.item_type != ItemType.STORY:
            raise ValueError(f"Item {story_id} is not a Story (type: {story.item_type})")

        # Check if suggested
        is_suggested = (story.labels and "suggested" in story.labels) or story.workflow_state == "draft"
        if not is_suggested:
            raise ValueError(f"Story {story_id} is not a suggested item")

        # Fetch project
        project = self.db.query(Project).filter(Project.id == story.project_id).first()
        if not project:
            raise ValueError(f"Project {story.project_id} not found")

        # Generate full story content
        story_content = await self._generate_full_story_content(story, project)

        # Update story
        story.description = story_content.get("description", story.description)
        story.generated_prompt = story_content.get("generated_prompt")
        story.acceptance_criteria = story_content.get("acceptance_criteria", [])
        story.story_points = story_content.get("story_points", story.story_points)

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

        self.db.commit()
        self.db.refresh(story)

        logger.info(f"✅ Story activated: {story.title}")

        # Generate draft tasks
        draft_tasks = await self._generate_draft_tasks(story, project)

        return {
            "id": str(story.id),
            "title": story.title,
            "description": story.description,
            "generated_prompt": story.generated_prompt,
            "acceptance_criteria": story.acceptance_criteria,
            "story_points": story.story_points,
            "priority": story.priority.value if story.priority else "medium",
            "activated": True,
            "children_generated": len(draft_tasks)
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

        # SAME DETAILED PROMPT AS EPIC - Adapted for Story
        system_prompt = """Você é um Arquiteto de Software e Product Owner especialista gerando especificações técnicas DETALHADAS para User Stories.

OBJETIVO: Gerar uma especificação COMPLETA e DETALHADA da User Story, incluindo:
- Campos e atributos com tipos de dados
- Regras de negócio específicas
- Fluxos e estados
- Interface do usuário
- Integrações e APIs
- Validações e constraints

METODOLOGIA DE REFERÊNCIAS SEMÂNTICAS:

**Categorias de Identificadores (use TODAS que forem aplicáveis):**

**Entidades e Dados:**
- **N** (Nouns/Entidades): N1, N2... = Entidades de domínio (Ex: N1=Usuário, N2=Imóvel)
- **ATTR** (Atributos): ATTR1, ATTR2... = Campos/atributos específicos (Ex: ATTR1=nome:string, ATTR2=email:string)
- **D** (Data/Estruturas): D1, D2... = Tabelas, schemas, models (Ex: D1=tabela_usuarios)
- **ENUM** (Enumerações): ENUM1, ENUM2... = Valores fixos (Ex: ENUM1=TipoUsuario[admin,corretor,cliente])
- **REL** (Relacionamentos): REL1, REL2... = Relações entre entidades (Ex: REL1=N1 possui muitos N2)

**Lógica e Regras:**
- **RN** (Regras de Negócio): RN1, RN2... = Regras específicas (Ex: RN1=Email deve ser único)
- **VAL** (Validações): VAL1, VAL2... = Validações de entrada (Ex: VAL1=CPF válido)
- **CALC** (Cálculos): CALC1, CALC2... = Fórmulas e cálculos (Ex: CALC1=comissão=valor*0.05)
- **COND** (Condições): COND1, COND2... = Condições lógicas (Ex: COND1=se status=ativo)

**Fluxos e Processos:**
- **P** (Processos): P1, P2... = Fluxos de trabalho (Ex: P1=Cadastro de imóvel)
- **EST** (Estados): EST1, EST2... = Estados possíveis (Ex: EST1=rascunho, EST2=publicado)
- **TRANS** (Transições): TRANS1, TRANS2... = Transições de estado (Ex: TRANS1=EST1→EST2)
- **STEP** (Etapas): STEP1, STEP2... = Passos do processo (Ex: STEP1=preencher dados)

**Interface:**
- **TELA** (Telas): TELA1, TELA2... = Telas/páginas (Ex: TELA1=Dashboard, TELA2=Listagem)
- **COMP** (Componentes): COMP1, COMP2... = Componentes UI (Ex: COMP1=FormularioCadastro)
- **BTN** (Botões/Ações): BTN1, BTN2... = Ações do usuário (Ex: BTN1=Salvar, BTN2=Cancelar)
- **FILTRO** (Filtros): FILTRO1... = Filtros disponíveis (Ex: FILTRO1=por status)

**Integrações:**
- **API** (Endpoints): API1, API2... = Endpoints REST (Ex: API1=POST /usuarios)
- **S** (Serviços): S1, S2... = Serviços externos (Ex: S1=serviço de email)
- **EVENTO** (Eventos): EVENTO1... = Eventos do sistema (Ex: EVENTO1=usuario_criado)

**Critérios:**
- **AC** (Acceptance Criteria): AC1, AC2... = Critérios de aceitação
- **PERF** (Performance): PERF1... = Requisitos de performance
- **SEG** (Segurança): SEG1... = Requisitos de segurança

**IMPORTANTE:** REUTILIZE os identificadores do Epic pai (N1, N2, ATTR1, etc.) e ESTENDA com novos específicos desta Story.

ESTRUTURA OBRIGATÓRIA DO description_markdown:

```
# Story: [Título no formato User Story]

## Mapa Semântico

### Entidades (Reutilizadas do Epic)
- **N1**: [reutilizado do Epic]
- **N2**: [reutilizado do Epic]

### Atributos Relevantes
- **ATTR1**: [campo]: [tipo] - [descrição]
- **ATTR2**: [campo]: [tipo] - [descrição]
...

### Regras de Negócio
- **RN1**: [regra específica]
- **RN2**: [regra específica]
...

### Validações
- **VAL1**: [validação]
...

### Estados e Transições
- **EST1**: [estado1]
- **TRANS1**: EST1 → EST2 quando [condição]
...

### Telas e Componentes
- **TELA1**: [nome da tela] - [descrição]
- **COMP1**: [componente] em TELA1
...

### Endpoints
- **API1**: [método] [rota] - [descrição]
...

## Descrição Funcional

[Narrativa DETALHADA usando os identificadores. Descreva o fluxo completo,
como as telas interagem, quais validações são aplicadas em cada etapa,
como os estados mudam, etc. MÍNIMO 1500 caracteres.]

## Fluxo Principal

1. STEP1: [descrição usando identificadores]
2. STEP2: [descrição usando identificadores]
...

## Critérios de Aceitação

1. **AC1**: [critério específico e mensurável]
2. **AC2**: [critério específico e mensurável]
...

## Regras de Negócio Detalhadas

### RN1: [Nome da Regra]
- **Condição**: [quando se aplica]
- **Ação**: [o que acontece]
- **Exceção**: [casos especiais]

...

## Especificação de Dados

### Campos Envolvidos
| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| ATTR1 | string | Sim | ... |
| ATTR2 | integer | Não | ... |

## Considerações Técnicas

- [consideração 1]
- [consideração 2]
```

Retorne APENAS JSON válido (sem markdown code blocks):
{
    "title": "Título da Story",
    "semantic_map": {
        "N1": "reutilizado do Epic", "N2": "...",
        "ATTR1": "campo: tipo - descrição",
        "RN1": "regra específica",
        "EST1": "estado", "TRANS1": "transição",
        "TELA1": "tela", "API1": "endpoint",
        "AC1": "critério de aceitação"
    },
    "description_markdown": "[MARKDOWN COMPLETO seguindo a estrutura acima - MÍNIMO 1500 caracteres]",
    "story_points": 5,
    "priority": "high",
    "acceptance_criteria": ["AC1: critério", "AC2: critério", "AC3: critério", "AC4: critério", "AC5: critério"],
    "interview_insights": {
        "key_requirements": ["requisito 1", "requisito 2"],
        "business_goals": ["objetivo 1", "objetivo 2"],
        "technical_constraints": ["restrição 1", "restrição 2"]
    }
}

**REGRAS CRÍTICAS:**
- MÍNIMO 20 identificadores no mapa semântico
- REUTILIZE identificadores do Epic (N1-N9, ATTR1-ATTR9, etc.)
- ESTENDA com novos identificadores específicos desta Story
- DETALHE campos com TIPOS DE DADOS (string, integer, boolean, date, etc)
- DETALHE regras de negócio com CONDIÇÕES ESPECÍFICAS
- INCLUA telas e componentes UI
- INCLUA endpoints da API
- A descrição deve ter MÍNIMO 1500 caracteres
- MÍNIMO 5 critérios de aceitação
- TUDO EM PORTUGUÊS
"""

        # Build COMPLETE context from Epic - NO TRUNCATION
        epic_full_spec = ""
        semantic_map_text = ""
        if parent_epic:
            # Use FULL generated_prompt from Epic - this is the key!
            epic_full_spec = f"""
## ===== ESPECIFICAÇÃO COMPLETA DO EPIC PAI (USE COMO BASE) =====

**Título do Epic:** {parent_epic.title}

**Descrição do Epic:**
{parent_epic.description or 'N/A'}

**ESPECIFICAÇÃO TÉCNICA COMPLETA DO EPIC (generated_prompt):**
{parent_epic.generated_prompt or 'N/A'}

## ===== FIM DA ESPECIFICAÇÃO DO EPIC =====
"""
            if epic_semantic_map:
                semantic_map_text = "\n\n## MAPA SEMÂNTICO DO EPIC (VOCÊ DEVE REUTILIZAR E ESTENDER):\n"
                semantic_map_text += json.dumps(epic_semantic_map, indent=2, ensure_ascii=False)

        user_prompt = f"""Gere a ESPECIFICAÇÃO TÉCNICA COMPLETA para a User Story abaixo.

A Story deve ter o MESMO NÍVEL DE DETALHAMENTO do Epic pai.
Os critérios de aceitação devem ser ESPECÍFICOS para esta Story, não genéricos.

## CONTEXTO DO PROJETO
**Nome:** {project.name}
**Contexto:**
{(project.context_human or project.context_semantic or 'Não disponível')[:3000]}

{epic_full_spec}
{semantic_map_text}

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

## EXEMPLO DE CRITÉRIOS GENÉRICOS (NÃO USE):
- "Funcionalidade implementada" ❌
- "Testes passam" ❌
- "Código revisado" ❌

Retorne APENAS o JSON, sem explicações."""

        try:
            # PROMPT #100: Disable cache for individual content generation
            # Semantic cache matches similar prompts, causing duplicate content
            orchestrator = AIOrchestrator(self.db, enable_cache=False)
            response = await orchestrator.execute(
                usage_type="prompt_generation",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=8000
            )

            content = response.get("content", "")
            result = self._parse_json_response(content)

            if result and isinstance(result, dict):
                # Convert semantic to human description
                semantic_map = result.get("semantic_map", {})
                description_markdown = result.get("description_markdown", "")
                result["description"] = _convert_semantic_to_human(description_markdown, semantic_map)
                result["generated_prompt"] = description_markdown
                return result

            # Fallback with more detail
            return {
                "description": story.description or "",
                "generated_prompt": f"# Story: {story.title}\n\n## Descrição\n{story.description or ''}\n\n## Contexto do Epic\n{parent_epic.title if parent_epic else 'N/A'}",
                "acceptance_criteria": ["AC1: Funcionalidade implementada", "AC2: Testes passam", "AC3: Código revisado", "AC4: Documentação atualizada", "AC5: Deploy realizado"],
                "semantic_map": epic_semantic_map,
                "story_points": story.story_points or 5,
                "interview_insights": {"derived_from_epic": str(parent_epic.id) if parent_epic else None}
            }

        except Exception as e:
            logger.error(f"Error generating story content: {e}")
            return {
                "description": story.description or "",
                "generated_prompt": "",
                "acceptance_criteria": [],
                "semantic_map": {},
                "story_points": story.story_points or 5
            }

    async def activate_suggested_task(self, task_id: UUID) -> Dict:
        """
        PROMPT #102 - Activate a suggested task and generate draft subtasks.

        After activation, auto-generates 3-5 draft subtasks.

        Args:
            task_id: Task ID to activate

        Returns:
            Dict with activated task data and children_generated count
        """
        # Fetch task
        task = self.db.query(Task).filter(Task.id == task_id).first()
        if not task:
            raise ValueError(f"Task {task_id} not found")

        if task.item_type != ItemType.TASK:
            raise ValueError(f"Item {task_id} is not a Task (type: {task.item_type})")

        # Check if suggested
        is_suggested = (task.labels and "suggested" in task.labels) or task.workflow_state == "draft"
        if not is_suggested:
            raise ValueError(f"Task {task_id} is not a suggested item")

        # Fetch project
        project = self.db.query(Project).filter(Project.id == task.project_id).first()
        if not project:
            raise ValueError(f"Project {task.project_id} not found")

        # Fetch parent story and grandparent epic for full context
        parent_story = None
        grandparent_epic = None
        if task.parent_id:
            parent_story = self.db.query(Task).filter(Task.id == task.parent_id).first()
            if parent_story and parent_story.parent_id:
                grandparent_epic = self.db.query(Task).filter(Task.id == parent_story.parent_id).first()

        # Generate full task content with complete hierarchy context
        task_content = await self._generate_full_task_content(task, project, parent_story, grandparent_epic)

        # Update task
        task.description = task_content.get("description", task.description)
        task.generated_prompt = task_content.get("generated_prompt")
        task.acceptance_criteria = task_content.get("acceptance_criteria", [])
        task.story_points = task_content.get("story_points", task.story_points)

        # Store insights
        task.interview_insights = task.interview_insights or {}
        task.interview_insights["activated_from_suggestion"] = True
        task.interview_insights["activation_timestamp"] = datetime.utcnow().isoformat()

        # Remove suggested label
        if task.labels and "suggested" in task.labels:
            task.labels = [l for l in task.labels if l != "suggested"]
        task.workflow_state = "open"
        task.updated_at = datetime.utcnow()

        self.db.commit()
        self.db.refresh(task)

        logger.info(f"✅ Task activated: {task.title}")

        # Generate draft subtasks
        draft_subtasks = await self._generate_draft_subtasks(task, project)

        return {
            "id": str(task.id),
            "title": task.title,
            "description": task.description,
            "generated_prompt": task.generated_prompt,
            "acceptance_criteria": task.acceptance_criteria,
            "story_points": task.story_points,
            "priority": task.priority.value if task.priority else "medium",
            "activated": True,
            "children_generated": len(draft_subtasks)
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

        # SAME DETAILED PROMPT AS EPIC - Adapted for Task
        system_prompt = """Você é um Arquiteto de Software e Tech Lead especialista gerando especificações técnicas DETALHADAS para Tasks de desenvolvimento.

OBJETIVO: Gerar uma especificação TÉCNICA COMPLETA da Task, incluindo:
- Arquivos a criar/modificar
- Funções e métodos com assinaturas
- Parâmetros e tipos de retorno
- Validações e tratamento de erros
- Testes necessários
- Comandos e código de exemplo

METODOLOGIA DE REFERÊNCIAS SEMÂNTICAS:

**Categorias de Identificadores (use TODAS que forem aplicáveis):**

**Código e Arquivos:**
- **FILE** (Arquivos): FILE1, FILE2... = Arquivos a criar/modificar (Ex: FILE1=src/models/User.ts)
- **FUNC** (Funções): FUNC1, FUNC2... = Funções/métodos (Ex: FUNC1=createUser(data: UserDTO): Promise<User>)
- **CLASS** (Classes): CLASS1, CLASS2... = Classes a criar (Ex: CLASS1=UserService)
- **PARAM** (Parâmetros): PARAM1, PARAM2... = Parâmetros de funções (Ex: PARAM1=userId: string)
- **RET** (Retornos): RET1, RET2... = Tipos de retorno (Ex: RET1=Promise<User>)
- **IMPORT** (Imports): IMPORT1... = Imports necessários (Ex: IMPORT1=import { User } from './models')

**Dados e Tipos:**
- **N** (Entidades): N1, N2... = Entidades envolvidas (reutilizar do Epic/Story)
- **ATTR** (Atributos): ATTR1, ATTR2... = Campos com tipos (reutilizar do Epic/Story)
- **TYPE** (Tipos): TYPE1, TYPE2... = Tipos/interfaces (Ex: TYPE1=UserDTO)
- **SCHEMA** (Schemas): SCHEMA1... = Schemas de validação (Ex: SCHEMA1=createUserSchema)

**Lógica:**
- **VAL** (Validações): VAL1, VAL2... = Validações a implementar
- **ERR** (Erros): ERR1, ERR2... = Erros a tratar (Ex: ERR1=UserNotFoundError)
- **LOG** (Logs): LOG1... = Logs a adicionar
- **COND** (Condições): COND1... = Condições lógicas

**Integração:**
- **API** (Endpoints): API1, API2... = Endpoints (reutilizar do Epic/Story)
- **QUERY** (Queries): QUERY1... = Queries de banco (Ex: QUERY1=SELECT * FROM users WHERE id = ?)
- **CMD** (Comandos): CMD1... = Comandos a executar (Ex: CMD1=npm run migrate)

**Testes:**
- **TEST** (Testes): TEST1, TEST2... = Casos de teste (Ex: TEST1=should create user with valid data)
- **MOCK** (Mocks): MOCK1... = Mocks necessários
- **FIXTURE** (Fixtures): FIXTURE1... = Dados de teste

**Critérios:**
- **AC** (Acceptance Criteria): AC1, AC2... = Critérios de aceitação técnicos

**IMPORTANTE:** REUTILIZE os identificadores do Epic/Story (N1, N2, ATTR1, API1, etc.) e ESTENDA com novos específicos desta Task.

ESTRUTURA OBRIGATÓRIA DO description_markdown:

```
# Task: [Título Técnico]

## Mapa Semântico

### Entidades (Reutilizadas)
- **N1**: [do Epic/Story]

### Arquivos
- **FILE1**: [caminho/arquivo.ext] - [descrição do que fazer]
- **FILE2**: [caminho/arquivo.ext] - [descrição]

### Funções a Implementar
- **FUNC1**: [assinatura completa com tipos]
- **FUNC2**: [assinatura completa com tipos]

### Tipos/Interfaces
- **TYPE1**: [definição do tipo]

### Validações
- **VAL1**: [validação específica]
- **VAL2**: [validação específica]

### Tratamento de Erros
- **ERR1**: [erro e como tratar]

### Queries/Comandos
- **QUERY1**: [query SQL ou comando]
- **CMD1**: [comando terminal]

### Testes Necessários
- **TEST1**: [caso de teste]
- **TEST2**: [caso de teste]

## Descrição Técnica

[Narrativa DETALHADA usando os identificadores. Descreva EXATAMENTE:
- O QUE implementar (quais arquivos, funções)
- COMO implementar (lógica, algoritmo)
- ONDE implementar (localização no código)
MÍNIMO 1200 caracteres.]

## Passos de Implementação

1. STEP1: [passo detalhado com identificadores]
2. STEP2: [passo detalhado]
...

## Código de Exemplo

```[linguagem]
// Exemplo de implementação de FUNC1
[código de exemplo]
```

## Critérios de Aceitação Técnicos

1. **AC1**: [critério técnico específico]
2. **AC2**: [critério técnico específico]
...

## Comandos Necessários

```bash
[comandos a executar]
```

## Considerações Técnicas

- [consideração 1]
- [consideração 2]
```

Retorne APENAS JSON válido:
{
    "title": "Título da Task",
    "semantic_map": {
        "N1": "reutilizado", "ATTR1": "reutilizado",
        "FILE1": "caminho/arquivo.ext",
        "FUNC1": "assinatura(params): ReturnType",
        "VAL1": "validação",
        "ERR1": "erro",
        "TEST1": "caso de teste",
        "AC1": "critério"
    },
    "description_markdown": "[MARKDOWN COMPLETO - MÍNIMO 1200 caracteres]",
    "story_points": 3,
    "acceptance_criteria": ["AC1: critério", "AC2: critério", "AC3: critério", "AC4: critério"],
    "interview_insights": {
        "files_to_modify": ["arquivo1", "arquivo2"],
        "dependencies": ["dep1", "dep2"],
        "commands": ["cmd1", "cmd2"]
    }
}

**REGRAS CRÍTICAS:**
- MÍNIMO 15 identificadores no mapa semântico
- REUTILIZE identificadores do Epic/Story
- INCLUA arquivos específicos (FILE1, FILE2...)
- INCLUA funções com assinaturas completas (FUNC1, FUNC2...)
- INCLUA casos de teste (TEST1, TEST2...)
- A descrição deve ter MÍNIMO 1200 caracteres
- MÍNIMO 4 critérios de aceitação
- INCLUA código de exemplo quando aplicável
- TUDO EM PORTUGUÊS
"""

        # Build COMPLETE context from Epic + Story - NO TRUNCATION
        epic_full_spec = ""
        story_full_spec = ""
        semantic_map_text = ""

        if grandparent_epic:
            epic_full_spec = f"""
## ===== ESPECIFICAÇÃO COMPLETA DO EPIC (AVÔ) =====

**Título do Epic:** {grandparent_epic.title}

**Descrição do Epic:**
{grandparent_epic.description or 'N/A'}

**ESPECIFICAÇÃO TÉCNICA COMPLETA DO EPIC (generated_prompt):**
{grandparent_epic.generated_prompt or 'N/A'}

## ===== FIM DA ESPECIFICAÇÃO DO EPIC =====
"""

        if parent_story:
            story_full_spec = f"""
## ===== ESPECIFICAÇÃO COMPLETA DA STORY (PAI DIRETO) =====

**Título da Story:** {parent_story.title}

**Descrição da Story:**
{parent_story.description or 'N/A'}

**ESPECIFICAÇÃO TÉCNICA COMPLETA DA STORY (generated_prompt):**
{parent_story.generated_prompt or 'N/A'}

## ===== FIM DA ESPECIFICAÇÃO DA STORY =====
"""

        if combined_semantic_map:
            semantic_map_text = "\n\n## MAPA SEMÂNTICO COMBINADO (EPIC + STORY - VOCÊ DEVE REUTILIZAR):\n"
            semantic_map_text += json.dumps(combined_semantic_map, indent=2, ensure_ascii=False)
            semantic_map_text += "\n\n**OBRIGATÓRIO:** Reutilize TODOS os identificadores relevantes do Epic/Story e estenda com novos específicos desta Task."

        user_prompt = f"""Gere a ESPECIFICAÇÃO TÉCNICA COMPLETA para esta Task.

A Task deve ter o MESMO NÍVEL DE DETALHAMENTO do Epic e da Story pai.
Os critérios de aceitação devem ser TÉCNICOS e ESPECÍFICOS para esta Task.

## CONTEXTO DO PROJETO
**Nome:** {project.name}

**Contexto do Projeto:**
{project.context_human or project.context_semantic or 'Não disponível'}

{epic_full_spec}
{story_full_spec}
{semantic_map_text}

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
                max_tokens=6000
            )

            content = response.get("content", "")
            result = self._parse_json_response(content)

            if result and isinstance(result, dict):
                # Convert semantic to human description
                semantic_map = result.get("semantic_map", {})
                description_markdown = result.get("description_markdown", "")
                result["description"] = _convert_semantic_to_human(description_markdown, semantic_map)
                result["generated_prompt"] = description_markdown
                return result

            return {
                "description": task.description or "",
                "generated_prompt": f"# Task: {task.title}\n\n## Descrição\n{task.description or ''}\n\n## Contexto da Story\n{parent_story.title if parent_story else 'N/A'}",
                "acceptance_criteria": ["AC1: Implementação completa", "AC2: Testes passam", "AC3: Code review aprovado", "AC4: Sem bugs"],
                "semantic_map": combined_semantic_map,
                "story_points": task.story_points or 3
            }

        except Exception as e:
            logger.error(f"Error generating task content: {e}")
            return {
                "description": task.description or "",
                "generated_prompt": "",
                "acceptance_criteria": [],
                "story_points": task.story_points or 2
            }

    async def activate_suggested_subtask(self, subtask_id: UUID) -> Dict:
        """
        PROMPT #102 - Activate a suggested subtask.

        Subtasks are leaf nodes - no children generated.
        Generates FULL DETAILED content (same level as Epic/Story/Task).

        Args:
            subtask_id: Subtask ID to activate

        Returns:
            Dict with activated subtask data
        """
        # Fetch subtask
        subtask = self.db.query(Task).filter(Task.id == subtask_id).first()
        if not subtask:
            raise ValueError(f"Subtask {subtask_id} not found")

        if subtask.item_type != ItemType.SUBTASK:
            raise ValueError(f"Item {subtask_id} is not a Subtask (type: {subtask.item_type})")

        # Check if suggested
        is_suggested = (subtask.labels and "suggested" in subtask.labels) or subtask.workflow_state == "draft"
        if not is_suggested:
            raise ValueError(f"Subtask {subtask_id} is not a suggested item")

        # Fetch project
        project = self.db.query(Project).filter(Project.id == subtask.project_id).first()
        if not project:
            raise ValueError(f"Project {subtask.project_id} not found")

        # Fetch full hierarchy for complete context
        parent_task = None
        grandparent_story = None
        great_grandparent_epic = None
        if subtask.parent_id:
            parent_task = self.db.query(Task).filter(Task.id == subtask.parent_id).first()
            if parent_task and parent_task.parent_id:
                grandparent_story = self.db.query(Task).filter(Task.id == parent_task.parent_id).first()
                if grandparent_story and grandparent_story.parent_id:
                    great_grandparent_epic = self.db.query(Task).filter(Task.id == grandparent_story.parent_id).first()

        # Generate FULL subtask content with complete hierarchy context
        subtask_content = await self._generate_full_subtask_content(subtask, project, parent_task, grandparent_story, great_grandparent_epic)

        # Update subtask with generated content
        subtask.description = subtask_content.get("description", subtask.description)
        subtask.generated_prompt = subtask_content.get("generated_prompt")
        subtask.acceptance_criteria = subtask_content.get("acceptance_criteria", [])

        # Store semantic map and insights
        subtask.interview_insights = subtask.interview_insights or {}
        subtask.interview_insights["semantic_map"] = subtask_content.get("semantic_map", {})
        subtask.interview_insights["activated_from_suggestion"] = True
        subtask.interview_insights["activation_timestamp"] = datetime.utcnow().isoformat()

        # Merge additional insights
        if subtask_content.get("interview_insights"):
            subtask.interview_insights.update(subtask_content["interview_insights"])

        # Remove suggested label
        if subtask.labels and "suggested" in subtask.labels:
            subtask.labels = [l for l in subtask.labels if l != "suggested"]
        subtask.workflow_state = "open"
        subtask.updated_at = datetime.utcnow()

        self.db.commit()
        self.db.refresh(subtask)

        logger.info(f"✅ Subtask activated: {subtask.title}")

        return {
            "id": str(subtask.id),
            "title": subtask.title,
            "description": subtask.description,
            "generated_prompt": subtask.generated_prompt,
            "acceptance_criteria": subtask.acceptance_criteria,
            "story_points": subtask.story_points or 1,
            "priority": subtask.priority.value if subtask.priority else "medium",
            "activated": True,
            "children_generated": 0  # Subtasks don't have children
        }

    async def _generate_full_subtask_content(self, subtask: Task, project: Project, parent_task: Task = None, grandparent_story: Task = None, great_grandparent_epic: Task = None) -> Dict:
        """
        Generate FULL EPIC-LEVEL content for a subtask using AI.

        Uses the SAME detailed prompt structure as other items.
        Includes ALL parent context (Epic + Story + Task semantic maps).

        Args:
            subtask: The subtask to generate content for (may only have title)
            project: The project
            parent_task: The parent Task (passed directly for full context access)
            grandparent_story: The grandparent Story (passed directly for full context access)
            great_grandparent_epic: The great-grandparent Epic (passed directly for full context access)
        """

        # Get full hierarchy context: Task -> Story -> Epic
        # Use passed parameters or fetch from DB if not provided
        task_semantic_map = {}
        story_semantic_map = {}
        epic_semantic_map = {}

        if not parent_task and subtask.parent_id:
            parent_task = self.db.query(Task).filter(Task.id == subtask.parent_id).first()

        if parent_task:
            if parent_task.interview_insights:
                task_semantic_map = parent_task.interview_insights.get("semantic_map", {})
            if not grandparent_story and parent_task.parent_id:
                grandparent_story = self.db.query(Task).filter(Task.id == parent_task.parent_id).first()

        if grandparent_story:
            if grandparent_story.interview_insights:
                story_semantic_map = grandparent_story.interview_insights.get("semantic_map", {})
            if not great_grandparent_epic and grandparent_story.parent_id:
                great_grandparent_epic = self.db.query(Task).filter(Task.id == grandparent_story.parent_id).first()

        if great_grandparent_epic and great_grandparent_epic.interview_insights:
            epic_semantic_map = great_grandparent_epic.interview_insights.get("semantic_map", {})

        # Combine all semantic maps
        combined_semantic_map = {**epic_semantic_map, **story_semantic_map, **task_semantic_map}

        system_prompt = """Você é um Desenvolvedor Sênior gerando especificações DETALHADAS para Subtasks de implementação.

OBJETIVO: Gerar uma especificação COMPLETA da Subtask, incluindo:
- Código específico a escrever
- Linhas exatas a modificar
- Comandos a executar
- Validações e testes

METODOLOGIA DE REFERÊNCIAS SEMÂNTICAS:

**Categorias de Identificadores:**
- **N** (Entidades): Reutilizar do Epic/Story/Task
- **ATTR** (Atributos): Reutilizar do Epic/Story/Task
- **FILE** (Arquivos): FILE1... = Arquivo específico a modificar
- **LINE** (Linhas): LINE1... = Linhas de código específicas
- **FUNC** (Funções): FUNC1... = Função específica a implementar/modificar
- **CODE** (Código): CODE1... = Bloco de código a adicionar
- **VAL** (Validações): VAL1... = Validação específica
- **TEST** (Testes): TEST1... = Teste específico
- **CMD** (Comandos): CMD1... = Comando a executar
- **AC** (Critérios): AC1, AC2... = Critérios de aceitação

ESTRUTURA OBRIGATÓRIA DO description_markdown:

```
# Subtask: [Título - Ação Específica]

## Mapa Semântico

### Entidades (Reutilizadas)
- **N1**: [do Epic/Story/Task]

### Arquivo(s) a Modificar
- **FILE1**: [caminho/completo/arquivo.ext]

### Código a Adicionar/Modificar
- **CODE1**: [descrição do bloco de código]
- **LINE1**: [linha específica]

### Função(ões) Envolvida(s)
- **FUNC1**: [nome da função]

### Validações
- **VAL1**: [validação]

### Teste(s)
- **TEST1**: [caso de teste]

### Comando(s)
- **CMD1**: [comando]

## Descrição Técnica Detalhada

[Narrativa DETALHADA descrevendo EXATAMENTE:
- O QUE modificar (arquivo, função, linha)
- O CÓDIGO a escrever
- COMO testar
MÍNIMO 800 caracteres.]

## Código a Implementar

```[linguagem]
// Código específico a adicionar
[código completo]
```

## Passos de Execução

1. [Passo específico com arquivo/linha]
2. [Passo específico]
...

## Comandos a Executar

```bash
[comandos]
```

## Critérios de Aceitação

1. **AC1**: [critério específico]
2. **AC2**: [critério específico]
...
```

Retorne APENAS JSON válido:
{
    "title": "Título da Subtask",
    "semantic_map": {
        "N1": "reutilizado",
        "FILE1": "caminho/arquivo.ext",
        "LINE1": "linha específica",
        "CODE1": "descrição do código",
        "FUNC1": "função",
        "VAL1": "validação",
        "TEST1": "teste",
        "CMD1": "comando",
        "AC1": "critério"
    },
    "description_markdown": "[MARKDOWN COMPLETO - MÍNIMO 800 caracteres]",
    "acceptance_criteria": ["AC1: critério", "AC2: critério", "AC3: critério"],
    "interview_insights": {
        "code_to_add": "código",
        "files_to_modify": ["arquivo1"],
        "commands": ["cmd1"]
    }
}

**REGRAS CRÍTICAS:**
- MÍNIMO 10 identificadores no mapa semântico
- REUTILIZE identificadores do Epic/Story/Task
- INCLUA código específico a escrever
- INCLUA arquivo e localização exata
- description_markdown com MÍNIMO 800 caracteres
- MÍNIMO 3 critérios de aceitação
- TUDO EM PORTUGUÊS
"""

        # Build COMPLETE context from Epic + Story + Task - NO TRUNCATION
        epic_full_spec = ""
        story_full_spec = ""
        task_full_spec = ""
        semantic_map_text = ""

        if great_grandparent_epic:
            epic_full_spec = f"""
## ===== ESPECIFICAÇÃO COMPLETA DO EPIC (BISAVÔ) =====

**Título do Epic:** {great_grandparent_epic.title}

**Descrição do Epic:**
{great_grandparent_epic.description or 'N/A'}

**ESPECIFICAÇÃO TÉCNICA COMPLETA DO EPIC (generated_prompt):**
{great_grandparent_epic.generated_prompt or 'N/A'}

## ===== FIM DA ESPECIFICAÇÃO DO EPIC =====
"""

        if grandparent_story:
            story_full_spec = f"""
## ===== ESPECIFICAÇÃO COMPLETA DA STORY (AVÔ) =====

**Título da Story:** {grandparent_story.title}

**Descrição da Story:**
{grandparent_story.description or 'N/A'}

**ESPECIFICAÇÃO TÉCNICA COMPLETA DA STORY (generated_prompt):**
{grandparent_story.generated_prompt or 'N/A'}

## ===== FIM DA ESPECIFICAÇÃO DA STORY =====
"""

        if parent_task:
            task_full_spec = f"""
## ===== ESPECIFICAÇÃO COMPLETA DA TASK (PAI DIRETO) =====

**Título da Task:** {parent_task.title}

**Descrição da Task:**
{parent_task.description or 'N/A'}

**ESPECIFICAÇÃO TÉCNICA COMPLETA DA TASK (generated_prompt):**
{parent_task.generated_prompt or 'N/A'}

## ===== FIM DA ESPECIFICAÇÃO DA TASK =====
"""

        if combined_semantic_map:
            semantic_map_text = "\n\n## MAPA SEMÂNTICO COMBINADO (EPIC + STORY + TASK - VOCÊ DEVE REUTILIZAR):\n"
            semantic_map_text += json.dumps(combined_semantic_map, indent=2, ensure_ascii=False)
            semantic_map_text += "\n\n**OBRIGATÓRIO:** Reutilize TODOS os identificadores relevantes e estenda com novos específicos desta Subtask."

        user_prompt = f"""Gere a ESPECIFICAÇÃO COMPLETA para esta Subtask.

A Subtask deve ter o MESMO NÍVEL DE DETALHAMENTO do Epic/Story/Task pai.
Os critérios de aceitação devem ser ESPECÍFICOS para esta Subtask.

## CONTEXTO DO PROJETO
**Nome:** {project.name}

**Contexto do Projeto:**
{project.context_human or project.context_semantic or 'Não disponível'}

{epic_full_spec}
{story_full_spec}
{task_full_spec}
{semantic_map_text}

## SUBTASK A ESPECIFICAR
**Título da Subtask:** {subtask.title}

## REGRAS OBRIGATÓRIAS

1. **REUTILIZE os identificadores do Epic/Story/Task** (N1, ATTR1, API1, FILE1, FUNC1, etc.)
2. **ESTENDA com identificadores ESPECÍFICOS** (CODE1, LINE1, etc.)
3. **Critérios de Aceitação ESPECÍFICOS** - para esta subtask exata
4. **description_markdown MÍNIMO 800 caracteres** com estrutura técnica
5. **MÍNIMO 10 identificadores** no mapa semântico
6. **MÍNIMO 3 critérios de aceitação** específicos
7. **INCLUA**: código específico a escrever, arquivo e localização exata

## EXEMPLO DE CRITÉRIOS DE ACEITAÇÃO ESPECÍFICOS:
- "AC1: Arquivo src/models/User.ts modificado com novo campo 'avatar'"
- "AC2: Função createUser atualizada para aceitar parâmetro 'avatarUrl'"
- "AC3: Teste unitário adicionado para validar upload de avatar"

## EXEMPLO DE CRITÉRIOS GENÉRICOS (NÃO USE):
- "Código implementado" ❌
- "Funciona corretamente" ❌

Retorne APENAS o JSON, sem explicações."""

        try:
            # PROMPT #100: Disable cache for individual content generation
            orchestrator = AIOrchestrator(self.db, enable_cache=False)
            response = await orchestrator.execute(
                usage_type="prompt_generation",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=4000
            )

            content = response.get("content", "")
            result = self._parse_json_response(content)

            if result and isinstance(result, dict):
                semantic_map = result.get("semantic_map", {})
                description_markdown = result.get("description_markdown", "")
                result["description"] = _convert_semantic_to_human(description_markdown, semantic_map)
                result["generated_prompt"] = description_markdown
                return result

            return {
                "description": subtask.description or "",
                "generated_prompt": f"# Subtask: {subtask.title}\n\n## Descrição\n{subtask.description or ''}\n\n## Contexto\nTask pai: {parent_task.title if parent_task else 'N/A'}",
                "acceptance_criteria": ["AC1: Implementação completa", "AC2: Testes passam", "AC3: Code review aprovado"],
                "semantic_map": combined_semantic_map
            }

        except Exception as e:
            logger.error(f"Error generating subtask content: {e}")
            return {
                "description": subtask.description or "",
                "generated_prompt": "",
                "acceptance_criteria": [],
                "semantic_map": {}
            }
