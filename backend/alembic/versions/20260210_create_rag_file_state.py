"""Create rag_file_state table and add RAG_CONTINUOUS_SCAN job type

PROMPT #218 - Continuous RAG Evolution

Revision ID: 218a_rag_file_state
Revises: 20260209_queue_usage
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, ENUM

revision = "218a_rag_file_state"
down_revision = "20260209_queue_usage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create file_processing_status enum (idempotent)
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE file_processing_status AS ENUM (
                'pending', 'processing', 'completed', 'failed', 'deleted'
            );
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END $$
    """)

    # 2. Add 'rag_continuous_scan' to jobtype enum (idempotent)
    op.execute("""
        DO $$ BEGIN
            ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'rag_continuous_scan';
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END $$
    """)

    # 3. Create rag_file_state table
    file_status_enum = ENUM(
        'pending', 'processing', 'completed', 'failed', 'deleted',
        name='file_processing_status',
        create_type=False
    )

    op.create_table(
        "rag_file_state",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("file_hash", sa.String(64), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=True),
        sa.Column("last_modified", sa.DateTime(), nullable=True),
        sa.Column("status", file_status_enum, nullable=False, server_default="pending"),
        sa.Column("last_processed_at", sa.DateTime(), nullable=True),
        sa.Column("rag_document_ids", sa.JSON(), nullable=True, server_default="[]"),
        sa.Column("rules_extracted", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("project_id", "file_path", name="uq_rag_file_state_project_file"),
    )

    # 4. Create indexes
    op.create_index("ix_rag_file_state_project_id", "rag_file_state", ["project_id"])
    op.create_index("ix_rag_file_state_project_status", "rag_file_state", ["project_id", "status"])

    # 5. Create auto-update trigger for updated_at
    op.execute("""
        CREATE OR REPLACE FUNCTION update_rag_file_state_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trigger_rag_file_state_updated_at ON rag_file_state;
        CREATE TRIGGER trigger_rag_file_state_updated_at
            BEFORE UPDATE ON rag_file_state
            FOR EACH ROW
            EXECUTE FUNCTION update_rag_file_state_updated_at();
    """)


def downgrade() -> None:
    op.drop_table("rag_file_state")
    op.execute("DROP TYPE IF EXISTS file_processing_status")
    op.execute("DROP FUNCTION IF EXISTS update_rag_file_state_updated_at()")
