import {seedCollections} from './plugins/collections/collections.seed';
import 'dotenv/config';
import { Pool } from 'pg';

export async function seedDatabase(pool: Pool) {
  const brandName=(process.env.ORBIT_APP_NAME||'Orbit').trim().slice(0,80)||'Orbit';
  const brandIcon=['orbit','tree_of_life'].includes(process.env.ORBIT_APP_ICON_KIND||'')?process.env.ORBIT_APP_ICON_KIND:'orbit';
  const loginTagline=(process.env.ORBIT_LOGIN_TAGLINE||'Seu trabalho, com uma visão mais clara.').trim().slice(0,180);
  const loginDescription=(process.env.ORBIT_LOGIN_DESCRIPTION||'Acompanhe o que vem pela frente, veja as novidades e organize seus projetos em quadros.').trim().slice(0,500);
  let loginBenefits=['Tarefas e prazos em destaque','Quadros, listas e cartões','Atividade e notificações em um lugar'];
  try{const parsed=JSON.parse(process.env.ORBIT_LOGIN_BENEFITS_JSON||'');if(Array.isArray(parsed)&&parsed.length>=1&&parsed.length<=5&&parsed.every((item)=>typeof item==='string'&&item.trim()&&item.length<=120))loginBenefits=parsed.map(item=>item.trim())}catch{/* Use the built-in Orbit copy when no valid list is configured. */}
  await pool.query(`INSERT INTO instance_branding(id,app_name,icon_kind,login_tagline,login_description,login_benefits) VALUES(true,$1,$2,$3,$4,$5::jsonb) ON CONFLICT(id) DO UPDATE SET login_tagline=EXCLUDED.login_tagline,login_description=EXCLUDED.login_description,login_benefits=EXCLUDED.login_benefits WHERE NOT instance_branding.login_content_customized`,[brandName,brandIcon,loginTagline,loginDescription,JSON.stringify(loginBenefits)]);
  const { rows: [user] } = await pool.query(
    `INSERT INTO users(name,email,password_hash,is_root) VALUES($1,$2,$3,true)
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
  if (process.env.ORBIT_SEED_DEFAULT_BOARDS === 'false') return;
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
  await seedCollections(pool,user.id);
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await seedDatabase(pool);
    console.log('Database seed is ready.');
  } finally { await pool.end(); }
}

if (require.main === module) main().catch(error => { console.error(error); process.exit(1); });
