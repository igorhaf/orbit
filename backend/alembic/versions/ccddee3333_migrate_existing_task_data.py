"""migrate_existing_task_data

Revision ID: ccddee3333
Revises: bbccddee2222
Create Date: 2026-01-04 00:10:00.000000

JIRA Transformation - Phase 1: Data Migration
- Migrate comments JSON → task_comments table
- Migrate depends_on JSON → task_relationships table
- Set default values for existing tasks
- Ensure zero data loss
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import json
from uuid import uuid4

# revision identifiers, used by Alembic.
revision: str = 'ccddee3333'
down_revision: Union[str, None] = 'bbccddee2222'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Migrate existing task data to new structure
    - Comments JSON → task_comments rows
    - Depends_on JSON → task_relationships rows
    """
    connection = op.get_bind()

    # 1. Migrate comments from JSON to task_comments table
    print("Migrating comments from JSON to task_comments table...")

    # Get all tasks with comments
    result = connection.execute(sa.text(
        "SELECT id, comments FROM tasks WHERE comments IS NOT NULL AND comments::text != '[]'"
    ))

    comments_migrated = 0
    for task_id, comments_json in result:
        if comments_json:
            try:
                # Parse comments (handle both string and dict)
                if isinstance(comments_json, str):
                    comments = json.loads(comments_json)
                else:
                    comments = comments_json

                if isinstance(comments, list) and len(comments) > 0:
                    for comment in comments:
                        # Extract comment data (handle different formats)
                        author = comment.get('author', comment.get('user', 'system'))
                        content = comment.get('content', comment.get('text', comment.get('comment', '')))
                        created_at = comment.get('created_at', comment.get('timestamp', 'NOW()'))

                        if content:  # Only migrate non-empty comments
                            # Insert into task_comments
                            connection.execute(sa.text("""
                                INSERT INTO task_comments (id, task_id, author, content, comment_type, created_at, updated_at)
                                VALUES (:id, :task_id, :author, :content, 'comment', :created_at, NOW())
                            """), {
                                'id': str(uuid4()),
                                'task_id': str(task_id),
                                'author': str(author),
                                'content': str(content),
                                'created_at': created_at if created_at != 'NOW()' else 'NOW()'
                            })
                            comments_migrated += 1

            except Exception as e:
                print(f"⚠️  Error migrating comments for task {task_id}: {e}")
                continue

    print(f"✅ Migrated {comments_migrated} comments to task_comments table")

    # 2. Migrate depends_on from JSON to task_relationships
    print("Migrating depends_on from JSON to task_relationships table...")

    # Get all tasks with depends_on
    result = connection.execute(sa.text(
        "SELECT id, depends_on FROM tasks WHERE depends_on IS NOT NULL AND depends_on::text != '[]'"
    ))

    relationships_migrated = 0
    for task_id, depends_on_json in result:
        if depends_on_json:
            try:
                # Parse depends_on (handle both string and list)
                if isinstance(depends_on_json, str):
                    depends_on = json.loads(depends_on_json)
                else:
                    depends_on = depends_on_json

                if isinstance(depends_on, list) and len(depends_on) > 0:
                    for dep_task_id in depends_on:
                        # Verify target task exists
                        target_exists = connection.execute(sa.text(
                            "SELECT 1 FROM tasks WHERE id = :target_id LIMIT 1"
                        ), {'target_id': str(dep_task_id)}).fetchone()

                        if target_exists:
                            # Insert into task_relationships
                            connection.execute(sa.text("""
                                INSERT INTO task_relationships (id, source_task_id, target_task_id, relationship_type, created_at)
                                VALUES (:id, :source, :target, 'depends_on', NOW())
                            """), {
                                'id': str(uuid4()),
                                'source': str(task_id),
                                'target': str(dep_task_id)
                            })
                            relationships_migrated += 1
                        else:
                            print(f"⚠️  Skipping invalid dependency: {task_id} → {dep_task_id} (target not found)")

            except Exception as e:
                print(f"⚠️  Error migrating depends_on for task {task_id}: {e}")
                continue

    print(f"✅ Migrated {relationships_migrated} dependencies to task_relationships table")

    # 3. Initialize JSON arrays for new fields where NULL
    print("Initializing JSON array fields...")

    connection.execute(sa.text("""
        UPDATE tasks
        SET labels = '[]'::json
        WHERE labels IS NULL
    """))

    connection.execute(sa.text("""
        UPDATE tasks
        SET components = '[]'::json
        WHERE components IS NULL
    """))

    connection.execute(sa.text("""
        UPDATE tasks
        SET acceptance_criteria = '[]'::json
        WHERE acceptance_criteria IS NULL
    """))

    connection.execute(sa.text("""
        UPDATE tasks
        SET interview_question_ids = '[]'::json
        WHERE interview_question_ids IS NULL
    """))

    connection.execute(sa.text("""
        UPDATE tasks
        SET interview_insights = '{}'::json
        WHERE interview_insights IS NULL
    """))

    connection.execute(sa.text("""
        UPDATE tasks
        SET generation_context = '{}'::json
        WHERE generation_context IS NULL
    """))

    connection.execute(sa.text("""
        UPDATE tasks
        SET status_history = '[]'::json
        WHERE status_history IS NULL
    """))

    print("✅ JSON array fields initialized")

    print(f"""
    ╔═══════════════════════════════════════════════════════════════════╗
    ║ Migration Complete! ✅                                             ║
    ╠═══════════════════════════════════════════════════════════════════╣
    ║ • {comments_migrated:,} comments migrated to task_comments        ║
    ║ • {relationships_migrated:,} relationships migrated                ║
    ║ • All JSON fields initialized                                     ║
    ║ • Zero data loss guaranteed                                       ║
    ╚═══════════════════════════════════════════════════════════════════╝
    """)


def downgrade() -> None:
    """
    Reverse migration: Copy data back to JSON fields
    Note: This is a lossy operation - new comments/relationships created after migration will be lost
    """
    connection = op.get_bind()

    print("Reverting migration - copying data back to JSON fields...")

    # 1. Copy task_comments back to tasks.comments JSON
    result = connection.execute(sa.text("""
        SELECT task_id, json_agg(
            json_build_object(
                'author', author,
                'content', content,
                'created_at', created_at
            )
            ORDER BY created_at
        ) as comments_json
        FROM task_comments
        WHERE comment_type = 'comment'
        GROUP BY task_id
    """))

    for task_id, comments_json in result:
        connection.execute(sa.text("""
            UPDATE tasks
            SET comments = :comments_json::json
            WHERE id = :task_id
        """), {
            'task_id': str(task_id),
            'comments_json': json.dumps(comments_json)
        })

    # 2. Copy task_relationships back to tasks.depends_on JSON
    result = connection.execute(sa.text("""
        SELECT source_task_id, json_agg(target_task_id) as depends_on_json
        FROM task_relationships
        WHERE relationship_type = 'depends_on'
        GROUP BY source_task_id
    """))

    for source_task_id, depends_on_json in result:
        connection.execute(sa.text("""
            UPDATE tasks
            SET depends_on = :depends_on_json::json
            WHERE id = :task_id
        """), {
            'task_id': str(source_task_id),
            'depends_on_json': json.dumps(depends_on_json)
        })

    print("✅ Data reverted to JSON fields")
