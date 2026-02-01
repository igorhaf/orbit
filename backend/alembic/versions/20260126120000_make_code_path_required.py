"""make_code_path_required

PROMPT #111 - Tornar code_path obrigatório e imutável
- code_path é definido APENAS na criação do projeto
- code_path NÃO pode ser editado depois
- ORBIT foca em análise de código existente, não provisionamento

Revision ID: 20260126120000
Revises: e9f2a3b4c5d6
Create Date: 2026-01-26 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260126120000'
down_revision: Union[str, None] = 'e9f2a3b4c5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PROMPT #111 - Make code_path required (NOT NULL)

    # Step 1: Fill existing NULL values with placeholder
    # Projects without code_path will need manual update or recreation
    op.execute(
        "UPDATE projects SET code_path = '/placeholder-needs-update' WHERE code_path IS NULL"
    )

    # Step 2: Alter column to NOT NULL
    op.alter_column(
        'projects',
        'code_path',
        existing_type=sa.String(500),
        nullable=False
    )


def downgrade() -> None:
    # Revert to nullable
    op.alter_column(
        'projects',
        'code_path',
        existing_type=sa.String(500),
        nullable=True
    )
