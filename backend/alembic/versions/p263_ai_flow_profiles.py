"""add ai_flow_profiles table and migrate existing chains

Revision ID: f263a1b2c3e4
Revises: e262a1b2c3e4
Create Date: 2026-02-25 00:00:00.000000

AI Flow Versioned Profiles
- Create ai_flow_profiles table for named, versioned flow configurations
- Migrate existing ai_flow_chains data into profiles
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'f263a1b2c3e4'
down_revision: Union[str, None] = 'e262a1b2c3e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Usage type display labels for migration
USAGE_TYPE_LABELS = {
    'interview': 'Interview Default',
    'task_execution': 'Task Execution Default',
    'prompt_generation': 'Prompt Generation Default',
    'commit_generation': 'Commit Generation Default',
    'general': 'General Default',
    'content_generation': 'Content Generation Default',
    'code_review': 'Code Review Default',
    'testing': 'Testing Default',
    'documentation': 'Documentation Default',
}


def upgrade() -> None:
    # Create ai_flow_profiles table
    op.create_table(
        'ai_flow_profiles',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('usage_type', sa.Enum(
            'interview', 'task_execution', 'prompt_generation',
            'commit_generation', 'general', 'content_generation',
            'code_review', 'testing', 'documentation',
            name='ai_model_usage_type',
            create_type=False,
        ), nullable=False, index=True),
        sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('chain', postgresql.JSON(), nullable=False, server_default='[]'),
        sa.Column('utility_nodes', postgresql.JSON(), nullable=True),
        sa.Column('node_positions', postgresql.JSON(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
    )

    # Migrate existing chains into profiles
    op.execute("""
        INSERT INTO ai_flow_profiles (id, name, usage_type, version, chain, utility_nodes, node_positions, is_active, created_at, updated_at)
        SELECT
            gen_random_uuid(),
            CASE usage_type
                WHEN 'interview' THEN 'Interview Default'
                WHEN 'task_execution' THEN 'Task Execution Default'
                WHEN 'prompt_generation' THEN 'Prompt Generation Default'
                WHEN 'commit_generation' THEN 'Commit Generation Default'
                WHEN 'general' THEN 'General Default'
                WHEN 'content_generation' THEN 'Content Generation Default'
                WHEN 'code_review' THEN 'Code Review Default'
                WHEN 'testing' THEN 'Testing Default'
                WHEN 'documentation' THEN 'Documentation Default'
                ELSE initcap(replace(usage_type::text, '_', ' ')) || ' Default'
            END,
            usage_type,
            1,
            chain,
            utility_nodes,
            node_positions,
            is_active,
            created_at,
            updated_at
        FROM ai_flow_chains
    """)


def downgrade() -> None:
    op.drop_table('ai_flow_profiles')
