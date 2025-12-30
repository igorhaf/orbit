from typing import Dict, List, Optional, Any
from sqlalchemy.orm import Session
from app.models.task import Task
from app.models.task_result import TaskResult
from app.models.project import Project
from app.models.spec import Spec
from app.models.prompt import Prompt  # PROMPT #58 - Audit logging
from app.orchestrators.registry import OrchestratorRegistry
from app.services.ai_orchestrator import AIOrchestrator
from app.api.websocket import broadcast_event
from app.services.consistency_validator import ConsistencyValidator
import anthropic
import time
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


class TaskExecutor:
    """
    Executa tasks com contexto cirúrgico e validação automática

    Features:
    - Seleção inteligente de modelo (Haiku para simple, Sonnet para complex)
    - Contexto cirúrgico (3-5k tokens vs 200k)
    - Validação automática com regeneração (até 3x)
    - Cálculo de custo real baseado em tokens
    - Suporte a execução em batch respeitando dependências
    """

    # Preços por 1M tokens (atualizar conforme necessário)
    PRICING = {
        "claude-3-haiku-20240307": {
            "input": 0.80,   # $0.80 per MTok
            "output": 4.00   # $4.00 per MTok
        },
        "claude-sonnet-4-20250514": {
            "input": 3.00,   # $3.00 per MTok
            "output": 15.00  # $15.00 per MTok
        }
    }

    def __init__(self, db: Session):
        self.db = db
        self.ai_orchestrator = AIOrchestrator(db)
        # Get Anthropic API key from environment or config
        import os
        api_key = os.getenv("ANTHROPIC_API_KEY")
        self.client = anthropic.Anthropic(api_key=api_key) if api_key else None

    def _fetch_relevant_specs(
        self,
        task: Task,
        project: Project
    ) -> Dict[str, Any]:
        """
        Fetch only relevant specs for this specific task.

        PROMPT #49 - Phase 4: Selective spec fetching for token reduction

        Unlike Phase 3 (which fetches all specs), this method is SELECTIVE:
        - Analyzes task title/description to determine needed specs
        - Only fetches specs directly relevant to this task
        - Example: Controller task → only controller spec (not all 22 Laravel specs)

        This achieves additional 20-30% token reduction during execution!

        Args:
            task: Task being executed
            project: Project with stack configuration

        Returns:
            Dictionary with relevant specs organized by category
        """
        specs = {
            'backend': [],
            'frontend': [],
            'database': [],
            'css': [],
            'ignore_patterns': set()
        }

        # Determine which spec types are needed based on task
        task_text = f"{task.title} {task.description}".lower()

        # Backend specs mapping (Laravel example)
        backend_keywords = {
            'controller': ['controller'],
            'model': ['model', 'eloquent'],
            'migration': ['migration', 'schema', 'table creation'],
            'routes_api': ['api route', 'api endpoint'],
            'routes_web': ['web route'],
            'request': ['request', 'validation', 'form request'],
            'resource': ['resource', 'api resource'],
            'middleware': ['middleware'],
            'policy': ['policy', 'authorization'],
            'job': ['job', 'queue'],
            'service': ['service'],
            'repository': ['repository'],
            'test': ['test']
        }

        # Frontend specs mapping (Next.js example)
        frontend_keywords = {
            'page': ['page', 'route'],
            'layout': ['layout'],
            'api_route': ['api route', 'api handler'],
            'server_component': ['server component'],
            'client_component': ['client component', 'use client'],
            'hook': ['hook', 'use'],
            'context': ['context', 'provider'],
            'component': ['component']
        }

        # Database specs mapping
        database_keywords = {
            'table': ['table', 'schema', 'create table'],
            'query': ['query', 'select'],
            'function': ['function', 'procedure', 'trigger'],
            'view': ['view']
        }

        # CSS specs mapping
        css_keywords = {
            'component': ['style', 'styling', 'css'],
            'layout': ['layout', 'grid', 'flex'],
            'responsive': ['responsive', 'mobile']
        }

        # Fetch backend specs
        if project.stack_backend:
            needed_types = [
                spec_type for spec_type, keywords in backend_keywords.items()
                if any(keyword in task_text for keyword in keywords)
            ]

            if needed_types:
                backend_specs = self.db.query(Spec).filter(
                    Spec.category == 'backend',
                    Spec.name == project.stack_backend,
                    Spec.spec_type.in_(needed_types),
                    Spec.is_active == True
                ).all()

                specs['backend'] = [
                    {
                        'type': s.spec_type,
                        'title': s.title,
                        'content': s.content,
                        'language': s.language
                    }
                    for s in backend_specs
                ]

                for s in backend_specs:
                    if s.ignore_patterns:
                        specs['ignore_patterns'].update(s.ignore_patterns)

        # Fetch frontend specs
        if project.stack_frontend:
            needed_types = [
                spec_type for spec_type, keywords in frontend_keywords.items()
                if any(keyword in task_text for keyword in keywords)
            ]

            if needed_types:
                frontend_specs = self.db.query(Spec).filter(
                    Spec.category == 'frontend',
                    Spec.name == project.stack_frontend,
                    Spec.spec_type.in_(needed_types),
                    Spec.is_active == True
                ).all()

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

        # Fetch database specs
        if project.stack_database:
            needed_types = [
                spec_type for spec_type, keywords in database_keywords.items()
                if any(keyword in task_text for keyword in keywords)
            ]

            if needed_types:
                db_specs = self.db.query(Spec).filter(
                    Spec.category == 'database',
                    Spec.name == project.stack_database,
                    Spec.spec_type.in_(needed_types),
                    Spec.is_active == True
                ).all()

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

        # Fetch CSS specs
        if project.stack_css:
            needed_types = [
                spec_type for spec_type, keywords in css_keywords.items()
                if any(keyword in task_text for keyword in keywords)
            ]

            if needed_types:
                css_specs = self.db.query(Spec).filter(
                    Spec.category == 'css',
                    Spec.name == project.stack_css,
                    Spec.spec_type.in_(needed_types),
                    Spec.is_active == True
                ).all()

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

        total_specs = len(specs['backend']) + len(specs['frontend']) + len(specs['database']) + len(specs['css'])
        logger.info(f"Fetched {total_specs} relevant specs for task: {task.title}")

        return specs

    def _format_specs_for_execution(
        self,
        specs: Dict[str, Any],
        task: Task,
        project: Project
    ) -> str:
        """
        Format specs into concise context for AI during task execution.

        PROMPT #49 - Phase 4: Format specs for execution context

        This is more concise than Phase 3 because:
        - Only relevant specs are included (1-3 specs vs 47)
        - Instructions are execution-focused (write code, not plan tasks)
        - Context is surgical and specific to this task

        Args:
            specs: Dictionary with relevant specs
            task: Task being executed
            project: Project with stack configuration

        Returns:
            Formatted specs context string
        """
        if not any(specs[cat] for cat in ['backend', 'frontend', 'database', 'css']):
            return ""

        context = "\n" + "="*80 + "\n"
        context += "FRAMEWORK SPECIFICATIONS FOR THIS TASK\n"
        context += "="*80 + "\n\n"

        context += f"PROJECT: {project.name}\n"
        context += f"STACK: {project.stack_backend}, {project.stack_database}, "
        context += f"{project.stack_frontend}, {project.stack_css}\n"
        context += f"TASK: {task.title}\n\n"

        # Backend specs
        if specs['backend']:
            lang = specs['backend'][0].get('language', 'Backend').upper()
            context += f"{'-'*80}\n"
            context += f"{lang} SPECIFICATIONS\n"
            context += f"{'-'*80}\n\n"

            for spec in specs['backend']:
                context += f"### {spec['title']} ({spec['type']})\n"
                context += f"{spec['content']}\n\n"

        # Frontend specs
        if specs['frontend']:
            context += f"{'-'*80}\n"
            context += f"FRONTEND SPECIFICATIONS\n"
            context += f"{'-'*80}\n\n"

            for spec in specs['frontend']:
                context += f"### {spec['title']} ({spec['type']})\n"
                context += f"{spec['content']}\n\n"

        # Database specs
        if specs['database']:
            context += f"{'-'*80}\n"
            context += f"DATABASE SPECIFICATIONS\n"
            context += f"{'-'*80}\n\n"

            for spec in specs['database']:
                context += f"### {spec['title']} ({spec['type']})\n"
                context += f"{spec['content']}\n\n"

        # CSS specs
        if specs['css']:
            context += f"{'-'*80}\n"
            context += f"CSS SPECIFICATIONS\n"
            context += f"{'-'*80}\n\n"

            for spec in specs['css']:
                context += f"### {spec['title']} ({spec['type']})\n"
                context += f"{spec['content']}\n\n"

        # Ignore patterns
        if specs['ignore_patterns']:
            context += f"{'-'*80}\n"
            context += f"FILES/DIRECTORIES TO IGNORE\n"
            context += f"{'-'*80}\n"
            context += f"{', '.join(specs['ignore_patterns'])}\n\n"

        context += "="*80 + "\n"
        context += "END OF SPECIFICATIONS\n"
        context += "="*80 + "\n\n"

        context += """CRITICAL INSTRUCTIONS FOR CODE GENERATION:

1. **Follow the specifications above EXACTLY**
   - Use the exact structure, naming conventions, and patterns shown
   - Do not deviate from framework conventions
   - Maintain consistency with the spec patterns

2. **Focus on the business logic for THIS task**
   - Implement ONLY what the task description requires
   - Do not add extra features or "nice to haves"
   - Keep code focused and minimal

3. **Code quality requirements**
   - Write clean, readable, production-ready code
   - Follow the language/framework best practices shown in specs
   - Include proper error handling where appropriate
   - Add minimal comments only where logic isn't obvious

4. **Output format**
   - Provide complete, working code
   - Include all necessary imports/dependencies
   - Ensure code can be directly used without modifications

5. **Token efficiency**
   - No verbose explanations needed
   - No tutorial-style comments
   - Just clean, working code following the spec pattern

"""

        logger.info(f"Built specs execution context: {len(context)} characters")
        return context

    async def execute_task(
        self,
        task_id: str,
        project_id: str,
        max_attempts: int = 3
    ) -> TaskResult:
        """
        Executa uma task com validação e regeneração automática

        Args:
            task_id: ID da task (UUID)
            project_id: ID do projeto (UUID)
            max_attempts: Máximo de tentativas se validação falhar

        Returns:
            TaskResult com código gerado e métricas
        """

        # Buscar task
        task = self.db.query(Task).filter(Task.id == task_id).first()
        if not task:
            raise ValueError(f"Task {task_id} not found")

        # Buscar projeto
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        # Verificar se já foi executada
        existing_result = self.db.query(TaskResult).filter(
            TaskResult.task_id == task_id
        ).first()

        if existing_result:
            logger.info(f"Task {task_id} already executed, returning existing result")
            return existing_result

        logger.info(f"🚀 Executing task {task_id}: {task.title}")

        # Pegar orquestrador (assumindo que Project tem campo 'stack')
        # Se não tiver, usar um padrão
        stack_key = getattr(project, 'stack', 'php_mysql')
        orchestrator = OrchestratorRegistry.get_orchestrator(stack_key)

        # ✨ BROADCAST: Task iniciada
        model_to_use = self._select_model(task.complexity)
        await broadcast_event(
            project_id=project_id,
            event_type="task_started",
            data={
                "task_id": str(task_id),
                "task_title": task.title,
                "task_type": task.type,
                "complexity": task.complexity,
                "model": model_to_use
            }
        )

        # Tentar executar (com retry em caso de validação falhar)
        for attempt in range(1, max_attempts + 1):
            logger.info(f"  Attempt {attempt}/{max_attempts}")

            try:
                # 1. Selecionar modelo baseado em complexidade
                model = self._select_model(task.complexity)
                logger.info(f"  Using {model}")

                # 2. Construir contexto cirúrgico
                context = await self._build_context(
                    task=task,
                    project=project,
                    orchestrator=orchestrator
                )

                logger.info(f"  Context size: {len(context.split())} words (~{len(context.split()) * 1.3:.0f} tokens)")

                # 3. Executar com Claude
                start_time = time.time()

                if not self.client:
                    raise ValueError("Anthropic API key not configured")

                response = self.client.messages.create(
                    model=model,
                    max_tokens=4000,
                    messages=[{
                        "role": "user",
                        "content": context
                    }]
                )

                execution_time = time.time() - start_time

                # Parse output
                output_code = response.content[0].text

                # 4. Calcular custo
                input_tokens = response.usage.input_tokens
                output_tokens = response.usage.output_tokens
                cost = self._calculate_cost(model, input_tokens, output_tokens)

                logger.info(f"  Generated {output_tokens} tokens in {execution_time:.2f}s (${cost:.4f})")

                # 5. Validar output
                validation_issues = orchestrator.validate_output(
                    code=output_code,
                    task=task.to_dict()
                )

                validation_passed = len(validation_issues) == 0

                if validation_passed:
                    logger.info(f"  ✅ Validation passed!")

                    # Salvar resultado
                    result = TaskResult(
                        task_id=task_id,
                        output_code=output_code,
                        file_path=task.file_path,
                        model_used=model,
                        input_tokens=input_tokens,
                        output_tokens=output_tokens,
                        cost=cost,
                        execution_time=execution_time,
                        validation_passed=True,
                        validation_issues=[],
                        attempts=attempt
                    )

                    self.db.add(result)
                    self.db.commit()
                    self.db.refresh(result)

                    # PROMPT #58 - Log successful execution to Prompt table
                    try:
                        prompt_log = Prompt(
                            project_id=project.id,
                            created_from_interview_id=None,
                            content=output_code,  # Legacy field - use response
                            type="task_execution",
                            ai_model_used=f"anthropic/{model}",
                            system_prompt=None,  # No system prompt in task execution
                            user_prompt=context,
                            response=output_code,
                            input_tokens=input_tokens,
                            output_tokens=output_tokens,
                            total_cost_usd=cost,
                            execution_time_ms=int(execution_time * 1000),
                            execution_metadata={
                                "task_id": str(task_id),
                                "task_title": task.title,
                                "task_type": task.type,
                                "complexity": task.complexity,
                                "validation_passed": True,
                                "attempts": attempt
                            },
                            status="success",
                            created_at=datetime.utcnow(),
                            updated_at=datetime.utcnow()
                        )
                        self.db.add(prompt_log)
                        self.db.commit()
                        logger.info(f"  ✅ Logged task execution to Prompt audit")
                    except Exception as prompt_error:
                        logger.error(f"  ⚠️  Failed to log prompt audit: {prompt_error}")
                        self.db.rollback()

                    # Atualizar status da task
                    task.status = "done"
                    self.db.commit()

                    # ✨ BROADCAST: Task completada
                    await broadcast_event(
                        project_id=project_id,
                        event_type="task_completed",
                        data={
                            "task_id": str(task_id),
                            "task_title": task.title,
                            "task_type": task.type,
                            "model_used": model,
                            "input_tokens": input_tokens,
                            "output_tokens": output_tokens,
                            "cost": cost,
                            "execution_time": execution_time,
                            "attempts": attempt,
                            "validation_passed": True
                        }
                    )

                    return result

                else:
                    logger.warning(f"  ⚠️  Validation failed: {validation_issues}")

                    # ✨ BROADCAST: Validação falhou
                    await broadcast_event(
                        project_id=project_id,
                        event_type="validation_failed",
                        data={
                            "task_id": str(task_id),
                            "attempt": attempt,
                            "max_attempts": max_attempts,
                            "issues": validation_issues
                        }
                    )

                    if attempt < max_attempts:
                        logger.info(f"  🔄 Retrying...")
                        continue
                    else:
                        # Última tentativa falhou, salvar mesmo assim
                        logger.error(f"  ❌ Max attempts reached, saving with issues")

                        result = TaskResult(
                            task_id=task_id,
                            output_code=output_code,
                            file_path=task.file_path,
                            model_used=model,
                            input_tokens=input_tokens,
                            output_tokens=output_tokens,
                            cost=cost,
                            execution_time=execution_time,
                            validation_passed=False,
                            validation_issues=validation_issues,
                            attempts=attempt
                        )

                        self.db.add(result)
                        self.db.commit()
                        self.db.refresh(result)

                        # PROMPT #58 - Log failed validation to Prompt table
                        try:
                            prompt_log = Prompt(
                                project_id=project.id,
                                created_from_interview_id=None,
                                content=output_code,  # Legacy field - use response
                                type="task_execution",
                                ai_model_used=f"anthropic/{model}",
                                system_prompt=None,
                                user_prompt=context,
                                response=output_code,
                                input_tokens=input_tokens,
                                output_tokens=output_tokens,
                                total_cost_usd=cost,
                                execution_time_ms=int(execution_time * 1000),
                                execution_metadata={
                                    "task_id": str(task_id),
                                    "task_title": task.title,
                                    "task_type": task.type,
                                    "complexity": task.complexity,
                                    "validation_passed": False,
                                    "validation_issues": validation_issues,
                                    "attempts": attempt
                                },
                                status="error",
                                error_message=f"Validation failed after {attempt} attempts: {validation_issues}",
                                created_at=datetime.utcnow(),
                                updated_at=datetime.utcnow()
                            )
                            self.db.add(prompt_log)
                            self.db.commit()
                            logger.info(f"  ✅ Logged failed validation to Prompt audit")
                        except Exception as prompt_error:
                            logger.error(f"  ⚠️  Failed to log prompt audit: {prompt_error}")
                            self.db.rollback()

                        task.status = "review"  # Marcar para revisão
                        self.db.commit()

                        # ✨ BROADCAST: Task falhou
                        await broadcast_event(
                            project_id=project_id,
                            event_type="task_failed",
                            data={
                                "task_id": str(task_id),
                                "task_title": task.title,
                                "attempts": attempt,
                                "issues": validation_issues,
                                "cost": cost
                            }
                        )

                        return result

            except Exception as e:
                logger.error(f"  ❌ Error on attempt {attempt}: {str(e)}")

                if attempt >= max_attempts:
                    raise

        raise Exception("Failed to execute task after max attempts")

    async def execute_batch(
        self,
        task_ids: List[str],
        project_id: str
    ) -> List[TaskResult]:
        """
        Executa múltiplas tasks respeitando dependências

        Args:
            task_ids: Lista de IDs de tasks (UUIDs)
            project_id: ID do projeto (UUID)

        Returns:
            Lista de TaskResults
        """

        logger.info(f"🚀 Executing batch of {len(task_ids)} tasks")

        results = []
        total_tasks = len(task_ids)
        completed = 0
        total_cost = 0.0

        # Ordenar tasks por dependências (tasks sem deps primeiro)
        tasks = self.db.query(Task).filter(Task.id.in_(task_ids)).all()
        ordered_tasks = self._topological_sort(tasks)

        # ✨ BROADCAST: Batch iniciado
        await broadcast_event(
            project_id=project_id,
            event_type="batch_started",
            data={
                "total_tasks": total_tasks,
                "task_ids": task_ids
            }
        )

        for task in ordered_tasks:
            try:
                result = await self.execute_task(str(task.id), project_id)
                results.append(result)
                completed += 1
                total_cost += result.cost

                # ✨ BROADCAST: Progresso do batch
                await broadcast_event(
                    project_id=project_id,
                    event_type="batch_progress",
                    data={
                        "completed": completed,
                        "total": total_tasks,
                        "percentage": round((completed / total_tasks) * 100, 1),
                        "total_cost": round(total_cost, 4)
                    }
                )

                logger.info(f"  ✅ Task {task.id} completed ({completed}/{total_tasks})")
            except Exception as e:
                logger.error(f"  ❌ Task {task.id} failed: {str(e)}")
                # Continuar com próximas tasks

        # ✨ BROADCAST: Batch completado
        await broadcast_event(
            project_id=project_id,
            event_type="batch_completed",
            data={
                "total_tasks": total_tasks,
                "completed": len(results),
                "failed": total_tasks - len(results),
                "total_cost": round(total_cost, 4)
            }
        )

        logger.info(f"✅ Batch execution complete: {len(results)}/{len(task_ids)} succeeded")

        # ✨ NOVO: Validar consistência após batch completo
        if results:
            logger.info("🔍 Running consistency validation...")

            validator = ConsistencyValidator(self.db)

            result_ids = [str(r.id) for r in results]
            validation_result = await validator.validate_batch(
                project_id=project_id,
                task_result_ids=result_ids
            )

            # Broadcast resultado da validação
            await broadcast_event(
                project_id=project_id,
                event_type="consistency_validated",
                data={
                    'total_issues': validation_result['total_issues'],
                    'critical': validation_result['critical'],
                    'warnings': validation_result['warnings'],
                    'auto_fixed': validation_result['auto_fixed']
                }
            )

            # Se há issues críticos, logar
            if validation_result['critical'] > 0:
                logger.warning(
                    f"⚠️  {validation_result['critical']} critical consistency issues found!"
                )
            elif validation_result['total_issues'] == 0:
                logger.info("✅ No consistency issues found!")

        return results

    def _select_model(self, complexity: int) -> str:
        """
        Seleciona modelo baseado em complexidade da task

        Complexity 1-2: Haiku (mais barato)
        Complexity 3-5: Sonnet (mais capaz)
        """

        if complexity <= 2:
            return "claude-3-haiku-20240307"
        else:
            return "claude-sonnet-4-20250514"

    async def _build_context(
        self,
        task: Task,
        project: Project,
        orchestrator
    ) -> str:
        """
        Constrói contexto cirúrgico usando orquestrador

        PROMPT #49 - Phase 4: Enhanced with specs integration

        Inclui:
        - Framework specs (NEW - Phase 4!)
        - Spec do projeto
        - Outputs de tasks dependentes
        - Patterns da stack
        - Conventions
        """

        # PHASE 4: Fetch and format relevant specs for this task
        specs = self._fetch_relevant_specs(task, project)
        specs_context = self._format_specs_for_execution(specs, task, project)

        # Buscar spec do projeto (assumindo que Project tem campo 'spec')
        spec = getattr(project, 'spec', {})

        # Buscar outputs de tasks dependentes
        previous_outputs = {}

        if task.depends_on:
            for dep_id in task.depends_on:
                dep_result = self.db.query(TaskResult).filter(
                    TaskResult.task_id == dep_id
                ).first()

                if dep_result:
                    previous_outputs[str(dep_id)] = dep_result.output_code

        # Usar orquestrador para montar contexto
        orchestrator_context = orchestrator.build_task_context(
            task=task.to_dict(),
            spec=spec,
            previous_outputs=previous_outputs
        )

        # PHASE 4: Combine specs context with orchestrator context
        # Specs go FIRST so AI sees framework patterns before task details
        if specs_context:
            context = specs_context + "\n" + orchestrator_context
            logger.info("✨ Phase 4: Specs integrated into execution context")
        else:
            context = orchestrator_context
            logger.info("No specs found for task, using orchestrator context only")

        return context

    def _calculate_cost(
        self,
        model: str,
        input_tokens: int,
        output_tokens: int
    ) -> float:
        """
        Calcula custo real baseado em tokens
        """

        if model not in self.PRICING:
            return 0.0

        pricing = self.PRICING[model]

        cost = (input_tokens / 1_000_000 * pricing["input"]) + \
               (output_tokens / 1_000_000 * pricing["output"])

        return round(cost, 6)

    def _topological_sort(self, tasks: List[Task]) -> List[Task]:
        """
        Ordena tasks por dependências (topological sort)
        Tasks sem dependências vêm primeiro
        """

        sorted_tasks = []
        remaining = list(tasks)

        # Máximo de iterações para evitar loop infinito
        max_iterations = len(tasks) * 2

        for _ in range(max_iterations):
            if not remaining:
                break

            # Encontrar task sem dependências não resolvidas
            for task in remaining:
                deps = task.depends_on if task.depends_on else []

                if not deps:
                    sorted_tasks.append(task)
                    remaining.remove(task)
                    break

                # Verificar se todas deps já foram resolvidas
                all_deps_resolved = all(
                    any(str(t.id) == str(dep_id) for t in sorted_tasks)
                    for dep_id in deps
                )

                if all_deps_resolved:
                    sorted_tasks.append(task)
                    remaining.remove(task)
                    break
            else:
                # Nenhuma task pode ser resolvida (ciclo?)
                logger.warning("Possible circular dependency, adding remaining tasks anyway")
                sorted_tasks.extend(remaining)
                break

        return sorted_tasks
