"""rename_task_comment_metadata_column

Revision ID: 0a91d3726255
Revises: ccddee3333
Create Date: 2026-01-04 08:36:38.295938

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0a91d3726255'
down_revision: Union[str, None] = 'ccddee3333'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Rename metadata column to comment_metadata to avoid SQLAlchemy reserved word conflict."""
    op.alter_column('task_comments', 'metadata', new_column_name='comment_metadata')


def downgrade() -> None:
    """Rename comment_metadata back to metadata."""
    op.alter_column('task_comments', 'comment_metadata', new_column_name='metadata')
