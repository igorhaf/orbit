"""create_specs_table

Revision ID: e9f1a3b25d7c
Revises: d8e3f5b62c4a
Create Date: 2025-12-29 16:00:00.000000

PROMPT #47 - Phase 2: Dynamic Specs Database System
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'e9f1a3b25d7c'
down_revision: Union[str, None] = 'd8e3f5b62c4a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create specs table
    op.create_table(
        'specs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),

        # Core fields
        sa.Column('category', sa.String(50), nullable=False),       # 'backend', 'frontend', 'database', 'css'
        sa.Column('name', sa.String(100), nullable=False),          # 'laravel', 'nextjs', 'postgresql', 'tailwind'
        sa.Column('spec_type', sa.String(50), nullable=False),      # 'controller', 'model', 'page', 'migration', etc

        # Content
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('content', sa.Text(), nullable=False),

        # Metadata
        sa.Column('language', sa.String(50), nullable=True),
        sa.Column('framework_version', sa.String(20), nullable=True),

        # Patterns
        sa.Column('ignore_patterns', postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column('file_extensions', postgresql.ARRAY(sa.Text()), nullable=True),

        # Status
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('usage_count', sa.Integer(), nullable=False, server_default='0'),

        # Timestamps
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP'))
    )

    # Create indexes for efficient querying
    op.create_index('ix_specs_id', 'specs', ['id'])
    op.create_index('ix_specs_category', 'specs', ['category'])
    op.create_index('ix_specs_name', 'specs', ['name'])
    op.create_index('ix_specs_category_name', 'specs', ['category', 'name'])
    op.create_index('ix_specs_is_active', 'specs', ['is_active'])


def downgrade() -> None:
    # Drop indexes
    op.drop_index('ix_specs_is_active', 'specs')
    op.drop_index('ix_specs_category_name', 'specs')
    op.drop_index('ix_specs_name', 'specs')
    op.drop_index('ix_specs_category', 'specs')
    op.drop_index('ix_specs_id', 'specs')

    # Drop table
    op.drop_table('specs')
