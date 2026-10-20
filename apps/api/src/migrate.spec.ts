import assert from 'node:assert/strict';
import test from 'node:test';
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
