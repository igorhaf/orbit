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
