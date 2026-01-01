"""
Prompter Facade

Backward-compatible interface for gradual migration to Prompter architecture.
Uses feature flags to enable/disable new functionality while maintaining compatibility.
"""

import os
from pathlib import Path
from typing import Dict, Any, Optional, List
from sqlalchemy.orm import Session

from app.prompter.core.composer import PromptComposer
from app.prompter.orchestration import PromptExecutor, ExecutionContext, apply_strategy
from app.prompter.optimization import CacheService, ModelSelector
from app.prompter.observability import get_ab_testing_service
from app.models.project import Project
from app.services.ai_orchestrator import AIOrchestrator


class PrompterFacade:
    """
    Facade for Prompter architecture with backward compatibility.

    Features enabled via environment variables:
    - PROMPTER_USE_TEMPLATES: Use template system (default: false)
    - PROMPTER_USE_STRUCTURED_TEMPLATES: Use v2 structured templates (default: false)
    - PROMPTER_USE_CACHE: Use caching layer (default: false)
    - PROMPTER_USE_BATCHING: Use request batching (default: false)
    - PROMPTER_USE_TRACING: Use distributed tracing (default: false)
    """

    def __init__(self, db: Session):
        """
        Initialize facade

        Args:
            db: Database session
        """
        self.db = db

        # Feature flags
        self.use_templates = os.getenv("PROMPTER_USE_TEMPLATES", "false").lower() == "true"
        self.use_cache = os.getenv("PROMPTER_USE_CACHE", "false").lower() == "true"
        self.use_batching = os.getenv("PROMPTER_USE_BATCHING", "false").lower() == "true"
        self.use_tracing = os.getenv("PROMPTER_USE_TRACING", "false").lower() == "true"
        self.use_structured_templates = os.getenv("PROMPTER_USE_STRUCTURED_TEMPLATES", "false").lower() == "true"

        # Initialize composer if templates enabled
        if self.use_templates:
            template_dir = Path(__file__).parent / "templates" / "base"
            self.composer = PromptComposer(template_dir, db)
        else:
            self.composer = None

        # Initialize cache service if enabled (Phase 2/3)
        if self.use_cache:
            # Initialize Redis client
            redis_client = None
            redis_host = os.getenv("REDIS_HOST")
            if redis_host:
                try:
                    import redis
                    redis_client = redis.Redis(
                        host=redis_host,
                        port=int(os.getenv("REDIS_PORT", 6379)),
                        db=0,
                        decode_responses=True,
                        socket_connect_timeout=5,
                        socket_timeout=5,
                    )
                    # Test connection
                    redis_client.ping()
                    print(f"✅ Redis connected: {redis_host}:{os.getenv('REDIS_PORT', 6379)}")
                except Exception as e:
                    print(f"⚠️  Redis connection failed: {e}. Using in-memory cache.")
                    redis_client = None

            # Initialize cache service
            self.cache = CacheService(
                redis_client=redis_client,
                enable_semantic=True if redis_client else False,  # Only enable if Redis available
                similarity_threshold=0.95
            )

            if redis_client and self.cache.enable_semantic:
                print("✅ Semantic caching (L2) enabled")
        else:
            self.cache = None

        # Initialize batch service if enabled (Phase 3)
        if self.use_batching:
            from app.prompter.optimization import BatchService
            self.batch = BatchService(
                batch_size=10,
                batch_window_ms=100,
                max_queue_size=1000
            )
            print("✅ Request batching enabled (batch_size=10, window=100ms)")
        else:
            self.batch = None

        # Initialize prompt executor if orchestration enabled (Phase 3)
        # For now, always initialize (will be controlled by feature flag later)
        self.executor = PromptExecutor(
            db=db,
            ai_orchestrator=AIOrchestrator(db),
            cache_service=self.cache,
            batch_service=self.batch,
            enable_cache=self.use_cache,
            enable_retry=True
        ) if (self.use_cache or self.use_batching) else None

        # Initialize model selector (Phase 3)
        self.model_selector = ModelSelector()

        # Initialize A/B testing service (Phase 7)
        self.ab_testing = get_ab_testing_service()

    def _get_template_version(
        self,
        template_name: str,
        project_id: Optional[str] = None,
        experiment_id: Optional[str] = None
    ) -> int:
        """
        Determine template version to use

        Priority:
        1. A/B experiment assignment (if active)
        2. Feature flag (PROMPTER_USE_STRUCTURED_TEMPLATES)
        3. Default (v1)

        Args:
            template_name: Name of template
            project_id: Project ID for A/B assignment
            experiment_id: Optional specific experiment ID to check

        Returns:
            Template version number
        """
        # Check A/B experiment first (if project_id provided)
        if project_id and experiment_id:
            variant = self.ab_testing.get_variant(
                experiment_id=experiment_id,
                assignment_key=str(project_id)
            )

            if variant and variant.template_version:
                return variant.template_version

        # Fallback to feature flag
        if self.use_structured_templates:
            return 2  # v2 structured templates
        else:
            return 1  # v1 legacy templates

    def generate_task_prompt(
        self,
        conversation: List[Dict],
        project: Project,
        specs: Dict[str, Any]
    ) -> str:
        """
        Generate task generation prompt (backward compatible with prompt_generator.py)

        Note: This method is synchronous (no async) as it doesn't perform I/O

        Args:
            conversation: List of conversation messages
            project: Project model instance
            specs: Framework specifications from database

        Returns:
            Rendered prompt string
        """

        if self.use_templates and self.composer:
            # NEW: Use template system
            return self._generate_task_prompt_new(conversation, project, specs)
        else:
            # OLD: Fallback to legacy method
            return self._generate_task_prompt_legacy(conversation, project, specs)

    def _generate_task_prompt_new(
        self,
        conversation: List[Dict],
        project: Project,
        specs: Dict[str, Any]
    ) -> str:
        """Generate prompt using new template system"""

        # Format conversation
        conversation_text = self._format_conversation(conversation)

        # Format specs context (if available)
        specs_context = self._format_specs_context(specs) if specs else None

        # Render template
        variables = {
            "conversation_text": conversation_text,
            "project_name": project.name,
            "project_stack": {
                "backend": project.stack_backend,
                "database": project.stack_database,
                "frontend": project.stack_frontend,
                "css": project.stack_css
            },
            "specs_context": specs_context,
            "max_tasks": 15,
            "min_tasks": 6
        }

        # Use structured templates (v2) if flag enabled, otherwise use v1
        if self.use_structured_templates:
            # render_structured() will automatically detect if template is v2 (structured)
            # or v1 (legacy) and render accordingly
            return self.composer.render_structured("task_generation", variables, version=2)
        else:
            # Use v1 template
            return self.composer.render("task_generation", variables)

    def _generate_task_prompt_legacy(
        self,
        conversation: List[Dict],
        project: Project,
        specs: Dict[str, Any]
    ) -> str:
        """
        Legacy prompt generation (hardcoded)
        Maintains current behavior for backward compatibility
        """

        conversation_text = self._format_conversation(conversation)
        specs_context = self._format_specs_context(specs) if specs else ""

        prompt = f"""Analise esta entrevista sobre um projeto de software e gere tarefas estruturadas.

PROJETO: {project.name}
STACK TÉCNICO:
- Backend: {project.stack_backend}
- Database: {project.stack_database}
- Frontend: {project.stack_frontend}
- CSS: {project.stack_css}

CONVERSA:
{conversation_text}

{specs_context}

FORMATO DE SAÍDA (JSON VÁLIDO):
{{
  "tasks": [
    {{
      "title": "Brief task title (5-10 words)",
      "description": "Task description (50-150 words)",
      "type": "setup|feature|bug_fix|refactor|test|docs|deployment",
      "priority": 1-5,
      "complexity": 1-5,
      "depends_on": []
    }}
  ]
}}

REGRAS:
- Gere entre 6 e 15 tarefas
- Priorize setup primeiro, depois features, depois testes/docs
- Use depends_on para dependências

Gere as tasks em JSON válido agora:
"""
        return prompt

    def generate_interview_question(
        self,
        project: Project,
        conversation_history: List[Dict],
        question_number: Optional[int] = None
    ) -> str:
        """
        Generate interview question (backward compatible)

        Note: This method is synchronous (no async) as it doesn't perform I/O

        Args:
            project: Project model instance
            conversation_history: Previous conversation messages
            question_number: Current question number

        Returns:
            Rendered question prompt
        """

        if self.use_templates and self.composer:
            # NEW: Use template system
            variables = {
                "project_name": project.name,
                "project_description": project.description or "",
                "project_stack": {
                    "backend": project.stack_backend,
                    "database": project.stack_database,
                    "frontend": project.stack_frontend,
                    "css": project.stack_css
                },
                "conversation_history": self._format_conversation(conversation_history),
                "current_question_number": question_number
            }

            # Use structured templates (v2) if flag enabled, otherwise use v1
            if self.use_structured_templates:
                return self.composer.render_structured("interview", variables, version=2)
            else:
                return self.composer.render("interview", variables)
        else:
            # OLD: Fallback to legacy
            return self._generate_interview_question_legacy(
                project, conversation_history, question_number
            )

    def _generate_interview_question_legacy(
        self,
        project: Project,
        conversation_history: List[Dict],
        question_number: Optional[int] = None
    ) -> str:
        """Legacy interview question generation"""

        history_text = self._format_conversation(conversation_history)
        question_num_text = f"Pergunta #{question_number}" if question_number else "Próxima pergunta"

        prompt = f"""
PROJETO: {project.name}
DESCRIÇÃO: {project.description or ''}

STACK: {project.stack_backend}/{project.stack_database}/{project.stack_frontend}

HISTÓRICO:
{history_text}

Você é um analista de requisitos. Faça a {question_num_text} sobre:
- Funcionalidades principais
- Regras de negócio
- Integrações
- Tipos de usuários
- Fluxos críticos

FORMATO:
❓ Pergunta [número]: [pergunta]

OPÇÕES:
□ Opção 1
□ Opção 2
□ Opção 3

☑️ ou ◉ [indicar tipo de seleção]

Gere a pergunta agora:
"""
        return prompt

    def _format_conversation(self, conversation: List[Dict]) -> str:
        """Format conversation messages into text"""
        if not conversation:
            return "[No conversation yet]"

        lines = []
        for msg in conversation:
            role = msg.get('role', 'unknown').upper()
            content = msg.get('content', '')
            timestamp = msg.get('timestamp', '')

            lines.append(f"{role} ({timestamp}):")
            lines.append(content)
            lines.append("")  # Empty line

        return "\n".join(lines)

    def _format_specs_context(self, specs: Dict[str, Any]) -> str:
        """
        Format specs context for prompt

        This is a simplified version. The full implementation uses
        the spec_formatter component.
        """
        if not specs:
            return ""

        lines = [
            "═══════════════════════════════════════════════════",
            "FRAMEWORK SPECIFICATIONS (PRE-DEFINED)",
            "═══════════════════════════════════════════════════",
            ""
        ]

        for category, spec_list in specs.items():
            if spec_list:
                lines.append(f"\n{category.upper()} SPECIFICATIONS:")
                lines.append("───────────────────────────────────────────────────")

                for spec in spec_list:
                    title = spec.get('title', 'Untitled')
                    content = spec.get('content', '')
                    spec_type = spec.get('spec_type', 'general')

                    lines.append(f"\n### {title} ({spec_type})")
                    lines.append(content)

        lines.append("\nCRITICAL: Reference these specs instead of reproducing them!")

        return "\n".join(lines)

    async def execute_prompt(
        self,
        prompt: str,
        usage_type: str = "general",
        system_prompt: Optional[str] = None,
        max_tokens: int = 4000,
        temperature: float = 0.7,
        strategy: str = "default",
        **kwargs
    ) -> Dict[str, Any]:
        """
        Execute prompt with full orchestration (cache, retry, validation)

        This is the high-level interface that uses:
        - Template rendering (if enabled)
        - Cache service (if enabled)
        - Prompt executor with retry and validation
        - Model selection

        Args:
            prompt: Prompt text
            usage_type: Type of usage (task_generation, interview, etc.)
            system_prompt: System prompt (optional)
            max_tokens: Maximum tokens
            temperature: Temperature (0-2)
            strategy: Execution strategy (default, fast, quality, cost)
            **kwargs: Additional context (project_id, interview_id, etc.)

        Returns:
            Dict with response, cost, tokens, quality_score, etc.
        """
        # Check if executor is available
        if not self.executor:
            raise RuntimeError(
                "Executor not initialized. Enable PROMPTER_USE_CACHE or "
                "PROMPTER_USE_BATCHING to use execute_prompt()"
            )

        # Create execution context
        context = ExecutionContext(
            prompt=prompt,
            system_prompt=system_prompt,
            usage_type=usage_type,
            max_tokens=max_tokens,
            temperature=temperature,
            **{k: v for k, v in kwargs.items() if k in [
                'project_id', 'interview_id', 'task_id',
                'template_name', 'template_version', 'metadata'
            ]}
        )

        # Apply execution strategy
        context = apply_strategy(context, strategy)

        # Execute with full orchestration
        result = await self.executor.execute(context)

        # Return formatted result
        return {
            "response": result.response,
            "success": result.is_success,
            "status": result.status,
            "cache_hit": result.cache_hit,
            "cache_type": result.cache_type,
            "model": result.model,
            "input_tokens": result.input_tokens,
            "output_tokens": result.output_tokens,
            "total_tokens": result.total_tokens,
            "cost": result.cost,
            "quality_score": result.quality_score,
            "validation_passed": result.validation_passed,
            "duration_seconds": result.duration_seconds,
            "attempt": result.attempt,
            "error": result.error_message if result.is_failed else None,
        }

    def get_status(self) -> Dict[str, Any]:
        """Get feature flag status and performance metrics for monitoring/debugging"""
        status = {
            "feature_flags": {
                "use_templates": self.use_templates,
                "use_cache": self.use_cache,
                "use_batching": self.use_batching,
                "use_tracing": self.use_tracing,
            },
            "components": {
                "composer_loaded": self.composer is not None,
                "executor_loaded": self.executor is not None,
                "cache_loaded": self.cache is not None,
                "model_selector_loaded": self.model_selector is not None,
            },
            "paths": {
                "template_dir": str(Path(__file__).parent / "templates") if self.composer else None
            }
        }

        # Add cache statistics if available
        if self.cache:
            status["cache_stats"] = self.cache.get_stats()

        # Add available models
        if self.model_selector:
            status["available_models"] = self.model_selector.list_models()

        return status
