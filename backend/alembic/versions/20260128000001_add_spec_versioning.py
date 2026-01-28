"""Add spec versioning

PROMPT #117 - Spec versioning
- Add version column to specs table
- Create spec_history table for audit trail

Revision ID: 20260128000001
Revises:
Create Date: 2026-01-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '20260128000001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add version column to specs table
    op.add_column('specs', sa.Column('version', sa.Integer(), nullable=True))
    op.add_column('specs', sa.Column('git_commit_hash', sa.String(40), nullable=True))

    # Set default value for existing records
    op.execute("UPDATE specs SET version = 1 WHERE version IS NULL")

    # Make column NOT NULL after setting defaults
    op.alter_column('specs', 'version', nullable=False)

    # Create spec_history table
    op.create_table(
        'spec_history',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('spec_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('category', sa.String(50), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('spec_type', sa.String(50), nullable=False),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('language', sa.String(50), nullable=True),
        sa.Column('framework_version', sa.String(20), nullable=True),
        sa.Column('change_reason', sa.String(255), nullable=True),
        sa.Column('changed_by', sa.String(100), nullable=True),
        sa.Column('git_commit_hash', sa.String(40), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['spec_id'], ['specs.id'], ondelete='CASCADE'),
    )

    # Create indexes
    op.create_index('ix_spec_history_id', 'spec_history', ['id'])
    op.create_index('ix_spec_history_spec_id', 'spec_history', ['spec_id'])
    op.create_index('ix_spec_history_version', 'spec_history', ['spec_id', 'version'])


def downgrade() -> None:
    # Drop spec_history table
    op.drop_index('ix_spec_history_version', table_name='spec_history')
    op.drop_index('ix_spec_history_spec_id', table_name='spec_history')
    op.drop_index('ix_spec_history_id', table_name='spec_history')
    op.drop_table('spec_history')

    # Remove columns from specs
    op.drop_column('specs', 'git_commit_hash')
    op.drop_column('specs', 'version')
