import 'dotenv/config';
import { Pool } from 'pg';

export async function seedDatabase(pool: Pool) {
  const { rows: [user] } = await pool.query(
    `INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3)
     ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name
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
    `INSERT INTO boards(title,background,owner_id,workspace_id,is_collection)
     SELECT 'Coleções','purple',$1,w.id,true FROM workspaces w WHERE w.owner_id=$1
     ORDER BY w.created_at LIMIT 1
     ON CONFLICT (owner_id) WHERE is_collection DO NOTHING`,
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
  await pool.query(
    `INSERT INTO board_members(board_id,user_id,role)
     SELECT b.id,$1,'owner' FROM boards b WHERE b.owner_id=$1 AND b.is_collection
     ON CONFLICT(board_id,user_id) DO NOTHING`,
    [user.id],
  );
  await pool.query(
    `INSERT INTO lists(board_id,title,position)
     SELECT b.id,category.title,category.position FROM boards b
     CROSS JOIN (VALUES ('Desenvolvimento',0),('Rotina',1)) AS category(title,position)
     WHERE b.owner_id=$1 AND b.is_collection
     AND NOT EXISTS (SELECT 1 FROM lists l WHERE l.board_id=b.id AND l.title=category.title)`,
    [user.id],
  );
  await pool.query(
    `INSERT INTO cards(list_id,title,description,position)
     SELECT l.id,'Reiniciar ambiente de desenvolvimento',
       'Reinicia os serviços locais do Orbit para começar o dia com o ambiente limpo.',0
     FROM lists l JOIN boards b ON b.id=l.board_id
     WHERE b.owner_id=$1 AND b.is_collection AND l.title='Desenvolvimento'
       AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.list_id=l.id AND c.title='Reiniciar ambiente de desenvolvimento')`,
    [user.id],
  );
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await seedDatabase(pool);
    console.log('Database seed is ready.');
  } finally { await pool.end(); }
}

if (require.main === module) main().catch(error => { console.error(error); process.exit(1); });
