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
from app.models.task import Task, TaskStatus
from app.models.project import Project
from app.models.spec import Spec
from app.services.ai_orchestrator import AIOrchestrator
from app.services.spec_loader import get_spec_loader

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
        Fetch all relevant specs for project's stack.
        Returns organized specs by category and type.

        PROMPT #48 - Phase 3: Token Reduction via Specs Integration
        PROMPT #61 - Week 2: Migrated to use SpecLoader instead of database queries
        """
        specs = {
            'backend': [],
            'frontend': [],
            'database': [],
            'css': [],
            'ignore_patterns': set()
        }

        # Get SpecLoader instance
        spec_loader = get_spec_loader()

        # Fetch backend specs
        if project.stack_backend:
            backend_specs = spec_loader.get_specs_by_framework(
                'backend',
                project.stack_backend,
                only_active=True
            )

            specs['backend'] = [
                {
                    'type': s.spec_type,
                    'title': s.title,
                    'content': s.content,
                    'language': s.language
                }
                for s in backend_specs
            ]

            # Collect ignore patterns
            for s in backend_specs:
                if s.ignore_patterns:
                    specs['ignore_patterns'].update(s.ignore_patterns)

        # Fetch database specs
        if project.stack_database:
            db_specs = spec_loader.get_specs_by_framework(
                'database',
                project.stack_database,
                only_active=True
            )

            specs['database'] = [
                {
                    'type': s.spec_type,
                    'title': s.title,
                    'content': s.content
                }
                for s in db_specs
            ]

            for s in db_specs:
                if s.ignore_patterns:
                    specs['ignore_patterns'].update(s.ignore_patterns)

        # Fetch frontend specs
        if project.stack_frontend:
            frontend_specs = spec_loader.get_specs_by_framework(
                'frontend',
                project.stack_frontend,
                only_active=True
            )

            specs['frontend'] = [
                {
                    'type': s.spec_type,
                    'title': s.title,
                    'content': s.content,
                    'language': s.language
                }
                for s in frontend_specs
            ]

            for s in frontend_specs:
                if s.ignore_patterns:
                    specs['ignore_patterns'].update(s.ignore_patterns)

        # Fetch CSS specs
        if project.stack_css:
            css_specs = spec_loader.get_specs_by_framework(
                'css',
                project.stack_css,
                only_active=True
            )

            specs['css'] = [
                {
                    'type': s.spec_type,
                    'title': s.title,
                    'content': s.content
                }
                for s in css_specs
            ]

            for s in css_specs:
                if s.ignore_patterns:
                    specs['ignore_patterns'].update(s.ignore_patterns)

        # Convert ignore patterns set to list
        specs['ignore_patterns'] = list(specs['ignore_patterns'])

        logger.info(f"Fetched specs from JSON files: {len(specs['backend'])} backend, {len(specs['frontend'])} frontend, "
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
        Analisa a entrevista e gera tasks estruturadas para o Kanban board

        Args:
            interview_id: UUID da entrevista
            db: Sessão do banco de dados

        Returns:
            Lista de tasks criadas

        Raises:
            ValueError: Se a entrevista não for encontrada
            Exception: Se houver erro na geração
        """
        logger.info(f"Starting task generation for interview {interview_id}")

        # 1. Buscar interview
        interview = db.query(Interview).filter(
            Interview.id == UUID(interview_id)
        ).first()

        if not interview:
            raise ValueError(f"Interview {interview_id} not found")

        if not interview.conversation_data or len(interview.conversation_data) == 0:
            raise ValueError("Interview has no conversation data")

        # 2. Buscar project (PROMPT #48 - Phase 3)
        project = db.query(Project).filter(
            Project.id == interview.project_id
        ).first()

        if not project:
            raise ValueError(f"Project {interview.project_id} not found")

        logger.info(f"Project stack: {project.stack_backend}, {project.stack_database}, "
                   f"{project.stack_frontend}, {project.stack_css}")

        # 3. Fetch specs for project stack (PROMPT #48 - Phase 3: TOKEN REDUCTION!)
        specs = self._fetch_stack_specs(project, db)

        # 4. Extrair conversa
        conversation = interview.conversation_data
        logger.info(f"Processing {len(conversation)} messages from interview")

        # 5. Criar prompt para análise with specs context (PROMPT #48 - Phase 3)
        analysis_prompt = self._create_analysis_prompt(conversation, project, specs)

        # 4. Chamar AI Orchestrator para analisar
        logger.info("Calling AI Orchestrator for prompt generation...")
        response = await self.orchestrator.execute(
            usage_type="prompt_generation",
            messages=[{
                "role": "user",
                "content": analysis_prompt
            }],
            max_tokens=4000,
            # PROMPT #58 - Add context for prompt logging
            project_id=interview.project_id,
            interview_id=interview.id
        )

        logger.info(f"Received response from {response['provider']} ({response['model']})")

        # 5. Parsear resposta e criar tasks
        tasks_data = self._parse_ai_response(response['content'])
        logger.info(f"Parsed {len(tasks_data)} tasks from AI response")

        # 6. Criar tasks no banco
        created_tasks = []
        for i, task_data in enumerate(tasks_data):
            task = Task(
                project_id=interview.project_id,
                title=task_data.get("name", task_data.get("title", f"Task {i+1}")),
                description=task_data.get("content", task_data.get("description", "")),
                status=TaskStatus.BACKLOG,
                column="backlog",
                order=i,
                type=task_data.get("type", "feature"),
                complexity=task_data.get("priority", 1),
                created_from_interview_id=UUID(interview_id)
            )
            db.add(task)
            created_tasks.append(task)
            logger.info(f"Created task {i+1}: {task.title}")

        db.commit()
        logger.info(f"Successfully generated and saved {len(created_tasks)} tasks")

        return created_tasks

    def _create_analysis_prompt(
        self,
        conversation: List[Dict[str, Any]],
        project: Project,
        specs: Dict[str, Any]
    ) -> str:
        """
        Cria prompt para Claude analisar a entrevista WITH SPECS CONTEXT
        PROMPT #48 - Phase 3: This is where token reduction happens!
        Phase 2 Integration: Uses PrompterFacade if enabled, else legacy

        Args:
            conversation: Lista de mensagens da conversa
            project: Project object with stack information
            specs: Dictionary with framework specs

        Returns:
            Prompt formatado para análise com specs context
        """
        # NEW: Use PrompterFacade if enabled
        if self.use_prompter and self.prompter:
            logger.info("Using PrompterFacade template-based prompt generation")
            # Call facade's internal method directly (already feature-flag checked)
            # Note: Both new and legacy methods are synchronous
            if self.prompter.use_templates and self.prompter.composer:
                return self.prompter._generate_task_prompt_new(
                    conversation=conversation,
                    project=project,
                    specs=specs
                )
            else:
                # Fallback within facade
                return self.prompter._generate_task_prompt_legacy(
                    conversation=conversation,
                    project=project,
                    specs=specs
                )

        # LEGACY: Fallback to hardcoded prompt
        logger.info("Using legacy hardcoded prompt generation")

        conversation_text = "\n".join([
            f"{msg.get('role', 'unknown').upper()}: {msg.get('content', '')}"
            for msg in conversation
        ])

        # PROMPT #54 - Token Optimization: Extract keywords for selective spec loading
        keywords = self._extract_keywords_from_conversation(conversation)

        # Build specs context with keyword filtering (70-80% token reduction!)
        specs_context = self._build_specs_context(specs, project, keywords)

        return f"""Analise esta entrevista sobre um projeto de software e gere tarefas estruturadas para o Kanban board.

CONVERSA DA ENTREVISTA:
{conversation_text}

{specs_context}

TAREFA:
Analise a conversa e gere tarefas (tasks) profissionais e detalhadas para implementar o projeto descrito.
IMPORTANTE: As especificações de framework fornecidas acima são PRÉ-DEFINIDAS.
NÃO reproduza código boilerplate. Foque apenas em lógica de negócio e recursos únicos do projeto.

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
