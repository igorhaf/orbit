"""PROMPT #282 - Create project_chats table for RAG chat sessions

Revision ID: prompt282_project_chats
Revises: None
Create Date: 2026-02-14
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'prompt282_project_chats'
down_revision = 'prompt270_wiki_enrich'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'project_chats',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('project_id', UUID(as_uuid=True), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.String(255), nullable=False, server_default='New Chat'),
        sa.Column('messages', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
    )

    op.create_index('idx_project_chats_project_id', 'project_chats', ['project_id'])
    op.create_index('idx_project_chats_project_created', 'project_chats', ['project_id', 'created_at'])


def downgrade() -> None:
    op.drop_index('idx_project_chats_project_created')
    op.drop_index('idx_project_chats_project_id')
    op.drop_table('project_chats')
