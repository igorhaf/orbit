"""
Core Task Executor
PROMPT #70 - Refactor task_executor.py

This module contains the core task execution logic:
- Model selection based on complexity
- Task execution with validation and retry
- Cost calculation
- Audit logging to Prompt table

Features:
- Intelligent model selection (Haiku vs Sonnet)
- Automatic validation and regeneration (up to 3 attempts)
- Real-time cost calculation
- WebSocket event broadcasting
"""

from typing import Dict, List, Optional
from sqlalchemy.orm import Session
from app.models.task import Task
from app.models.task_result import TaskResult
from app.models.project import Project
from app.models.prompt import Prompt
from app.orchestrators.registry import OrchestratorRegistry
from app.services.ai_orchestrator import AIOrchestrator
from app.api.websocket import broadcast_event
from app.services.task_execution.project_spec_fetcher import ProjectSpecFetcher
from app.services.task_execution.context_builder import ContextBuilder
from app.services.task_execution.budget_manager import BudgetManager
from app.services.task_execution.batch_executor import BatchExecutor
# PROMPT #103 - External prompts support
from app.prompts import get_prompt_service
import anthropic
import time
import os
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


class TaskExecutor:
    """
    Executes tasks with surgical context and automatic validation.

    Features:
    - Intelligent model selection (Haiku for simple, Sonnet for complex)
    - Surgical context (3-5k tokens vs 200k)
    - Automatic validation with regeneration (up to 3 attempts)
    - Real-time cost calculation based on tokens
    - Batch execution respecting dependencies
    """

    # Pricing per 1M tokens (update as needed)
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

        # Initialize helper modules
        self.spec_fetcher = ProjectSpecFetcher(db)  # Project-specific specs from database
        self.context_builder = ContextBuilder(db)
        self.budget_manager = BudgetManager(db)
        self.batch_executor = BatchExecutor(db)

        # Get Anthropic API key from environment or config
        api_key = os.getenv("ANTHROPIC_API_KEY")
        self.client = anthropic.Anthropic(api_key=api_key) if api_key else None

    async def execute_task(
        self,
        task_id: str,
        project_id: str,
        max_attempts: int = 3
    ) -> TaskResult:
        """
        Execute a task with validation and automatic regeneration.

        Args:
            task_id: Task ID (UUID)
            project_id: Project ID (UUID)
            max_attempts: Maximum attempts if validation fails

        Returns:
            TaskResult with generated code and metrics
        """
        # Fetch task
        task = self.db.query(Task).filter(Task.id == task_id).first()
        if not task:
            raise ValueError(f"Task {task_id} not found")

        # Fetch project
        project = self.db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        # Check if already executed
        existing_result = self.db.query(TaskResult).filter(
            TaskResult.task_id == task_id
        ).first()

        if existing_result:
            logger.info(f"Task {task_id} already executed, returning existing result")
            return existing_result

        logger.info(f"🚀 Executing task {task_id}: {task.title}")

        # Get orchestrator
        stack_key = getattr(project, 'stack', 'php_mysql')
        orchestrator = OrchestratorRegistry.get_orchestrator(stack_key)

        # Broadcast: Task started
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

        # Try executing (with retry if validation fails)
        for attempt in range(1, max_attempts + 1):
            logger.info(f"  Attempt {attempt}/{max_attempts}")

            try:
                # 1. Select model based on complexity
                model = self._select_model(task.complexity)
                logger.info(f"  Using {model}")

                # 2. Build surgical context
                context = await self._build_context(
                    task=task,
                    project=project,
                    orchestrator=orchestrator
                )

                logger.info(f"  Context size: {len(context.split())} words (~{len(context.split()) * 1.3:.0f} tokens)")

                # 3. Execute with Claude
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

                # 4. Calculate cost
                input_tokens = response.usage.input_tokens
                output_tokens = response.usage.output_tokens
                cost = self._calculate_cost(model, input_tokens, output_tokens)

                logger.info(f"  Generated {output_tokens} tokens in {execution_time:.2f}s (${cost:.4f})")

                # 5. Validate output
                validation_issues = orchestrator.validate_output(
                    code=output_code,
                    task=task.to_dict()
                )

                validation_passed = len(validation_issues) == 0

                if validation_passed:
                    # Save result and return
                    result = await self._save_successful_result(
                        task=task,
                        task_id=task_id,
                        project=project,
                        project_id=project_id,
                        output_code=output_code,
                        model=model,
                        input_tokens=input_tokens,
                        output_tokens=output_tokens,
                        cost=cost,
                        execution_time=execution_time,
                        attempt=attempt,
                        context=context
                    )
                    return result

                else:
                    # Validation failed
                    logger.warning(f"  ⚠️  Validation failed: {validation_issues}")

                    # Broadcast: Validation failed
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
                        # Max attempts reached, save with issues
                        result = await self._save_failed_result(
                            task=task,
                            task_id=task_id,
                            project=project,
                            project_id=project_id,
                            output_code=output_code,
                            model=model,
                            input_tokens=input_tokens,
                            output_tokens=output_tokens,
                            cost=cost,
                            execution_time=execution_time,
                            attempt=attempt,
                            validation_issues=validation_issues,
                            context=context
                        )
                        return result

            except Exception as e:
                logger.error(f"  ❌ Error on attempt {attempt}: {str(e)}")

                if attempt >= max_attempts:
                    raise

        raise Exception("Failed to execute task after max attempts")

    async def execute_task_with_budget(
        self,
        task_id: str,
        project_id: str,
        max_attempts: int = 3
    ) -> TaskResult:
        """
        Execute task with token budget tracking and warnings.

        JIRA Transformation - Phase 2

        Features:
        - Sets token_budget if not set (based on complexity/story_points)
        - Monitors actual token usage
        - Creates system comment if budget exceeded
        - Updates actual_tokens_used field

        Args:
            task_id: Task ID (UUID)
            project_id: Project ID (UUID)
            max_attempts: Maximum retry attempts

        Returns:
            TaskResult with budget tracking
        """
        # 1. Fetch task
        task = self.db.query(Task).filter(Task.id == task_id).first()
        if not task:
            raise ValueError(f"Task {task_id} not found")

        # 2. Set token budget if not set
        self.budget_manager.set_budget_if_not_set(task)

        # 3. Execute task normally
        result = await self.execute_task(task_id, project_id, max_attempts)

        # 4. Track budget usage
        self.budget_manager.track_budget_usage(task, result)

        return result

    async def execute_batch(
        self,
        task_ids: List[str],
        project_id: str
    ) -> List[TaskResult]:
        """
        Execute multiple tasks respecting dependencies.

        Args:
            task_ids: List of task IDs (UUIDs)
            project_id: Project ID (UUID)

        Returns:
            List of TaskResults
        """
        return await self.batch_executor.execute_batch(
            task_ids=task_ids,
            project_id=project_id,
            execute_task_func=self.execute_task
        )

    def _select_model(self, complexity: int) -> str:
        """
        Select model based on task complexity.

        Complexity 1-2: Haiku (cheaper)
        Complexity 3-5: Sonnet (more capable)
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
        Build surgical context using spec fetcher and context builder.

        Project-Specific Specs: Now uses discovered project patterns
        instead of generic JSON framework specs.

        Includes:
        - Project-specific discovered patterns (from specs table)
        - Outputs of dependent tasks
        - Patterns from stack
        - Conventions

        If no specs found for project, adds to discovery_queue for later.
        """
        # Fetch project-specific specs from database
        specs = self.spec_fetcher.fetch_relevant_specs(task, project)
        specs_context = self.spec_fetcher.format_specs_for_execution(specs, task, project)

        # Build context with orchestrator
        context = await self.context_builder.build_context(
            task=task,
            project=project,
            orchestrator=orchestrator,
            specs_context=specs_context
        )

        return context

    def _calculate_cost(
        self,
        model: str,
        input_tokens: int,
        output_tokens: int
    ) -> float:
        """
        Calculate real cost based on tokens.
        """
        if model not in self.PRICING:
            return 0.0

        pricing = self.PRICING[model]

        cost = (input_tokens / 1_000_000 * pricing["input"]) + \
               (output_tokens / 1_000_000 * pricing["output"])

        return round(cost, 6)

    async def _save_successful_result(
        self,
        task: Task,
        task_id: str,
        project: Project,
        project_id: str,
        output_code: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
        cost: float,
        execution_time: float,
        attempt: int,
        context: str
    ) -> TaskResult:
        """Save successful execution result."""
        logger.info(f"  ✅ Validation passed!")

        # Save result
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
                content=output_code,  # Legacy field
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

        # Update task status
        task.status = "done"
        self.db.commit()

        # Broadcast: Task completed
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

    async def _save_failed_result(
        self,
        task: Task,
        task_id: str,
        project: Project,
        project_id: str,
        output_code: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
        cost: float,
        execution_time: float,
        attempt: int,
        validation_issues: List[str],
        context: str
    ) -> TaskResult:
        """Save failed execution result."""
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
                content=output_code,
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

        task.status = "review"  # Mark for review
        self.db.commit()

        # Broadcast: Task failed
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
