"""add_pattern_discovery_fields

Revision ID: a1b2c3d4e5f6
Revises: 656b42f1fb6d
Create Date: 2026-01-03 12:00:00.000000

PROMPT #62 - Week 1 Day 1: Add pattern discovery support
- Add project_id, scope, discovery_metadata to Spec model
- Add code_path to Project model
- Enable AI-powered pattern discovery from ANY codebase
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '656b42f1fb6d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create spec_scope ENUM type
    spec_scope_enum = postgresql.ENUM('framework', 'project', name='spec_scope')
    spec_scope_enum.create(op.get_bind())

    # Add new columns to specs table
    op.add_column('specs', sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('specs', sa.Column('scope', postgresql.ENUM('framework', 'project', name='spec_scope', create_type=False), nullable=False, server_default='framework'))
    op.add_column('specs', sa.Column('discovery_metadata', postgresql.JSON(astext_type=sa.Text()), nullable=True))

    # Create foreign key constraint
    op.create_foreign_key('fk_spec_project', 'specs', 'projects', ['project_id'], ['id'], ondelete='CASCADE')

    # Create indexes for efficient querying
    op.create_index('ix_specs_project_id', 'specs', ['project_id'])
    op.create_index('ix_specs_scope', 'specs', ['scope'])

    # Add code_path to projects table
    op.add_column('projects', sa.Column('code_path', sa.String(500), nullable=True))
    op.create_index('ix_projects_code_path', 'projects', ['code_path'])


def downgrade() -> None:
    # Drop indexes
    op.drop_index('ix_projects_code_path', table_name='projects')
    op.drop_index('ix_specs_scope', table_name='specs')
    op.drop_index('ix_specs_project_id', table_name='specs')

    # Drop foreign key constraint
    op.drop_constraint('fk_spec_project', 'specs', type_='foreignkey')

    # Drop columns from projects
    op.drop_column('projects', 'code_path')

    # Drop columns from specs
    op.drop_column('specs', 'discovery_metadata')
    op.drop_column('specs', 'scope')
    op.drop_column('specs', 'project_id')

    # Drop ENUM type
    spec_scope_enum = postgresql.ENUM('framework', 'project', name='spec_scope')
    spec_scope_enum.drop(op.get_bind())
