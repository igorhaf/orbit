"""
Service para gerar prompts automaticamente usando IA
Analisa entrevistas e gera prompts estruturados para implementação
Atualizado para criar Tasks ao invés de Prompts (PROMPT #44)
Integrado com Prompter Architecture (Phase 2: Integration)
"""

from typing import List, Dict, Any
from uuid import UUID
from sqlalchemy.orm import Session
import json
import logging
import os

from app.models.interview import Interview
from app.models.task import Task, TaskStatus, ItemType, PriorityLevel
from app.models.project import Project
from app.models.spec import Spec, SpecScope
from app.services.ai_orchestrator import AIOrchestrator
from app.services.backlog_generator import BacklogGeneratorService

# Prompter Architecture (gradual migration via feature flags)
try:
    from app.prompter.facade import PrompterFacade
    PROMPTER_AVAILABLE = True
except ImportError:
    PROMPTER_AVAILABLE = False
    logger.warning("PrompterFacade not available - using legacy prompt generation")

logger = logging.getLogger(__name__)


class PromptGenerator:
    """
    Serviço para geração automática de prompts usando AI Orchestrator
    Supports gradual migration to Prompter Architecture via feature flags
    """

    def __init__(self, db: Session):
        """
        Inicializa o gerador com AI Orchestrator e PrompterFacade (if enabled)

        Args:
            db: Sessão do banco de dados
        """
        self.db = db
        self.orchestrator = AIOrchestrator(db)

        # Initialize PrompterFacade if available and enabled
        self.use_prompter = (
            PROMPTER_AVAILABLE and
            os.getenv("PROMPTER_USE_TEMPLATES", "false").lower() == "true"
        )

        if self.use_prompter:
            self.prompter = PrompterFacade(db)
            logger.info("✓ PrompterFacade enabled - using template-based prompts")
        else:
            self.prompter = None
            if PROMPTER_AVAILABLE:
                logger.info("PrompterFacade available but disabled (PROMPTER_USE_TEMPLATES=false)")
            else:
                logger.info("Using legacy hardcoded prompts")

    def _fetch_stack_specs(self, project: Project, db: Session) -> Dict[str, Any]:
        """
        Fetch all relevant specs for project from database.
        Returns organized specs by category and type.

        PROMPT #48 - Phase 3: Token Reduction via Specs Integration
        PROMPT #77 - Project-Specific Specs: Now fetches from database (discovered via RAG)
        """
        specs = {
            'backend': [],
            'frontend': [],
            'database': [],
            'css': [],
            'ignore_patterns': set()
        }

        # Fetch project-specific specs from database
        project_specs = db.query(Spec).filter(
            Spec.project_id == project.id,
            Spec.is_active == True
        ).all()

        if not project_specs:
            logger.info(f"No project-specific specs found for project {project.id}")
            return specs

        # Organize specs by category
        for spec in project_specs:
            category = spec.category.lower() if spec.category else 'backend'

            spec_data = {
                'type': spec.spec_type,
                'title': spec.title,
                'content': spec.content,
                'language': getattr(spec, 'language', None)
            }

            if category in specs:
                specs[category].append(spec_data)
            else:
                # Default to backend for unrecognized categories
                specs['backend'].append(spec_data)

            # Collect ignore patterns
            if spec.ignore_patterns:
                specs['ignore_patterns'].update(spec.ignore_patterns)

        # Convert ignore patterns set to list
        specs['ignore_patterns'] = list(specs['ignore_patterns'])

        logger.info(f"Fetched specs from database: {len(specs['backend'])} backend, {len(specs['frontend'])} frontend, "
                   f"{len(specs['database'])} database, {len(specs['css'])} css")

        return specs

    def _extract_keywords_from_conversation(self, conversation: List[Dict]) -> set:
        """
        Extract relevant keywords from interview conversation to guide spec selection.

        PROMPT #54 - Token Optimization: Extract hints for selective spec loading

        Returns set of keywords found in conversation (authentication, api, payment, etc.)
        """
        # Common technical keywords to look for
        keyword_patterns = {
            'auth', 'login', 'register', 'password', 'jwt', 'token', 'session',
            'api', 'rest', 'endpoint', 'route', 'controller', 'middleware',
            'database', 'model', 'migration', 'query', 'table', 'schema',
            'user', 'permission', 'role', 'access', 'authorization',
            'payment', 'stripe', 'paypal', 'checkout', 'cart', 'order',
            'email', 'notification', 'mail', 'smtp',
            'upload', 'file', 'image', 'storage', 's3',
            'component', 'page', 'form', 'validation',
            'admin', 'dashboard', 'panel',
            'test', 'testing', 'unit', 'integration'
        }

        found_keywords = set()
        conversation_text = ' '.join([
            msg.get('content', '').lower()
            for msg in conversation
        ])

        for keyword in keyword_patterns:
            if keyword in conversation_text:
                found_keywords.add(keyword)

        logger.info(f"🔍 Extracted {len(found_keywords)} keywords from conversation: {found_keywords}")
        return found_keywords

    def _is_spec_relevant(self, spec: Dict, keywords: set) -> bool:
        """
        Check if a spec is relevant based on keywords OR essentiality.

        PROMPT #54 - Token Optimization: Filter specs by relevance
        PROMPT #54.1 - Always Filter: Ensures specs are ALWAYS limited, never sends all 47

        Strategy:
        - If HAS keywords: Match by keyword relevance OR essential types
        - If NO keywords: Include only essential types (top 10 most common)
        - This guarantees specs are ALWAYS filtered (never all 47 specs)

        Returns:
            True if spec is relevant (by keyword or essentiality), False otherwise
        """
        # Define essential spec types (most commonly needed across all projects)
        # Expanded from 4 to 10 types for better coverage without keywords
        essential_types = {
            'project_structure',  # How to organize files/folders
            'database',           # Database schema, queries
            'routing',            # Routes/endpoints definition
            'api_endpoints',      # API controllers/handlers
            'middleware',         # Auth, CORS, validation
            'models',             # ORM models, entities
            'migrations',         # Database migrations
            'components',         # UI components (frontend)
            'pages',              # Routes/pages (frontend)
            'authentication'      # Auth system (very common)
        }

        spec_type = spec.get('type', '').lower()

        # If no keywords, use only essential types
        if not keywords:
            return spec_type in essential_types

        # Has keywords - check for keyword match first
        spec_text = f"{spec.get('title', '')} {spec_type}".lower()

        for keyword in keywords:
            if keyword in spec_text:
                return True

        # No keyword match - still include if essential type
        # This ensures essential specs are always included even with keywords
        return spec_type in essential_types

    def _build_specs_context(self, specs: Dict[str, Any], project: Project, keywords: set = None) -> str:
        """
        Format specs into readable context for AI.

        PROMPT #48 - Phase 3: Build comprehensive specs context
        PROMPT #54 - Token Optimization: Made selective based on keywords (70-80% reduction)
        PROMPT #54.1 - Always Filter: ALWAYS limits specs to max 12 (never sends all 47)

        Args:
            specs: All available specs organized by category
            project: Project with stack information
            keywords: Optional set of keywords from conversation for filtering

        Strategy:
        - ALWAYS filter specs (never send all 47)
        - If keywords provided: Include specs matching keywords + essentials
        - If no keywords: Include only essential specs (10 types)
        - Limit to MAX 3 specs per category (total ~12 specs max)
        - This reduces from 16,278 tokens → 1,200-1,500 tokens (90%+ reduction)
        """
        if not any(specs[cat] for cat in ['backend', 'frontend', 'database', 'css']):
            logger.warning("No specs available for project stack")
            return ""

        # PROMPT #54.1 - Always Filter: Maximum specs per category
        MAX_SPECS_PER_CATEGORY = 3

        # Filter specs by relevance
        filtered_specs = {
            'backend': [],
            'frontend': [],
            'database': [],
            'css': []
        }

        total_before = 0
        total_after = 0

        for category in ['backend', 'frontend', 'database', 'css']:
            total_before += len(specs.get(category, []))
            if specs.get(category):
                # Filter by relevance (keywords or essentiality)
                relevant_specs = [
                    spec for spec in specs[category]
                    if self._is_spec_relevant(spec, keywords or set())
                ]

                # ALWAYS limit to top N specs per category (PROMPT #54.1)
                # This ensures we NEVER send too many specs, even if many are relevant
                filtered_specs[category] = relevant_specs[:MAX_SPECS_PER_CATEGORY]
                total_after += len(filtered_specs[category])

        logger.info(f"📊 Spec filtering: {total_before} specs → {total_after} relevant specs "
                   f"({100 - (total_after/total_before*100 if total_before > 0 else 0):.0f}% reduction)")

        context = "\n" + "="*80 + "\n"
        context += "FRAMEWORK SPECIFICATIONS (PRE-DEFINED - DO NOT REGENERATE)\n"
        context += "="*80 + "\n\n"

        context += f"PROJECT STACK:\n"
        context += f"- Backend: {project.stack_backend or 'None'}\n"
        context += f"- Database: {project.stack_database or 'None'}\n"
        context += f"- Frontend: {project.stack_frontend or 'None'}\n"
        context += f"- CSS Framework: {project.stack_css or 'None'}\n\n"

        # Backend specs
        if filtered_specs['backend']:
            lang = filtered_specs['backend'][0].get('language', 'Backend').upper()
            context += f"{'-'*80}\n"
            context += f"{lang} FRAMEWORK SPECIFICATIONS\n"
            context += f"{'-'*80}\n\n"

            for spec in filtered_specs['backend']:
                context += f"### {spec['title']} ({spec['type']})\n"
                context += f"{spec['content']}\n\n"

        # Frontend specs
        if filtered_specs['frontend']:
            context += f"{'-'*80}\n"
            context += f"FRONTEND FRAMEWORK SPECIFICATIONS\n"
            context += f"{'-'*80}\n\n"

            for spec in filtered_specs['frontend']:
                context += f"### {spec['title']} ({spec['type']})\n"
                context += f"{spec['content']}\n\n"

        # Database specs
        if filtered_specs['database']:
            context += f"{'-'*80}\n"
            context += f"DATABASE SPECIFICATIONS\n"
            context += f"{'-'*80}\n\n"

            for spec in filtered_specs['database']:
                context += f"### {spec['title']} ({spec['type']})\n"
                context += f"{spec['content']}\n\n"

        # CSS specs
        if filtered_specs['css']:
            context += f"{'-'*80}\n"
            context += f"CSS FRAMEWORK SPECIFICATIONS\n"
            context += f"{'-'*80}\n\n"

            for spec in filtered_specs['css']:
                context += f"### {spec['title']} ({spec['type']})\n"
                context += f"{spec['content']}\n\n"

        # Ignore patterns
        if specs.get('ignore_patterns'):
            context += f"{'-'*80}\n"
            context += f"FILES/DIRECTORIES TO IGNORE\n"
            context += f"{'-'*80}\n"
            context += f"{', '.join(specs['ignore_patterns'])}\n\n"

        context += "="*80 + "\n"
        context += "END OF FRAMEWORK SPECIFICATIONS\n"
        context += "="*80 + "\n\n"

        context += """CRITICAL INSTRUCTIONS FOR TASK GENERATION:

1. **The framework structures above are PRE-DEFINED**
   - DO NOT include them in task descriptions
   - DO NOT regenerate boilerplate code
   - DO NOT explain framework conventions

2. **Reference specs instead of reproducing them**
   - Example: "Follow Laravel controller spec structure"
   - Example: "Use Next.js page component pattern from spec"
   - Example: "Apply PostgreSQL table creation spec"

3. **Focus ONLY on business logic and unique features**
   - What makes THIS project different
   - Project-specific validations
   - Custom methods beyond standard patterns
   - Integration logic between components

4. **Task descriptions should be CONCISE**
   - 50-150 words maximum per task
   - Describe WHAT to implement, not HOW the framework works
   - Reference spec patterns instead of repeating them

5. **Token reduction strategy**
   - Before: "Create a Laravel controller with methods index(), store(), show()..."  (500 tokens)
   - After: "Create Product controller following spec. Add inventory tracking logic." (50 tokens)
   - 90% TOKEN REDUCTION by not repeating framework patterns!

"""

        logger.info(f"Built specs context: {len(context)} characters")
        return context

    async def generate_from_interview(
        self,
        interview_id: str,
        db: Session
    ) -> List[Task]:
        """
        Analisa a entrevista e gera hierarquia completa de Backlog (Epic → Stories → Tasks)

        PROMPT #64 - JIRA Backlog Generation (EM PORTUGUÊS)
        - Substitui geração de tasks simples por hierarquia JIRA-like rica
        - Gera Epic → decompõe em Stories → decompõe em Tasks
        - Todo conteúdo gerado em PORTUGUÊS
        - Itens criados no Backlog (não diretamente no Kanban)

        Args:
            interview_id: UUID da entrevista
            db: Sessão do banco de dados

        Returns:
            Lista de todos os itens criados (Epic + Stories + Tasks)

        Raises:
            ValueError: Se a entrevista não for encontrada
            Exception: Se houver erro na geração
        """
        logger.info(f"🚀 PROMPT #64: Starting JIRA Backlog generation (PT-BR) for interview {interview_id}")

        # 1. Buscar interview e validar
        interview = db.query(Interview).filter(
            Interview.id == UUID(interview_id)
        ).first()

        if not interview:
            raise ValueError(f"Interview {interview_id} not found")

        if not interview.conversation_data or len(interview.conversation_data) == 0:
            raise ValueError("Interview has no conversation data")

        project_id = interview.project_id
        logger.info(f"📋 Interview found for project {project_id}")

        # 2. Initialize BacklogGeneratorService
        backlog_service = BacklogGeneratorService(db)
        all_created_items = []

        # 3. STEP 1: Generate Epic from Interview (EM PORTUGUÊS)
        logger.info("🎯 STEP 1: Generating Epic from interview conversation...")
        epic_suggestion = await backlog_service.generate_epic_from_interview(
            interview_id=UUID(interview_id),
            project_id=project_id
        )

        # Create Epic in database
        epic = Task(
            project_id=project_id,
            item_type=ItemType.EPIC,
            title=epic_suggestion["title"],
            description=epic_suggestion["description"],
            story_points=epic_suggestion.get("story_points", 13),
            priority=PriorityLevel(epic_suggestion.get("priority", "medium")),
            acceptance_criteria=epic_suggestion.get("acceptance_criteria", []),
            interview_insights=epic_suggestion.get("interview_insights", {}),
            interview_question_ids=epic_suggestion.get("interview_question_ids", []),
            status=TaskStatus.BACKLOG,
            workflow_state="backlog",
            column="backlog",
            order=0,
            reporter="system",
            created_from_interview_id=UUID(interview_id)
        )
        db.add(epic)
        db.flush()  # Get Epic ID without committing
        all_created_items.append(epic)
        logger.info(f"✅ Epic created: {epic.title} (ID: {epic.id})")

        # 4. STEP 2: Decompose Epic into Stories (EM PORTUGUÊS)
        logger.info(f"📖 STEP 2: Decomposing Epic into Stories...")
        stories_suggestions = await backlog_service.decompose_epic_to_stories(
            epic_id=epic.id,
            project_id=project_id
        )

        stories = []
        for i, story_suggestion in enumerate(stories_suggestions):
            story = Task(
                project_id=project_id,
                item_type=ItemType.STORY,
                parent_id=epic.id,
                title=story_suggestion["title"],
                description=story_suggestion["description"],
                story_points=story_suggestion.get("story_points", 5),
                priority=PriorityLevel(story_suggestion.get("priority", "medium")),
                acceptance_criteria=story_suggestion.get("acceptance_criteria", []),
                interview_insights=story_suggestion.get("interview_insights", {}),
                status=TaskStatus.BACKLOG,
                workflow_state="backlog",
                column="backlog",
                order=i,
                reporter="system",
                created_from_interview_id=UUID(interview_id)
            )
            db.add(story)
            db.flush()  # Get Story ID
            stories.append(story)
            all_created_items.append(story)
            logger.info(f"✅ Story {i+1} created: {story.title} (ID: {story.id})")

        # 5. STEP 3: Decompose each Story into Tasks (EM PORTUGUÊS)
        logger.info(f"✓ STEP 3: Decomposing each Story into Tasks...")
        task_order = 0
        for story in stories:
            logger.info(f"  📝 Decomposing Story: {story.title}...")
            tasks_suggestions = await backlog_service.decompose_story_to_tasks(
                story_id=story.id,
                project_id=project_id
            )

            for i, task_suggestion in enumerate(tasks_suggestions):
                task = Task(
                    project_id=project_id,
                    item_type=ItemType.TASK,
                    parent_id=story.id,
                    title=task_suggestion["title"],
                    description=task_suggestion["description"],
                    story_points=task_suggestion.get("story_points", 2),
                    priority=PriorityLevel(task_suggestion.get("priority", "medium")),
                    acceptance_criteria=task_suggestion.get("acceptance_criteria", []),
                    status=TaskStatus.BACKLOG,
                    workflow_state="backlog",
                    column="backlog",
                    order=task_order,
                    reporter="system",
                    created_from_interview_id=UUID(interview_id)
                )
                db.add(task)
                all_created_items.append(task)
                task_order += 1
                logger.info(f"  ✅ Task {i+1} created: {task.title}")

        # 6. Commit everything
        db.commit()
        logger.info(f"🎉 Successfully generated complete Backlog hierarchy (PT-BR)!")
        logger.info(f"   Epic: 1")
        logger.info(f"   Stories: {len(stories)}")
        logger.info(f"   Tasks: {len(all_created_items) - len(stories) - 1}")
        logger.info(f"   Total items: {len(all_created_items)}")

        return all_created_items

    def _create_analysis_prompt(
        self,
        conversation: List[Dict[str, Any]],
        project: Project
    ) -> str:
        """
        Create functional prompt for interview analysis (NO SPECS)

        PROMPT #54.2 - FIX: Specs removed from task generation
        - This stage is FUNCTIONAL (WHAT needs to be done)
        - Specs are only used during EXECUTION (HOW to implement)

        Args:
            conversation: Interview conversation messages
            project: Project object with stack information

        Returns:
            Functional prompt for task generation (no technical details)
        """
        # NEW: Use PrompterFacade if enabled (but WITHOUT specs)
        if self.use_prompter and self.prompter:
            logger.info("Using PrompterFacade template-based prompt generation (functional only)")

            # PROMPT #54.2 - FIX: NO keywords, NO specs for functional generation
            # Call facade's internal method directly (already feature-flag checked)
            # Note: Both new and legacy methods are synchronous
            if self.prompter.use_templates and self.prompter.composer:
                return self.prompter._generate_task_prompt_new(
                    conversation=conversation,
                    project=project,
                    specs={},  # Empty specs - functional only
                    keywords=set()  # Empty keywords - no filtering needed
                )
            else:
                # Fallback within facade
                return self.prompter._generate_task_prompt_legacy(
                    conversation=conversation,
                    project=project,
                    specs={},  # Empty specs - functional only
                    keywords=set()  # Empty keywords - no filtering needed
                )

        # LEGACY: Fallback to hardcoded prompt (FUNCTIONAL ONLY)
        logger.info("Using legacy hardcoded prompt generation (functional only)")

        conversation_text = "\n".join([
            f"{msg.get('role', 'unknown').upper()}: {msg.get('content', '')}"
            for msg in conversation
        ])

        return f"""Analise esta entrevista sobre um projeto de software e gere tarefas estruturadas para o Kanban board.

CONVERSA DA ENTREVISTA:
{conversation_text}

TAREFA:
Analise a conversa e gere tarefas (tasks) FUNCIONAIS e detalhadas para implementar o projeto descrito.

IMPORTANTE:
- Foque no QUE precisa ser feito, não COMO implementar
- Evite detalhes técnicos específicos de frameworks
- Descreva funcionalidades e features do ponto de vista do usuário
- As tasks devem ser compreensíveis sem conhecimento técnico do stack

FORMATO DE SAÍDA (JSON):
{{
  "tasks": [
    {{
      "title": "Create Product model with inventory tracking",
      "description": "Follow Laravel model spec. Add fields: name, sku, price, quantity, low_stock_threshold. Implement method to check if low on stock. Focus on business logic, not framework structure.",
      "type": "feature",
      "priority": 1
    }},
    {{
      "title": "Implement product search with filters",
      "description": "Follow Laravel controller spec. Add search endpoint with filters for category, price range, availability. Return paginated results. Business logic only.",
      "type": "feature",
      "priority": 2
    }},
    {{
      "title": "Create products page with grid layout",
      "description": "Follow Next.js page spec. Fetch products from API, display in grid using Tailwind layout spec. Add filters sidebar. Focus on UI logic and data integration.",
      "type": "feature",
      "priority": 3
    }}
  ]
}}

DIRETRIZES PARA GERAÇÃO (TOKEN REDUCTION STRATEGY):
1. **Clareza**: Cada tarefa deve ter título curto (3-8 palavras) e descrição CONCISA
2. **Granularidade**: Tarefas pequenas e executáveis (1-4 horas de trabalho)
3. **Priorização**: Ordene por ordem lógica de implementação (campo priority: 1-10)
4. **CONCISÃO**: Descrição deve ter 50-150 palavras (NÃO 100-200!)
5. **Tipos válidos**: setup, feature, bug_fix, refactor, documentation, test, integration
6. **Actionable**: Use verbos de ação (Create, Implement, Add, Build)

TOKEN REDUCTION - CRITICAL RULES:
⚠️ DO NOT include framework boilerplate in descriptions
⚠️ DO NOT explain how frameworks work
⚠️ DO NOT reproduce spec structures
✅ DO reference specs: "Follow [framework] [spec type] spec"
✅ DO focus on business logic: "Add inventory tracking", "Implement search filters"
✅ DO keep descriptions short: 2-3 sentences maximum

EXAMPLES OF TOKEN REDUCTION:
❌ BAD (500 tokens): "Create a Laravel controller class that extends Controller. Add index method that returns paginated products with query parameters for filtering by category..."
✅ GOOD (50 tokens): "Follow Laravel controller spec. Add product search with category and price filters. Return paginated results."
→ 90% TOKEN REDUCTION!

IMPORTANTE:
- Gere entre 6 e 15 tarefas (depende da complexidade do projeto)
- Tarefas devem seguir ordem de dependência lógica
- Cada tarefa deve ser independente quando possível
- Tarefas de setup vêm primeiro (priority 1-3)
- Tarefas de features principais vêm depois (priority 4-10)
- Tarefas de integração e testes vêm por último (priority 11-15)
- Título deve ser conciso mas descritivo
- Descrição deve referenciar specs e focar em lógica única

Retorne APENAS o JSON válido, sem texto adicional antes ou depois."""

    def _parse_ai_response(self, response_text: str) -> List[Dict[str, Any]]:
        """
        Parseia a resposta da IA e extrai as tasks

        Args:
            response_text: Texto de resposta da IA

        Returns:
            Lista de dicionários com dados das tasks

        Raises:
            ValueError: Se o JSON for inválido
        """
        # Remover markdown se presente
        response_text = response_text.strip()
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]

        # Parse JSON
        try:
            data = json.loads(response_text.strip())
            tasks = data.get("tasks", [])

            # Validar estrutura básica
            for task in tasks:
                if "title" not in task and "name" not in task:
                    raise ValueError("Task missing required 'title' or 'name' field")
                if "description" not in task and "content" not in task:
                    task["description"] = task.get("name", task.get("title", ""))
                if "type" not in task:
                    task["type"] = "feature"  # Default type
                if "priority" not in task:
                    task["priority"] = 1  # Default priority

            return tasks

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse AI response as JSON: {e}")
            logger.error(f"Response text: {response_text[:500]}")
            raise ValueError(f"Invalid JSON response from AI: {str(e)}")
