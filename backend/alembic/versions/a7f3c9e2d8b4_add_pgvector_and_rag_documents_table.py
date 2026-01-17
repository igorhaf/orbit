"""add_pgvector_and_rag_documents_table

Revision ID: a7f3c9e2d8b4
Revises: ff42c2846a70
Create Date: 2026-01-08 12:00:00.000000

PROMPT #83 - Phase 1: RAG Foundation
- Add pgvector extension to PostgreSQL
- Create rag_documents table for vector embeddings storage
- Add indices for fast similarity search
- Support project-specific and global knowledge base
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'a7f3c9e2d8b4'
down_revision: Union[str, None] = '20260107100000'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add pgvector extension (OPTIONAL - can be added later for performance)
    # Note: pgvector extension not yet installed in PostgreSQL container
    # Using ARRAY(Float) for now, which works but is less optimized than vector type
    # To add pgvector later: docker-compose exec db psql -U postgres -c "CREATE EXTENSION vector"
    # op.execute('CREATE EXTENSION IF NOT EXISTS vector')

    # 2. Create rag_documents table
    op.create_table(
        'rag_documents',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=True),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('embedding', postgresql.ARRAY(sa.Float()), nullable=False),  # vector(384) for sentence-transformers
        sa.Column('metadata', postgresql.JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()'), nullable=False),
    )

    # 3. Create indices
    # Index for project filtering
    op.create_index('idx_rag_documents_project_id', 'rag_documents', ['project_id'])

    # Index for metadata JSONB queries (GIN index)
    op.execute('CREATE INDEX idx_rag_documents_metadata ON rag_documents USING GIN (metadata)')

    # Index for vector similarity search (IVFFlat index)
    # Note: IVFFlat requires training data, so we create it manually after seeding
    # For now, we'll use a basic index that will be replaced with IVFFlat later
    # op.execute('CREATE INDEX idx_rag_documents_embedding ON rag_documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)')

    # 4. Create trigger for updated_at
    op.execute("""
        CREATE OR REPLACE FUNCTION update_rag_documents_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)

    op.execute("""
        CREATE TRIGGER trigger_rag_documents_updated_at
        BEFORE UPDATE ON rag_documents
        FOR EACH ROW
        EXECUTE FUNCTION update_rag_documents_updated_at();
    """)


def downgrade() -> None:
    # Drop trigger first
    op.execute('DROP TRIGGER IF EXISTS trigger_rag_documents_updated_at ON rag_documents')
    op.execute('DROP FUNCTION IF EXISTS update_rag_documents_updated_at()')

    # Drop indices
    op.drop_index('idx_rag_documents_project_id', 'rag_documents')
    op.execute('DROP INDEX IF EXISTS idx_rag_documents_metadata')
    op.execute('DROP INDEX IF EXISTS idx_rag_documents_embedding')

    # Drop table
    op.drop_table('rag_documents')

    # Note: We don't drop pgvector extension as other parts of the system might use it
    # If you really want to drop it: op.execute('DROP EXTENSION IF EXISTS vector')
