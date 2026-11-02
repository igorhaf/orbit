import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyVersionedMigrations } from './migrations';

test('distinct full filenames with the same numeric prefix migrate independently and only once', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-versioned-migrations-'));
  context.after(async () => rm(directory, { recursive: true, force: true }));

  const files = [
    '149_notification_email_delivery.sql',
    '149_auth_mfa_session_version.sql',
    '150_notification_web_push.sql',
  ];
  for (const file of files) await writeFile(join(directory, file), `SELECT '${file}';\n`, { mode: 0o600 });
  await writeFile(join(directory, 'README.md'), 'ignored');

  const applied = new Map<string, string>();
  const executed: string[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      if (sql.startsWith('SELECT checksum FROM schema_migrations')) {
        const checksum = applied.get(String(params[0]));
        return { rows: checksum ? [{ checksum }] : [] };
      }
      if (sql.startsWith('INSERT INTO schema_migrations')) {
        applied.set(String(params[0]), String(params[1]));
        return { rows: [] };
      }
      executed.push(sql);
      return { rows: [] };
    },
  };

  await applyVersionedMigrations(client as never, directory);
  assert.deepEqual([...applied.keys()], [...files].sort());
  assert.deepEqual(executed.slice(3), [...files].sort().map((file) => `SELECT '${file}';\n`));

  const executionCount = executed.length;
  await applyVersionedMigrations(client as never, directory);
  assert.equal(executed.length, executionCount + 3, 'only transaction setup and lock queries rerun');
  assert.equal(applied.size, files.length);
});
