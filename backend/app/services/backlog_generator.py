"""
BacklogGeneratorService
AI-powered backlog generation (Epic → Story → Task decomposition)
JIRA Transformation - Phase 2
"""

from typing import Dict, List, Optional
from uuid import UUID
from sqlalchemy.orm import Session
import json
import logging

from app.models.task import Task, ItemType, PriorityLevel, TaskStatus
from app.models.interview import Interview
from app.models.spec import Spec, SpecScope
from app.models.project import Project
from app.services.ai_orchestrator import AIOrchestrator
from app.prompter.facade import PrompterFacade

logger = logging.getLogger(__name__)


def _strip_markdown_json(content: str) -> str:
    """
    Remove markdown code blocks from JSON response.

    AI sometimes returns JSON wrapped in ```json ... ``` blocks.
    This function strips those markers to get pure JSON.

    Args:
        content: Raw AI response that may contain markdown

    Returns:
        Clean JSON string without markdown markers
    """
    import re

    # Remove ```json and ``` markers
    content = re.sub(r'^```json\s*\n?', '', content, flags=re.MULTILINE)
    content = re.sub(r'\n?```\s*$', '', content, flags=re.MULTILINE)

    return content.strip()


def _convert_semantic_to_human(semantic_markdown: str, semantic_map: Dict[str, str]) -> str:
    """
    PROMPT #85/86 - Convert semantic markdown to human-readable text.

    This function transforms semantic references (N1, P1, E1, etc.) into
    their actual meanings, creating natural prose from structured semantic text.

    Args:
        semantic_markdown: Markdown text with semantic identifiers (N1, P1, etc.)
        semantic_map: Dictionary mapping identifiers to their meanings

    Returns:
        Human-readable text with identifiers replaced by their meanings
    """
    import re

    if not semantic_map or not semantic_markdown:
        return semantic_markdown or ""

    human_text = semantic_markdown

    # PROMPT #86 - FIRST: Remove the entire "## Mapa Semântico" section BEFORE replacements
    # This prevents redundant output like "**Recepcionista**: Recepcionista"
    # Pattern matches: ## Mapa Semântico (or Mapa Semantico) followed by definition lines
    # until next ## heading or end of section
    human_text = re.sub(
        r'##\s*Mapa\s*Sem[aâ]ntico\s*\n+(?:[-*]\s*\*\*[^*]+\*\*:[^\n]*\n*)*',
        '',
        human_text,
        flags=re.IGNORECASE | re.MULTILINE
    )

    # Sort identifiers by length (longest first) to avoid partial replacements
    # e.g., replace "AC10" before "AC1"
    sorted_identifiers = sorted(semantic_map.keys(), key=len, reverse=True)

    for identifier in sorted_identifiers:
        meaning = semantic_map[identifier]
        # Replace identifier with meaning (case-sensitive, word boundaries)
        # Match: **N1**, N1, (N1), [N1], N1:, N1,, N1.
        pattern = rf'\b{re.escape(identifier)}\b'
        human_text = re.sub(pattern, meaning, human_text)

    # Clean up markdown formatting artifacts
    # Remove any remaining bullet points that look like semantic definitions
    human_text = re.sub(r'^[-*]\s*\*\*[^*]+\*\*:\s*[^\n]*$\n?', '', human_text, flags=re.MULTILINE)

    # Clean up double asterisks that might be left from **identifier** patterns
    human_text = re.sub(r'\*\*\*\*', '', human_text)

    # Clean up empty bullet points
    human_text = re.sub(r'^[-*]\s*$\n?', '', human_text, flags=re.MULTILINE)

    # Clean up multiple consecutive newlines
    human_text = re.sub(r'\n{3,}', '\n\n', human_text)

    return human_text.strip()


