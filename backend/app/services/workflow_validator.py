"""
WorkflowValidator
Validates status transitions for different item types
JIRA Transformation - Phase 2
"""

from typing import Dict, List, Optional
from uuid import uuid4
from datetime import datetime
from sqlalchemy.orm import Session
import logging

from app.models.task import Task, ItemType, TaskStatus
from app.models.status_transition import StatusTransition

logger = logging.getLogger(__name__)


class WorkflowValidator:
    """Service for validating and enforcing workflow rules"""

    # Workflow definitions (4 hardcoded workflows)
    WORKFLOWS: Dict[ItemType, List[str]] = {
        ItemType.EPIC: [
            "backlog",
            "planning",
            "in_progress",
            "review",
            "done"
        ],
        ItemType.STORY: [
            "backlog",
            "ready",
            "in_progress",
            "review",
            "validation",
            "done"
        ],
        ItemType.TASK: [
            "backlog",
            "todo",
            "in_progress",
            "code_review",
            "testing",
            "done"
        ],
        ItemType.BUG: [
            "new",
            "confirmed",
            "in_progress",
            "fixed",
            "verified",
            "closed"
        ],
        ItemType.SUBTASK: [
            "todo",
            "in_progress",
            "done"
        ]
    }

    # Valid transitions (from_status → [to_status, ...])
    # This defines the state machine for each workflow
    VALID_TRANSITIONS: Dict[ItemType, Dict[str, List[str]]] = {
        ItemType.EPIC: {
            "backlog": ["planning"],
            "planning": ["backlog", "in_progress"],
            "in_progress": ["planning", "review", "done"],
            "review": ["in_progress", "done"],
            "done": []  # Terminal state
        },
        ItemType.STORY: {
            "backlog": ["ready"],
            "ready": ["backlog", "in_progress"],
            "in_progress": ["ready", "review"],
            "review": ["in_progress", "validation", "done"],
            "validation": ["review", "done"],
            "done": []  # Terminal state
        },
        ItemType.TASK: {
            "backlog": ["todo"],
            "todo": ["backlog", "in_progress"],
            "in_progress": ["todo", "code_review"],
            "code_review": ["in_progress", "testing", "done"],
            "testing": ["code_review", "in_progress", "done"],
            "done": []  # Terminal state
        },
        ItemType.BUG: {
            "new": ["confirmed", "closed"],
            "confirmed": ["new", "in_progress", "closed"],
            "in_progress": ["confirmed", "fixed"],
            "fixed": ["in_progress", "verified", "closed"],
            "verified": ["fixed", "closed"],
            "closed": []  # Terminal state
        },
        ItemType.SUBTASK: {
            "todo": ["in_progress"],
            "in_progress": ["todo", "done"],
            "done": []  # Terminal state
        }
    }

    def __init__(self, db: Session):
        self.db = db

    def validate_transition(
        self,
        item_type: ItemType,
        from_status: str,
        to_status: str
    ) -> bool:
        """
        Validate if a status transition is allowed for an item type

        Args:
            item_type: Type of item (Epic, Story, Task, Bug, Subtask)
            from_status: Current status
            to_status: Desired status

        Returns:
            True if transition is valid, False otherwise

        Example:
            validator.validate_transition(ItemType.EPIC, "planning", "in_progress")  # True
            validator.validate_transition(ItemType.EPIC, "done", "in_progress")      # False
        """
        # Get valid transitions for this item type
        transitions = self.VALID_TRANSITIONS.get(item_type, {})

        # Get allowed next states from current status
        allowed_next_states = transitions.get(from_status, [])

        # Check if to_status is in allowed list
        is_valid = to_status in allowed_next_states

        if not is_valid:
            logger.warning(
                f"❌ Invalid transition for {item_type.value}: "
                f"{from_status} → {to_status} (allowed: {allowed_next_states})"
            )
        else:
            logger.info(
                f"✅ Valid transition for {item_type.value}: {from_status} → {to_status}"
            )

        return is_valid

    def get_valid_next_statuses(
        self,
        item_type: ItemType,
        current_status: str
    ) -> List[str]:
        """
        Get list of valid next statuses from current status

        Args:
            item_type: Type of item
            current_status: Current status

        Returns:
            List of valid next statuses

        Example:
            validator.get_valid_next_statuses(ItemType.STORY, "in_progress")
            # Returns: ["ready", "review"]
        """
        transitions = self.VALID_TRANSITIONS.get(item_type, {})
        return transitions.get(current_status, [])

    def get_workflow_statuses(self, item_type: ItemType) -> List[str]:
        """
        Get all statuses in workflow for an item type

        Args:
            item_type: Type of item

        Returns:
            List of all workflow statuses

        Example:
            validator.get_workflow_statuses(ItemType.EPIC)
            # Returns: ["backlog", "planning", "in_progress", "review", "done"]
        """
        return self.WORKFLOWS.get(item_type, [])

    def record_transition(
        self,
        task_id: str,
        from_status: str,
        to_status: str,
        transitioned_by: Optional[str] = None,
        transition_reason: Optional[str] = None
    ) -> StatusTransition:
        """
        Record a status transition in the audit log

        Should be called AFTER a successful status change
        Creates a StatusTransition record for audit trail

        Args:
            task_id: Task ID
            from_status: Previous status
            to_status: New status
            transitioned_by: Username who made the change (optional)
            transition_reason: Reason for transition (optional)

        Returns:
            StatusTransition record

        Example:
            transition = validator.record_transition(
                task_id=str(task.id),
                from_status="in_progress",
                to_status="code_review",
                transitioned_by="john",
                transition_reason="Code complete, ready for review"
            )
        """
        transition = StatusTransition(
            id=uuid4(),
            task_id=task_id,
            from_status=from_status,
            to_status=to_status,
            transitioned_by=transitioned_by,
            transition_reason=transition_reason,
            created_at=datetime.utcnow()
        )

        self.db.add(transition)
        self.db.commit()

        logger.info(
            f"📝 Recorded transition for task {task_id}: "
            f"{from_status} → {to_status} by {transitioned_by or 'system'}"
        )

        return transition

    def get_task_transition_history(
        self,
        task_id: str
    ) -> List[StatusTransition]:
        """
        Get transition history for a task (audit trail)

        Args:
            task_id: Task ID

        Returns:
            List of StatusTransition records ordered by created_at

        Example:
            history = validator.get_task_transition_history(str(task.id))
            for transition in history:
                print(f"{transition.from_status} → {transition.to_status} at {transition.created_at}")
        """
        transitions = self.db.query(StatusTransition).filter(
            StatusTransition.task_id == task_id
        ).order_by(StatusTransition.created_at).all()

        logger.info(f"📊 Found {len(transitions)} transitions for task {task_id}")

        return transitions

    def validate_and_transition(
        self,
        task: Task,
        to_status: str,
        transitioned_by: Optional[str] = None,
        transition_reason: Optional[str] = None
    ) -> bool:
        """
        Validate and perform status transition (all-in-one method)

        Validates transition, updates task status, records audit log

        Args:
            task: Task object
            to_status: Desired status
            transitioned_by: Username (optional)
            transition_reason: Reason (optional)

        Returns:
            True if transition successful, False if invalid

        Raises:
            ValueError: If transition is invalid

        Example:
            success = validator.validate_and_transition(
                task=task,
                to_status="code_review",
                transitioned_by="john",
                transition_reason="Code complete"
            )
        """
        from_status = task.workflow_state or "backlog"

        # 1. Validate transition
        if not self.validate_transition(task.item_type, from_status, to_status):
            raise ValueError(
                f"Invalid status transition for {task.item_type.value}: "
                f"{from_status} → {to_status}"
            )

        # 2. Update task status
        task.workflow_state = to_status
        self.db.commit()

        # 3. Record transition in audit log
        self.record_transition(
            task_id=str(task.id),
            from_status=from_status,
            to_status=to_status,
            transitioned_by=transitioned_by,
            transition_reason=transition_reason
        )

        logger.info(
            f"✅ Task {task.id} transitioned: {from_status} → {to_status}"
        )

        return True

    def get_workflow_diagram(self, item_type: ItemType) -> str:
        """
        Get ASCII workflow diagram for an item type (for documentation/debugging)

        Args:
            item_type: Type of item

        Returns:
            ASCII diagram string

        Example:
            print(validator.get_workflow_diagram(ItemType.EPIC))
            # Output:
            # Epic Workflow:
            # backlog → planning → in_progress → review → done
        """
        statuses = self.get_workflow_statuses(item_type)
        transitions = self.VALID_TRANSITIONS.get(item_type, {})

        diagram = [f"{item_type.value.title()} Workflow:\n"]

        # Linear representation
        diagram.append(" → ".join(statuses))
        diagram.append("\n\nTransitions:")

        # Detailed transitions
        for from_status, to_statuses in transitions.items():
            if to_statuses:
                diagram.append(f"  {from_status} → {', '.join(to_statuses)}")
            else:
                diagram.append(f"  {from_status} → (terminal)")

        return "\n".join(diagram)
