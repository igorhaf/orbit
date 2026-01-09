"""create task_results table

Revision ID: 250541e1bafc
Revises: 1838e26713b5
Create Date: 2025-12-27 19:59:02.395383

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSON


# revision identifiers, used by Alembic.
revision: str = '250541e1bafc'
down_revision: Union[str, None] = '1838e26713b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create task_results table
    op.create_table(
        'task_results',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('task_id', UUID(as_uuid=True), sa.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('output_code', sa.Text(), nullable=False),
        sa.Column('file_path', sa.String(500), nullable=True),
        sa.Column('model_used', sa.String(100), nullable=True),
        sa.Column('input_tokens', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('output_tokens', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('cost', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('execution_time', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('validation_passed', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('validation_issues', JSON(), nullable=True),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()'))
    )
    op.create_index(op.f('ix_task_results_id'), 'task_results', ['id'], unique=False)
    op.create_index(op.f('ix_task_results_task_id'), 'task_results', ['task_id'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_task_results_task_id'), table_name='task_results')
    op.drop_index(op.f('ix_task_results_id'), table_name='task_results')
    op.drop_table('task_results')
