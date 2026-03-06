"""
Backlog Generator - Task Generation Mixin
Handles decomposition of Stories into Tasks and direct task generation from interviews.
Extracted from backlog_generator.py for modularity.
"""

import json
import logging
from typing import Dict, List
from uuid import UUID

from app.models.task import Task, ItemType, TaskStatus
from app.models.interview import Interview
from app.models.project import Project
from app.services.backlog_utils import (
    get_business_rules_context,
    strip_markdown_json,
    convert_semantic_to_human,
    build_task_generation_prompt,
    format_conversation_for_task,
    parse_priority,
)

logger = logging.getLogger(__name__)


class TaskGenerationMixin:
    """Mixin that provides decompose_story_to_tasks and generate_task_from_interview_direct capabilities."""

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
            raise ValueError(f"Story {story_id} não encontrada ou não é uma Story")

        # 2. Build AI prompt (PROMPT #258 - Load from ContractLoader, fallback to hardcoded)
        try:
            system_prompt, _ = self._contract_loader.render("generation/tasks_decomposition")
        except Exception:
            logger.warning("Failed to load tasks_decomposition contract, using hardcoded fallback")
            system_prompt = ""

        if not system_prompt:
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
        "description_markdown": "# Task: [Título]\\n\\n## Mapa Semântico\\n\\n- **N1**: [definição - REUTILIZADO]\\n- **E10**: [definição - NOVO]\\n- **F1**: [definição - NOVO]\\n...\\n\\n## Descrição\\n\\n[Narrativa técnica usando identificadores. Ex: 'Esta Task implementa E10 em F1, criando M1 para processar D5 de N1.']\\n\\n## Critérios de Aceitação\\n\\n1. **AC1**: [critério testável usando identificadores]\\n2. **AC2**: [critério testável usando identificadores]\\n...",
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

        # PROMPT #170 - Inject business rules as high-priority context
        business_rules_text = get_business_rules_context(self.db, project_id)
        business_rules_section = ""
        if business_rules_text:
            business_rules_section = f"""
{business_rules_text}

ATENÇÃO: TODAS as Tasks geradas DEVEM respeitar as regras de negócio listadas acima.
Cada Task deve implementar corretamente as regras que se aplicam a ela.

"""

        user_prompt = f"""Decomponha esta Story em Tasks usando a Metodologia de Referências Semânticas.
{business_rules_section}
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
{f"6. IMPORTANTE: Os critérios de aceitação de cada Task DEVEM validar as regras de negócio aplicáveis" if business_rules_text else ""}

Retorne 3-10 Tasks como array JSON seguindo EXATAMENTE o schema fornecido no system prompt.

LEMBRE-SE:
- TODO O CONTEÚDO DEVE SER EM PORTUGUÊS
- REUTILIZE identificadores da Story (mantenha consistência)
- NUNCA substitua identificadores por seus significados
- Evite mencionar frameworks específicos (use identificadores genéricos)
{f"- REGRAS DE NEGÓCIO são OBRIGATÓRIAS - cada Task deve implementar as regras que se aplicam" if business_rules_text else ""}"""

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

        if self.prompter:
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
                    "operation": "decompose_story_to_tasks",
                    "story_id": str(story_id)
                },
                enable_rag=True
            )
            # Normalize result format
            result = {"response": result["content"], "input_tokens": result.get("usage", {}).get("input_tokens", 0), "output_tokens": result.get("usage", {}).get("output_tokens", 0), "model": result.get("db_model_name", "unknown")}

        # 5. Parse AI response
        try:
            # Strip markdown code blocks if present
            clean_json = strip_markdown_json(result["response"])
            tasks_suggestions = json.loads(clean_json)

            if not isinstance(tasks_suggestions, list):
                raise ValueError("Resposta da IA não é uma lista")

            # Add metadata and parent_id to each Task
            for task in tasks_suggestions:
                # PROMPT #85 - Dual output: Semantic prompt + Human description
                if "description_markdown" in task and "semantic_map" in task:
                    # Store semantic markdown as the output prompt (Prompt tab)
                    task["generated_prompt"] = task["description_markdown"]

                    # Convert semantic to human-readable text (Description tab)
                    task["description"] = convert_semantic_to_human(
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
            raise ValueError(f"IA não retornou JSON válido: {str(e)}")

    async def generate_task_from_interview_direct(
        self,
        interview: "Interview",
        project: "Project"
    ) -> "Task":
        """
        Generate SINGLE TASK directly from task-focused interview.

        PROMPT #68 - Dual-Mode Interview System (FASE 4)

        For task-focused interviews (existing projects), generates ONE task directly
        without Epic->Story->Task hierarchy.

        The task includes:
        - Title, description, acceptance criteria
        - Story points, priority, labels
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
            raise ValueError(f"Entrevista {interview.id} não é focada em tarefa (modo: {interview.interview_mode})")

        conversation = interview.conversation_data
        if not conversation or len(conversation) == 0:
            raise ValueError(f"Entrevista {interview.id} não possui dados de conversa")

        # Extract task type from interview
        task_type = interview.task_type_selection or "feature"
        logger.info(f"Task type: {task_type}")

        # Build AI prompt for task generation
        system_prompt = build_task_generation_prompt(project, task_type)

        # Build conversation summary
        conversation_text = format_conversation_for_task(conversation)

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

Return ONLY valid JSON in this format:
{{
  "title": "Clear, actionable title",
  "description": "Detailed description with context",
  "acceptance_criteria": ["Criterion 1", "Criterion 2", "Criterion 3"],
  "story_points": 5,
  "priority": "high",
  "labels": ["backend", "{task_type}"],
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
            interview_id=interview.id,
            enable_rag=True  # PROMPT #124 - Enable RAG for backlog generation
        )

        # Parse AI response
        content = strip_markdown_json(response["content"])
        try:
            task_data = json.loads(content)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse task JSON: {content[:200]}")
            raise ValueError(f"IA retornou JSON inválido: {str(e)}")

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
            priority=parse_priority(task_data.get("priority", "medium")),
            labels=task_data.get("labels", [task_type]),
            interview_insights=task_data.get("interview_insights", {}),
            status="backlog",
            workflow_state="closed",
            reporter="system"
        )

        self.db.add(task)
        self.db.commit()
        self.db.refresh(task)

        logger.info(f"✅ Task created: {task.id} - {task.title}")

        return task
