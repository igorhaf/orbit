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
        project = self.db.query(Project).filter(Project.id == epic.project_id).first()
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

        # --- Validate acceptance_criteria ---
        if not acceptance_criteria or len(acceptance_criteria) == 0:
            issues.append("acceptance_criteria empty")

            # Try to extract from description
            extracted = []
            if description:
                import re as _re
                for line in description.split("\n"):
                    line = line.strip()
                    if _re.match(r'^[-*]\s*\[[ xX]?\]', line) or _re.match(r'^\d+\.\s*\[[ xX]?\]', line):
                        criterion = _re.sub(r'^[\d\.\-\*\s\[\]xX]+', '', line).strip()
                        if criterion and len(criterion) > 5:
                            extracted.append(criterion)
                    elif _re.match(r'^[-*]\s*\*?\*?AC\d+', line, _re.IGNORECASE):
                        criterion = _re.sub(r'^[-*]\s*\*?\*?AC\d+[:\s]*', '', line, flags=_re.IGNORECASE).strip()
                        if criterion and len(criterion) > 5:
                            extracted.append(criterion)

            if extracted:
                acceptance_criteria = extracted[:15]
                logger.info(f"  Restructured: {len(acceptance_criteria)} criteria extracted from description")
            else:
                # PROMPT #175 - Type-aware fallback criteria
                fallback_criteria = {
                    "epic": [
                        f"Módulo '{title}' implementado e funcional",
                        "Testes unitários cobrindo os fluxos principais",
                        "Documentação técnica atualizada",
                    ],
                    "story": [
                        f"Story '{title}' funcional e testada",
                        "Critérios de aceitação verificados",
                        "Testes de integração passando",
                    ],
                    "task": [
                        f"Task '{title}' implementada",
                        "Testes unitários adicionados",
                    ],
                    "subtask": [
                        f"Subtask '{title}' concluída",
                    ],
                }
                acceptance_criteria = fallback_criteria.get(item_type, fallback_criteria["epic"])
                logger.info(f"  Restructured: fallback acceptance_criteria generated for {item_type}")

        # --- Validate story_points (skip for subtask) ---
        if default_story_points is not None:
            if not story_points or not isinstance(story_points, (int, float)) or story_points <= 0:
                issues.append(f"story_points invalid ({story_points})")
                story_points = default_story_points
                logger.info(f"  Restructured: story_points set to default {default_story_points}")

        # --- Log validation results ---
        if issues:
            logger.warning(
                f"⚠️ Content validation found {len(issues)} issues for '{title[:50]}': "
                f"{', '.join(issues)}"
            )
            logger.info(f"  Final description: {len(description)} chars")
            logger.info(f"  Final generated_prompt: {len(generated_prompt)} chars")
            logger.info(f"  Final acceptance_criteria: {len(acceptance_criteria)} items")
            logger.info(f"  Final story_points: {story_points}")
        else:
            logger.info(f"✅ Content validation passed for '{title[:50]}'")

        # Return restructured content
        result = {
            **content,
            "description": description,
            "generated_prompt": generated_prompt,
            "acceptance_criteria": acceptance_criteria,
            "semantic_map": semantic_map,
            "interview_insights": interview_insights,
        }
        if default_story_points is not None:
            result["story_points"] = int(story_points)
        return result

    def _validate_context_content(
        self,
        context_result: Dict,
        project_name: str
    ) -> Dict:
        """
        PROMPT #175/186 - Validate context generation output.

        Ensures context_semantic and context_human meet minimum quality
        before saving to the project. Also ensures both are strings (not dicts).
        """
        MIN_CONTEXT_LEN = 100

        context_semantic = context_result.get("context_semantic", "") or ""
        context_human = context_result.get("context_human", "") or ""

        # PROMPT #186 - Ensure both are strings, convert dicts to markdown
        if isinstance(context_semantic, dict):
            logger.warning("  _validate_context_content: context_semantic is dict, converting to markdown")
            context_semantic = _dict_to_markdown_context(context_semantic, project_name)
        elif not isinstance(context_semantic, str):
            context_semantic = str(context_semantic)

        if isinstance(context_human, dict):
            logger.warning("  _validate_context_content: context_human is dict, converting to markdown")
            context_human = _dict_to_markdown_context(context_human, project_name)
        elif not isinstance(context_human, str):
            context_human = str(context_human)

        # PROMPT #186 - Always strip emojis as final safety net
        context_semantic = _strip_emojis(context_semantic)
        context_human = _strip_emojis(context_human)

        issues = []

        if len(context_semantic.strip()) < MIN_CONTEXT_LEN:
            issues.append(f"context_semantic too short ({len(context_semantic.strip())} chars)")
            if len(context_human.strip()) >= MIN_CONTEXT_LEN:
                context_semantic = context_human
                logger.info("  Restructured: context_semantic copied from context_human")
            else:
                context_semantic = (
                    f"# Projeto: {project_name}\n\n"
                    f"Contexto gerado automaticamente. "
                    f"Informações insuficientes da entrevista para gerar contexto detalhado.\n\n"
                    f"*Edite para adicionar detalhes.*"
                )
                logger.info("  Restructured: context_semantic built from fallback")

        if len(context_human.strip()) < MIN_CONTEXT_LEN:
            issues.append(f"context_human too short ({len(context_human.strip())} chars)")
            if len(context_semantic.strip()) >= MIN_CONTEXT_LEN:
                context_human = context_semantic
                logger.info("  Restructured: context_human copied from context_semantic")

        if issues:
            logger.warning(
                f"Context validation found {len(issues)} issues for '{project_name[:50]}': "
                f"{', '.join(issues)}"
            )
        else:
            logger.info(f"Context validation passed for '{project_name[:50]}'")

        return {
            **context_result,
            "context_semantic": context_semantic,
            "context_human": context_human,
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
- **API** (Endpoints): API1, API2... = Endpoints REST (Ex: API1=POST /usuários)
- **S** (Serviços): S1, S2... = Serviços externos (Ex: S1=serviço de email)
- **EVENTO** (Eventos): EVENTO1... = Eventos do sistema (Ex: EVENTO1=usuario_criado)

**Critérios:**
- **AC** (Acceptance Criteria): AC1, AC2... = Critérios de aceitação
- **PERF** (Performance): PERF1... = Requisitos de performance
- **SEG** (Segurança): SEG1... = Requisitos de segurança

Sua tarefa:
1. Análise o contexto do projeto e o épico sugerido
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

        # PROMPT #162 - Fetch relevant interview answers from RAG
        interview_context = ""
        try:
            rag_service = RAGService(self.db)
            relevant_answers = rag_service.get_relevant_interview_answers(
                query=f"{epic_title} {epic_description or ''}",
                project_id=project.id,
                top_k=5,
                similarity_threshold=0.5
            )
            if relevant_answers:
                interview_context = "\n\n## RESPOSTAS RELEVANTES DA ENTREVISTA\n"
                interview_context += "*(O usuário mencionou isto durante a entrevista de contexto)*\n\n"
                for i, answer in enumerate(relevant_answers, 1):
                    content = answer.get("content", "")[:500]
                    interview_context += f"- {content}\n"
                logger.info(f"📝 Added {len(relevant_answers)} relevant interview answers to epic context")
        except Exception as e:
            logger.warning(f"Could not fetch interview answers: {e}")

        # PROMPT #182 - Explicitly fetch business rules from RAG
        business_rules_context = ""
        try:
            rag_service = RAGService(self.db)
            rules = rag_service.get_business_rules(project_id=project.id, top_k=20)
            if rules:
                business_rules_context = rag_service.format_business_rules_for_prompt(rules, max_chars=6000)
                logger.info(f"📋 Injected {len(rules)} business rules into epic content generation")
        except Exception as e:
            logger.warning(f"Could not fetch business rules for epic: {e}")

        user_prompt = f"""Gere a ESPECIFICAÇÃO TÉCNICA COMPLETA para este Epic/Módulo.

## CONTEXTO DO PROJETO
**Nome:** {project.name}
**Descrição:** {project.description or 'Não especificada'}

**Contexto Semântico do Projeto (REUTILIZE estes identificadores):**
{project.context_semantic or 'Não disponível'}{interview_context}

**Contexto Legível do Projeto:**
{project.context_human or 'Não disponível'}

{business_rules_context}
{f'''ATENÇÃO CRÍTICA: As regras de negócio acima foram extraídas DIRETAMENTE do código-fonte do projeto.
Você DEVE:
1. INCORPORAR estas regras no Mapa Semântico (como RN1, RN2, VAL1, etc.) com seus conteúdos REAIS
2. USAR as regras nos Critérios de Aceitação — cada regra relevante deve ter um AC correspondente
3. DETALHAR as regras na seção "Regras de Negócio Detalhadas" com condições, ações e exceções REAIS
4. RESPEITAR a hierarquia e estrutura das regras do código existente
NÃO invente regras genéricas — USE as regras REAIS listadas acima.''' if business_rules_context else ''}

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
- {f'INCORPORE as regras de negócio do projeto listadas acima' if business_rules_context else 'Liste TODAS as regras de negócio do módulo'}
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
- ATTR1: título: string(100) - Título do anúncio, obrigatório
- ATTR2: descrição: text - Descrição detalhada, obrigatório, mínimo 50 caracteres
- ATTR3: preço: decimal(10,2) - Valor do imóvel em reais
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
            max_tokens=4000,  # Increased to allow for detailed specifications
            enable_rag=True,  # PROMPT #124 - Enable RAG for context generation
            project_id=str(project.id)  # PROMPT #125 - Log to prompts table
        )

        # PROMPT #127 - Capture AI model used for tracking
        ai_model_used = response.get("model", "unknown")

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
                    max_tokens=4000,  # Increased to allow more detailed response
                    enable_rag=True,  # PROMPT #124 - Enable RAG for context generation
                    project_id=str(project.id)  # PROMPT #125 - Log to prompts table
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
                    raise ValueError("Resposta muito curta")

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

NOTA: Esta e uma especificação preliminar. A geração automática de conteúdo detalhado falhou.
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

        # PROMPT #180 - Include acceptance criteria in generated_prompt
        acceptance_criteria = result.get("acceptance_criteria", [])
        if acceptance_criteria:
            generated_prompt += "\n\n## Critérios de Aceitação\n\n"
            for ac in acceptance_criteria:
                generated_prompt += f"- {ac}\n"

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
        # PROMPT #127 - Include AI model used for tracking
        return {
            "title": result.get("title", epic_title),
            "description": description,
            "generated_prompt": generated_prompt,
            "semantic_map": semantic_map,
            "acceptance_criteria": acceptance_criteria,
            "story_points": result.get("story_points"),
            "interview_insights": result.get("interview_insights", {}),
            "ai_model_used": ai_model_used  # PROMPT #127
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
            raise ValueError(f"Item {epic_id} não encontrado")

        # Check if it's a suggested item
        is_suggested = (
            epic.labels and "suggested" in epic.labels
        ) or epic.workflow_state == "draft"

        if not is_suggested:
            raise ValueError(
                f"Item {epic_id} não é um item sugerido. "
                "Apenas itens sugeridos podem ser rejeitados."
            )

        item_title = epic.title

        # Delete the item
        self.db.delete(epic)
        self.db.commit()

        logger.info(f"❌ Suggested item rejected and deleted: {item_title}")

        return True
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

        # Fetch project
        project = self.db.query(Project).filter(Project.id == story.project_id).first()
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
- **API** (Endpoints): API1, API2... = Endpoints REST (Ex: API1=POST /usuários)
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
                max_tokens=6000,
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
            raise ValueError(f"Task {task_id} não encontrada")

        if task.item_type != ItemType.TASK:
            raise ValueError(f"Item {task_id} não é uma Task (tipo: {task.item_type})")

        # Check if suggested
        is_suggested = (task.labels and "suggested" in task.labels) or task.workflow_state == "draft"
        if not is_suggested:
            raise ValueError(f"Task {task_id} não é um item sugerido")

        # Fetch project
        project = self.db.query(Project).filter(Project.id == task.project_id).first()
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

        # PROMPT #127 - Removed auto-generation of draft subtasks.
        # Children are now generated on-demand via "Generate Subtasks" button.

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
                max_tokens=6000,
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
            raise ValueError(f"Subtask {subtask_id} não encontrada")

        if subtask.item_type != ItemType.SUBTASK:
            raise ValueError(f"Item {subtask_id} não é uma Subtask (tipo: {subtask.item_type})")

        # Check if suggested
        is_suggested = (subtask.labels and "suggested" in subtask.labels) or subtask.workflow_state == "draft"
        if not is_suggested:
            raise ValueError(f"Subtask {subtask_id} não é um item sugerido")

        # Fetch project
        project = self.db.query(Project).filter(Project.id == subtask.project_id).first()
        if not project:
            raise ValueError(f"Projeto {subtask.project_id} não encontrado")

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

        # PROMPT #175 - Validate and restructure AI response before saving
        subtask_content = self._validate_and_restructure_content(
            subtask_content, subtask.title, subtask.description, project, item_type="subtask"
        )

        # Update subtask with generated content
        # PROMPT #232 - REGRA #0: Human data is sacred - never overwrite human edits
        if subtask.description_edited_by != 'human':
            subtask.description = subtask_content.get("description", subtask.description)
            subtask.description_edited_by = 'ai'
        else:
            logger.info(f"🛡️ Preserving human-edited description for subtask '{subtask.title}'")

        if subtask.prompt_edited_by != 'human':
            subtask.generated_prompt = subtask_content.get("generated_prompt")
            subtask.prompt_edited_by = 'ai'
        else:
            logger.info(f"🛡️ Preserving human-edited prompt for subtask '{subtask.title}'")

        subtask.acceptance_criteria = subtask_content.get("acceptance_criteria", [])
        # PROMPT #127 - Track which AI model generated the content
        subtask.created_by_ai_model = subtask_content.get("ai_model_used")

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

        # PROMPT #232 - IC-2 fix: lock context on ANY card activation
        if not project.context_locked:
            project.context_locked = True
            project.context_locked_at = datetime.utcnow()
            logger.info(f"🔒 Context locked for project {project.name} (subtask activated)")

        self.db.commit()
        self.db.refresh(subtask)

        logger.info(f"✅ Subtask activated: {subtask.title}")

        # PROMPT #162 - Index activated card in RAG for semantic search
        try:
            rag_service = RAGService(self.db)
            rag_service.store_card(
                card_id=subtask.id,
                title=subtask.title,
                description=subtask.description,
                generated_prompt=subtask.generated_prompt,
                item_type="subtask",
                parent_id=subtask.parent_id,
                labels=subtask.labels,
                workflow_state=subtask.workflow_state,
                project_id=subtask.project_id
            )
            logger.info(f"📇 Subtask indexed in RAG: {subtask.title}")
        except Exception as e:
            logger.error(f"❌ Error indexing subtask in RAG: {str(e)}")

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

        # PROMPT #182 - Explicitly fetch business rules from RAG
        business_rules_context = ""
        try:
            rag_service = RAGService(self.db)
            rules = rag_service.get_business_rules(project_id=project.id, top_k=10)
            if rules:
                business_rules_context = rag_service.format_business_rules_for_prompt(rules, max_chars=2000)
                logger.info(f"📋 Injected {len(rules)} business rules into subtask content generation")
        except Exception as e:
            logger.warning(f"Could not fetch business rules for subtask: {e}")

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

{business_rules_context}
{f'ATENÇÃO: As regras de negócio acima foram extraídas do código-fonte. IMPLEMENTE as regras relevantes nesta Subtask.' if business_rules_context else ''}

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
                max_tokens=6000,
                enable_rag=True,  # PROMPT #124 - Enable RAG for context generation
                project_id=str(project.id)  # PROMPT #125 - Log to prompts table
            )

            # PROMPT #127 - Capture AI model used for tracking
            ai_model_used = response.get("model", "unknown")

            content = response.get("content", "")
            # PROMPT #178 - Use robust parser (8 strategies) instead of simple _parse_json_response
            try:
                result = _robust_json_parse(content, context=f"subtask_content:{subtask.title[:30]}")
            except ValueError:
                result = None

            if result and isinstance(result, dict):
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
            logger.warning(f"⚠️ Subtask JSON parsing failed, extracting clean content from raw response")
            raw_content = content.strip() if content else ""
            extracted = _extract_content_from_raw_response(raw_content, subtask.title, "Subtask")

            if extracted:
                extracted.setdefault("acceptance_criteria", [
                    f"AC1: {subtask.title} implementada",
                    "AC2: Testes passam",
                    "AC3: Code review aprovado"
                ])
                # PROMPT #180 - Append criteria to generated_prompt
                ac_list = extracted.get("acceptance_criteria", [])
                if ac_list and "## Critérios de Aceitação" not in extracted.get("generated_prompt", ""):
                    extracted["generated_prompt"] = extracted.get("generated_prompt", "") + "\n\n## Critérios de Aceitação\n\n" + "".join(f"- {ac}\n" for ac in ac_list)
                extracted.setdefault("semantic_map", combined_semantic_map)
                extracted["ai_model_used"] = ai_model_used
                return extracted

            # No usable content extracted - build from parent context
            task_desc = (parent_task.description or parent_task.generated_prompt or "") if parent_task else ""
            story_desc = (grandparent_story.description or grandparent_story.generated_prompt or "") if grandparent_story else ""
            subtask_ac = [
                f"AC1: {subtask.title} implementada",
                "AC2: Testes passam",
                "AC3: Code review aprovado"
            ]
            fallback_desc = (
                f"# Subtask: {subtask.title}\n\n"
                f"## Visão Geral\n\n{subtask.description or subtask.title}\n\n"
                f"## Contexto da Task\n\n**{parent_task.title if parent_task else 'N/A'}**\n\n"
                f"{task_desc[:1500]}\n\n"
                f"## Contexto da Story\n\n**{grandparent_story.title if grandparent_story else 'N/A'}**\n\n"
                f"{story_desc[:1000]}\n\n"
            )
            # PROMPT #180 - Include criteria in generated_prompt
            fallback_prompt = fallback_desc + "## Critérios de Aceitação\n\n" + "".join(f"- {ac}\n" for ac in subtask_ac)
            return {
                "description": fallback_desc.rstrip() + "\n\n*Conteúdo gerado como fallback. Edite para adicionar detalhes técnicos.*",
                "generated_prompt": fallback_prompt,
                "acceptance_criteria": subtask_ac,
                "semantic_map": combined_semantic_map,
                "ai_model_used": ai_model_used  # PROMPT #127
            }

        except Exception as e:
            logger.error(f"Error generating subtask content: {e}")
            # PROMPT #178 - Provide meaningful content from parent context even on exception
            task_ctx = ""
            if subtask.parent_id:
                try:
                    pt = self.db.query(Task).filter(Task.id == subtask.parent_id).first()
                    if pt:
                        task_ctx = f"## Contexto da Task\n\n**{pt.title}**\n\n{(pt.description or pt.generated_prompt or '')[:1500]}"
                except Exception:
                    pass
            fallback = (
                f"# Subtask: {subtask.title}\n\n"
                f"{subtask.description or ''}\n\n"
                f"{task_ctx}\n\n"
                f"*Conteúdo gerado como fallback após erro. Edite para adicionar detalhes.*"
            )
            return {
                "description": fallback,
                "generated_prompt": fallback,
                "acceptance_criteria": [f"{subtask.title} concluída"],
                "semantic_map": {},
                "ai_model_used": None  # PROMPT #127
            }
