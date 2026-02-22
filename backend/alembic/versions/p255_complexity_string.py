"""Convert complexity from Integer to String (low/medium/high)

Revision ID: p255_complexity_string
Revises: p252_indexed_status
Create Date: 2026-02-21
"""
from alembic import op
import sqlalchemy as sa

revision = "p255_complexity_string"
down_revision = "p252_indexed_status"
branch_labels = None
depends_on = None


def upgrade():
    # 1. Add temporary string column
    op.add_column("tasks", sa.Column("complexity_new", sa.String(10), nullable=True))

    # 2. Migrate data: old integer 1-5 -> new string low/medium/high
    op.execute("""
        UPDATE tasks SET complexity_new = CASE
            WHEN complexity <= 2 THEN 'low'
            WHEN complexity <= 3 THEN 'medium'
            ELSE 'high'
        END
    """)

    # 3. Set default for any nulls
    op.execute("UPDATE tasks SET complexity_new = 'medium' WHERE complexity_new IS NULL")

    # 4. Drop old column, rename new
    op.drop_column("tasks", "complexity")
    op.alter_column("tasks", "complexity_new", new_column_name="complexity",
                     nullable=False, server_default="medium")


def downgrade():
    # Reverse: string -> integer
    op.add_column("tasks", sa.Column("complexity_old", sa.Integer(), nullable=True))
    op.execute("""
        UPDATE tasks SET complexity_old = CASE
            WHEN complexity = 'low' THEN 1
            WHEN complexity = 'medium' THEN 3
            ELSE 5
        END
    """)
    op.execute("UPDATE tasks SET complexity_old = 1 WHERE complexity_old IS NULL")
    op.drop_column("tasks", "complexity")
    op.alter_column("tasks", "complexity_old", new_column_name="complexity",
                     nullable=False, server_default="1")
