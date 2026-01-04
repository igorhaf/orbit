"""add_jira_fields_to_tasks

Revision ID: aabbccdd1111
Revises: ff42c2846a70
Create Date: 2026-01-04 00:00:00.000000

JIRA Transformation - Phase 1: Extend Task Model
- Add 4 new enums (item_type, priority_level, severity_level, resolution_type)
- Add 19 new columns to tasks table
- Add 7 new indexes for performance
- Add 3 new foreign keys
- Set safe defaults for existing data
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'aabbccdd1111'
down_revision: Union[str, None] = 'ff42c2846a70'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create new ENUM types
    op.execute("""
        CREATE TYPE item_type AS ENUM ('epic', 'story', 'task', 'subtask', 'bug')
    """)

    op.execute("""
        CREATE TYPE priority_level AS ENUM ('critical', 'high', 'medium', 'low', 'trivial')
    """)

    op.execute("""
        CREATE TYPE severity_level AS ENUM ('blocker', 'critical', 'major', 'minor', 'trivial')
    """)

    op.execute("""
        CREATE TYPE resolution_type AS ENUM (
            'fixed', 'wont_fix', 'duplicate', 'works_as_designed', 'cannot_reproduce'
        )
    """)

    # 2. Add Classification & Hierarchy columns
    op.add_column('tasks', sa.Column(
        'item_type',
        sa.Enum('epic', 'story', 'task', 'subtask', 'bug', name='item_type'),
        nullable=False,
        server_default='task'
    ))

    op.add_column('tasks', sa.Column(
        'parent_id',
        postgresql.UUID(as_uuid=True),
        nullable=True
    ))

    # 3. Add Planning columns
    op.add_column('tasks', sa.Column(
        'priority',
        sa.Enum('critical', 'high', 'medium', 'low', 'trivial', name='priority_level'),
        nullable=False,
        server_default='medium'
    ))

    op.add_column('tasks', sa.Column(
        'severity',
        sa.Enum('blocker', 'critical', 'major', 'minor', 'trivial', name='severity_level'),
        nullable=True
    ))

    op.add_column('tasks', sa.Column(
        'story_points',
        sa.Integer,
        nullable=True
    ))

    op.add_column('tasks', sa.Column(
        'sprint_id',
        postgresql.UUID(as_uuid=True),
        nullable=True
    ))

    # 4. Add Ownership columns (strings for now, FK to users later)
    op.add_column('tasks', sa.Column(
        'reporter',
        sa.String(100),
        nullable=True,
        server_default='system'
    ))

    op.add_column('tasks', sa.Column(
        'assignee',
        sa.String(100),
        nullable=True
    ))

    # 5. Add Categorization columns (JSON arrays)
    op.add_column('tasks', sa.Column(
        'labels',
        postgresql.JSON,
        nullable=True
    ))

    op.add_column('tasks', sa.Column(
        'components',
        postgresql.JSON,
        nullable=True
    ))

    # 6. Add Workflow columns
    op.add_column('tasks', sa.Column(
        'workflow_state',
        sa.String(50),
        nullable=False,
        server_default='open'
    ))

    op.add_column('tasks', sa.Column(
        'resolution',
        sa.Enum('fixed', 'wont_fix', 'duplicate', 'works_as_designed', 'cannot_reproduce', name='resolution_type'),
        nullable=True
    ))

    op.add_column('tasks', sa.Column(
        'resolution_comment',
        sa.Text,
        nullable=True
    ))

    op.add_column('tasks', sa.Column(
        'status_history',
        postgresql.JSON,
        nullable=True
    ))

    # 7. Add AI Orchestration columns
    op.add_column('tasks', sa.Column(
        'prompt_template_id',
        postgresql.UUID(as_uuid=True),
        nullable=True
    ))

    op.add_column('tasks', sa.Column(
        'target_ai_model_id',
        postgresql.UUID(as_uuid=True),
        nullable=True
    ))

    op.add_column('tasks', sa.Column(
        'generation_context',
        postgresql.JSON,
        nullable=True
    ))

    op.add_column('tasks', sa.Column(
        'acceptance_criteria',
        postgresql.JSON,
        nullable=True
    ))

    op.add_column('tasks', sa.Column(
        'token_budget',
        sa.Integer,
        nullable=True
    ))

    op.add_column('tasks', sa.Column(
        'actual_tokens_used',
        sa.Integer,
        nullable=True
    ))

    # 8. Add Interview Traceability columns
    op.add_column('tasks', sa.Column(
        'interview_question_ids',
        postgresql.JSON,
        nullable=True
    ))

    op.add_column('tasks', sa.Column(
        'interview_insights',
        postgresql.JSON,
        nullable=True
    ))

    # 9. Create Foreign Keys
    op.create_foreign_key(
        'fk_tasks_parent',
        'tasks', 'tasks',
        ['parent_id'], ['id'],
        ondelete='SET NULL'
    )

    op.create_foreign_key(
        'fk_tasks_prompt_template',
        'tasks', 'prompt_templates',
        ['prompt_template_id'], ['id'],
        ondelete='SET NULL'
    )

    op.create_foreign_key(
        'fk_tasks_target_ai_model',
        'tasks', 'ai_models',
        ['target_ai_model_id'], ['id'],
        ondelete='SET NULL'
    )

    # 10. Create Indexes for Performance
    op.create_index('ix_tasks_item_type', 'tasks', ['item_type'])
    op.create_index('ix_tasks_parent_id', 'tasks', ['parent_id'])
    op.create_index('ix_tasks_priority', 'tasks', ['priority'])
    op.create_index('ix_tasks_assignee', 'tasks', ['assignee'])
    op.create_index('ix_tasks_workflow_state', 'tasks', ['workflow_state'])
    op.create_index('ix_tasks_item_type_project', 'tasks', ['item_type', 'project_id'])
    op.create_index('ix_tasks_parent_project', 'tasks', ['parent_id', 'project_id'])


def downgrade() -> None:
    # Drop indexes
    op.drop_index('ix_tasks_parent_project', 'tasks')
    op.drop_index('ix_tasks_item_type_project', 'tasks')
    op.drop_index('ix_tasks_workflow_state', 'tasks')
    op.drop_index('ix_tasks_assignee', 'tasks')
    op.drop_index('ix_tasks_priority', 'tasks')
    op.drop_index('ix_tasks_parent_id', 'tasks')
    op.drop_index('ix_tasks_item_type', 'tasks')

    # Drop foreign keys
    op.drop_constraint('fk_tasks_target_ai_model', 'tasks', type_='foreignkey')
    op.drop_constraint('fk_tasks_prompt_template', 'tasks', type_='foreignkey')
    op.drop_constraint('fk_tasks_parent', 'tasks', type_='foreignkey')

    # Drop columns
    op.drop_column('tasks', 'interview_insights')
    op.drop_column('tasks', 'interview_question_ids')
    op.drop_column('tasks', 'actual_tokens_used')
    op.drop_column('tasks', 'token_budget')
    op.drop_column('tasks', 'acceptance_criteria')
    op.drop_column('tasks', 'generation_context')
    op.drop_column('tasks', 'target_ai_model_id')
    op.drop_column('tasks', 'prompt_template_id')
    op.drop_column('tasks', 'status_history')
    op.drop_column('tasks', 'resolution_comment')
    op.drop_column('tasks', 'resolution')
    op.drop_column('tasks', 'workflow_state')
    op.drop_column('tasks', 'components')
    op.drop_column('tasks', 'labels')
    op.drop_column('tasks', 'assignee')
    op.drop_column('tasks', 'reporter')
    op.drop_column('tasks', 'sprint_id')
    op.drop_column('tasks', 'story_points')
    op.drop_column('tasks', 'severity')
    op.drop_column('tasks', 'priority')
    op.drop_column('tasks', 'parent_id')
    op.drop_column('tasks', 'item_type')

    # Drop ENUM types
    op.execute("DROP TYPE resolution_type")
    op.execute("DROP TYPE severity_level")
    op.execute("DROP TYPE priority_level")
    op.execute("DROP TYPE item_type")
