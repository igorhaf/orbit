"""add pipeline_profiles and pipeline_runs tables

Revision ID: e262a1b2c3e4
Revises: d260a1b2c3e4
Create Date: 2026-02-24 00:00:00.000000

Deep Pipeline Dynamic Configuration
- Create pipeline_profiles table for configurable execution profiles
- Create pipeline_runs table for run history with per-phase scoring
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'e262a1b2c3e4'
down_revision: Union[str, None] = 'd260a1b2c3e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create pipeline_profiles table
    op.create_table(
        'pipeline_profiles',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, index=True),
        sa.Column('name', sa.String(50), unique=True, nullable=False, index=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('phase_configs', postgresql.JSONB(), nullable=False),
        sa.Column('quality_threshold', sa.Integer(), nullable=False, server_default='60'),
        sa.Column('is_default', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
    )

    # Create pipeline_runs table
    op.create_table(
        'pipeline_runs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, index=True),
        sa.Column('project_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('profile_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('pipeline_profiles.id', ondelete='SET NULL'), nullable=True),
        sa.Column('profile_snapshot', postgresql.JSONB(), nullable=True),
        sa.Column('profile_name', sa.String(50), nullable=True),
        sa.Column('version', sa.String(10), nullable=False, server_default='v2'),
        sa.Column('status', sa.String(20), nullable=False, server_default='running'),
        sa.Column('overall_score', sa.Integer(), nullable=True),
        sa.Column('phase_scores', postgresql.JSONB(), nullable=True),
        sa.Column('phase_durations', postgresql.JSONB(), nullable=True),
        sa.Column('total_files_scanned', sa.Integer(), nullable=True),
        sa.Column('total_rules_extracted', sa.Integer(), nullable=True),
        sa.Column('total_domains', sa.Integer(), nullable=True),
        sa.Column('total_cards_created', sa.Integer(), nullable=True),
        sa.Column('total_wiki_pages', sa.Integer(), nullable=True),
        sa.Column('total_input_tokens', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('total_output_tokens', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('estimated_cost_usd', sa.Numeric(10, 4), nullable=True),
        sa.Column('reinforcement_applied', postgresql.JSONB(), nullable=True),
        sa.Column('error', sa.String(1000), nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
    )


def downgrade() -> None:
    op.drop_table('pipeline_runs')
    op.drop_table('pipeline_profiles')
