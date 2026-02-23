"""add contracts table

Revision ID: c257a1b2d3e4
Revises: a7f3c9e2d8b4
Create Date: 2026-02-23 00:00:00.000000

PROMPT #257 - Contracts in Database + Visual Nodes in AI Flow
- Create contracts table to store prompt contracts (previously YAML files)
- Each contract can be visualized as a node in the AI Flow diagram
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'c257a1b2d3e4'
down_revision: Union[str, None] = 'a7f3c9e2d8b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'contracts',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, index=True),
        sa.Column('name', sa.String(255), unique=True, nullable=False, index=True),
        sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('domain', sa.String(50), nullable=False, server_default='generation', index=True),
        sa.Column('category', sa.String(100), nullable=False, server_default=''),
        sa.Column('usage_type', sa.String(50), nullable=False, server_default='general', index=True),
        sa.Column('description', sa.Text(), server_default=''),
        sa.Column('system_prompt', sa.Text(), server_default=''),
        sa.Column('user_prompt', sa.Text(), server_default=''),
        sa.Column('semantic_map', postgresql.JSON(), server_default='{}'),
        sa.Column('variables', postgresql.JSON(), server_default='{}'),
        sa.Column('governance', postgresql.JSON(), server_default='{}'),
        sa.Column('rules', postgresql.JSON(), server_default='{}'),
        sa.Column('validators', postgresql.JSON(), server_default='[]'),
        sa.Column('execution', postgresql.JSON(), server_default='{}'),
        sa.Column('data', postgresql.JSON(), server_default='{}'),
        sa.Column('components', postgresql.JSON(), server_default='[]'),
        sa.Column('tags', postgresql.JSON(), server_default='[]'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
    )


def downgrade() -> None:
    op.drop_table('contracts')