class BacklogGeneratorService:
    """Service for AI-powered backlog generation with user approval"""

    def __init__(self, db: Session):
        self.db = db
        # PROMPT #54.3 - Use PrompterFacade for cache support
        self.prompter = PrompterFacade(db)
        # Keep orchestrator as fallback
        self.orchestrator = AIOrchestrator(db)

    async def generate_epic_from_interview(
        self,
        interview_id: UUID,
        project_id: UUID
    ) -> Dict:
        """
        Generate Epic suggestion from Interview conversation using AI

        Flow:
        1. Fetch interview conversation
        2. AI analyzes conversation and extracts Epic
        3. Returns JSON suggestion (NOT created in DB)
        4. User reviews and approves via API

        Args:
            interview_id: Interview ID to analyze
            project_id: Project ID

        Returns:
            Dict with Epic suggestion:
            {
                "title": str,
                "description": str,
                "story_points": int,
                "priority": str,
                "acceptance_criteria": [str, str, ...],
                "interview_insights": {
                    "key_requirements": [...],
                    "business_goals": [...],
                    "technical_constraints": [...]
                },
                "interview_question_ids": [question_index, ...]
            }

        Raises:
            ValueError: If interview not found or empty
        """
        # 1. Fetch interview
        interview = self.db.query(Interview).filter(Interview.id == interview_id).first()
        if not interview:
            raise ValueError(f"Interview {interview_id} not found")

        conversation = interview.conversation_data
        if not conversation or len(conversation) == 0:
            raise ValueError(f"Interview {interview_id} has no conversation data")

        # 2. Build AI prompt (EM PORTUGUÊS - PROMPT #83 - Semantic References Methodology)
        system_prompt = """Você é um Product Owner especialista analisando conversas de entrevistas para extrair requisitos de nível Epic.

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

**Objetivo desta metodologia:**
- Reduzir ambiguidade semântica
- Manter consistência conceitual
- Permitir edição posterior manual do código
- Garantir rastreabilidade entre texto e implementação

Sua tarefa:
1. Analise toda a conversa e identifique o EPIC principal (objetivo de negócio de alto nível)
2. Crie um **Mapa Semântico** definindo TODOS os identificadores usados
3. Escreva a narrativa do Epic usando APENAS esses identificadores
4. Extraia critérios de aceitação (usando identificadores AC1, AC2, AC3...)
5. Extraia insights chave: requisitos, objetivos de negócio, restrições técnicas
6. Estime story points (1-21, escala Fibonacci) baseado na complexidade do Epic
7. Sugira prioridade (critical, high, medium, low, trivial)

IMPORTANTE:
- Um Epic representa um grande corpo de trabalho (múltiplas Stories)
- Foque em VALOR DE NEGÓCIO e RESULTADOS PARA O USUÁRIO
- Use identificadores semânticos em TODO o texto (narrativa, critérios, insights)
- Seja específico e acionável nos critérios de aceitação
- TUDO DEVE SER EM PORTUGUÊS (título, descrição, critérios, identificadores)

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
        "C1": "Definição clara do critério/regra 1"
    },
    "description_markdown": "# Epic: [Título]\n\n## Mapa Semântico\n\n- **N1**: [definição]\n- **N2**: [definição]\n- **P1**: [definição]\n...\n\n## Descrição\n\n[Narrativa usando APENAS identificadores do mapa semântico. Ex: 'Este Epic implementa P1 para N1, permitindo que N2 gerencie D1 via E1.']\n\n## Critérios de Aceitação\n\n1. **AC1**: [critério usando identificadores]\n2. **AC2**: [critério usando identificadores]\n...\n\n## Insights da Entrevista\n\n**Requisitos-Chave:**\n- [requisito usando identificadores]\n...\n\n**Objetivos de Negócio:**\n- [objetivo usando identificadores]\n...\n\n**Restrições Técnicas:**\n- [restrição usando identificadores]\n...",
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
    },
    "interview_question_ids": [0, 2, 5]
}

**REGRAS CRÍTICAS:**
- interview_question_ids deve conter os índices das mensagens da conversa mais relevantes para este Epic
- description_markdown deve conter TODO o conteúdo formatado em Markdown
- O Mapa Semântico deve estar TANTO no description_markdown quanto no campo semantic_map do JSON
- Use identificadores semânticos em TODOS os textos (title pode ser em linguagem natural, mas description/criteria/insights devem usar identificadores)
- NUNCA substitua identificadores por seus significados - mantenha sempre os identificadores no texto
"""

        # Convert conversation to readable format
        conversation_text = self._format_conversation(conversation)

        user_prompt = f"""Analise esta conversa de entrevista e extraia o Epic principal usando a Metodologia de Referências Semânticas.

CONVERSA:
{conversation_text}

INSTRUÇÕES:
1. Crie um Mapa Semântico definindo TODOS os conceitos como identificadores (N1, N2, P1, E1, D1, S1, C1, AC1...)
2. Escreva a narrativa do Epic usando APENAS esses identificadores
3. Gere o campo "description_markdown" com o Markdown completo formatado (incluindo Mapa Semântico)
4. Gere o campo "semantic_map" com o dicionário de identificadores

Retorne o Epic como JSON seguindo EXATAMENTE o schema fornecido no system prompt.

LEMBRE-SE:
- TODO O CONTEÚDO DEVE SER EM PORTUGUÊS
- Use identificadores semânticos em TODA a narrativa
- NUNCA substitua identificadores por seus significados
- O Mapa Semântico deve aparecer tanto no Markdown quanto no JSON"""

        # 3. Call AI (PROMPT #54.3 - Using PrompterFacade for cache support)
        logger.info(f"🎯 Generating Epic from Interview {interview_id}...")

        try:
            result = await self.prompter.execute_prompt(
                prompt=user_prompt,
                usage_type="prompt_generation",
                system_prompt=system_prompt,
                project_id=str(project_id),
                interview_id=str(interview_id),
                metadata={"operation": "generate_epic_from_interview"}
            )
        except RuntimeError:
            # Fallback to direct orchestrator if PrompterFacade not initialized
            logger.warning("PrompterFacade not available, using direct AIOrchestrator")
            result = await self.orchestrator.execute(
                usage_type="prompt_generation",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                project_id=project_id,
                interview_id=interview_id,
                metadata={"operation": "generate_epic_from_interview"}
            )
            # Normalize result format
            result = {"response": result["content"], "input_tokens": result.get("usage", {}).get("input_tokens", 0), "output_tokens": result.get("usage", {}).get("output_tokens", 0), "model": result.get("db_model_name", "unknown")}

        # 4. Parse AI response
        try:
            # Strip markdown code blocks if present
            clean_json = _strip_markdown_json(result["response"])
            epic_suggestion = json.loads(clean_json)

            # PROMPT #85/86 - Dual output: Semantic prompt + Human description
            # - generated_prompt: Semantic markdown (for child card generation)
            # - description: Human-readable text (for reading)
            if "description_markdown" in epic_suggestion and "semantic_map" in epic_suggestion:
                # Store semantic markdown as the output prompt (Prompt tab)
                epic_suggestion["generated_prompt"] = epic_suggestion["description_markdown"]

                # Convert semantic to human-readable text (Description tab)
                epic_suggestion["description"] = _convert_semantic_to_human(
                    epic_suggestion["description_markdown"],
                    epic_suggestion["semantic_map"]
                )

                logger.info("✅ PROMPT #85/86: Converted semantic → human description")
            elif "description_markdown" in epic_suggestion:
                # Fallback: no semantic_map, use description_markdown as-is
                epic_suggestion["description"] = epic_suggestion["description_markdown"]
                epic_suggestion["generated_prompt"] = epic_suggestion["description_markdown"]

            # Add semantic_map to interview_insights for traceability
            if "semantic_map" in epic_suggestion:
                if "interview_insights" not in epic_suggestion:
                    epic_suggestion["interview_insights"] = {}
                epic_suggestion["interview_insights"]["semantic_map"] = epic_suggestion["semantic_map"]

            # Add metadata
            epic_suggestion["_metadata"] = {
                "source": "interview",
                "interview_id": str(interview_id),
                "ai_model": result.get("model", "unknown"),
                "input_tokens": result.get("input_tokens", 0),
                "output_tokens": result.get("output_tokens", 0),
                "cache_hit": result.get("cache_hit", False),
                "cache_type": result.get("cache_type", None),
                "uses_semantic_references": "semantic_map" in epic_suggestion  # PROMPT #83
            }

            logger.info(f"✅ Epic generated: {epic_suggestion['title']} (cache: {result.get('cache_hit', False)})")
            return epic_suggestion

        except json.JSONDecodeError as e:
            logger.error(f"❌ Failed to parse AI response as JSON: {e}")
            logger.error(f"AI response: {result.get('response', result.get('content', ''))}")
            raise ValueError(f"AI did not return valid JSON: {str(e)}")

    async def decompose_epic_to_stories(
        self,
        epic_id: UUID,
        project_id: UUID
    ) -> List[Dict]:
        """
        Decompose Epic into Story suggestions using AI

        Flow:
        1. Fetch Epic details
        2. AI decomposes Epic into Stories
        3. Returns array of Story suggestions (NOT created in DB)
        4. User reviews and approves via API

        Args:
            epic_id: Epic ID to decompose
            project_id: Project ID

        Returns:
            List of Story suggestions:
            [
                {
                    "title": str,
                    "description": str,
                    "story_points": int,
                    "priority": str,
                    "acceptance_criteria": [str, ...],
                    "interview_insights": {...},
                    "parent_id": epic_id
                },
                ...
            ]

        Raises:
            ValueError: If Epic not found or not an Epic type
        """
        # 1. Fetch Epic
        epic = self.db.query(Task).filter(
            Task.id == epic_id,
            Task.item_type == ItemType.EPIC
        ).first()

        if not epic:
            raise ValueError(f"Epic {epic_id} not found or is not an Epic")

        # 2. Build AI prompt (EM PORTUGUÊS - PROMPT #83 - Semantic References Methodology)
        system_prompt = """Você é um Product Owner especialista decompondo Epics em Stories.

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

**ATENÇÃO:** O Epic pai já possui um Mapa Semântico. Você deve:
- **REUSAR** os identificadores existentes do Epic quando aplicável
- **ESTENDER** o mapa com novos identificadores apenas se necessário (N10, P5, E3, etc.)
- **MANTER CONSISTÊNCIA** com o mapa semântico do Epic

Sua tarefa:
1. Divida o Epic em 3-7 STORIES (funcionalidades voltadas ao usuário)
2. Cada Story deve ter seu próprio Mapa Semântico (reutilizando identificadores do Epic + novos se necessário)
3. Cada Story deve ser entregável de forma independente
4. Cada Story deve entregar valor ao usuário
5. Stories devem ser estimadas em story points (1-8, Fibonacci)
6. Herde a prioridade do Epic (ajuste se necessário)

IMPORTANTE:
- Uma Story representa uma funcionalidade para o usuário (pode ser completada em 1-2 semanas)
- Siga o formato de User Story no título: "Como [usuário], eu quero [funcionalidade]"
- Use identificadores semânticos na description_markdown
- Cada Story deve ter critérios de aceitação claros (AC1, AC2, AC3...)
- Stories devem ser independentes (mínimas dependências)
- TODO O CONTEÚDO DEVE SER EM PORTUGUÊS

Retorne APENAS array JSON válido (sem markdown code blocks, sem explicação):
[
    {
        "title": "Como [N1], eu quero [funcionalidade em linguagem natural]",
        "semantic_map": {
            "N1": "Reutilizado do Epic - [definição]",
            "N10": "Novo conceito específico desta Story - [definição]",
            "P5": "Novo processo específico desta Story - [definição]",
            "AC1": "Critério de aceitação 1",
            "AC2": "Critério de aceitação 2"
        },
        "description_markdown": "# Story: [Título]\n\n## Mapa Semântico\n\n- **N1**: [definição - REUTILIZADO DO EPIC]\n- **N10**: [definição - NOVO]\n- **P5**: [definição - NOVO]\n...\n\n## Descrição\n\n[Narrativa usando APENAS identificadores. Ex: 'Esta Story implementa P5 para N1, permitindo gerenciar N10 através de E3.']\n\n## Critérios de Aceitação\n\n1. **AC1**: [critério usando identificadores]\n2. **AC2**: [critério usando identificadores]\n...\n\n## Requisitos do Epic\n\n- [requisito usando identificadores do Epic]",
        "story_points": 5,
        "priority": "high",
        "acceptance_criteria": [
            "AC1: [Critério usando identificadores]",
            "AC2: [Critério usando identificadores]"
        ],
        "interview_insights": {
            "derived_from_epic": true,
            "epic_requirements": ["[requisito usando identificadores do Epic]"]
        }
    }
]

**REGRAS CRÍTICAS:**
- REUTILIZE identificadores do Epic sempre que possível
- CRIE novos identificadores apenas para conceitos específicos da Story
- Mantenha numeração consistente (se Epic usou N1-N5, Stories usam N6+)
- Use identificadores semânticos em TODOS os textos
- NUNCA substitua identificadores por seus significados
"""

        # PROMPT #83 - Extract semantic_map from Epic if available
        epic_semantic_map = None
        if epic.interview_insights and isinstance(epic.interview_insights, dict):
            epic_semantic_map = epic.interview_insights.get("semantic_map", {})

        semantic_map_text = ""
        if epic_semantic_map:
            semantic_map_text = "\n\nMAPA SEMÂNTICO DO EPIC (REUTILIZE ESTES IDENTIFICADORES):\n"
            semantic_map_text += json.dumps(epic_semantic_map, indent=2, ensure_ascii=False)
            semantic_map_text += "\n\nVocê DEVE reutilizar estes identificadores nas Stories sempre que aplicável."

        user_prompt = f"""Decomponha este Epic em Stories usando a Metodologia de Referências Semânticas.

DETALHES DO EPIC:
Título: {epic.title}
Descrição: {epic.description}
Story Points: {epic.story_points}
Prioridade: {epic.priority.value if epic.priority else 'medium'}

Critérios de Aceitação:
{json.dumps(epic.acceptance_criteria, indent=2, ensure_ascii=False) if epic.acceptance_criteria else 'Nenhum'}
{semantic_map_text}

Insights da Entrevista:
{json.dumps(epic.interview_insights, indent=2, ensure_ascii=False) if epic.interview_insights else 'Nenhum'}

INSTRUÇÕES:
1. REUTILIZE os identificadores do Mapa Semântico do Epic (N1, N2, P1, etc.)
2. CRIE novos identificadores apenas para conceitos específicos de cada Story (N10+, P5+, etc.)
3. Cada Story deve ter seu próprio campo "semantic_map" (reutilizando + estendendo)
4. Gere o campo "description_markdown" com Markdown completo formatado
5. Use identificadores semânticos em TODA a narrativa

Retorne 3-7 Stories como array JSON seguindo EXATAMENTE o schema fornecido no system prompt.

LEMBRE-SE:
- TODO O CONTEÚDO DEVE SER EM PORTUGUÊS
- REUTILIZE identificadores do Epic (mantenha consistência)
- NUNCA substitua identificadores por seus significados"""

        # PROMPT #85 - RAG Phase 3: Retrieve similar completed stories for learning
        rag_context = ""
        rag_story_count = 0
        try:
            from app.services.rag_service import RAGService

            rag_service = RAGService(self.db)

            # Build query from epic title + description
            query = f"{epic.title} {epic.description or ''}"

            # Retrieve similar completed stories (project-specific)
            similar_stories = rag_service.retrieve(
                query=query,
                filter={"type": "completed_story", "project_id": str(project_id)},
                top_k=5,
                similarity_threshold=0.6
            )

            if similar_stories:
                rag_story_count = len(similar_stories)
                rag_context = "\n\n**APRENDIZADOS DE STORIES SIMILARES BEM-SUCEDIDAS:**\n"
                rag_context += "Use estes exemplos como referência para criar stories melhores:\n\n"

                for i, story in enumerate(similar_stories, 1):
                    rag_context += f"{i}. {story['content']}\n"
                    rag_context += f"   (Similaridade: {story['similarity']:.2f})\n\n"

                rag_context += "**IMPORTANTE:** Use estes exemplos para:\n"
                rag_context += "- Manter consistência nos títulos (formato User Story)\n"
                rag_context += "- Estimar story points de forma mais precisa\n"
                rag_context += "- Criar critérios de aceitação mais claros\n"
                rag_context += "- Seguir o mesmo nível de granularidade e escopo\n"

                # Inject RAG context into user prompt
                user_prompt += f"\n\n{rag_context}"

                logger.info(f"✅ RAG: Retrieved {rag_story_count} similar completed stories for epic decomposition")

        except Exception as e:
            logger.warning(f"⚠️  RAG retrieval failed for epic decomposition: {e}")

        # 3. Call AI (PROMPT #54.3 - Using PrompterFacade for cache support)
        logger.info(f"🎯 Decomposing Epic {epic_id} into Stories... (RAG: {rag_story_count} similar stories)")

        try:
            result = await self.prompter.execute_prompt(
                prompt=user_prompt,
                usage_type="prompt_generation",
                system_prompt=system_prompt,
                project_id=str(project_id),
                metadata={
                    "operation": "decompose_epic_to_stories",
                    "epic_id": str(epic_id)
                }
            )
        except RuntimeError:
            # Fallback to direct orchestrator if PrompterFacade not initialized
            logger.warning("PrompterFacade not available, using direct AIOrchestrator")
            result = await self.orchestrator.execute(
                usage_type="prompt_generation",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                project_id=project_id,
                metadata={
                    "operation": "decompose_epic_to_stories",
                    "epic_id": str(epic_id)
                }
            )
            # Normalize result format
            result = {"response": result["content"], "input_tokens": result.get("usage", {}).get("input_tokens", 0), "output_tokens": result.get("usage", {}).get("output_tokens", 0), "model": result.get("db_model_name", "unknown")}

        # 4. Parse AI response
        try:
            # Strip markdown code blocks if present
            clean_json = _strip_markdown_json(result["response"])
            stories_suggestions = json.loads(clean_json)

            if not isinstance(stories_suggestions, list):
                raise ValueError("AI response is not a list")

            # Add metadata and parent_id to each Story
            for story in stories_suggestions:
                # PROMPT #85 - Dual output: Semantic prompt + Human description
                if "description_markdown" in story and "semantic_map" in story:
                    # Store semantic markdown as the output prompt (Prompt tab)
                    story["generated_prompt"] = story["description_markdown"]

                    # Convert semantic to human-readable text (Description tab)
                    story["description"] = _convert_semantic_to_human(
                        story["description_markdown"],
                        story["semantic_map"]
                    )
                elif "description_markdown" in story:
                    # Fallback: no semantic_map, use description_markdown as-is
                    story["description"] = story["description_markdown"]
                    story["generated_prompt"] = story["description_markdown"]

                # Add semantic_map to interview_insights for traceability
                if "semantic_map" in story:
                    if "interview_insights" not in story:
                        story["interview_insights"] = {}
                    story["interview_insights"]["semantic_map"] = story["semantic_map"]

                story["parent_id"] = str(epic_id)
                story["_metadata"] = {
                    "source": "epic_decomposition",
                    "epic_id": str(epic_id),
                    "ai_model": result.get("model", "unknown"),
                    "input_tokens": result.get("input_tokens", 0),
                    "output_tokens": result.get("output_tokens", 0),
                    "cache_hit": result.get("cache_hit", False),
                    "cache_type": result.get("cache_type", None),
                    "rag_enhanced": rag_story_count > 0,  # PROMPT #85 - Phase 3
                    "rag_similar_stories": rag_story_count,  # PROMPT #85 - Phase 3
                    "uses_semantic_references": "semantic_map" in story  # PROMPT #83
                }

            logger.info(f"✅ Generated {len(stories_suggestions)} Stories from Epic (cache: {result.get('cache_hit', False)})")
            return stories_suggestions

        except json.JSONDecodeError as e:
            logger.error(f"❌ Failed to parse AI response as JSON: {e}")
            logger.error(f"AI response: {result.get('response', result.get('content', ''))}")
            raise ValueError(f"AI did not return valid JSON: {str(e)}")

    async def decompose_story_to_tasks(
        self,
        story_id: UUID,
        project_id: UUID
    ) -> List[Dict]:
        """
        Decompose Story into Task suggestions using AI (FUNCTIONAL ONLY)

        PROMPT #54.2 - FIX: Specs removed from decomposition
        - This stage is FUNCTIONAL (WHAT needs to be done)
        - Specs are only used during EXECUTION (HOW to implement)

        Flow:
        1. Fetch Story details
        2. AI decomposes Story into Tasks (functional description)
        3. Returns array of Task suggestions (NOT created in DB)
        4. User reviews and approves via API

        Args:
            story_id: Story ID to decompose
            project_id: Project ID

        Returns:
            List of Task suggestions:
            [
                {
                    "title": str,
                    "description": str,
                    "story_points": int,
                    "priority": str,
                    "acceptance_criteria": [str, ...],
                    "parent_id": story_id
                },
                ...
            ]

        Raises:
            ValueError: If Story not found or not a Story type
        """
        # 1. Fetch Story
        story = self.db.query(Task).filter(
            Task.id == story_id,
            Task.item_type == ItemType.STORY
        ).first()

        if not story:
            raise ValueError(f"Story {story_id} not found or is not a Story")

        # 2. Build AI prompt (EM PORTUGUÊS - PROMPT #83 - Semantic References Methodology)
        # PROMPT #54.2 - FIX: Specs removed from decomposition (only for execution)
        system_prompt = """Você é um Product Owner especialista decompondo Stories em Tasks.

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
- **F** (Files/Arquivos): F1, F2, F3... = Arquivos, módulos, componentes de código
- **M** (Methods/Métodos): M1, M2, M3... = Funções, métodos, operações

**ATENÇÃO:** A Story pai já possui um Mapa Semântico (que herda do Epic). Você deve:
- **REUSAR** os identificadores existentes da Story/Epic quando aplicável
- **ESTENDER** o mapa com novos identificadores técnicos (F1, M1, E10, D5, etc.)
- **MANTER CONSISTÊNCIA** com o mapa semântico da Story

Sua tarefa:
1. Divida a Story em 3-10 TASKS (passos de implementação técnica)
2. Cada Task deve ter seu próprio Mapa Semântico (reutilizando identificadores + novos técnicos)
3. Cada Task deve ser específica e acionável (completável em 1-3 dias)
4. Estime story points para cada Task (1-3, Fibonacci)
5. Mantenha a prioridade da Story

IMPORTANTE:
- Uma Task é um passo concreto de implementação (o que precisa ser construído)
- Seja ESPECÍFICO: use identificadores como "Implementar E10 (CRUD de N1)" não genérico "Criar backend"
- Foque em O QUE precisa ser feito (funcional), não COMO (detalhes de framework vêm na execução)
- Tasks devem ter critérios de aceitação claros (resultados testáveis)
- Use identificadores semânticos em TODO o texto (títulos podem ser mais descritivos, mas descriptions devem usar identificadores)
- TODO O CONTEÚDO DEVE SER EM PORTUGUÊS

Retorne APENAS array JSON válido (sem markdown code blocks, sem explicação):
[
    {
        "title": "Implementar E10 para gerenciamento de N1",
        "semantic_map": {
            "N1": "Reutilizado da Story - [definição]",
            "E10": "Novo endpoint - [definição específica]",
            "F1": "Arquivo específico - [definição]",
            "M1": "Método específico - [definição]",
            "D5": "Campo/estrutura específica - [definição]",
            "AC1": "Critério de aceitação 1",
            "AC2": "Critério de aceitação 2"
        },
        "description_markdown": "# Task: [Título]\n\n## Mapa Semântico\n\n- **N1**: [definição - REUTILIZADO]\n- **E10**: [definição - NOVO]\n- **F1**: [definição - NOVO]\n...\n\n## Descrição\n\n[Narrativa técnica usando identificadores. Ex: 'Esta Task implementa E10 em F1, criando M1 para processar D5 de N1.']\n\n## Critérios de Aceitação\n\n1. **AC1**: [critério testável usando identificadores]\n2. **AC2**: [critério testável usando identificadores]\n...",
        "story_points": 2,
        "priority": "high",
        "acceptance_criteria": [
            "AC1: [Critério testável usando identificadores]",
            "AC2: [Critério testável usando identificadores]"
        ]
    }
]

**REGRAS CRÍTICAS:**
- REUTILIZE identificadores da Story/Epic sempre que possível
- CRIE novos identificadores técnicos para componentes específicos (F1, M1, E10, etc.)
- Mantenha numeração consistente (se Story usou E1-E5, Tasks usam E6+)
- Use identificadores semânticos em TODOS os textos
- NUNCA substitua identificadores por seus significados
- Evite mencionar frameworks específicos (Laravel, React, etc.) - use identificadores genéricos
"""

        # PROMPT #83 - Extract semantic_map from Story if available
        story_semantic_map = None
        if story.interview_insights and isinstance(story.interview_insights, dict):
            story_semantic_map = story.interview_insights.get("semantic_map", {})

        semantic_map_text = ""
        if story_semantic_map:
            semantic_map_text = "\n\nMAPA SEMÂNTICO DA STORY (REUTILIZE ESTES IDENTIFICADORES):\n"
            semantic_map_text += json.dumps(story_semantic_map, indent=2, ensure_ascii=False)
            semantic_map_text += "\n\nVocê DEVE reutilizar estes identificadores nas Tasks sempre que aplicável."

        user_prompt = f"""Decomponha esta Story em Tasks usando a Metodologia de Referências Semânticas.

DETALHES DA STORY:
Título: {story.title}
Descrição: {story.description}
Story Points: {story.story_points}
Prioridade: {story.priority.value if story.priority else 'medium'}

Critérios de Aceitação:
{json.dumps(story.acceptance_criteria, indent=2, ensure_ascii=False) if story.acceptance_criteria else 'Nenhum'}
{semantic_map_text}

INSTRUÇÕES:
1. REUTILIZE os identificadores do Mapa Semântico da Story (N1, P1, E1, etc.)
2. CRIE novos identificadores técnicos para componentes específicos (F1, M1, E10, D5, etc.)
3. Cada Task deve ter seu próprio campo "semantic_map" (reutilizando + estendendo)
4. Gere o campo "description_markdown" com Markdown completo formatado
5. Use identificadores semânticos em TODA a narrativa

Retorne 3-10 Tasks como array JSON seguindo EXATAMENTE o schema fornecido no system prompt.

LEMBRE-SE:
- TODO O CONTEÚDO DEVE SER EM PORTUGUÊS
- REUTILIZE identificadores da Story (mantenha consistência)
- NUNCA substitua identificadores por seus significados
- Evite mencionar frameworks específicos (use identificadores genéricos)"""

        # PROMPT #85 - RAG Phase 3: Retrieve similar completed tasks for learning
        rag_context = ""
        rag_task_count = 0
        try:
            from app.services.rag_service import RAGService

            rag_service = RAGService(self.db)

            # Build query from story title + description
            query = f"{story.title} {story.description or ''}"

            # Retrieve similar completed tasks (project-specific)
            similar_tasks = rag_service.retrieve(
                query=query,
                filter={"type": "completed_task", "project_id": str(project_id)},
                top_k=5,
                similarity_threshold=0.6
            )

            if similar_tasks:
                rag_task_count = len(similar_tasks)
                rag_context = "\n\n**APRENDIZADOS DE TASKS SIMILARES BEM-SUCEDIDAS:**\n"
                rag_context += "Use estes exemplos como referência para criar tasks melhores:\n\n"

                for i, task in enumerate(similar_tasks, 1):
                    rag_context += f"{i}. {task['content']}\n"
                    rag_context += f"   (Similaridade: {task['similarity']:.2f})\n\n"

                rag_context += "**IMPORTANTE:** Use estes exemplos para:\n"
                rag_context += "- Manter consistência nos títulos e descrições\n"
                rag_context += "- Estimar story points de forma mais precisa\n"
                rag_context += "- Criar critérios de aceitação mais claros\n"
                rag_context += "- Seguir o mesmo nível de granularidade\n"

                # Inject RAG context into user prompt
                user_prompt += f"\n\n{rag_context}"

                logger.info(f"✅ RAG: Retrieved {rag_task_count} similar completed tasks for story decomposition")

        except Exception as e:
            logger.warning(f"⚠️  RAG retrieval failed for story decomposition: {e}")

        # 4. Call AI (PROMPT #54.3 - Using PrompterFacade for cache support)
        logger.info(f"🎯 Decomposing Story {story_id} into Tasks... (RAG: {rag_task_count} similar tasks)")

        try:
            result = await self.prompter.execute_prompt(
                prompt=user_prompt,
                usage_type="prompt_generation",
                system_prompt=system_prompt,
                project_id=str(project_id),
                metadata={
                    "operation": "decompose_story_to_tasks",
                    "story_id": str(story_id)
                }
            )
        except RuntimeError:
            # Fallback to direct orchestrator if PrompterFacade not initialized
            logger.warning("PrompterFacade not available, using direct AIOrchestrator")
            result = await self.orchestrator.execute(
                usage_type="prompt_generation",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                project_id=project_id,
                metadata={
                    "operation": "decompose_story_to_tasks",
                    "story_id": str(story_id)
                }
            )
            # Normalize result format
            result = {"response": result["content"], "input_tokens": result.get("usage", {}).get("input_tokens", 0), "output_tokens": result.get("usage", {}).get("output_tokens", 0), "model": result.get("db_model_name", "unknown")}

        # 5. Parse AI response
        try:
            # Strip markdown code blocks if present
            clean_json = _strip_markdown_json(result["response"])
            tasks_suggestions = json.loads(clean_json)

            if not isinstance(tasks_suggestions, list):
                raise ValueError("AI response is not a list")

            # Add metadata and parent_id to each Task
            for task in tasks_suggestions:
                # PROMPT #85 - Dual output: Semantic prompt + Human description
                if "description_markdown" in task and "semantic_map" in task:
                    # Store semantic markdown as the output prompt (Prompt tab)
                    task["generated_prompt"] = task["description_markdown"]

                    # Convert semantic to human-readable text (Description tab)
                    task["description"] = _convert_semantic_to_human(
                        task["description_markdown"],
                        task["semantic_map"]
                    )
                elif "description_markdown" in task:
                    # Fallback: no semantic_map, use description_markdown as-is
                    task["description"] = task["description_markdown"]
                    task["generated_prompt"] = task["description_markdown"]

                # Add semantic_map to interview_insights for traceability (Tasks don't have interview_insights by default)
                if "semantic_map" in task:
                    if "interview_insights" not in task:
                        task["interview_insights"] = {}
                    task["interview_insights"]["semantic_map"] = task["semantic_map"]

                task["parent_id"] = str(story_id)
                task["_metadata"] = {
                    "source": "story_decomposition",
                    "story_id": str(story_id),
                    "ai_model": result.get("model", "unknown"),
                    "input_tokens": result.get("input_tokens", 0),
                    "output_tokens": result.get("output_tokens", 0),
                    "cache_hit": result.get("cache_hit", False),
                    "cache_type": result.get("cache_type", None),
                    "rag_enhanced": rag_task_count > 0,  # PROMPT #85 - Phase 3
                    "rag_similar_tasks": rag_task_count,  # PROMPT #85 - Phase 3
                    "uses_semantic_references": "semantic_map" in task  # PROMPT #83
                }

            logger.info(f"✅ Generated {len(tasks_suggestions)} Tasks from Story (cache: {result.get('cache_hit', False)})")
            return tasks_suggestions

        except json.JSONDecodeError as e:
            logger.error(f"❌ Failed to parse AI response as JSON: {e}")
            logger.error(f"AI response: {result.get('response', result.get('content', ''))}")
            raise ValueError(f"AI did not return valid JSON: {str(e)}")

    def _format_conversation(self, conversation: List[Dict]) -> str:
        """
        Format interview conversation for AI consumption

        Args:
            conversation: List of message dicts with role/content

        Returns:
            Formatted conversation string
        """
        formatted = []
        for i, msg in enumerate(conversation):
            role = msg.get("role", "unknown").upper()
            content = msg.get("content", "")
            formatted.append(f"[{i}] {role}: {content}")

        return "\n\n".join(formatted)

    def _build_specs_context(
        self,
        specs: List[Spec],
        story: Task,
        max_specs: int = 10
    ) -> str:
        """
        Build Specs context for AI (relevant specs only)

        Strategy:
        1. Filter specs by relevance (keywords in story title/description)
        2. Limit to max_specs to avoid token bloat
        3. Format for AI consumption

        Args:
            specs: List of available Specs
            story: Story being decomposed
            max_specs: Maximum number of specs to include

        Returns:
            Formatted specs context string
        """
        if not specs:
            return "FRAMEWORK SPECIFICATIONS:\nNone available."

        # Simple relevance scoring (keyword matching)
        story_text = f"{story.title} {story.description}".lower()

        scored_specs = []
        for spec in specs:
            score = 0
            spec_keywords = [
                spec.category.lower(),
                spec.name.lower(),
                spec.spec_type.lower()
            ]

            for keyword in spec_keywords:
                if keyword in story_text:
                    score += 1

            scored_specs.append((score, spec))

        # Sort by score (descending) and take top N
        scored_specs.sort(key=lambda x: x[0], reverse=True)
        top_specs = [spec for _, spec in scored_specs[:max_specs]]

        # Format specs
        formatted = ["FRAMEWORK SPECIFICATIONS (follow these patterns):"]
        for spec in top_specs:
            # PROMPT #54 - Token Optimization: Only add "..." if actually truncated
            content = spec.content[:500]
            truncated_suffix = "..." if len(spec.content) > 500 else ""

            formatted.append(f"""
---
Category: {spec.category}
Framework: {spec.name}
Type: {spec.spec_type}
Title: {spec.title}

Specification:
{content}{truncated_suffix}
---
""")

        return "\n".join(formatted)

    async def generate_task_from_interview_direct(
        self,
        interview: Interview,
        project: Project
    ) -> Task:
        """
        Generate SINGLE TASK directly from task-focused interview.

        PROMPT #68 - Dual-Mode Interview System (FASE 4)

        For task-focused interviews (existing projects), generates ONE task directly
        without Epic→Story→Task hierarchy.

        The task includes:
        - Title, description, acceptance criteria
        - Story points, priority, labels
        - suggested_subtasks (AI suggestions, not created yet)
        - interview_insights (context from interview)

        Args:
            interview: Task-focused interview instance
            project: Project instance

        Returns:
            Task instance (created in DB)

        Raises:
            ValueError: If interview is not task-focused or has no data
        """
        logger.info(f"🎯 Generating direct task from task-focused interview {interview.id}")

        # Validate interview mode
        if interview.interview_mode != "task_focused":
            raise ValueError(f"Interview {interview.id} is not task-focused (mode: {interview.interview_mode})")

        conversation = interview.conversation_data
        if not conversation or len(conversation) == 0:
            raise ValueError(f"Interview {interview.id} has no conversation data")

        # Extract task type from interview
        task_type = interview.task_type_selection or "feature"
        logger.info(f"Task type: {task_type}")

        # Build AI prompt for task generation
        system_prompt = self._build_task_generation_prompt(project, task_type)

        # Build conversation summary
        conversation_text = self._format_conversation_for_task(conversation)

        # Call AI to generate task
        messages = [
            {
                "role": "user",
                "content": f"""Analyze this task-focused interview and generate a SINGLE task.

**PROJECT CONTEXT:**
- Name: {project.name}
- Description: {project.description}
- Stack: {project.stack_backend}, {project.stack_database}, {project.stack_frontend}

**TASK TYPE:** {task_type.upper()}

**INTERVIEW CONVERSATION:**
{conversation_text}

**INSTRUCTIONS:**
Generate a SINGLE task with:
1. Clear title and description
2. Acceptance criteria (list of conditions)
3. Story points (Fibonacci: 1, 2, 3, 5, 8, 13)
4. Priority (critical/high/medium/low)
5. Labels (array of tags: backend, frontend, database, bugfix, feature, etc.)
6. Suggested subtasks (array of optional sub-tasks if task is complex)

Return ONLY valid JSON in this format:
{{
  "title": "Clear, actionable title",
  "description": "Detailed description with context",
  "acceptance_criteria": ["Criterion 1", "Criterion 2", "Criterion 3"],
  "story_points": 5,
  "priority": "high",
  "labels": ["backend", "{task_type}"],
  "suggested_subtasks": [
    {{"title": "Subtask 1", "description": "Details", "story_points": 2}},
    {{"title": "Subtask 2", "description": "Details", "story_points": 3}}
  ],
  "interview_insights": {{
    "key_requirements": ["Req 1", "Req 2"],
    "technical_notes": ["Note 1", "Note 2"],
    "business_context": "Why this task matters"
  }}
}}
"""
            }
        ]

        response = await self.orchestrator.execute(
            usage_type="prompt_generation",
            messages=messages,
            system_prompt=system_prompt,
            max_tokens=2000,
            project_id=project.id,
            interview_id=interview.id
        )

        # Parse AI response
        content = _strip_markdown_json(response["content"])
        try:
            task_data = json.loads(content)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse task JSON: {content[:200]}")
            raise ValueError(f"AI returned invalid JSON: {str(e)}")

        # PROMPT #94 FASE 4 - Check for modification attempts (>90% similarity)
        from app.services.similarity_detector import detect_modification_attempt
        from app.services.modification_manager import block_task

        # Get all existing tasks in the project
        existing_tasks = self.db.query(Task).filter(
            Task.project_id == project.id,
            Task.status != TaskStatus.DONE  # Don't compare with archived tasks
        ).all()

        # Detect if this is a modification attempt
        is_modification, similar_task, similarity_score = detect_modification_attempt(
            new_task_title=task_data["title"],
            new_task_description=task_data["description"],
            existing_tasks=existing_tasks,
            threshold=0.90
        )

        if is_modification:
            # Block the existing task instead of creating a new one
            logger.warning(
                f"🚨 MODIFICATION DETECTED (similarity: {similarity_score:.2%})\n"
                f"   Blocking existing task: {similar_task.title}\n"
                f"   Proposed modification: {task_data['title']}\n"
                f"   User must approve/reject via UI"
            )

            blocked_task = block_task(
                task=similar_task,
                proposed_modification={
                    "title": task_data["title"],
                    "description": task_data["description"],
                    "acceptance_criteria": task_data.get("acceptance_criteria", []),
                    "story_points": task_data.get("story_points"),
                    "priority": task_data.get("priority", "medium"),
                    "labels": task_data.get("labels", []),
                    "suggested_subtasks": task_data.get("suggested_subtasks", []),
                    "interview_insights": task_data.get("interview_insights", {}),
                    "similarity_score": similarity_score,
                    "interview_id": str(interview.id)
                },
                db=self.db,
                reason=f"AI suggested modification detected (similarity: {similarity_score:.2%})"
            )

            # Return the blocked task (not a new task)
            return blocked_task

        # No modification detected - create new task normally
        task = Task(
            project_id=project.id,
            created_from_interview_id=interview.id,
            item_type=ItemType.TASK,
            title=task_data["title"],
            description=task_data["description"],
            acceptance_criteria=task_data.get("acceptance_criteria", []),
            story_points=task_data.get("story_points"),
            priority=self._parse_priority(task_data.get("priority", "medium")),
            labels=task_data.get("labels", [task_type]),
            subtask_suggestions=task_data.get("suggested_subtasks", []),  # PROMPT #68
            interview_insights=task_data.get("interview_insights", {}),
            status="backlog",
            workflow_state="open",
            reporter="system"
        )

        self.db.add(task)
        self.db.commit()
        self.db.refresh(task)

        logger.info(f"✅ Task created: {task.id} - {task.title} (suggested subtasks: {len(task.subtask_suggestions or [])})")

        return task

    def _build_task_generation_prompt(self, project: Project, task_type: str) -> str:
        """Build system prompt for task generation based on task type."""
        base_prompt = f"""You are an AI product manager generating actionable tasks for a software project.

PROJECT: {project.name}
TASK TYPE: {task_type.upper()}

Your task:
1. Analyze the interview conversation
2. Extract ONE clear, actionable task
3. Include acceptance criteria (measurable conditions)
4. Suggest story points (Fibonacci scale)
5. Assign appropriate priority and labels
6. Optionally suggest subtasks if task is complex (>5 points)

Output ONLY valid JSON. Be concise but complete.
"""

        if task_type == "bug":
            return base_prompt + """
For BUG tasks, focus on:
- Clear reproduction steps
- Expected vs actual behavior
- Root cause if mentioned
- Fix approach
"""
        elif task_type == "feature":
            return base_prompt + """
For FEATURE tasks, focus on:
- User story (who, what, why)
- Functional requirements
- Acceptance criteria (how to test)
- Integration points
"""
        elif task_type == "refactor":
            return base_prompt + """
For REFACTOR tasks, focus on:
- Current code problems
- Desired outcome
- Behavior preservation (no functionality changes)
- Testing strategy
"""
        elif task_type == "enhancement":
            return base_prompt + """
For ENHANCEMENT tasks, focus on:
- Existing functionality
- Proposed improvements
- Benefits and value
- Backward compatibility
"""
        else:
            return base_prompt

    def _format_conversation_for_task(self, conversation: list) -> str:
        """Format conversation for AI analysis."""
        formatted = []
        for i, msg in enumerate(conversation, 1):
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            formatted.append(f"[{i}] {role.upper()}: {content}")
        return "\n\n".join(formatted)

    def _parse_priority(self, priority_str: str) -> PriorityLevel:
        """Parse priority string to enum."""
        priority_map = {
            "critical": PriorityLevel.CRITICAL,
            "high": PriorityLevel.HIGH,
            "medium": PriorityLevel.MEDIUM,
            "low": PriorityLevel.LOW,
            "trivial": PriorityLevel.TRIVIAL
        }
        return priority_map.get(priority_str.lower(), PriorityLevel.MEDIUM)
