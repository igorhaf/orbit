"""
Backlog Generator - Story Generation Mixin
Handles decomposition of Epics into Stories.
Extracted from backlog_generator.py for modularity.
"""

import json
import logging
from typing import Dict, List
from uuid import UUID

from app.models.task import Task, ItemType
from app.services.backlog_utils import (
    get_business_rules_context,
    strip_markdown_json,
    convert_semantic_to_human,
)

logger = logging.getLogger(__name__)


class StoryGenerationMixin:
    """Mixin that provides decompose_epic_to_stories capability."""

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
            raise ValueError(f"Epic {epic_id} não encontrado ou não é um Epic")

        # 2. Build AI prompt (PROMPT #258 - Load from ContractLoader, fallback to hardcoded)
        try:
            system_prompt, _ = self._contract_loader.render("generation/stories_decomposition")
        except Exception:
            logger.warning("Failed to load stories_decomposition contract, using hardcoded fallback")
            system_prompt = ""

        if not system_prompt:
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
        "description_markdown": "# Story: [Título]\\n\\n## Mapa Semântico\\n\\n- **N1**: [definição - REUTILIZADO DO EPIC]\\n- **N10**: [definição - NOVO]\\n- **P5**: [definição - NOVO]\\n...\\n\\n## Descrição\\n\\n[Narrativa usando APENAS identificadores. Ex: 'Esta Story implementa P5 para N1, permitindo gerenciar N10 através de E3.']\\n\\n## Critérios de Aceitação\\n\\n1. **AC1**: [critério usando identificadores]\\n2. **AC2**: [critério usando identificadores]\\n...\\n\\n## Requisitos do Epic\\n\\n- [requisito usando identificadores do Epic]",
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

        # PROMPT #258 - Extract semantic_map from Epic if available
        epic_semantic_map = None
        if epic.interview_insights and isinstance(epic.interview_insights, dict):
            epic_semantic_map = epic.interview_insights.get("semantic_map", {})

        semantic_map_text = ""
        if epic_semantic_map:
            semantic_map_text = "\n\nMAPA SEMÂNTICO DO EPIC (REUTILIZE ESTES IDENTIFICADORES):\n"
            semantic_map_text += json.dumps(epic_semantic_map, indent=2, ensure_ascii=False)
            semantic_map_text += "\n\nVocê DEVE reutilizar estes identificadores nas Stories sempre que aplicável."

        # PROMPT #170 - Inject business rules as high-priority context
        business_rules_text = get_business_rules_context(self.db, project_id)
        business_rules_section = ""
        if business_rules_text:
            business_rules_section = f"""
{business_rules_text}

ATENÇÃO: TODAS as Stories geradas DEVEM respeitar as regras de negócio listadas acima.
Incorpore as regras relevantes nos critérios de aceitação de cada Story.

"""

        user_prompt = f"""Decomponha este Epic em Stories usando a Metodologia de Referências Semânticas.
{business_rules_section}
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
{f"6. IMPORTANTE: Cada Story DEVE incorporar regras de negócio relevantes nos critérios de aceitação" if business_rules_text else ""}

Retorne 3-7 Stories como array JSON seguindo EXATAMENTE o schema fornecido no system prompt.

LEMBRE-SE:
- TODO O CONTEÚDO DEVE SER EM PORTUGUÊS
- REUTILIZE identificadores do Epic (mantenha consistência)
- NUNCA substitua identificadores por seus significados
{f"- REGRAS DE NEGÓCIO são OBRIGATÓRIAS - verifique se cada Story as respeita" if business_rules_text else ""}"""

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

        if self.prompter:
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
            except (RuntimeError, AttributeError):
                logger.warning("PrompterFacade failed, using direct AIOrchestrator")
                self.prompter = None
                result = None
        else:
            result = None

        if result is None:
            result = await self.orchestrator.execute(
                usage_type="prompt_generation",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                project_id=project_id,
                metadata={
                    "operation": "decompose_epic_to_stories",
                    "epic_id": str(epic_id)
                },
                enable_rag=True
            )
            # Normalize result format
            result = {"response": result["content"], "input_tokens": result.get("usage", {}).get("input_tokens", 0), "output_tokens": result.get("usage", {}).get("output_tokens", 0), "model": result.get("db_model_name", "unknown")}

        # 4. Parse AI response
        try:
            # Strip markdown code blocks if present
            clean_json = strip_markdown_json(result["response"])
            stories_suggestions = json.loads(clean_json)

            if not isinstance(stories_suggestions, list):
                raise ValueError("Resposta da IA não é uma lista")

            # Add metadata and parent_id to each Story
            for story in stories_suggestions:
                # PROMPT #85 - Dual output: Semantic prompt + Human description
                if "description_markdown" in story and "semantic_map" in story:
                    # Store semantic markdown as the output prompt (Prompt tab)
                    story["generated_prompt"] = story["description_markdown"]

                    # Convert semantic to human-readable text (Description tab)
                    story["description"] = convert_semantic_to_human(
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
            raise ValueError(f"IA não retornou JSON válido: {str(e)}")
