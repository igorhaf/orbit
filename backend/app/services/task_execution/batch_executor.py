"""
Batch Execution Module
PROMPT #70 - Refactor task_executor.py

This module handles:
- Batch execution of multiple tasks
- Dependency resolution via topological sort
- Progress tracking and broadcasting
- Consistency validation after batch
"""

from typing import List
from sqlalchemy.orm import Session
from app.models.task import Task
from app.models.task_result import TaskResult
from app.api.websocket import broadcast_event
from app.services.consistency_validator import ConsistencyValidator
import logging

logger = logging.getLogger(__name__)


class BatchExecutor:
    """
    Executes multiple tasks in batch respecting dependencies.

    Features:
    - Topological sort for dependency resolution
    - Progress tracking and broadcasting
    - Consistency validation after batch
    - Resilient to individual task failures
    """

    def __init__(self, db: Session):
        self.db = db

    async def execute_batch(
        self,
        task_ids: List[str],
        project_id: str,
        execute_task_func
    ) -> List[TaskResult]:
        """
        Execute multiple tasks respecting dependencies.

        Args:
            task_ids: List of task IDs (UUIDs)
            project_id: Project ID (UUID)
            execute_task_func: Function to execute single task (async)

        Returns:
            List of TaskResults
        """
        logger.info(f"🚀 Executing batch of {len(task_ids)} tasks")

        results = []
        total_tasks = len(task_ids)
        completed = 0
        total_cost = 0.0

        # Order tasks by dependencies (tasks without deps first)
        tasks = self.db.query(Task).filter(Task.id.in_(task_ids)).all()
        ordered_tasks = self._topological_sort(tasks)

        # Broadcast: Batch started
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
                result = await execute_task_func(str(task.id), project_id)
                results.append(result)
                completed += 1
                total_cost += result.cost

                # Broadcast: Batch progress
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
                # Continue with next tasks

        # Broadcast: Batch completed
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

        # Run consistency validation
        if results:
            await self._validate_consistency(project_id, results)

        return results

    async def _validate_consistency(
        self,
        project_id: str,
        results: List[TaskResult]
    ) -> None:
        """
        Validate consistency after batch execution.

        Args:
            project_id: Project ID
            results: List of TaskResults
        """
        logger.info("🔍 Running consistency validation...")

        validator = ConsistencyValidator(self.db)

        result_ids = [str(r.id) for r in results]
        validation_result = await validator.validate_batch(
            project_id=project_id,
            task_result_ids=result_ids
        )

        # Broadcast validation result
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

        # Log issues if any
        if validation_result['critical'] > 0:
            logger.warning(
                f"⚠️  {validation_result['critical']} critical consistency issues found!"
            )
        elif validation_result['total_issues'] == 0:
            logger.info("✅ No consistency issues found!")

    def _topological_sort(self, tasks: List[Task]) -> List[Task]:
        """
        Order tasks by dependencies (topological sort).

        Tasks without dependencies come first.
        Handles circular dependencies gracefully.

        Args:
            tasks: List of Task objects

        Returns:
            Ordered list of Task objects
        """
        sorted_tasks = []
        remaining = list(tasks)

        # Maximum iterations to avoid infinite loop
        max_iterations = len(tasks) * 2

        for _ in range(max_iterations):
            if not remaining:
                break

            # Find task without unresolved dependencies
            for task in remaining:
                deps = task.depends_on if task.depends_on else []

                if not deps:
                    sorted_tasks.append(task)
                    remaining.remove(task)
                    break

                # Check if all deps already resolved
                all_deps_resolved = all(
                    any(str(t.id) == str(dep_id) for t in sorted_tasks)
                    for dep_id in deps
                )

                if all_deps_resolved:
                    sorted_tasks.append(task)
                    remaining.remove(task)
                    break
            else:
                # No task can be resolved (circular dependency?)
                logger.warning("Possible circular dependency, adding remaining tasks anyway")
                sorted_tasks.extend(remaining)
                break

        return sorted_tasks
