"""PROMPT #250 - Migrate RAG embeddings from MiniLM (384) to Nomic Embed Text (768)

Truncates existing embeddings (incompatible dimensions) and resizes vector column.
Nomic Embed Text via Ollama produces richer 768-dimensional embeddings.

Revision ID: p250_nomic_768
Revises: p241_ignore_paths
Create Date: 2026-02-21
"""
from alembic import op
import sqlalchemy as sa

revision: str = 'p250_nomic_768'
down_revision: str = 'p241_ignore_paths'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop existing IVFFlat index (dimension-specific)
    op.execute("DROP INDEX IF EXISTS idx_rag_documents_embedding_ivfflat")

    # Truncate — old 384-dim embeddings are incompatible with 768-dim
    op.execute("TRUNCATE TABLE rag_documents")

    # Alter column from vector(384) to vector(768)
    op.execute("ALTER TABLE rag_documents ALTER COLUMN embedding TYPE vector(768) USING embedding::vector(768)")

    # Recreate IVFFlat index for 768-dim vectors
    op.execute(
        "CREATE INDEX idx_rag_documents_embedding_ivfflat "
        "ON rag_documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_rag_documents_embedding_ivfflat")
    op.execute("TRUNCATE TABLE rag_documents")
    op.execute("ALTER TABLE rag_documents ALTER COLUMN embedding TYPE vector(384) USING embedding::vector(384)")
    op.execute(
        "CREATE INDEX idx_rag_documents_embedding_ivfflat "
        "ON rag_documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
    )
