"""add pipeline_artifacts table and project deep pipeline fields

Revision ID: d260a1b2c3e4
Revises: c257a1b2d3e4
Create Date: 2026-02-23 00:00:00.000000

Deep Pipeline (7-phase) - Foundation
- Create pipeline_artifacts table to store intermediate phase artifacts
- Add project_architecture, pipeline_quality_score, pipeline_version to projects
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'd260a1b2c3e4'
down_revision: Union[str, None] = 'c257a1b2d3e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create pipeline_artifacts table
    op.create_table(
        'pipeline_artifacts',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, index=True),
        sa.Column('project_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('artifact_type', sa.String(50), nullable=False, index=True),
        sa.Column('phase', sa.Integer(), nullable=False),
        sa.Column('domain', sa.String(255), nullable=True, index=True),
        sa.Column('source_path', sa.String(500), nullable=True),
        sa.Column('content', postgresql.JSONB(), nullable=False),
        sa.Column('quality_score', sa.Integer(), nullable=True),
        sa.Column('run_id', postgresql.UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )

    # Composite indexes for common query patterns
    op.create_index('ix_pipeline_artifacts_project_phase', 'pipeline_artifacts', ['project_id', 'phase'])
    op.create_index('ix_pipeline_artifacts_run_type', 'pipeline_artifacts', ['run_id', 'artifact_type'])

    # Add deep pipeline fields to projects table
    op.add_column('projects', sa.Column('project_architecture', postgresql.JSON(), nullable=True))
    op.add_column('projects', sa.Column('pipeline_quality_score', sa.String(10), nullable=True))
    op.add_column('projects', sa.Column('pipeline_version', sa.String(10), nullable=True))


def downgrade() -> None:
    # Remove project columns
    op.drop_column('projects', 'pipeline_version')
    op.drop_column('projects', 'pipeline_quality_score')
    op.drop_column('projects', 'project_architecture')

    # Drop indexes and table
    op.drop_index('ix_pipeline_artifacts_run_type', table_name='pipeline_artifacts')
    op.drop_index('ix_pipeline_artifacts_project_phase', table_name='pipeline_artifacts')
    op.drop_table('pipeline_artifacts')
