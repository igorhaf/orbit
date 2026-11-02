import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { allowLocalOnlyMigrationBackup } from './migration-backup-policy';

test('migration backup stays cloud-gated unless the explicit DEV-only demo flag is present', () => {
  assert.equal(allowLocalOnlyMigrationBackup([], { ORBIT_ENV: 'development' }), false);
  assert.equal(allowLocalOnlyMigrationBackup(['--allow-dev-local-only-backup'], { ORBIT_ENV: 'development' }), true);
  assert.throws(
    () => allowLocalOnlyMigrationBackup(['--allow-dev-local-only-backup'], { ORBIT_ENV: 'production' }),
    /restricted to ORBIT_ENV=development/,
  );
  assert.throws(
    () => allowLocalOnlyMigrationBackup(['--allow-dev-local-only-backup'], {}),
    /restricted to ORBIT_ENV=development/,
  );
});

test('webhook event version migration repairs existing rows and enforces the version contract', () => {
  const migration = readFileSync(resolve(process.cwd(), 'sql/migrations/152_webhook_event_version.sql'), 'utf8');
  const schema = readFileSync(resolve(process.cwd(), 'sql/schema.sql'), 'utf8');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS event_version integer/i);
  assert.match(migration, /UPDATE webhook_events\s+SET event_version=1\s+WHERE event_version IS NULL/i);
  assert.match(migration, /ALTER COLUMN event_version SET DEFAULT 1/i);
  assert.match(migration, /ALTER COLUMN event_version SET NOT NULL/i);
  assert.match(migration, /CHECK \(event_version > 0\)/i);
  assert.match(schema, /event_version integer NOT NULL DEFAULT 1 CHECK \(event_version>0\)/i);
});
