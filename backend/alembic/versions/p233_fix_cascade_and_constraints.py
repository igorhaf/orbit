"""PROMPT #233 - Fix cascade policies and add constraints

Revision ID: p233_cascade_fix
Revises: 967131d5b898
Create Date: 2026-02-20 03:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'p233_cascade_fix'
down_revision: Union[str, None] = '967131d5b898'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # DB-1: Fix Task parent_id from SET NULL to CASCADE
    op.drop_constraint('fk_tasks_parent', 'tasks', type_='foreignkey')
    op.create_foreign_key(
        'fk_tasks_parent', 'tasks', 'tasks',
        ['parent_id'], ['id'], ondelete='CASCADE'
    )

    # DB-2: Fix Prompt created_from_interview_id from SET NULL to CASCADE
    op.drop_constraint('prompts_created_from_interview_id_fkey', 'prompts', type_='foreignkey')
    op.create_foreign_key(
        'prompts_created_from_interview_id_fkey', 'prompts', 'interviews',
        ['created_from_interview_id'], ['id'], ondelete='CASCADE'
    )

    # DB-3: Fix PromptTemplate FKs - add explicit ondelete
    # base_template_id
    try:
        op.drop_constraint('prompt_templates_base_template_id_fkey', 'prompt_templates', type_='foreignkey')
        op.create_foreign_key(
            'prompt_templates_base_template_id_fkey', 'prompt_templates', 'prompt_templates',
            ['base_template_id'], ['id'], ondelete='SET NULL'
        )
    except Exception:
        pass  # Constraint may not exist if table was never created

    # parent_version_id
    try:
        op.drop_constraint('prompt_templates_parent_version_id_fkey', 'prompt_templates', type_='foreignkey')
        op.create_foreign_key(
            'prompt_templates_parent_version_id_fkey', 'prompt_templates', 'prompt_templates',
            ['parent_version_id'], ['id'], ondelete='SET NULL'
        )
    except Exception:
        pass

    # project_id
    try:
        op.drop_constraint('prompt_templates_project_id_fkey', 'prompt_templates', type_='foreignkey')
        op.create_foreign_key(
            'prompt_templates_project_id_fkey', 'prompt_templates', 'projects',
            ['project_id'], ['id'], ondelete='CASCADE'
        )
    except Exception:
        pass

    # DB-4: Add unique constraint to TaskRelationship
    try:
        op.create_unique_constraint(
            'uq_task_relationship_tuple', 'task_relationships',
            ['source_task_id', 'target_task_id', 'relationship_type']
        )
    except Exception:
        pass  # May already exist or table may not exist


def downgrade() -> None:
    # Revert DB-4
    try:
        op.drop_constraint('uq_task_relationship_tuple', 'task_relationships', type_='unique')
    except Exception:
        pass

    # Revert DB-3 (back to no ondelete)
    try:
        op.drop_constraint('prompt_templates_project_id_fkey', 'prompt_templates', type_='foreignkey')
        op.create_foreign_key(
            'prompt_templates_project_id_fkey', 'prompt_templates', 'projects',
            ['project_id'], ['id']
        )
    except Exception:
        pass

    try:
        op.drop_constraint('prompt_templates_parent_version_id_fkey', 'prompt_templates', type_='foreignkey')
        op.create_foreign_key(
            'prompt_templates_parent_version_id_fkey', 'prompt_templates', 'prompt_templates',
            ['parent_version_id'], ['id']
        )
    except Exception:
        pass

    try:
        op.drop_constraint('prompt_templates_base_template_id_fkey', 'prompt_templates', type_='foreignkey')
        op.create_foreign_key(
            'prompt_templates_base_template_id_fkey', 'prompt_templates', 'prompt_templates',
            ['base_template_id'], ['id']
        )
    except Exception:
        pass

    # Revert DB-2 (back to SET NULL)
    op.drop_constraint('prompts_created_from_interview_id_fkey', 'prompts', type_='foreignkey')
    op.create_foreign_key(
        'prompts_created_from_interview_id_fkey', 'prompts', 'interviews',
        ['created_from_interview_id'], ['id'], ondelete='SET NULL'
    )

    # Revert DB-1 (back to SET NULL)
    op.drop_constraint('fk_tasks_parent', 'tasks', type_='foreignkey')
    op.create_foreign_key(
        'fk_tasks_parent', 'tasks', 'tasks',
        ['parent_id'], ['id'], ondelete='SET NULL'
    )
