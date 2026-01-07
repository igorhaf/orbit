"""
Token Budget Management Module
PROMPT #70 - Refactor task_executor.py

This module handles:
- Token budget calculation based on complexity
- Budget tracking during execution
- System comment creation on budget overage
- Cost monitoring and warnings

JIRA Transformation - Phase 2
"""

from typing import Optional
from uuid import uuid4
from sqlalchemy.orm import Session
from app.models.task import Task, ItemType
from app.models.task_comment import TaskComment, CommentType
from app.models.task_result import TaskResult
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class BudgetManager:
    """
    Manages token budgets for task execution.

    Features:
    - Automatic budget calculation based on story points and item type
    - Budget tracking and overage detection
    - System comment creation on budget exceeded
    - Cost monitoring and warnings
    """

    def __init__(self, db: Session):
        self.db = db

    def calculate_token_budget(self, task: Task) -> int:
        """
        Calculate token budget based on task complexity.

        JIRA Transformation - Phase 2

        Budget calculation:
        - Story Points: 1-3=2000, 5=3000, 8=4000, 13=5000, 21=6000
        - Item Type: Subtask=1500, Task=2500, Story=4000, Epic=6000, Bug=2000
        - Uses whichever is higher

        Args:
            task: Task object

        Returns:
            Token budget (int)
        """
        budget = 2500  # Default base budget

        # Budget from story points
        if task.story_points:
            story_point_budgets = {
                1: 2000, 2: 2000, 3: 2500,
                5: 3000, 8: 4000, 13: 5000, 21: 6000
            }
            # Find closest Fibonacci
            closest = min(story_point_budgets.keys(), key=lambda x: abs(x - task.story_points))
            budget = max(budget, story_point_budgets[closest])

        # Budget from item type
        if task.item_type:
            type_budgets = {
                ItemType.SUBTASK: 1500,
                ItemType.TASK: 2500,
                ItemType.BUG: 2000,
                ItemType.STORY: 4000,
                ItemType.EPIC: 6000
            }
            budget = max(budget, type_budgets.get(task.item_type, 2500))

        logger.info(
            f"💰 Calculated budget: {budget} tokens "
            f"(story_points={task.story_points}, type={task.item_type.value if task.item_type else 'task'})"
        )

        return budget

    def set_budget_if_not_set(self, task: Task) -> int:
        """
        Set token budget on task if not already set.

        Args:
            task: Task object

        Returns:
            Token budget (int)
        """
        if not task.token_budget:
            budget = self.calculate_token_budget(task)
            task.token_budget = budget
            self.db.commit()
            logger.info(f"💰 Set token budget for task {task.id}: {budget} tokens")
            return budget
        else:
            logger.info(f"💰 Using existing token budget: {task.token_budget} tokens")
            return task.token_budget

    def track_budget_usage(
        self,
        task: Task,
        result: TaskResult
    ) -> None:
        """
        Track token usage and create system comment if budget exceeded.

        Args:
            task: Task object with budget
            result: TaskResult with token usage
        """
        # Update actual_tokens_used
        total_tokens = result.input_tokens + result.output_tokens
        task.actual_tokens_used = total_tokens
        self.db.commit()

        # Check if budget exceeded
        if total_tokens > task.token_budget:
            self._handle_budget_overage(task, total_tokens)
        else:
            under_budget = task.token_budget - total_tokens
            logger.info(
                f"✅ Within budget! "
                f"Used: {total_tokens}/{task.token_budget} "
                f"({under_budget} tokens remaining)"
            )

    def _handle_budget_overage(
        self,
        task: Task,
        total_tokens: int
    ) -> None:
        """
        Handle budget overage by creating system comment.

        Args:
            task: Task object
            total_tokens: Actual tokens used
        """
        overage = total_tokens - task.token_budget
        overage_pct = (overage / task.token_budget) * 100

        logger.warning(
            f"⚠️  Token budget exceeded! "
            f"Used: {total_tokens}, Budget: {task.token_budget}, "
            f"Overage: {overage} ({overage_pct:.1f}%)"
        )

        # Create system comment
        comment = TaskComment(
            id=uuid4(),
            task_id=task.id,
            author="system",
            content=(
                f"⚠️ Token Budget Exceeded\n\n"
                f"Budget: {task.token_budget:,} tokens\n"
                f"Used: {total_tokens:,} tokens\n"
                f"Overage: {overage:,} tokens ({overage_pct:.1f}%)\n\n"
                f"Consider:\n"
                f"- Simplifying task description\n"
                f"- Breaking into smaller subtasks\n"
                f"- Increasing token budget if complexity is justified"
            ),
            comment_type=CommentType.SYSTEM,
            metadata={
                "budget": task.token_budget,
                "actual": total_tokens,
                "overage": overage,
                "overage_percentage": round(overage_pct, 2)
            },
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )

        self.db.add(comment)
        self.db.commit()

        logger.info(f"📝 Created system comment about token budget overage")
