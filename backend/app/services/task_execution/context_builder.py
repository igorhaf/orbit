"""
Context Building Module
PROMPT #70 - Refactor task_executor.py

This module handles:
- Building surgical context for AI execution
- JIRA hierarchy context integration
- Interview insights traceability
- Acceptance criteria formatting
"""

from typing import Dict, Any
from sqlalchemy.orm import Session
from app.models.task import Task
from app.models.project import Project
from app.models.task_result import TaskResult
from app.services.task_hierarchy import TaskHierarchyService
import logging

logger = logging.getLogger(__name__)


class ContextBuilder:
    """
    Builds surgical, optimized context for AI task execution.

    Features:
    - Surgical context (3-5k tokens vs 200k)
    - JIRA hierarchy integration (Epic → Story → Task)
    - Interview insights traceability
    - Acceptance criteria formatting
    """

    def __init__(self, db: Session):
        self.db = db

    async def build_context(
        self,
        task: Task,
        project: Project,
        orchestrator,
        specs_context: str = ""
    ) -> str:
        """
        Build surgical context using orchestrator.

        PROMPT #49 - Phase 4: Enhanced with specs integration

        Includes:
        - Framework specs (Phase 4!)
        - Project spec
        - Outputs of dependent tasks
        - Patterns from stack
        - Conventions

        Args:
            task: Task being executed
            project: Project object
            orchestrator: Stack orchestrator
            specs_context: Pre-formatted specs context (optional)

        Returns:
            Complete context string for AI
        """
        # Fetch project spec
        spec = getattr(project, 'spec', {})

        # Fetch outputs of dependent tasks
        previous_outputs = {}

        if task.depends_on:
            for dep_id in task.depends_on:
                dep_result = self.db.query(TaskResult).filter(
                    TaskResult.task_id == dep_id
                ).first()

                if dep_result:
                    previous_outputs[str(dep_id)] = dep_result.output_code

        # Use orchestrator to build task context
        orchestrator_context = orchestrator.build_task_context(
            task=task.to_dict(),
            spec=spec,
            previous_outputs=previous_outputs
        )

        # Phase 4: Combine specs context with orchestrator context
        # Specs go FIRST so AI sees framework patterns before task details
        if specs_context:
            context = specs_context + "\n" + orchestrator_context
            logger.info("✨ Phase 4: Specs integrated into execution context")
        else:
            context = orchestrator_context
            logger.info("No specs found for task, using orchestrator context only")

        return context

    def build_jira_task_context(
        self,
        task: Task,
        project: Project
    ) -> str:
        """
        Build enhanced context with JIRA hierarchy, interview insights, and acceptance criteria.

        JIRA Transformation - Phase 2

        Extends build_context() with:
        - Parent hierarchy context (Epic → Story → Task)
        - Interview insights traceability
        - Acceptance criteria
        - Generation context from AI decomposition

        Args:
            task: Task object with JIRA fields
            project: Project object

        Returns:
            Enhanced context string for AI execution
        """
        context_parts = []

        # 1. Hierarchy Context (Epic → Story → Task)
        if task.parent_id:
            hierarchy_service = TaskHierarchyService(self.db)
            hierarchy_path = hierarchy_service.get_hierarchy_path(task.id)

            if len(hierarchy_path) > 1:  # Has parents
                context_parts.append("=" * 80)
                context_parts.append("HIERARCHY CONTEXT")
                context_parts.append("=" * 80)
                context_parts.append("")

                # Show path: Epic → Story → Task
                path_display = " → ".join([
                    f"{item.item_type.value.upper()}: {item.title}"
                    for item in hierarchy_path
                ])
                context_parts.append(f"Path: {path_display}")
                context_parts.append("")

                # Include parent descriptions for context
                for i, parent in enumerate(hierarchy_path[:-1]):  # Exclude current task
                    context_parts.append(f"--- {parent.item_type.value.upper()}: {parent.title} ---")
                    context_parts.append(parent.description or "No description")

                    if parent.acceptance_criteria:
                        context_parts.append(f"\nAcceptance Criteria:")
                        for criterion in parent.acceptance_criteria:
                            context_parts.append(f"  - {criterion}")

                    context_parts.append("")

                context_parts.append("This task is part of the above hierarchy. Ensure your implementation")
                context_parts.append("aligns with the parent Epic/Story goals and acceptance criteria.")
                context_parts.append("")

        # 2. Interview Insights
        if task.interview_insights and task.interview_insights:
            context_parts.append("=" * 80)
            context_parts.append("INTERVIEW INSIGHTS")
            context_parts.append("=" * 80)
            context_parts.append("")

            for key, value in task.interview_insights.items():
                context_parts.append(f"{key.replace('_', ' ').title()}:")
                if isinstance(value, list):
                    for item in value:
                        context_parts.append(f"  - {item}")
                else:
                    context_parts.append(f"  {value}")
                context_parts.append("")

            context_parts.append("These insights were extracted from stakeholder interviews.")
            context_parts.append("Your implementation should address these requirements.")
            context_parts.append("")

        # 3. Acceptance Criteria
        if task.acceptance_criteria:
            context_parts.append("=" * 80)
            context_parts.append("ACCEPTANCE CRITERIA (MUST SATISFY ALL)")
            context_parts.append("=" * 80)
            context_parts.append("")

            for i, criterion in enumerate(task.acceptance_criteria, 1):
                context_parts.append(f"{i}. {criterion}")

            context_parts.append("")
            context_parts.append("Your code MUST satisfy ALL acceptance criteria above.")
            context_parts.append("")

        # 4. Generation Context (from AI decomposition)
        if task.generation_context:
            context_parts.append("=" * 80)
            context_parts.append("AI GENERATION CONTEXT")
            context_parts.append("=" * 80)
            context_parts.append("")

            for key, value in task.generation_context.items():
                context_parts.append(f"{key}: {value}")

            context_parts.append("")

        # 5. Priority and Complexity Signals
        context_parts.append("=" * 80)
        context_parts.append("TASK METADATA")
        context_parts.append("=" * 80)
        context_parts.append(f"Type: {task.item_type.value if task.item_type else 'task'}")
        context_parts.append(f"Priority: {task.priority.value if task.priority else 'medium'}")
        if task.story_points:
            context_parts.append(f"Story Points: {task.story_points}")
        if task.severity:
            context_parts.append(f"Severity: {task.severity.value}")
        context_parts.append("")

        return "\n".join(context_parts)
