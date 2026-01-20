"""
BacklogViewService
Hierarchical backlog queries with filtering and eager loading
JIRA Transformation - Phase 2
"""

from typing import List, Optional, Dict, Any
from uuid import UUID
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import and_, or_

from app.models.task import Task, ItemType, PriorityLevel, TaskStatus
import logging

logger = logging.getLogger(__name__)


class BacklogViewService:
    """Service for querying hierarchical backlog with optimized loading"""

    def __init__(self, db: Session):
        self.db = db

    def get_project_backlog(
        self,
        project_id: UUID,
        filters: Optional[Dict[str, Any]] = None
    ) -> List[Dict]:
        """
        Get hierarchical backlog for a project with filters

        Returns tree structure: Epic → Story → Task → Subtask
        Uses eager loading for performance (selectinload strategy)

        Args:
            project_id: Project ID
            filters: Optional filters dict:
                - item_type: ItemType enum or list of types
                - priority: PriorityLevel enum or list of priorities
                - assignee: str (assignee username)
                - labels: list of label strings (match ANY)
                - status: TaskStatus enum or list of statuses

        Returns:
            List of root items (no parent) with nested children:
            [
                {
                    "id": "...",
                    "title": "Epic Title",
                    "item_type": "epic",
                    "priority": "high",
                    "story_points": 13,
                    "assignee": "user1",
                    "labels": ["backend", "api"],
                    "status": "in_progress",
                    "children": [
                        {
                            "id": "...",
                            "title": "Story Title",
                            "item_type": "story",
                            "children": [...]
                        }
                    ]
                }
            ]

        Example:
            backlog = service.get_project_backlog(
                project_id=uuid,
                filters={
                    "item_type": [ItemType.EPIC, ItemType.STORY],
                    "priority": [PriorityLevel.HIGH, PriorityLevel.CRITICAL],
                    "assignee": "john",
                    "labels": ["backend", "urgent"]
                }
            )
        """
        filters = filters or {}

        # 1. Build base query for root items (no parent)
        query = self.db.query(Task).filter(
            Task.project_id == project_id,
            Task.parent_id == None  # Root items only
        )

        # 2. Apply filters
        query = self._apply_filters(query, filters)

        # 3. Eager load children recursively (up to 4 levels: Epic→Story→Task→Subtask)
        # This prevents N+1 queries
        query = query.options(
            selectinload(Task.children).selectinload(Task.children).selectinload(Task.children)
        )

        # 4. Order by item_type (Epic first, then Story, Task, Subtask) and order field
        query = query.order_by(Task.order, Task.created_at)

        # 5. Execute query
        root_items = query.all()

        logger.info(f"📊 Found {len(root_items)} root items for project {project_id}")

        # 6. Convert to hierarchical dict structure
        result = []
        for item in root_items:
            result.append(self._task_to_tree_dict(item, filters))

        return result

    def get_flat_backlog(
        self,
        project_id: UUID,
        filters: Optional[Dict[str, Any]] = None
    ) -> List[Dict]:
        """
        Get flat list of all backlog items (no hierarchy)

        Useful for:
        - Bulk operations
        - Exporting data
        - Simple list views

        Args:
            project_id: Project ID
            filters: Optional filters (same as get_project_backlog)

        Returns:
            Flat list of items (no nesting):
            [
                {"id": "...", "title": "...", "item_type": "epic", ...},
                {"id": "...", "title": "...", "item_type": "story", ...},
                ...
            ]
        """
        filters = filters or {}

        # Build query for ALL items in project (not just roots)
        query = self.db.query(Task).filter(
            Task.project_id == project_id
        )

        # Apply filters
        query = self._apply_filters(query, filters)

        # Order by hierarchy depth (Epics first, then Stories, Tasks, Subtasks)
        query = query.order_by(Task.item_type, Task.order, Task.created_at)

        items = query.all()

        logger.info(f"📊 Found {len(items)} total items for project {project_id}")

        # Convert to dict (no children)
        result = []
        for item in items:
            result.append(self._task_to_dict(item))

        return result

    def _apply_filters(self, query, filters: Dict[str, Any]):
        """
        Apply filters to query

        Args:
            query: SQLAlchemy query object
            filters: Filters dict

        Returns:
            Query with filters applied
        """
        # Filter by item_type
        if "item_type" in filters:
            item_type_filter = filters["item_type"]
            if isinstance(item_type_filter, list):
                query = query.filter(Task.item_type.in_(item_type_filter))
            else:
                query = query.filter(Task.item_type == item_type_filter)

        # Filter by priority
        if "priority" in filters:
            priority_filter = filters["priority"]
            if isinstance(priority_filter, list):
                query = query.filter(Task.priority.in_(priority_filter))
            else:
                query = query.filter(Task.priority == priority_filter)

        # Filter by assignee
        if "assignee" in filters and filters["assignee"]:
            query = query.filter(Task.assignee == filters["assignee"])

        # Filter by status
        if "status" in filters:
            status_filter = filters["status"]
            if isinstance(status_filter, list):
                query = query.filter(Task.status.in_(status_filter))
            else:
                query = query.filter(Task.status == status_filter)

        # Filter by labels (match ANY label in the list)
        if "labels" in filters and filters["labels"]:
            label_filters = filters["labels"]
            if isinstance(label_filters, list) and len(label_filters) > 0:
                # PostgreSQL JSON array contains check
                # Check if ANY label from filter exists in task's labels array
                label_conditions = []
                for label in label_filters:
                    # JSON contains check: labels @> '["label"]'
                    label_conditions.append(
                        Task.labels.contains([label])
                    )
                query = query.filter(or_(*label_conditions))

        return query

    def _task_to_tree_dict(
        self,
        task: Task,
        filters: Optional[Dict[str, Any]] = None
    ) -> Dict:
        """
        Convert Task to hierarchical dict with filtered children

        Recursively builds tree structure, applying filters to children

        Args:
            task: Task object
            filters: Filters to apply to children

        Returns:
            Dict with task data and filtered children
        """
        # Base task data
        data = self._task_to_dict(task)

        # Get children (already eager loaded)
        children = task.children if hasattr(task, 'children') else []

        # Filter children if filters provided
        if filters:
            children = self._filter_tasks_in_memory(children, filters)

        # Recursively convert children
        if children:
            data["children"] = [
                self._task_to_tree_dict(child, filters)
                for child in sorted(children, key=lambda x: (x.order, x.created_at))
            ]
        else:
            data["children"] = []

        return data

    def _filter_tasks_in_memory(
        self,
        tasks: List[Task],
        filters: Dict[str, Any]
    ) -> List[Task]:
        """
        Filter tasks list in memory (for already loaded children)

        Args:
            tasks: List of Task objects
            filters: Filters dict

        Returns:
            Filtered list of tasks
        """
        filtered = []

        for task in tasks:
            # Check item_type
            if "item_type" in filters:
                item_type_filter = filters["item_type"]
                if isinstance(item_type_filter, list):
                    if task.item_type not in item_type_filter:
                        continue
                else:
                    if task.item_type != item_type_filter:
                        continue

            # Check priority
            if "priority" in filters:
                priority_filter = filters["priority"]
                if isinstance(priority_filter, list):
                    if task.priority not in priority_filter:
                        continue
                else:
                    if task.priority != priority_filter:
                        continue

            # Check assignee
            if "assignee" in filters and filters["assignee"]:
                if task.assignee != filters["assignee"]:
                    continue

            # Check status
            if "status" in filters:
                status_filter = filters["status"]
                if isinstance(status_filter, list):
                    if task.status not in status_filter:
                        continue
                else:
                    if task.status != status_filter:
                        continue

            # Check labels (match ANY)
            if "labels" in filters and filters["labels"]:
                label_filters = filters["labels"]
                if isinstance(label_filters, list) and len(label_filters) > 0:
                    task_labels = task.labels or []
                    # Check if ANY filter label exists in task labels
                    if not any(label in task_labels for label in label_filters):
                        continue

            # If all filters pass, include task
            filtered.append(task)

        return filtered

    def _task_to_dict(self, task: Task) -> Dict:
        """
        Convert Task to dict (without children)

        Args:
            task: Task object

        Returns:
            Dict with task data
        """
        return {
            "id": str(task.id),
            "title": task.title,
            "description": task.description,
            "item_type": task.item_type.value if task.item_type else "task",
            "priority": task.priority.value if task.priority else None,
            "severity": task.severity.value if task.severity else None,
            "story_points": task.story_points,
            "assignee": task.assignee,
            "reporter": task.reporter,
            "labels": task.labels or [],
            "components": task.components or [],
            "status": task.status.value if task.status else None,
            "workflow_state": task.workflow_state,
            "resolution": task.resolution.value if task.resolution else None,
            "parent_id": str(task.parent_id) if task.parent_id else None,
            "order": task.order,
            "created_at": task.created_at.isoformat() if task.created_at else None,
            "updated_at": task.updated_at.isoformat() if task.updated_at else None,
            # PROMPT #96 - Include generated_prompt for ItemDetailPanel
            "generated_prompt": task.generated_prompt,
            "acceptance_criteria": task.acceptance_criteria or [],
            "token_budget": task.token_budget,
            "actual_tokens_used": task.actual_tokens_used,
        }
