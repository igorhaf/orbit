"""create_relationship_comment_transition_tables

Revision ID: bbccddee2222
Revises: aabbccdd1111
Create Date: 2026-01-04 00:05:00.000000

JIRA Transformation - Phase 1: Create New Tables
- Create task_relationships table (blocks, depends_on, etc.)
- Create task_comments table (structured comments)
- Create status_transitions table (audit log)
- Add indexes for performance
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'bbccddee2222'
down_revision: Union[str, None] = 'aabbccdd1111'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create relationship_type ENUM (IF NOT EXISTS to handle idempotency)
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE relationship_type AS ENUM (
                'blocks', 'blocked_by', 'depends_on', 'relates_to', 'duplicates', 'clones'
            );
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)

    # 2. Create comment_type ENUM (IF NOT EXISTS to handle idempotency)
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE comment_type AS ENUM (
                'comment', 'system', 'ai_insight', 'validation', 'code_snippet'
            );
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)

    # 3. Create task_relationships table
    op.create_table(
        'task_relationships',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('source_task_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('target_task_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            'relationship_type',
            sa.Enum('blocks', 'blocked_by', 'depends_on', 'relates_to', 'duplicates', 'clones', name='relationship_type'),
            nullable=False
        ),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),

        sa.ForeignKeyConstraint(['source_task_id'], ['tasks.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['target_task_id'], ['tasks.id'], ondelete='CASCADE'),
    )

    # 4. Create task_comments table
    op.create_table(
        'task_comments',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('task_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('author', sa.String(100), nullable=False),
        sa.Column('content', sa.Text, nullable=False),
        sa.Column(
            'comment_type',
            sa.Enum('comment', 'system', 'ai_insight', 'validation', 'code_snippet', name='comment_type'),
            nullable=False,
            server_default='comment'
        ),
        sa.Column('metadata', postgresql.JSON, nullable=True),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime, nullable=False, server_default=sa.func.now()),

        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='CASCADE'),
    )

    # 5. Create status_transitions table
    op.create_table(
        'status_transitions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('task_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('from_status', sa.String(50), nullable=False),
        sa.Column('to_status', sa.String(50), nullable=False),
        sa.Column('transitioned_by', sa.String(100), nullable=True),
        sa.Column('transition_reason', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),

        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='CASCADE'),
    )

    # 6. Create Indexes for task_relationships
    op.create_index('ix_task_relationships_id', 'task_relationships', ['id'])
    op.create_index('ix_task_relationships_source', 'task_relationships', ['source_task_id'])
    op.create_index('ix_task_relationships_target', 'task_relationships', ['target_task_id'])
    op.create_index('ix_task_relationships_type', 'task_relationships', ['relationship_type'])
    op.create_index('ix_task_rel_source_target', 'task_relationships', ['source_task_id', 'target_task_id'])
    op.create_index('ix_task_rel_type_source', 'task_relationships', ['relationship_type', 'source_task_id'])

    # 7. Create Indexes for task_comments
    op.create_index('ix_task_comments_id', 'task_comments', ['id'])
    op.create_index('ix_task_comments_task', 'task_comments', ['task_id'])
    op.create_index('ix_task_comments_created', 'task_comments', ['created_at'])

    # 8. Create Indexes for status_transitions
    op.create_index('ix_status_transitions_id', 'status_transitions', ['id'])
    op.create_index('ix_status_transitions_task', 'status_transitions', ['task_id'])
    op.create_index('ix_status_transitions_created', 'status_transitions', ['created_at'])


def downgrade() -> None:
    # Drop indexes
    op.drop_index('ix_status_transitions_created', 'status_transitions')
    op.drop_index('ix_status_transitions_task', 'status_transitions')
    op.drop_index('ix_status_transitions_id', 'status_transitions')

    op.drop_index('ix_task_comments_created', 'task_comments')
    op.drop_index('ix_task_comments_task', 'task_comments')
    op.drop_index('ix_task_comments_id', 'task_comments')

    op.drop_index('ix_task_rel_type_source', 'task_relationships')
    op.drop_index('ix_task_rel_source_target', 'task_relationships')
    op.drop_index('ix_task_relationships_type', 'task_relationships')
    op.drop_index('ix_task_relationships_target', 'task_relationships')
    op.drop_index('ix_task_relationships_source', 'task_relationships')
    op.drop_index('ix_task_relationships_id', 'task_relationships')

    # Drop tables
    op.drop_table('status_transitions')
    op.drop_table('task_comments')
    op.drop_table('task_relationships')

    # Drop ENUM types
    op.execute("DROP TYPE comment_type")
    op.execute("DROP TYPE relationship_type")
