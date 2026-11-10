import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertIsolatedRestoreTarget, restoreDatabaseBackup, verifyDatabaseBackup } from './database-backup';

test('restore target must be an explicitly isolated disposable database', () => {
  assert.doesNotThrow(() => assertIsolatedRestoreTarget('postgres://user:pass@127.0.0.1:5432/orbit_restore_client_test'));
  for (const database of ['orbit', 'orbit_prod', 'orbit_client', 'postgres', 'template1']) {
    assert.throws(
      () => assertIsolatedRestoreTarget(`postgres://user:pass@127.0.0.1:5432/${database}`),
      /isolated orbit_restore_ prefix/,
      `${database} must not be a restore target`,
    );
  }
});

test('restore target rejects non-PostgreSQL and malformed URLs before connecting', () => {
  assert.throws(() => assertIsolatedRestoreTarget('https://example.test/orbit_restore_test'), /postgres:\/\/ or postgresql:\/\//);
  assert.throws(() => assertIsolatedRestoreTarget('not a connection URL'), /Invalid URL/);
});

test('backup verification rejects the wrong key and tampered archive before restore', async () => {
  const oldKey = process.env.ORBIT_BACKUP_KEY;
  const directory = await mkdtemp(join(tmpdir(), 'orbit-database-backup-test-'));
  const bin = join(directory, 'bin');
  const key = Buffer.from('7a'.repeat(32), 'hex');
  const archiveName = 'orbit-2026-10-13T12-00-00-000Z-fixture.backup.enc';
  const archivePath = join(directory, archiveName);
  const plain = Buffer.from('synthetic pg dump fixture');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const bytes = Buffer.concat([Buffer.from('ORBITBK1'), iv, cipher.getAuthTag(), encrypted]);
  const manifest = {
    format: 'orbit-aes-256-gcm-v1',
    key_fingerprint: createHash('sha256').update(key).digest('hex').slice(0, 16),
    created_at: new Date().toISOString(),
    reason: 'synthetic test',
    database: 'orbit',
    server: { host: 'db-dev', port: '5432' },
    postgres_server: '17',
    postgres_client: 'pg_dump 17',
    application_revision: null,
    archive: archiveName,
    archive_bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  try {
    await mkdir(bin);
    const pgRestore = join(bin, 'pg_restore');
    await writeFile(pgRestore, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    await chmod(pgRestore, 0o700);
    await writeFile(archivePath, bytes, { mode: 0o600 });
    await writeFile(`${archivePath}.manifest.json`, JSON.stringify(manifest), { mode: 0o600 });
    process.env.PATH = `${bin}:${process.env.PATH || ''}`;
    process.env.ORBIT_BACKUP_KEY = key.toString('hex');
    assert.equal((await verifyDatabaseBackup(archivePath)).archive, archiveName);

    process.env.ORBIT_BACKUP_KEY = Buffer.from('8b'.repeat(32), 'hex').toString('hex');
    await assert.rejects(() => verifyDatabaseBackup(archivePath), /does not match this archive/);
    process.env.ORBIT_BACKUP_KEY = key.toString('hex');
    await writeFile(archivePath, Buffer.concat([bytes, Buffer.from('tamper')]));
    await assert.rejects(() => verifyDatabaseBackup(archivePath), /checksum does not match/);
    await assert.rejects(() => restoreDatabaseBackup('/does/not/exist', 'postgres://u:p@db-prod:5432/orbit_prod'), /isolated orbit_restore_ prefix/);
  } finally {
    if (oldKey === undefined) delete process.env.ORBIT_BACKUP_KEY;
    else process.env.ORBIT_BACKUP_KEY = oldKey;
    await rm(directory, { recursive: true, force: true });
  }
});
