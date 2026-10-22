import type {Pool} from 'pg';

/** Idempotent plugin data, skipped whenever Collections is disabled. */
export async function seedCollections(pool:Pool,userId:string) {
  const collectionsEnabled=!(await pool.query("SELECT 1 FROM plugin_settings WHERE plugin_id='collections' AND NOT enabled")).rowCount;
  if(collectionsEnabled) await pool.query(
    `INSERT INTO boards(title,background,owner_id,workspace_id,is_collection)
     SELECT 'Coleções','purple',$1,w.id,true FROM workspaces w WHERE w.owner_id=$1
     ORDER BY w.created_at LIMIT 1
     ON CONFLICT (owner_id) WHERE is_collection DO NOTHING`,
    [userId],
  );
  if(collectionsEnabled) {
  await pool.query(
    `INSERT INTO board_members(board_id,user_id,role)
     SELECT b.id,$1,'owner' FROM boards b WHERE b.owner_id=$1 AND b.is_collection
     ON CONFLICT(board_id,user_id) DO NOTHING`,
    [userId],
  );
  await pool.query(
    `INSERT INTO lists(board_id,title,position)
     SELECT b.id,category.title,category.position FROM boards b
     CROSS JOIN (VALUES ('Desenvolvimento',0),('Rotina',1)) AS category(title,position)
     WHERE b.owner_id=$1 AND b.is_collection
     AND NOT EXISTS (SELECT 1 FROM lists l WHERE l.board_id=b.id AND l.title=category.title)`,
    [userId],
  );
  await pool.query(
    `INSERT INTO cards(list_id,title,description,position)
     SELECT l.id,'Reiniciar ambiente de desenvolvimento',
       'Reinicia os serviços locais do Orbit para começar o dia com o ambiente limpo.',0
     FROM lists l JOIN boards b ON b.id=l.board_id
     WHERE b.owner_id=$1 AND b.is_collection AND l.title='Desenvolvimento'
       AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.list_id=l.id AND c.title='Reiniciar ambiente de desenvolvimento')`,
    [userId],
  );
  }
}
