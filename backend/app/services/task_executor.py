from typing import Dict, List, Optional
from sqlalchemy.orm import Session
from app.models.task import Task
from app.models.task_result import TaskResult
from app.models.project import Project
from app.orchestrators.registry import OrchestratorRegistry
from app.services.ai_orchestrator import AIOrchestrator
from app.api.websocket import broadcast_event
from app.services.consistency_validator import ConsistencyValidator
import anthropic
import time
import logging

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

        Inclui:
        - Spec do projeto
        - Outputs de tasks dependentes
        - Patterns da stack
        - Conventions
        """

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
        context = orchestrator.build_task_context(
            task=task.to_dict(),
            spec=spec,
            previous_outputs=previous_outputs
        )

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
