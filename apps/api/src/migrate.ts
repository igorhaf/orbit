import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(readFileSync(resolve(__dirname, '../sql/schema.sql'), 'utf8'));
    await pool.query(readFileSync(resolve(__dirname, '../sql/automations.sql'), 'utf8'));
    const { rows: [user] } = await pool.query(
      `INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3)
       ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash
       RETURNING id`,
      ['Igor', 'igorhaf@gmail.com', '$2b$12$87GMGtpzEwEEjmfwVIjFMu0U5Bq8.5N9xI/NHO4JBHcorA7pHJDG2'],
    );
    await pool.query(
      `INSERT INTO workspaces(owner_id,name)
       SELECT $1,'Meu espaço de trabalho'
       WHERE NOT EXISTS (SELECT 1 FROM workspaces WHERE owner_id=$1)`,
      [user.id],
    );
    await pool.query(
      `UPDATE boards SET workspace_id=(SELECT id FROM workspaces WHERE owner_id=$1 ORDER BY created_at LIMIT 1)
       WHERE owner_id=$1 AND workspace_id IS NULL`,
      [user.id],
    );
    await pool.query(
      `INSERT INTO boards(title,background,owner_id,workspace_id,is_inbox)
       SELECT 'Inbox','blue',$1,w.id,true FROM workspaces w WHERE w.owner_id=$1
       ORDER BY w.created_at LIMIT 1
       ON CONFLICT (owner_id) WHERE is_inbox DO NOTHING`,
      [user.id],
    );
    await pool.query(
      `INSERT INTO board_members(board_id,user_id,role)
       SELECT b.id,$1,'owner' FROM boards b WHERE b.owner_id=$1 AND b.is_inbox
       ON CONFLICT(board_id,user_id) DO NOTHING`,
      [user.id],
    );
    await pool.query(
      `INSERT INTO lists(board_id,title,position)
       SELECT b.id,'Inbox',0 FROM boards b WHERE b.owner_id=$1 AND b.is_inbox
       AND NOT EXISTS (SELECT 1 FROM lists l WHERE l.board_id=b.id)`,
      [user.id],
    );
    console.log('Database schema is ready.');
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error); process.exit(1); });
