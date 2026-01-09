"""
MetaPromptProcessor
PROMPT #78 - Process meta prompt interviews and generate complete project hierarchy

This service analyzes meta prompt interview responses and automatically generates:
- 1 Epic representing the entire project
- 3-7 Stories breaking down the Epic
- 15-50 Tasks distributed across Stories
- Subtasks for complex Tasks
- Atomic prompts for each Task/Subtask
"""

from typing import Dict, List, Optional
from uuid import UUID, uuid4
from sqlalchemy.orm import Session
import json
import logging

from app.models.task import Task, ItemType, PriorityLevel, TaskStatus
from app.models.interview import Interview
from app.models.project import Project
from app.services.ai_orchestrator import AIOrchestrator
from app.prompter.facade import PrompterFacade

logger = logging.getLogger(__name__)


def _strip_markdown_json(content: str) -> str:
    """Remove markdown code blocks from JSON response."""
    import re
    content = re.sub(r'^```json\s*\n?', '', content, flags=re.MULTILINE)
    content = re.sub(r'\n?```\s*$', '', content, flags=re.MULTILINE)
    return content.strip()


class MetaPromptProcessor:
    """Service for processing meta prompt interviews and generating complete hierarchies"""

    def __init__(self, db: Session):
        self.db = db
        try:
            self.prompter = PrompterFacade(db)
        except RuntimeError:
            self.prompter = None
        self.orchestrator = AIOrchestrator(db)

    async def generate_complete_hierarchy(
        self,
        interview_id: UUID,
        project_id: UUID
    ) -> Dict:
        """
        Generate complete project hierarchy from meta prompt interview.

        PROMPT #78 - Meta Prompt Processing

        This is the main function that processes a completed meta prompt interview
        and generates the entire project structure in one go:

        - 1 Epic (project-level goal)
        - 3-7 Stories (feature-level breakdown)
        - 15-50 Tasks (implementation steps)
        - Subtasks as needed (granular work items)
        - Atomic prompts for each Task/Subtask

        Args:
            interview_id: ID of the completed meta prompt interview
            project_id: Project ID

        Returns:
            Dict containing:
            {
                "epic": {...},
                "stories": [...],
                "tasks": [...],
                "subtasks": [...],
                "metadata": {
                    "total_items": int,
                    "ai_model": str,
                    "focus_topics": [...]
                }
            }

        Raises:
            ValueError: If interview not found, not meta_prompt mode, or incomplete
        """
        # 1. Validate interview
        interview = self.db.query(Interview).filter(Interview.id == interview_id).first()
        if not interview:
            raise ValueError(f"Interview {interview_id} not found")

        # PROMPT #92/94 - Accept both meta_prompt and orchestrator interviews
        if interview.interview_mode not in ["meta_prompt", "orchestrator"]:
            raise ValueError(f"Interview {interview_id} cannot generate hierarchy (mode: {interview.interview_mode}). Only 'meta_prompt' and 'orchestrator' modes supported.")

        # PROMPT #92/94 - Different minimum messages for each mode
        # Orchestrator interviews: 5-8 fixed questions + AI questions (min 10 messages)
        # Meta prompt: 17 fixed questions + AI questions (min 18 messages)
        min_messages = 10 if interview.interview_mode == "orchestrator" else 18
        if not interview.conversation_data or len(interview.conversation_data) < min_messages:
            raise ValueError(f"Interview {interview_id} is incomplete (needs at least {min_messages//2} questions answered)")

        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        logger.info(f"🎯 Processing {interview.interview_mode} interview {interview_id} for project {project.name}")
        logger.info(f"   Focus topics: {interview.focus_topics}")
        logger.info(f"   Conversation messages: {len(interview.conversation_data)}")

        # 2. Extract all Q&A from interview
        qa_pairs = self._extract_qa_pairs(interview.conversation_data)
        focus_topics = interview.focus_topics or []

        # 3. Generate complete hierarchy using AI
        hierarchy_data = await self._generate_hierarchy_with_ai(
            qa_pairs=qa_pairs,
            focus_topics=focus_topics,
            project=project,
            interview_id=interview_id
        )

        # 4. Create Epic in database
        epic = await self._create_epic(
            hierarchy_data["epic"],
            project_id=project_id,
            interview_id=interview_id
        )

        # 5. Create Stories under Epic
        stories = []
        tasks_by_story = {}

        for story_data in hierarchy_data["stories"]:
            story = await self._create_story(
                story_data,
                epic_id=epic.id,
                project_id=project_id
            )
            stories.append(story)

            # 6. Create Tasks under each Story
            tasks_for_story = []
            for task_data in story_data.get("tasks", []):
                task = await self._create_task(
                    task_data,
                    story_id=story.id,
                    project_id=project_id
                )
                tasks_for_story.append(task)

                # 7. Create Subtasks under each Task (if any)
                for subtask_data in task_data.get("subtasks", []):
                    subtask = await self._create_subtask(
                        subtask_data,
                        task_id=task.id,
                        project_id=project_id
                    )
                    tasks_for_story.append(subtask)  # Track subtasks too

            tasks_by_story[story.id] = tasks_for_story

        # 8. Flatten all tasks/subtasks for response
        all_tasks = []
        for tasks_list in tasks_by_story.values():
            all_tasks.extend(tasks_list)

        # 9. Count subtasks separately
        subtasks = [t for t in all_tasks if t.item_type == ItemType.SUBTASK]
        tasks = [t for t in all_tasks if t.item_type == ItemType.TASK]

        logger.info(f"✅ Meta prompt processing complete!")
        logger.info(f"   Created: 1 Epic, {len(stories)} Stories, {len(tasks)} Tasks, {len(subtasks)} Subtasks")

        return {
            "epic": self._task_to_dict(epic),
            "stories": [self._task_to_dict(s) for s in stories],
            "tasks": [self._task_to_dict(t) for t in tasks],
            "subtasks": [self._task_to_dict(s) for s in subtasks],
            "metadata": {
                "total_items": 1 + len(stories) + len(tasks) + len(subtasks),
                "epic_count": 1,
                "story_count": len(stories),
                "task_count": len(tasks),
                "subtask_count": len(subtasks),
                "ai_model": hierarchy_data["metadata"]["ai_model"],
                "focus_topics": focus_topics,
                "interview_id": str(interview_id),
                "project_id": str(project_id)
            }
        }

    def _extract_qa_pairs(self, conversation_data: list) -> Dict:
        """
        Extract Q&A pairs from meta prompt conversation.

        Returns dict with answers to each question:
        {
            "q1_vision": "answer...",
            "q2_features": ["auth", "crud", ...],
            "q3_users": "answer...",
            ...
            "q9_topics": ["business_rules", "design_ux"],
            "contextual": [{"question": "...", "answer": "..."}]
        }
        """
        qa = {}

        # Q1-Q9 are fixed questions
        question_labels = {
            1: "q1_vision",
            2: "q2_features",
            3: "q3_users",
            4: "q4_business_rules",
            5: "q5_data_entities",
            6: "q6_success_criteria",
            7: "q7_constraints",
            8: "q8_mvp_scope",
            9: "q9_topics"
        }

        # Extract answers (they appear after questions in conversation_data)
        # Message 0: Initial message
        # Message 1: User answer to "start interview" (not a question answer)
        # Message 2: Q1
        # Message 3: A1
        # Message 4: Q2
        # Message 5: A2
        # ...

        for i, msg in enumerate(conversation_data):
            if msg["role"] == "user" and i > 1:  # Skip first user message
                # This is an answer
                question_index = (i // 2)  # Q1 is at index 2, A1 is at index 3
                if question_index in question_labels:
                    label = question_labels[question_index]
                    qa[label] = msg["content"]

        # Q10+ are contextual AI questions
        contextual_qa = []
        for i in range(18, len(conversation_data), 2):  # Start after Q9 (message 18)
            if i < len(conversation_data) - 1:
                question = conversation_data[i]
                answer = conversation_data[i + 1]
                if question["role"] == "assistant" and answer["role"] == "user":
                    contextual_qa.append({
                        "question": question["content"],
                        "answer": answer["content"]
                    })

        qa["contextual"] = contextual_qa

        return qa

    async def _generate_hierarchy_with_ai(
        self,
        qa_pairs: Dict,
        focus_topics: List[str],
        project: Project,
        interview_id: UUID
    ) -> Dict:
        """
        Use AI to generate complete project hierarchy from meta prompt Q&A.

        This is the core AI call that analyzes all answers and generates:
        - 1 Epic
        - 3-7 Stories
        - Tasks for each Story (3-10 per Story)
        - Subtasks for complex Tasks
        - Atomic prompts for each Task/Subtask
        """
        # Build topic focus text
        topic_labels = {
            "business_rules": "Regras de Negócio",
            "design_ux": "Design e UX/UI",
            "architecture": "Conceito e Arquitetura",
            "security": "Segurança",
            "performance": "Performance e Escalabilidade",
            "integrations": "Integrações",
            "workflows": "Workflows e Processos",
            "data_model": "Modelagem de Dados",
            "deployment": "Deploy e Infraestrutura",
            "testing": "Testes e Qualidade"
        }

        focus_text = ""
        if focus_topics:
            focus_text = "\n**TÓPICOS PRIORIZADOS:**\n"
            for topic in focus_topics:
                label = topic_labels.get(topic, topic)
                focus_text += f"- {label}\n"
            focus_text += "\nPriorize a geração de Stories/Tasks relacionadas a estes tópicos.\n"

        # Build system prompt
        system_prompt = f"""Você é um Product Owner sênior que vai gerar a estrutura completa de um projeto baseado em respostas de meta prompt.

**CONTEXTO DO PROJETO:**
Nome: {project.name}
Descrição: {project.description or 'N/A'}

{focus_text}

**SUA TAREFA:**
Analise TODAS as respostas do meta prompt e gere a hierarquia completa:

1. **1 EPIC** - Objetivo principal do projeto (valor de negócio de alto nível)
2. **3-7 STORIES** - Funcionalidades principais quebrando o Epic
3. **TASKS** - 3-10 Tasks por Story (passos de implementação)
4. **SUBTASKS** - Para Tasks complexas (>5 story points), quebrar em 2-4 subtasks
5. **PROMPTS ATÔMICOS** - Para cada Task/Subtask, gerar um prompt de execução focado

**REGRAS IMPORTANTES:**
- TODO O CONTEÚDO DEVE SER EM PORTUGUÊS
- Use as respostas das perguntas fixas (Q1-Q8) como base
- Incorpore insights das perguntas contextuais (Q10+)
- Priorize tópicos selecionados pelo cliente em Q9
- Epic: story_points 13-21, representa todo o projeto
- Stories: story_points 5-13, representam features completas
- Tasks: story_points 1-5, representam passos de implementação
- Subtasks: story_points 1-3, granularidade máxima
- Prompts atômicos: instruções específicas e focadas para IA executar cada Task/Subtask

**FORMATO DE SAÍDA:**
Retorne APENAS JSON válido (sem markdown):

{{
  "epic": {{
    "title": "Título do Epic - EM PORTUGUÊS",
    "description": "Descrição detalhada do objetivo de negócio - EM PORTUGUÊS",
    "story_points": 21,
    "priority": "high",
    "business_value": "Valor para o negócio e usuário - EM PORTUGUÊS",
    "acceptance_criteria": [
      "Critério mensurável 1 - EM PORTUGUÊS",
      "Critério mensurável 2 - EM PORTUGUÊS",
      "Critério mensurável 3 - EM PORTUGUÊS"
    ],
    "labels": ["mvp", "core-feature"]
  }},
  "stories": [
    {{
      "title": "Título da Story 1 - EM PORTUGUÊS",
      "description": "Descrição da funcionalidade - EM PORTUGUÊS",
      "story_points": 8,
      "priority": "high",
      "acceptance_criteria": [
        "Critério 1 - EM PORTUGUÊS",
        "Critério 2 - EM PORTUGUÊS"
      ],
      "labels": ["auth", "mvp"],
      "tasks": [
        {{
          "title": "Título específico da Task - EM PORTUGUÊS",
          "description": "O que precisa ser implementado - EM PORTUGUÊS",
          "story_points": 3,
          "priority": "high",
          "acceptance_criteria": [
            "Critério testável 1 - EM PORTUGUÊS",
            "Critério testável 2 - EM PORTUGUÊS"
          ],
          "generated_prompt": "Prompt atômico: Implemente [descrição específica do que fazer, usando contexto do projeto]. Considere [requisitos técnicos relevantes]. Critérios de sucesso: [o que validar]. - EM PORTUGUÊS",
          "subtasks": [
            {{
              "title": "Subtask granular - EM PORTUGUÊS",
              "description": "Passo específico - EM PORTUGUÊS",
              "story_points": 2,
              "priority": "high",
              "generated_prompt": "Prompt atômico para subtask - EM PORTUGUÊS"
            }}
          ]
        }}
      ]
    }}
  ],
  "metadata": {{
    "total_stories": 5,
    "total_tasks": 28,
    "total_subtasks": 12,
    "focus_topics": {json.dumps(focus_topics)}
  }}
}}

Analise TODAS as respostas abaixo e gere a hierarquia completa."""

        # Build user prompt with all Q&A
        user_prompt = f"""**RESPOSTAS DO META PROMPT:**

**Q1 - Visão e Problema:**
{qa_pairs.get('q1_vision', 'N/A')}

**Q2 - Módulos/Funcionalidades:**
{qa_pairs.get('q2_features', 'N/A')}

**Q3 - Perfis de Usuários:**
{qa_pairs.get('q3_users', 'N/A')}

**Q4 - Regras de Negócio:**
{qa_pairs.get('q4_business_rules', 'N/A')}

**Q5 - Entidades/Dados:**
{qa_pairs.get('q5_data_entities', 'N/A')}

**Q6 - Critérios de Sucesso:**
{qa_pairs.get('q6_success_criteria', 'N/A')}

**Q7 - Restrições Técnicas:**
{qa_pairs.get('q7_constraints', 'N/A')}

**Q8 - Escopo MVP:**
{qa_pairs.get('q8_mvp_scope', 'N/A')}

**Q9 - Tópicos Selecionados:**
{', '.join([topic_labels.get(t, t) for t in focus_topics]) if focus_topics else 'Nenhum'}

**PERGUNTAS CONTEXTUAIS (Q10+):**
"""

        for i, ctx_qa in enumerate(qa_pairs.get('contextual', []), 10):
            user_prompt += f"\nQ{i}: {ctx_qa['question']}\n"
            user_prompt += f"A{i}: {ctx_qa['answer']}\n"

        user_prompt += "\n\nGere a hierarquia completa seguindo o schema JSON fornecido."

        # Call AI
        logger.info("🤖 Calling AI to generate complete hierarchy...")

        try:
            if self.prompter:
                result = await self.prompter.execute_prompt(
                    prompt=user_prompt,
                    usage_type="prompt_generation",
                    system_prompt=system_prompt,
                    project_id=str(project.id),
                    interview_id=str(interview_id),
                    metadata={"operation": "generate_hierarchy_from_meta_prompt"}
                )
            else:
                result = await self.orchestrator.execute(
                    usage_type="prompt_generation",
                    messages=[{"role": "user", "content": user_prompt}],
                    system_prompt=system_prompt,
                    project_id=project.id,
                    interview_id=interview_id,
                    metadata={"operation": "generate_hierarchy_from_meta_prompt"}
                )
                result = {
                    "response": result["content"],
                    "model": result.get("db_model_name", "unknown"),
                    "input_tokens": result.get("usage", {}).get("input_tokens", 0),
                    "output_tokens": result.get("usage", {}).get("output_tokens", 0)
                }
        except Exception as e:
            logger.error(f"❌ AI call failed: {e}", exc_info=True)
            raise ValueError(f"Failed to generate hierarchy: {str(e)}")

        # Parse AI response
        try:
            clean_json = _strip_markdown_json(result["response"])
            hierarchy = json.loads(clean_json)

            hierarchy["metadata"]["ai_model"] = result.get("model", "unknown")
            hierarchy["metadata"]["input_tokens"] = result.get("input_tokens", 0)
            hierarchy["metadata"]["output_tokens"] = result.get("output_tokens", 0)

            logger.info(f"✅ Hierarchy generated: {hierarchy['metadata']['total_stories']} stories, {hierarchy['metadata']['total_tasks']} tasks")

            return hierarchy

        except json.JSONDecodeError as e:
            logger.error(f"❌ Failed to parse AI response as JSON: {e}")
            logger.error(f"AI response: {result.get('response', '')[:1000]}")
            raise ValueError(f"AI did not return valid JSON: {str(e)}")

    async def _create_epic(
        self,
        epic_data: Dict,
        project_id: UUID,
        interview_id: UUID
    ) -> Task:
        """Create Epic in database."""
        epic = Task(
            id=uuid4(),
            project_id=project_id,
            title=epic_data["title"],
            description=epic_data["description"],
            item_type=ItemType.EPIC,
            story_points=epic_data.get("story_points", 21),
            priority=self._parse_priority(epic_data.get("priority", "high")),
            business_value=epic_data.get("business_value"),
            acceptance_criteria=epic_data.get("acceptance_criteria", []),
            labels=epic_data.get("labels", []),
            status=TaskStatus.TODO,
            created_from_interview_id=interview_id
        )

        self.db.add(epic)
        self.db.commit()
        self.db.refresh(epic)

        logger.info(f"   ✅ Created Epic: {epic.title}")
        return epic

    async def _create_story(
        self,
        story_data: Dict,
        epic_id: UUID,
        project_id: UUID
    ) -> Task:
        """Create Story in database."""
        story = Task(
            id=uuid4(),
            project_id=project_id,
            parent_id=epic_id,
            title=story_data["title"],
            description=story_data["description"],
            item_type=ItemType.STORY,
            story_points=story_data.get("story_points", 5),
            priority=self._parse_priority(story_data.get("priority", "medium")),
            acceptance_criteria=story_data.get("acceptance_criteria", []),
            labels=story_data.get("labels", []),
            status=TaskStatus.TODO
        )

        self.db.add(story)
        self.db.commit()
        self.db.refresh(story)

        logger.info(f"     ✅ Created Story: {story.title}")
        return story

    async def _create_task(
        self,
        task_data: Dict,
        story_id: UUID,
        project_id: UUID
    ) -> Task:
        """Create Task in database with atomic prompt."""
        task = Task(
            id=uuid4(),
            project_id=project_id,
            parent_id=story_id,
            title=task_data["title"],
            description=task_data["description"],
            item_type=ItemType.TASK,
            story_points=task_data.get("story_points", 3),
            priority=self._parse_priority(task_data.get("priority", "medium")),
            acceptance_criteria=task_data.get("acceptance_criteria", []),
            generated_prompt=task_data.get("generated_prompt"),  # Atomic prompt!
            status=TaskStatus.TODO
        )

        self.db.add(task)
        self.db.commit()
        self.db.refresh(task)

        logger.info(f"       ✅ Created Task: {task.title}")
        return task

    async def _create_subtask(
        self,
        subtask_data: Dict,
        task_id: UUID,
        project_id: UUID
    ) -> Task:
        """Create Subtask in database with atomic prompt."""
        subtask = Task(
            id=uuid4(),
            project_id=project_id,
            parent_id=task_id,
            title=subtask_data["title"],
            description=subtask_data["description"],
            item_type=ItemType.SUBTASK,
            story_points=subtask_data.get("story_points", 2),
            priority=self._parse_priority(subtask_data.get("priority", "medium")),
            generated_prompt=subtask_data.get("generated_prompt"),  # Atomic prompt!
            status=TaskStatus.TODO
        )

        self.db.add(subtask)
        self.db.commit()
        self.db.refresh(subtask)

        logger.info(f"         ✅ Created Subtask: {subtask.title}")
        return subtask

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

    def _task_to_dict(self, task: Task) -> Dict:
        """Convert Task model to dict for response."""
        return {
            "id": str(task.id),
            "title": task.title,
            "description": task.description,
            "item_type": task.item_type.value,
            "story_points": task.story_points,
            "priority": task.priority.value if task.priority else None,
            "parent_id": str(task.parent_id) if task.parent_id else None,
            "has_generated_prompt": bool(task.generated_prompt)
        }
