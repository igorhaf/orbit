"""add_prompt_template_table

Revision ID: 9088b001976c
Revises: f2a4e6b8c9d1
Create Date: 2025-12-31 13:13:39.576764

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9088b001976c'
down_revision: Union[str, None] = 'f2a4e6b8c9d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create prompt_templates table
    op.create_table(
        'prompt_templates',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('category', sa.String(length=50), nullable=True),
        sa.Column('template_content', sa.Text(), nullable=False),
        sa.Column('template_format', sa.String(length=20), nullable=True, server_default='jinja2'),
        sa.Column('base_template_id', sa.UUID(), nullable=True),
        sa.Column('components', sa.JSON(), nullable=True),
        sa.Column('variables_schema', sa.JSON(), nullable=True),
        sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('parent_version_id', sa.UUID(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True, server_default='true'),
        sa.Column('usage_count', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('avg_cost', sa.Float(), nullable=True, server_default='0.0'),
        sa.Column('avg_quality_score', sa.Float(), nullable=True),
        sa.Column('project_id', sa.UUID(), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('tags', sa.JSON(), nullable=True),
        sa.Column('post_process', sa.JSON(), nullable=True),
        sa.Column('recommended_model', sa.String(length=50), nullable=True),
        sa.Column('estimated_tokens', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['base_template_id'], ['prompt_templates.id'], ),
        sa.ForeignKeyConstraint(['parent_version_id'], ['prompt_templates.id'], ),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
        sa.PrimaryKeyConstraint('id')
    )

    # Create indexes
    op.create_index(op.f('ix_prompt_templates_name'), 'prompt_templates', ['name'], unique=False)
    op.create_index(op.f('ix_prompt_templates_is_active'), 'prompt_templates', ['is_active'], unique=False)


def downgrade() -> None:
    # Drop indexes
    op.drop_index(op.f('ix_prompt_templates_is_active'), table_name='prompt_templates')
    op.drop_index(op.f('ix_prompt_templates_name'), table_name='prompt_templates')

    # Drop table
    op.drop_table('prompt_templates')
