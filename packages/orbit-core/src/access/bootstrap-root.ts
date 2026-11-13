import bcrypt from 'bcryptjs';
import type { Pool } from 'pg';

type BootstrapDatabase = Pick<Pool, 'query'>;

/** Initializes an empty instance without copying an identity or changing an existing account. */
export async function ensureBootstrapRoot(db: BootstrapDatabase, environment: NodeJS.ProcessEnv = process.env): Promise<{ id: string }> {
  const existing = await db.query<{ id: string }>('SELECT id FROM users WHERE is_root=true ORDER BY created_at,id LIMIT 1');
  if (existing.rows[0]) return existing.rows[0];

  const name = (environment.ORBIT_BOOTSTRAP_ROOT_NAME || '').trim();
  const email = (environment.ORBIT_BOOTSTRAP_ROOT_EMAIL || '').trim().toLowerCase();
  const password = environment.ORBIT_BOOTSTRAP_ROOT_PASSWORD || '';
  if (!name || name.length > 80 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Banco sem ROOT: configure ORBIT_BOOTSTRAP_ROOT_NAME (1–80 caracteres), ORBIT_BOOTSTRAP_ROOT_EMAIL e ORBIT_BOOTSTRAP_ROOT_PASSWORD (mínimo de 12 caracteres e máximo de 72 bytes).');
  }
  const collision = await db.query<{ id: string; is_root: boolean }>('SELECT id,is_root FROM users WHERE lower(email)=lower($1) LIMIT 1', [email]);
  if (collision.rows[0]) {
    if (collision.rows[0].is_root) return { id: collision.rows[0].id };
    throw new Error('O e-mail de bootstrap já pertence a uma conta existente. Escolha outro e-mail; nenhuma conta foi promovida.');
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const created = await db.query<{ id: string }>('INSERT INTO users(name,email,password_hash,is_root) VALUES($1,$2,$3,true) ON CONFLICT(email) DO NOTHING RETURNING id', [name, email, passwordHash]);
  if (created.rows[0]) return created.rows[0];
  // A concurrent seed may have created the same ROOT; never reset or promote its account.
  const concurrent = await db.query<{ id: string; is_root: boolean }>('SELECT id,is_root FROM users WHERE lower(email)=lower($1) LIMIT 1', [email]);
  if (concurrent.rows[0]?.is_root) return { id: concurrent.rows[0].id };
  throw new Error('Não foi possível criar o ROOT de bootstrap sem alterar uma conta existente.');
}
