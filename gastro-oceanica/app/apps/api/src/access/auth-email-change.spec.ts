import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import * as bcrypt from 'bcryptjs';
import { AuthEmailChangeService } from './auth-email-change';
import type { Db } from '../db';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

test('requests re-authenticate, store only a token hash and send the confirmation link', async () => {
  const passwordHash = await bcrypt.hash('current password', 4);
  const statements: Array<{ sql: string; args?: unknown[] }> = [];
  let sent = '';
  const client = {
    async query(sql: string, args?: unknown[]) {
      statements.push({ sql, args });
      if (sql.includes('SELECT email,password_hash,disabled')) return { rows: [{ email: 'old@example.test', password_hash: passwordHash, disabled: false }] };
      return { rows: [] };
    },
    release() {},
  };
  const db = { pool: { async connect() { return client; } } } as unknown as Db;
  const access = { async require() {}, revoke() {} };
  const service = new AuthEmailChangeService(db, access as never, async () => true, async (_email, token) => { sent = token; });

  assert.deepEqual(await service.request('user-1', { email: ' NEW@example.test ', current_password: 'current password' }), { ok: true });
  const inserted = statements.find(({ sql }) => sql.includes("INSERT INTO account_auth_tokens(user_id,token_hash,purpose,target_email"));
  assert.ok(inserted);
  assert.equal(inserted.args?.[2], 'new@example.test');
  assert.equal(inserted.args?.[1], digest(sent));
  assert.notEqual(inserted.args?.[1], sent);
  assert.ok(statements.some(({ sql }) => sql === 'COMMIT'));
  assert.ok(statements.some(({ sql }) => sql.includes("account.email_change.requested")));
});

test('rejected current password rolls back and never sends a link', async () => {
  const passwordHash = await bcrypt.hash('actual password', 4);
  const statements: string[] = [];
  let sent = false;
  const client = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes('SELECT email,password_hash,disabled')) return { rows: [{ email: 'old@example.test', password_hash: passwordHash, disabled: false }] };
      return { rows: [] };
    },
    release() {},
  };
  const service = new AuthEmailChangeService({ pool: { async connect() { return client; } } } as unknown as Db, {} as never, async () => true, async () => { sent = true; });
  await assert.rejects(() => service.request('user-1', { email: 'new@example.test', current_password: 'wrong password' }), /senha atual está incorreta/);
  assert.ok(statements.includes('ROLLBACK'));
  assert.ok(!statements.includes('COMMIT'));
  assert.equal(sent, false);
});

test('confirmation changes identity, invalidates sessions and revokes in-memory auth state', async () => {
  const statements: Array<{ sql: string; args?: unknown[] }> = [];
  let revoked = '';
  const client = {
    async query(sql: string, args?: unknown[]) {
      statements.push({ sql, args });
      if (sql.includes('SELECT t.id,t.user_id,t.target_email')) return { rows: [{ id: 'token-row', user_id: 'user-1', target_email: 'new@example.test' }] };
      return { rows: [] };
    },
    release() {},
  };
  const service = new AuthEmailChangeService({ pool: { async connect() { return client; } } } as unknown as Db, { revoke(userId: string) { revoked = userId; } } as never, async () => true, async () => {});

  assert.deepEqual(await service.complete('a'.repeat(43)), { ok: true });
  const update = statements.find(({ sql }) => sql.startsWith('UPDATE users SET email='));
  assert.deepEqual(update?.args, ['user-1', 'new@example.test']);
  assert.ok(update?.sql.includes('email_verified=true') && update.sql.includes('session_version=session_version+1'));
  assert.ok(statements.some(({ sql }) => sql === 'COMMIT'));
  assert.equal(revoked, 'user-1');
});

test('administrative requests require access.manage and cannot target ROOT', async () => {
  let connected = false;
  let mailed = false;
  const statements: string[] = [];
  const client = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes('SELECT email,is_root,disabled')) return { rows: [{ email: 'root@example.test', is_root: true, disabled: false }] };
      return { rows: [] };
    },
    release() {},
  };
  const access = { async require(_actor: string, permission: string) { assert.equal(permission, 'access.manage'); }, revoke() {} };
  const service = new AuthEmailChangeService({ pool: { async connect() { connected = true; return client; } } } as unknown as Db, access as never, async () => true, async () => { mailed = true; });
  await assert.rejects(() => service.requestAdministrative('admin', '00000000-0000-4000-8000-000000000001', 'root@example.test'), /ROOT/);
  assert.equal(connected, true);
  assert.ok(statements.includes('ROLLBACK'));
  assert.ok(!statements.includes('COMMIT'));
  assert.equal(mailed, false);
});
