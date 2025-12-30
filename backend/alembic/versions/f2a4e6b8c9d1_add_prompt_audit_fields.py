"""add_prompt_audit_fields

Revision ID: f2a4e6b8c9d1
Revises: e5be97316b3f
Create Date: 2025-12-29 18:45:00.000000

PROMPT #58 - Add audit fields to Prompt model for comprehensive AI execution logging
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'f2a4e6b8c9d1'
down_revision: Union[str, None] = 'e5be97316b3f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add AI execution audit fields to prompts table
    op.add_column('prompts', sa.Column('ai_model_used', sa.String(100), nullable=True))
    op.add_column('prompts', sa.Column('system_prompt', sa.Text(), nullable=True))
    op.add_column('prompts', sa.Column('user_prompt', sa.Text(), nullable=True))
    op.add_column('prompts', sa.Column('response', sa.Text(), nullable=True))
    op.add_column('prompts', sa.Column('input_tokens', sa.Integer(), nullable=True, default=0))
    op.add_column('prompts', sa.Column('output_tokens', sa.Integer(), nullable=True, default=0))
    op.add_column('prompts', sa.Column('total_cost_usd', sa.Float(), nullable=True, default=0.0))
    op.add_column('prompts', sa.Column('execution_time_ms', sa.Integer(), nullable=True, default=0))
    op.add_column('prompts', sa.Column('execution_metadata', postgresql.JSON(astext_type=sa.Text()), nullable=True))
    op.add_column('prompts', sa.Column('status', sa.String(20), nullable=True, default='success'))
    op.add_column('prompts', sa.Column('error_message', sa.Text(), nullable=True))

    # Create indexes for common query patterns
    op.create_index('ix_prompts_ai_model_used', 'prompts', ['ai_model_used'])
    op.create_index('ix_prompts_status', 'prompts', ['status'])
    op.create_index('ix_prompts_created_at', 'prompts', ['created_at'])


def downgrade() -> None:
    # Drop indexes
    op.drop_index('ix_prompts_created_at', table_name='prompts')
    op.drop_index('ix_prompts_status', table_name='prompts')
    op.drop_index('ix_prompts_ai_model_used', table_name='prompts')

    # Drop columns
    op.drop_column('prompts', 'error_message')
    op.drop_column('prompts', 'status')
    op.drop_column('prompts', 'execution_metadata')
    op.drop_column('prompts', 'execution_time_ms')
    op.drop_column('prompts', 'total_cost_usd')
    op.drop_column('prompts', 'output_tokens')
    op.drop_column('prompts', 'input_tokens')
    op.drop_column('prompts', 'response')
    op.drop_column('prompts', 'user_prompt')
    op.drop_column('prompts', 'system_prompt')
    op.drop_column('prompts', 'ai_model_used')
