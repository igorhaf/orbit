"""PROMPT #282 - Add chat_message to jobtype enum

Revision ID: prompt282_chat_jobtype
Revises: prompt282_project_chats
Create Date: 2026-02-14
"""
from alembic import op


revision = 'prompt282_chat_jobtype'
down_revision = 'prompt282_project_chats'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'chat_message'")


def downgrade() -> None:
    pass  # Cannot remove enum values in PostgreSQL
