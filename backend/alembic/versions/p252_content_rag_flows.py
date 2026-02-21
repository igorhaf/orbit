"""PROMPT #252 - Add content_generation and rag_extraction usage types + seed Opus models/chains.
Also upgrades 'memory' model to Opus 4.6.

New usage types for the RAG pipeline:
- content_generation: Wiki, Cards, Description, Title generation (Claudio Opus 4.6)
- rag_extraction: Business rules extraction to RAG (Claudio Opus 4.6)

Memory scan upgraded:
- memory: Codebase scan now uses Claudio Opus 4.6 (was Sonnet)

Revision ID: p252_content_rag_flows
Revises: p241_ignore_paths
"""
from alembic import op
from sqlalchemy import text
import uuid

revision = "p252_content_rag_flows"
down_revision = "p241_ignore_paths"
branch_labels = None
depends_on = None


def upgrade():
    # 1. Add new enum values to ai_model_usage_type
    op.execute("ALTER TYPE ai_model_usage_type ADD VALUE IF NOT EXISTS 'content_generation'")
    op.execute("ALTER TYPE ai_model_usage_type ADD VALUE IF NOT EXISTS 'rag_extraction'")

    # Need to commit the ALTER TYPE before using the new values in INSERT
    op.execute("COMMIT")

    # 2. Seed Claudio Opus 4.6 models for each new usage_type
    content_model_id = str(uuid.uuid4())
    rag_model_id = str(uuid.uuid4())

    op.execute(text("""
        INSERT INTO ai_models (id, name, provider, api_key, usage_type, is_active, config, created_at, updated_at)
        VALUES (
            :id,
            'Claudio Opus 4.6 (Content)',
            'claudio',
            'not-needed',
            'content_generation',
            true,
            '{"model_id": "claude-opus-4-6", "max_tokens": 8192, "temperature": 0.7}'::jsonb,
            NOW(), NOW()
        )
        ON CONFLICT (name) DO NOTHING
    """).bindparams(id=content_model_id))

    op.execute(text("""
        INSERT INTO ai_models (id, name, provider, api_key, usage_type, is_active, config, created_at, updated_at)
        VALUES (
            :id,
            'Claudio Opus 4.6 (RAG Extraction)',
            'claudio',
            'not-needed',
            'rag_extraction',
            true,
            '{"model_id": "claude-opus-4-6", "max_tokens": 8192, "temperature": 0.3}'::jsonb,
            NOW(), NOW()
        )
        ON CONFLICT (name) DO NOTHING
    """).bindparams(id=rag_model_id))

    # 3. Create AI Flow chains for the new usage_types
    op.execute(text("""
        INSERT INTO ai_flow_chains (id, usage_type, chain, is_active, created_at, updated_at)
        SELECT
            gen_random_uuid(),
            'content_generation',
            jsonb_build_array(m.id::text),
            true,
            NOW(), NOW()
        FROM ai_models m
        WHERE m.name = 'Claudio Opus 4.6 (Content)' AND m.is_active = true
        ON CONFLICT (usage_type) DO UPDATE SET
            chain = EXCLUDED.chain,
            updated_at = NOW()
    """))

    op.execute(text("""
        INSERT INTO ai_flow_chains (id, usage_type, chain, is_active, created_at, updated_at)
        SELECT
            gen_random_uuid(),
            'rag_extraction',
            jsonb_build_array(m.id::text),
            true,
            NOW(), NOW()
        FROM ai_models m
        WHERE m.name = 'Claudio Opus 4.6 (RAG Extraction)' AND m.is_active = true
        ON CONFLICT (usage_type) DO UPDATE SET
            chain = EXCLUDED.chain,
            updated_at = NOW()
    """))

    # 4. Upgrade memory model from Sonnet to Opus 4.6
    op.execute(text("""
        UPDATE ai_models
        SET config = '{"model_id": "claude-opus-4-6", "max_tokens": 8192, "temperature": 0.5}'::jsonb,
            name = 'Claudio Opus 4.6 (Memory)',
            updated_at = NOW()
        WHERE usage_type = 'memory' AND provider = 'claudio' AND is_active = true
          AND name LIKE '%Sonnet%'
    """))


def downgrade():
    op.execute("DELETE FROM ai_flow_chains WHERE usage_type IN ('content_generation', 'rag_extraction')")
    op.execute("DELETE FROM ai_models WHERE name IN ('Claudio Opus 4.6 (Content)', 'Claudio Opus 4.6 (RAG Extraction)')")
    # Revert memory back to Sonnet
    op.execute(text("""
        UPDATE ai_models
        SET config = '{"model_id": "claude-sonnet-4-6", "max_tokens": 8192, "temperature": 0.5}'::jsonb,
            name = 'Claudio Sonnet 4.6 (Memory)',
            updated_at = NOW()
        WHERE usage_type = 'memory' AND provider = 'claudio' AND is_active = true
          AND name LIKE '%Opus%'
    """))
