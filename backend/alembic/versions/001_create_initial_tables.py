"""Create initial tables

Revision ID: 001
Revises:
Create Date: 2025-12-26 02:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create custom enum types with conditional logic to handle existing types
    connection = op.get_bind()

    connection.execute(text("""
        DO $$ BEGIN
            CREATE TYPE interview_status AS ENUM ('active', 'completed', 'cancelled');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """))

    connection.execute(text("""
        DO $$ BEGIN
            CREATE TYPE task_status AS ENUM ('backlog', 'todo', 'in_progress', 'review', 'done');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """))

    connection.execute(text("""
        DO $$ BEGIN
            CREATE TYPE chat_session_status AS ENUM ('active', 'completed', 'failed');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """))

    connection.execute(text("""
        DO $$ BEGIN
            CREATE TYPE commit_type AS ENUM ('feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore', 'perf');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """))

    connection.execute(text("""
        DO $$ BEGIN
            CREATE TYPE ai_model_usage_type AS ENUM ('interview', 'prompt_generation', 'commit_generation', 'task_execution', 'general');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """))

    # Create projects table
    op.create_table(
        'projects',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('git_repository_info', postgresql.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_projects_id', 'projects', ['id'])
    op.create_index('ix_projects_name', 'projects', ['name'])

    # Create interviews table
    op.create_table(
        'interviews',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('conversation_data', postgresql.JSON(), nullable=False),
        sa.Column('ai_model_used', sa.String(100), nullable=False),
        sa.Column('status', postgresql.ENUM('active', 'completed', 'cancelled', name='interview_status', create_type=False), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_interviews_id', 'interviews', ['id'])
    op.create_index('ix_interviews_project_id', 'interviews', ['project_id'])
    op.create_index('ix_interviews_status', 'interviews', ['status'])

    # Create prompts table
    op.create_table(
        'prompts',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_from_interview_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('parent_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('type', sa.String(50), nullable=False),
        sa.Column('is_reusable', sa.Boolean(), nullable=False),
        sa.Column('components', postgresql.JSON(), nullable=True),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_from_interview_id'], ['interviews.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['parent_id'], ['prompts.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_prompts_id', 'prompts', ['id'])
    op.create_index('ix_prompts_project_id', 'prompts', ['project_id'])
    op.create_index('ix_prompts_created_from_interview_id', 'prompts', ['created_from_interview_id'])
    op.create_index('ix_prompts_parent_id', 'prompts', ['parent_id'])
    op.create_index('ix_prompts_type', 'prompts', ['type'])

    # Create tasks table
    op.create_table(
        'tasks',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('prompt_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('status', postgresql.ENUM('backlog', 'todo', 'in_progress', 'review', 'done', name='task_status', create_type=False), nullable=False),
        sa.Column('column', sa.String(50), nullable=False),
        sa.Column('order', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['prompt_id'], ['prompts.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_tasks_id', 'tasks', ['id'])
    op.create_index('ix_tasks_prompt_id', 'tasks', ['prompt_id'])
    op.create_index('ix_tasks_project_id', 'tasks', ['project_id'])
    op.create_index('ix_tasks_status', 'tasks', ['status'])

    # Create chat_sessions table
    op.create_table(
        'chat_sessions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('task_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('messages', postgresql.JSON(), nullable=False),
        sa.Column('ai_model_used', sa.String(100), nullable=False),
        sa.Column('status', postgresql.ENUM('active', 'completed', 'failed', name='chat_session_status', create_type=False), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_chat_sessions_id', 'chat_sessions', ['id'])
    op.create_index('ix_chat_sessions_task_id', 'chat_sessions', ['task_id'])
    op.create_index('ix_chat_sessions_status', 'chat_sessions', ['status'])

    # Create commits table
    op.create_table(
        'commits',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('task_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('type', postgresql.ENUM('feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore', 'perf', name='commit_type', create_type=False), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('changes', postgresql.JSON(), nullable=True),
        sa.Column('created_by_ai_model', sa.String(100), nullable=False),
        sa.Column('author', sa.String(100), nullable=False),
        sa.Column('timestamp', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_commits_id', 'commits', ['id'])
    op.create_index('ix_commits_task_id', 'commits', ['task_id'])
    op.create_index('ix_commits_project_id', 'commits', ['project_id'])
    op.create_index('ix_commits_type', 'commits', ['type'])
    op.create_index('ix_commits_timestamp', 'commits', ['timestamp'])

    # Create ai_models table
    op.create_table(
        'ai_models',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(100), nullable=False, unique=True),
        sa.Column('provider', sa.String(50), nullable=False),
        sa.Column('api_key', sa.String(255), nullable=False),
        sa.Column('usage_type', postgresql.ENUM('interview', 'prompt_generation', 'commit_generation', 'task_execution', 'general', name='ai_model_usage_type', create_type=False), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('config', postgresql.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_ai_models_id', 'ai_models', ['id'])
    op.create_index('ix_ai_models_name', 'ai_models', ['name'], unique=True)
    op.create_index('ix_ai_models_provider', 'ai_models', ['provider'])
    op.create_index('ix_ai_models_usage_type', 'ai_models', ['usage_type'])
    op.create_index('ix_ai_models_is_active', 'ai_models', ['is_active'])

    # Create system_settings table
    op.create_table(
        'system_settings',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('key', sa.String(100), nullable=False, unique=True),
        sa.Column('value', postgresql.JSON(), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_system_settings_id', 'system_settings', ['id'])
    op.create_index('ix_system_settings_key', 'system_settings', ['key'], unique=True)


def downgrade() -> None:
    # Drop tables in reverse order
    op.drop_table('system_settings')
    op.drop_table('ai_models')
    op.drop_table('commits')
    op.drop_table('chat_sessions')
    op.drop_table('tasks')
    op.drop_table('prompts')
    op.drop_table('interviews')
    op.drop_table('projects')

    # Drop custom enum types
    op.execute("DROP TYPE IF EXISTS ai_model_usage_type")
    op.execute("DROP TYPE IF EXISTS commit_type")
    op.execute("DROP TYPE IF EXISTS chat_session_status")
    op.execute("DROP TYPE IF EXISTS task_status")
    op.execute("DROP TYPE IF EXISTS interview_status")
