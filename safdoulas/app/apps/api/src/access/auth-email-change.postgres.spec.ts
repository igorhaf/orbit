import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomInt } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';

const pgBin = '/usr/lib/postgresql/16/bin';
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

test('email change migration adds a repeatable token contract on isolated PostgreSQL', async (t) => {
  assert.ok(existsSync(join(pgBin, 'initdb')) && existsSync(join(pgBin, 'pg_ctl')), 'native PostgreSQL 16 is required; product DATABASE_URL is never a fallback');
  const inherited = Object.entries(process.env).filter(([key]) => key.startsWith('PG') || key === 'DATABASE_URL');
  for (const [key] of inherited) delete process.env[key];
  t.after(() => { for (const [key, value] of inherited) process.env[key] = value; });

  const directory = mkdtempSync(join(tmpdir(), 'orbit-auth-email-change-pg-'));
  const data = join(directory, 'data');
  const socket = join(directory, 'socket');
  mkdirSync(socket, { mode: 0o700 });
  const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: directory, LC_ALL: 'C', LANG: 'C', TZ: 'UTC' };
  const port = randomInt(20_000, 60_000);
  const pg = (binary: string, args: string[]) => execFileSync(join(pgBin, binary), args, { env, cwd: directory, encoding: 'utf8', timeout: 30_000, stdio: 'pipe' });
  let started = false;
  const poolRef: { current?: Pool } = {};
  t.after(async () => {
    try { await poolRef.current?.end(); }
    finally {
      if (started && existsSync(join(data, 'postmaster.pid'))) pg('pg_ctl', ['-D', data, '-m', 'immediate', '-w', '-t', '20', 'stop']);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  pg('initdb', ['-D', data, '-U', 'orbit_auth_fixture', '-A', 'trust', '--encoding=UTF8', '--locale=C', '--no-instructions']);
  pg('pg_ctl', ['-D', data, '-l', join(directory, 'postgres.log'), '-w', '-t', '20', '-o', `-k ${quote(socket)} -p ${port} -c listen_addresses='' -c unix_socket_permissions=0700 -c fsync=off`, 'start']);
  started = true;
  const pool = new Pool({ host: socket, port, user: 'orbit_auth_fixture', database: 'postgres', ssl: false, max: 1, connectionTimeoutMillis: 3000, options: '-c statement_timeout=5000' });
  poolRef.current = pool;
  const identity = (await pool.query("SELECT current_setting('data_directory') AS data_directory,current_setting('listen_addresses') AS listen_addresses,inet_server_addr() AS inet,current_user AS actor")).rows[0];
  assert.equal(realpathSync(identity.data_directory), realpathSync(data));
  assert.equal(identity.listen_addresses, '');
  assert.equal(identity.inet, null);
  assert.equal(identity.actor, 'orbit_auth_fixture');

  await pool.query('CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text NOT NULL,session_version integer NOT NULL DEFAULT 0,disabled boolean NOT NULL DEFAULT false,is_root boolean NOT NULL DEFAULT false)');
  const directoryFromTest = __dirname;
  const baseMigration = readFileSync(join(directoryFromTest, '../../sql/migrations/079_account_auth_tokens.sql'), 'utf8');
  const emailMigration = readFileSync(join(directoryFromTest, '../../sql/migrations/213_auth_email_change.sql'), 'utf8');
  await pool.query(baseMigration);
  await pool.query(emailMigration);
  await pool.query(emailMigration);

  const columns = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='account_auth_tokens'")).rows.map(row => row.column_name);
  assert.ok(columns.includes('target_email'));
  const index = (await pool.query("SELECT indexdef FROM pg_indexes WHERE tablename='account_auth_tokens' AND indexname='account_auth_tokens_target_email'")).rows[0]?.indexdef as string;
  assert.match(index, /lower\(target_email\)/i);
  const constraint = (await pool.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='account_auth_tokens_purpose_check'")).rows[0]?.definition as string;
  assert.match(constraint, /change-email/);

  const user = (await pool.query("INSERT INTO users(email) VALUES('old@example.test') RETURNING id")).rows[0];
  await pool.query("INSERT INTO account_auth_tokens(user_id,token_hash,purpose,target_email,expires_at) VALUES($1,$2,'change-email',$3,now()+interval '30 minutes')", [user.id, 'a'.repeat(64), 'new@example.test']);
  await assert.rejects(() => pool!.query("INSERT INTO account_auth_tokens(user_id,token_hash,purpose,expires_at) VALUES($1,$2,'unknown',now()+interval '30 minutes')", [user.id, 'b'.repeat(64)]), /account_auth_tokens_purpose_check/);
});
