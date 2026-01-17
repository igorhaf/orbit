"""create_ai_executions_table

Revision ID: 20260107100000
Revises: 20260107000002
Create Date: 2026-01-07 10:00:00.000000

PROMPT #54 - AI Execution Logging System
Creates the ai_executions table for tracking all AI model executions.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '20260107100000'
down_revision: Union[str, None] = '20260107000002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Create ai_executions table for tracking AI model executions.

    This table logs every AI model call for:
    - Audit trail
    - Cost monitoring
    - Performance analysis
    - Debugging
    """
    # Check if table already exists
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)

    if 'ai_executions' in inspector.get_table_names():
        print("✅ Table ai_executions already exists, skipping creation")
        return

    print("📊 Creating ai_executions table...")

    op.create_table(
        'ai_executions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('ai_model_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('usage_type', sa.String(50), nullable=False),
        sa.Column('input_messages', postgresql.JSON(), nullable=False),
        sa.Column('system_prompt', sa.Text(), nullable=True),
        sa.Column('response_content', sa.Text(), nullable=True),
        sa.Column('input_tokens', sa.Integer(), nullable=True),
        sa.Column('output_tokens', sa.Integer(), nullable=True),
        sa.Column('total_tokens', sa.Integer(), nullable=True),
        sa.Column('provider', sa.String(50), nullable=False),
        sa.Column('model_name', sa.String(100), nullable=False),
        sa.Column('temperature', sa.String(10), nullable=True),
        sa.Column('max_tokens', sa.Integer(), nullable=True),
        sa.Column('execution_metadata', postgresql.JSON(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('execution_time_ms', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['ai_model_id'], ['ai_models.id'], ondelete='SET NULL'),
    )

    # Create indexes
    op.create_index('ix_ai_executions_id', 'ai_executions', ['id'])
    op.create_index('ix_ai_executions_ai_model_id', 'ai_executions', ['ai_model_id'])
    op.create_index('ix_ai_executions_usage_type', 'ai_executions', ['usage_type'])
    op.create_index('ix_ai_executions_provider', 'ai_executions', ['provider'])
    op.create_index('ix_ai_executions_created_at', 'ai_executions', ['created_at'])

    print("✅ ai_executions table created successfully")


def downgrade() -> None:
    """
    Drop ai_executions table.
    """
    print("⚠️  Dropping ai_executions table...")

    op.drop_index('ix_ai_executions_created_at', table_name='ai_executions')
    op.drop_index('ix_ai_executions_provider', table_name='ai_executions')
    op.drop_index('ix_ai_executions_usage_type', table_name='ai_executions')
    op.drop_index('ix_ai_executions_ai_model_id', table_name='ai_executions')
    op.drop_index('ix_ai_executions_id', table_name='ai_executions')
    op.drop_table('ai_executions')

    print("✅ ai_executions table dropped")
