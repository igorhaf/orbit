"""add_rag_metrics_to_ai_executions

Revision ID: 20260108000002
Revises: 20260108000001
Create Date: 2026-01-08 17:00:00.000000

PROMPT #89 - RAG Monitoring & Analytics
- Add RAG metrics tracking to ai_executions table
- Track: rag_enabled, rag_hit, rag_results_count, rag_top_similarity, rag_retrieval_time_ms
- Enable monitoring of RAG hit rate and performance
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260108000002'
down_revision: Union[str, None] = '20260108000001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add RAG metrics columns to ai_executions table.

    Metrics tracked:
    - rag_enabled: Was RAG feature enabled for this execution?
    - rag_hit: Did RAG find relevant results?
    - rag_results_count: Number of RAG documents retrieved
    - rag_top_similarity: Highest similarity score (0.0-1.0)
    - rag_retrieval_time_ms: Time spent on RAG retrieval in milliseconds
    """
    from sqlalchemy import inspect
    from sqlalchemy.engine import reflection

    print("📊 Adding RAG metrics columns to ai_executions table...")

    # Get connection and check which columns already exist
    conn = op.get_bind()
    inspector = inspect(conn)
    existing_columns = {col['name'] for col in inspector.get_columns('ai_executions')}

    # Add RAG metrics columns only if they don't exist
    if 'rag_enabled' not in existing_columns:
        op.add_column('ai_executions', sa.Column('rag_enabled', sa.Boolean(), nullable=True, default=False))
    if 'rag_hit' not in existing_columns:
        op.add_column('ai_executions', sa.Column('rag_hit', sa.Boolean(), nullable=True, default=False))
    if 'rag_results_count' not in existing_columns:
        op.add_column('ai_executions', sa.Column('rag_results_count', sa.Integer(), nullable=True, default=0))
    if 'rag_top_similarity' not in existing_columns:
        op.add_column('ai_executions', sa.Column('rag_top_similarity', sa.Float(), nullable=True))
    if 'rag_retrieval_time_ms' not in existing_columns:
        op.add_column('ai_executions', sa.Column('rag_retrieval_time_ms', sa.Float(), nullable=True))

    print("✅ RAG metrics columns added successfully")
    print("\nTracking:")
    print("  - rag_enabled: Was RAG used?")
    print("  - rag_hit: Did RAG find results?")
    print("  - rag_results_count: Number of docs retrieved")
    print("  - rag_top_similarity: Highest similarity score")
    print("  - rag_retrieval_time_ms: Retrieval latency")


def downgrade() -> None:
    """
    Remove RAG metrics columns from ai_executions table.
    """

    print("⚠️  Removing RAG metrics columns from ai_executions...")

    op.drop_column('ai_executions', 'rag_retrieval_time_ms')
    op.drop_column('ai_executions', 'rag_top_similarity')
    op.drop_column('ai_executions', 'rag_results_count')
    op.drop_column('ai_executions', 'rag_hit')
    op.drop_column('ai_executions', 'rag_enabled')

    print("✅ RAG metrics columns removed")
