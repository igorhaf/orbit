"""
TaskHierarchyService
Manages task hierarchies (parent-child relationships) and prevents cycles
"""

from typing import List, Set, Optional
from uuid import UUID
from sqlalchemy.orm import Session
from app.models.task import Task, ItemType


class TaskHierarchyService:
    """Service for managing task hierarchies and validating hierarchy rules"""

    def __init__(self, db: Session):
        self.db = db

    def get_all_descendants(self, task_id: UUID) -> List[Task]:
        """
        Get all descendants recursively (children, grandchildren, etc.)

        Args:
            task_id: Root task ID

        Returns:
            List of all descendant tasks
        """
        descendants = []
        visited = set()
        self._collect_descendants(task_id, descendants, visited)
        return descendants

    def _collect_descendants(self, task_id: UUID, result: List[Task], visited: Set[UUID]):
        """
        Recursive helper to collect descendants

        Args:
            task_id: Current task ID
            result: List to accumulate descendants
            visited: Set of visited task IDs (prevents infinite loops)
        """
        if task_id in visited:
            return  # Prevent infinite loops

        visited.add(task_id)

        # Get all children of current task
        children = self.db.query(Task).filter(Task.parent_id == task_id).all()

        for child in children:
            result.append(child)
            # Recursively collect descendants of this child
            self._collect_descendants(child.id, result, visited)

    def get_all_ancestors(self, task_id: UUID) -> List[Task]:
        """
        Get all ancestors up to root (parent, grandparent, etc.)

        Args:
            task_id: Starting task ID

        Returns:
            List of all ancestor tasks (ordered from immediate parent to root)
        """
        ancestors = []
        current_id = task_id
        visited = set()  # Prevent infinite loops

        while current_id and current_id not in visited:
            visited.add(current_id)

            # Get current task
            task = self.db.query(Task).filter(Task.id == current_id).first()
            if not task or not task.parent_id:
                break

            # Get parent
            parent = self.db.query(Task).filter(Task.id == task.parent_id).first()
            if parent:
                ancestors.append(parent)
                current_id = parent.id
            else:
                break

        return ancestors

    def get_root_tasks(self, project_id: UUID, item_type: Optional[ItemType] = None) -> List[Task]:
        """
        Get all root-level tasks (no parent) for a project

        Args:
            project_id: Project ID
            item_type: Optional filter by item type

        Returns:
            List of root tasks
        """
        query = self.db.query(Task).filter(
            Task.project_id == project_id,
            Task.parent_id == None
        )

        if item_type:
            query = query.filter(Task.item_type == item_type)

        return query.order_by(Task.order).all()

    def would_create_cycle(self, source_id: UUID, target_id: UUID) -> bool:
        """
        Check if creating a parent-child relationship would create a cycle

        A cycle would occur if the target is already an ancestor of the source.
        For example: A → B → C, trying to make C parent of A would create a cycle.

        Args:
            source_id: Task that would become the child
            target_id: Task that would become the parent

        Returns:
            True if this would create a cycle, False otherwise
        """
        # Check if target is already an ancestor of source
        ancestors = self.get_all_ancestors(source_id)
        return any(a.id == target_id for a in ancestors)

    def validate_hierarchy_rules(self, child_type: ItemType, parent_type: ItemType) -> bool:
        """
        Validate hierarchy rules for JIRA-like structure

        Rules:
        - Epic can contain: Story, Spike
        - Story can contain: Task, Bug
        - Task can contain: Subtask
        - Subtask cannot contain anything
        - Bug cannot contain anything (standalone)

        Args:
            child_type: Type of the child item
            parent_type: Type of the parent item

        Returns:
            True if the hierarchy is valid, False otherwise
        """
        valid_hierarchies = {
            ItemType.EPIC: [ItemType.STORY],
            ItemType.STORY: [ItemType.TASK, ItemType.BUG],
            ItemType.TASK: [ItemType.SUBTASK],
            ItemType.SUBTASK: [],  # Cannot have children
            ItemType.BUG: [],  # Cannot have children
        }

        allowed_children = valid_hierarchies.get(parent_type, [])
        return child_type in allowed_children

    def get_hierarchy_depth(self, task_id: UUID) -> int:
        """
        Calculate the depth of a task in the hierarchy

        Depth is the number of ancestors (0 = root, 1 = child of root, etc.)

        Args:
            task_id: Task ID

        Returns:
            Depth level (0-based)
        """
        ancestors = self.get_all_ancestors(task_id)
        return len(ancestors)

    def get_hierarchy_path(self, task_id: UUID) -> List[Task]:
        """
        Get the full hierarchy path from root to this task

        Example: [Epic] → [Story] → [Task] → [Subtask]

        Args:
            task_id: Task ID

        Returns:
            List of tasks from root to current (inclusive)
        """
        ancestors = self.get_all_ancestors(task_id)
        ancestors.reverse()  # Root first

        # Add current task
        current_task = self.db.query(Task).filter(Task.id == task_id).first()
        if current_task:
            ancestors.append(current_task)

        return ancestors

    def move_task(
        self,
        task_id: UUID,
        new_parent_id: Optional[UUID],
        validate_rules: bool = True
    ) -> bool:
        """
        Move a task to a new parent (or make it root)

        Args:
            task_id: Task to move
            new_parent_id: New parent ID (None = make root)
            validate_rules: Whether to validate hierarchy rules

        Returns:
            True if successful, False if validation failed

        Raises:
            ValueError: If operation would create a cycle
        """
        task = self.db.query(Task).filter(Task.id == task_id).first()
        if not task:
            raise ValueError(f"Task {task_id} not found")

        # If setting a parent, validate
        if new_parent_id:
            # Check for cycles
            if self.would_create_cycle(task_id, new_parent_id):
                raise ValueError("Cannot move task: would create a cycle")

            # Validate hierarchy rules if requested
            if validate_rules:
                parent = self.db.query(Task).filter(Task.id == new_parent_id).first()
                if not parent:
                    raise ValueError(f"Parent task {new_parent_id} not found")

                if not self.validate_hierarchy_rules(task.item_type, parent.item_type):
                    raise ValueError(
                        f"Invalid hierarchy: {parent.item_type.value} cannot contain {task.item_type.value}"
                    )

        # Update parent
        task.parent_id = new_parent_id
        self.db.commit()

        return True

    def get_children_count(self, task_id: UUID, recursive: bool = False) -> int:
        """
        Count children of a task

        Args:
            task_id: Task ID
            recursive: If True, counts all descendants; if False, only direct children

        Returns:
            Number of children
        """
        if recursive:
            return len(self.get_all_descendants(task_id))
        else:
            return self.db.query(Task).filter(Task.parent_id == task_id).count()

    def reorder_children(self, parent_id: Optional[UUID], task_ids_in_order: List[UUID]):
        """
        Reorder children of a parent task

        Args:
            parent_id: Parent task ID (None for root tasks)
            task_ids_in_order: List of task IDs in desired order
        """
        for index, task_id in enumerate(task_ids_in_order):
            task = self.db.query(Task).filter(
                Task.id == task_id,
                Task.parent_id == parent_id
            ).first()

            if task:
                task.order = index

        self.db.commit()
