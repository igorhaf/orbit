import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import { ensureBootstrapRoot } from './bootstrap-root';

const credentials = { ORBIT_BOOTSTRAP_ROOT_NAME: 'Example Administrator', ORBIT_BOOTSTRAP_ROOT_EMAIL: 'ROOT@example.test', ORBIT_BOOTSTRAP_ROOT_PASSWORD: 'explicit-local-password' };

function database(replies: Array<Array<Record<string, unknown>>>) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const db = { async query(sql: string, values: unknown[] = []) { calls.push({ sql, values }); return { rows: replies.shift() || [] }; } };
  return { db: db as never, calls };
}

test('existing ROOT is preserved with one read and no bootstrap configuration', async () => {
  const { db, calls } = database([[{ id: 'existing-root' }]]);
  assert.deepEqual(await ensureBootstrapRoot(db, {}), { id: 'existing-root' });
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].sql, /UPDATE|INSERT/);
});

test('empty database refuses absent or invalid credentials before any mutation', async () => {
  for (const environment of [{}, { ...credentials, ORBIT_BOOTSTRAP_ROOT_NAME: '' }, { ...credentials, ORBIT_BOOTSTRAP_ROOT_EMAIL: 'invalid' }, { ...credentials, ORBIT_BOOTSTRAP_ROOT_PASSWORD: 'short' }]) {
    const { db, calls } = database([[]]);
    await assert.rejects(() => ensureBootstrapRoot(db, environment), /configure ORBIT_BOOTSTRAP_ROOT_NAME/);
    assert.equal(calls.length, 1);
    assert.doesNotMatch(calls[0].sql, /UPDATE|INSERT/);
  }
});

test('explicit credentials create a ROOT with a new bcrypt hash and parameterized SQL', async () => {
  const { db, calls } = database([[], [], [{ id: 'new-root' }]]);
  assert.deepEqual(await ensureBootstrapRoot(db, credentials), { id: 'new-root' });
  const insert = calls[2];
  assert.match(insert.sql, /INSERT INTO users\(name,email,password_hash,is_root\) VALUES\(\$1,\$2,\$3,true\)/);
  assert.doesNotMatch(insert.sql, /DO UPDATE|explicit-local-password|ROOT@example/);
  assert.deepEqual(insert.values.slice(0, 2), ['Example Administrator', 'root@example.test']);
  assert.notEqual(insert.values[2], credentials.ORBIT_BOOTSTRAP_ROOT_PASSWORD);
  assert.equal(await bcrypt.compare(credentials.ORBIT_BOOTSTRAP_ROOT_PASSWORD, String(insert.values[2])), true);
});

test('email collision never promotes or resets an existing non-root account', async () => {
  const { db, calls } = database([[], [{ id: 'member', is_root: false }]]);
  await assert.rejects(() => ensureBootstrapRoot(db, credentials), /nenhuma conta foi promovida/);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => !/INSERT|UPDATE/.test(call.sql)));
});

test('concurrent ROOT creation is reused and an ordinary account remains protected', async () => {
  const root = database([[], [], [], [{ id: 'concurrent-root', is_root: true }]]);
  assert.deepEqual(await ensureBootstrapRoot(root.db, credentials), { id: 'concurrent-root' });
  const ordinary = database([[], [], [], [{ id: 'concurrent-member', is_root: false }]]);
  await assert.rejects(() => ensureBootstrapRoot(ordinary.db, credentials), /sem alterar uma conta/);
  assert.ok([...root.calls, ...ordinary.calls].every(call => !/UPDATE/.test(call.sql)));
});
