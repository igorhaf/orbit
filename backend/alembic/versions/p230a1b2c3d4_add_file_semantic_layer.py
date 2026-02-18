"""add_file_semantic_layer

Revision ID: p230a1b2c3d4
Revises: 20260216_ai_model_name
Create Date: 2026-02-17 00:00:00.000000

PROMPT #230 - Add semantic layer classification to rag_file_state
Stack-agnostic file classification: schema, routes, logic, presentation, config, unknown
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'p230a1b2c3d4'
down_revision: Union[str, None] = '20260216_ai_model_name'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create enum type
    file_semantic_layer = sa.Enum(
        'schema', 'routes', 'logic', 'presentation', 'config', 'unknown',
        name='file_semantic_layer'
    )
    file_semantic_layer.create(op.get_bind(), checkfirst=True)

    # Add column
    op.add_column('rag_file_state', sa.Column(
        'file_layer',
        file_semantic_layer,
        nullable=True,
        server_default='unknown'
    ))

    # Index for layer-based queries
    op.create_index('ix_rag_file_state_file_layer', 'rag_file_state', ['file_layer'])
    op.create_index(
        'ix_rag_file_state_project_layer_status',
        'rag_file_state',
        ['project_id', 'file_layer', 'status']
    )

    # Backfill existing rows with classification based on file_path patterns
    op.execute(sa.text(r"""
        UPDATE rag_file_state SET file_layer = (CASE
            WHEN file_path ~* '(migration|migrate|/models?/|/entit(y|ies)/|/schemas?/|/domain|prisma|\.graphql|\.proto)' THEN 'schema'
            WHEN file_path ~* '(/controllers?/|/handlers?/|/routes?/|/routing/|/endpoints?/|/api/|/resolvers?/|router|views\.py)' THEN 'routes'
            WHEN file_path ~* '(/services?/|/usecases?/|/use.cases?/|/actions?/|/jobs?/|/workers?/|/commands?/|/events?/|/listeners?/|/polic(y|ies)/|/rules?/|/middleware|/validators?/|/observers?/|/notifications?/|/mail/|/requests?/)' THEN 'logic'
            WHEN file_path ~* '(/views?/|/components?/|/templates?/|/pages?/|/layouts?/|/partials?/|/widgets?/|/screens?/|/ui/|\.blade\.php|\.vue|\.jsx|\.tsx|\.ejs|\.pug|\.hbs|\.twig|\.jinja|\.html)' THEN 'presentation'
            WHEN file_path ~* '(^configs?/|/configs?/|/configuration/|^bootstrap/|/bootstrap/|/boot/|/providers?/|/initializers?/|docker|makefile|\.env|\.ini|\.toml|\.ya?ml|package\.json|composer\.json|webpack|vite|babel|eslint|tsconfig)' THEN 'config'
            ELSE 'unknown'
        END)::file_semantic_layer
        WHERE file_layer IS NULL OR file_layer = 'unknown'::file_semantic_layer
    """))


def downgrade() -> None:
    op.drop_index('ix_rag_file_state_project_layer_status', table_name='rag_file_state')
    op.drop_index('ix_rag_file_state_file_layer', table_name='rag_file_state')
    op.drop_column('rag_file_state', 'file_layer')

    # Drop enum type
    sa.Enum(name='file_semantic_layer').drop(op.get_bind(), checkfirst=True)
