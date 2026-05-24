"""v2.5: claudius-only lockdown — enforce single provider + model whitelist.

- Deletes any ai_models row whose provider != 'claudius' (idempotent: 0 rows
  in production today).
- Deletes ai_models whose config.model_id is outside the supported Claude trio.
- Normalizes provider casing to lowercase 'claudius'.
- Adds CHECK (provider = 'claudius') to ai_models.

Notes:
- ai_flow_chains.chain is a JSON array of model IDs (not an FK), so it doesn't
  need cascade handling here. Stale entries become harmless no-ops when the
  app resolves them.

Revision ID: p267_claudius_only
Revises: eee958a2f4d5
Create Date: 2026-05-24
"""
from alembic import op
import sqlalchemy as sa


revision = "p267_claudius_only"
down_revision = "eee958a2f4d5"
branch_labels = None
depends_on = None


ALLOWED_MODEL_IDS = (
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
)


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Delete non-claudius models
    conn.execute(sa.text("DELETE FROM ai_models WHERE LOWER(provider) <> 'claudius'"))

    # 2. Normalize provider casing
    conn.execute(sa.text("UPDATE ai_models SET provider = 'claudius'"))

    # 3. Delete models whose model_id is outside the whitelist
    conn.execute(sa.text("""
        DELETE FROM ai_models
        WHERE (config::jsonb)->>'model_id' IS NOT NULL
          AND (config::jsonb)->>'model_id' NOT IN :allowed
    """).bindparams(sa.bindparam("allowed", expanding=True)), {"allowed": list(ALLOWED_MODEL_IDS)})

    # 4. Add CHECK constraint (prevents regressions via raw SQL)
    op.create_check_constraint(
        "ck_ai_models_provider_claudius_only",
        "ai_models",
        "provider = 'claudius'",
    )


def downgrade() -> None:
    op.drop_constraint("ck_ai_models_provider_claudius_only", "ai_models", type_="check")
