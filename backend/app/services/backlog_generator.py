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

from app.models.task import Task, ItemType, PriorityLevel
from app.models.interview import Interview
from app.models.spec import Spec, SpecScope
from app.models.project import Project
from app.services.ai_orchestrator import AIOrchestrator
from app.prompter.facade import PrompterFacade
from app.services.spec_loader import get_spec_loader

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

        # 2. Build AI prompt (EM PORTUGUÊS - PROMPT #64)
        system_prompt = """Você é um Product Owner especialista analisando conversas de entrevistas para extrair requisitos de nível Epic.

Sua tarefa:
1. Analise toda a conversa e identifique o EPIC principal (objetivo de negócio de alto nível)
2. Extraia critérios de aceitação (o que define que este Epic está "completo")
3. Extraia insights chave: requisitos, objetivos de negócio, restrições técnicas
4. Estime story points (1-21, escala Fibonacci) baseado na complexidade do Epic
5. Sugira prioridade (critical, high, medium, low, trivial)

IMPORTANTE:
- Um Epic representa um grande corpo de trabalho (múltiplas Stories)
- Foque em VALOR DE NEGÓCIO e RESULTADOS PARA O USUÁRIO
- Seja específico e acionável nos critérios de aceitação
- Extraia citações/insights reais da conversa
- TUDO DEVE SER EM PORTUGUÊS (título, descrição, critérios)

Retorne APENAS JSON válido (sem markdown, sem explicação):
{
    "title": "Título do Epic (conciso, focado em negócio) - EM PORTUGUÊS",
    "description": "Descrição detalhada do Epic explicando o objetivo de negócio e valor para o usuário - EM PORTUGUÊS",
    "story_points": 13,
    "priority": "high",
    "acceptance_criteria": [
        "Critério específico mensurável 1 - EM PORTUGUÊS",
        "Critério específico mensurável 2 - EM PORTUGUÊS",
        "Critério específico mensurável 3 - EM PORTUGUÊS"
    ],
    "interview_insights": {
        "key_requirements": ["requisito 1 - EM PORTUGUÊS", "requisito 2 - EM PORTUGUÊS"],
        "business_goals": ["objetivo 1 - EM PORTUGUÊS", "objetivo 2 - EM PORTUGUÊS"],
        "technical_constraints": ["restrição 1 - EM PORTUGUÊS", "restrição 2 - EM PORTUGUÊS"]
    },
    "interview_question_ids": [0, 2, 5]
}

interview_question_ids deve conter os índices das mensagens da conversa mais relevantes para este Epic.
"""

        # Convert conversation to readable format
        conversation_text = self._format_conversation(conversation)

        user_prompt = f"""Analise esta conversa de entrevista e extraia o Epic principal:

CONVERSA:
{conversation_text}

Retorne o Epic como JSON seguindo o schema fornecido no system prompt. LEMBRE-SE: TODO O CONTEÚDO DEVE SER EM PORTUGUÊS."""

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

            # Add metadata
            epic_suggestion["_metadata"] = {
                "source": "interview",
                "interview_id": str(interview_id),
                "ai_model": result.get("model", "unknown"),
                "input_tokens": result.get("input_tokens", 0),
                "output_tokens": result.get("output_tokens", 0),
                "cache_hit": result.get("cache_hit", False),
                "cache_type": result.get("cache_type", None)
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

        # 2. Build AI prompt (EM PORTUGUÊS - PROMPT #64)
        system_prompt = """Você é um Product Owner especialista decompondo Epics em Stories.

Sua tarefa:
1. Divida o Epic em 3-7 STORIES (funcionalidades voltadas ao usuário)
2. Cada Story deve ser entregável de forma independente
3. Cada Story deve entregar valor ao usuário
4. Stories devem ser estimadas em story points (1-8, Fibonacci)
5. Herde a prioridade do Epic (ajuste se necessário)

IMPORTANTE:
- Uma Story representa uma funcionalidade para o usuário (pode ser completada em 1-2 semanas)
- Siga o formato de User Story: "Como [usuário], eu quero [funcionalidade] para que [benefício]"
- Cada Story deve ter critérios de aceitação claros
- Stories devem ser independentes (mínimas dependências)
- TODO O CONTEÚDO DEVE SER EM PORTUGUÊS

Retorne APENAS array JSON válido (sem markdown, sem explicação):
[
    {
        "title": "Título da Story (formato User Story) - EM PORTUGUÊS",
        "description": "Como [usuário], eu quero [funcionalidade] para que [benefício]. Inclua detalhes de implementação aqui. - EM PORTUGUÊS",
        "story_points": 5,
        "priority": "high",
        "acceptance_criteria": [
            "Critério 1 - EM PORTUGUÊS",
            "Critério 2 - EM PORTUGUÊS"
        ],
        "interview_insights": {
            "derived_from_epic": true,
            "epic_requirements": ["requisito que esta story aborda - EM PORTUGUÊS"]
        }
    }
]
"""

        user_prompt = f"""Decomponha este Epic em Stories:

DETALHES DO EPIC:
Título: {epic.title}
Descrição: {epic.description}
Story Points: {epic.story_points}
Prioridade: {epic.priority.value if epic.priority else 'medium'}

Critérios de Aceitação:
{json.dumps(epic.acceptance_criteria, indent=2) if epic.acceptance_criteria else 'Nenhum'}

Insights da Entrevista:
{json.dumps(epic.interview_insights, indent=2) if epic.interview_insights else 'Nenhum'}

Retorne 3-7 Stories como array JSON seguindo o schema fornecido. LEMBRE-SE: TODO O CONTEÚDO DEVE SER EM PORTUGUÊS."""

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
                    "rag_similar_stories": rag_story_count  # PROMPT #85 - Phase 3
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

        # 2. Build AI prompt (EM PORTUGUÊS - PROMPT #64)
        # PROMPT #54.2 - FIX: Specs removed from decomposition (only for execution)
        system_prompt = """Você é um Product Owner especialista decompondo Stories em Tasks.

Sua tarefa:
1. Divida a Story em 3-10 TASKS (passos de implementação)
2. Cada Task deve ser específica e acionável (completável em 1-3 dias)
3. Estime story points para cada Task (1-3, Fibonacci)
4. Mantenha a prioridade da Story

IMPORTANTE:
- Uma Task é um passo concreto de implementação (o que precisa ser construído)
- Seja ESPECÍFICO: "Criar endpoints CRUD da API de Usuário" não "Criar backend"
- Foque em O QUE precisa ser feito, não COMO (detalhes técnicos vêm durante a execução)
- Tasks devem ter critérios de aceitação claros (resultados testáveis)
- Evite detalhes específicos de framework (ex: não mencione Laravel/React/etc.)
- TODO O CONTEÚDO DEVE SER EM PORTUGUÊS

Retorne APENAS array JSON válido (sem markdown, sem explicação):
[
    {
        "title": "Título Específico da Task - EM PORTUGUÊS",
        "description": "O que precisa ser implementado (descrição funcional, não técnica). - EM PORTUGUÊS",
        "story_points": 2,
        "priority": "high",
        "acceptance_criteria": [
            "Critério testável 1 - EM PORTUGUÊS",
            "Critério testável 2 - EM PORTUGUÊS"
        ]
    }
]
"""

        user_prompt = f"""Decomponha esta Story em Tasks:

DETALHES DA STORY:
Título: {story.title}
Descrição: {story.description}
Story Points: {story.story_points}
Prioridade: {story.priority.value if story.priority else 'medium'}

Critérios de Aceitação:
{json.dumps(story.acceptance_criteria, indent=2) if story.acceptance_criteria else 'Nenhum'}

Retorne 3-10 Tasks como array JSON seguindo o schema fornecido. LEMBRE-SE: TODO O CONTEÚDO DEVE SER EM PORTUGUÊS."""

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
                    "rag_similar_tasks": rag_task_count  # PROMPT #85 - Phase 3
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
