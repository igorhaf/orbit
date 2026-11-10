import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { restoreDatabaseBackup } from './database-backup';
import { appendErasureLedger, ErasureLedgerInput, initializeErasureLedger, markErasureLedgerCancelled, markErasureLedgerCommitted, readErasureLedger, recoverErasureLedgerHead } from './erasure-ledger';

const operationId = 'a0000000-0000-4000-8000-000000000001';
const subjectUserId = 'b0000000-0000-4000-8000-000000000002';
const recordId = 'c0000000-0000-4000-8000-000000000003';
const entry: ErasureLedgerInput = { operationId, subjectUserId, accountFields: ['email'], targets: [{ recordId, revision: 2, fieldPath: ['contact', 'email'] }] };

test('ledger persists only pseudonymous locators and append is idempotent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-erasure-ledger-'));
  const original = { key: process.env.ORBIT_ERASURE_LEDGER_KEY, path: process.env.ORBIT_ERASURE_LEDGER_PATH, backupKey: process.env.ORBIT_BACKUP_KEY };
  process.env.ORBIT_ERASURE_LEDGER_KEY = '91'.repeat(32);
  process.env.ORBIT_ERASURE_LEDGER_PATH = join(directory, 'ledger.jsonl');
  delete process.env.ORBIT_BACKUP_KEY;
  try {
    await assert.rejects(readErasureLedger(), /ENOENT/);
    await initializeErasureLedger();
    await appendErasureLedger(entry);
    await appendErasureLedger(entry);
    const records = await readErasureLedger();
    assert.equal(records.length, 1);
    assert.equal(records[0].state, 'prepared');
    assert.match(records[0].subjectRef, /^hmac-sha256:v1:/);
    const serialized = await readFile(process.env.ORBIT_ERASURE_LEDGER_PATH!, 'utf8');
    assert.equal(serialized.includes(subjectUserId), false);
    await assert.rejects(appendErasureLedger({ ...entry, targets: [] }), /different targets/);
    await markErasureLedgerCommitted(operationId);
    await markErasureLedgerCommitted(operationId);
    assert.equal((await readErasureLedger())[0].state, 'committed');
    await assert.rejects(markErasureLedgerCancelled(operationId), /already committed/);
    await assert.rejects(
      restoreDatabaseBackup('/missing.backup.enc', 'postgres://u:p@127.0.0.1:5432/orbit_restore_committed'),
      /ENOENT/,
    );
    await assert.rejects(initializeErasureLedger(), /EEXIST/);
  } finally {
    if (original.key === undefined) delete process.env.ORBIT_ERASURE_LEDGER_KEY; else process.env.ORBIT_ERASURE_LEDGER_KEY = original.key;
    if (original.path === undefined) delete process.env.ORBIT_ERASURE_LEDGER_PATH; else process.env.ORBIT_ERASURE_LEDGER_PATH = original.path;
    if (original.backupKey === undefined) delete process.env.ORBIT_BACKUP_KEY; else process.env.ORBIT_BACKUP_KEY = original.backupKey;
    await rm(directory, { recursive: true, force: true });
  }
});

test('ledger records credential revocation without storing the credential or provider identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-erasure-ledger-'));
  const original = { key: process.env.ORBIT_ERASURE_LEDGER_KEY, path: process.env.ORBIT_ERASURE_LEDGER_PATH };
  const path = join(directory, 'ledger.jsonl');
  process.env.ORBIT_ERASURE_LEDGER_KEY = '91'.repeat(32);
  process.env.ORBIT_ERASURE_LEDGER_PATH = path;
  const credentialsEntry: ErasureLedgerInput = { ...entry, operationId: 'a0000000-0000-4000-8000-000000000005', targets: [],
    accountFields: ['name', 'email', 'password_hash', 'social_identities'] };
  try {
    await initializeErasureLedger();
    await appendErasureLedger(credentialsEntry);
    await markErasureLedgerCommitted(credentialsEntry.operationId);
    const ledger = await readErasureLedger();
    assert.deepEqual(ledger[0].accountFields, ['email', 'name', 'password_hash', 'social_identities']);
    assert.equal(JSON.stringify(ledger).includes('password_hash_value'), false);
  } finally {
    if (original.key === undefined) delete process.env.ORBIT_ERASURE_LEDGER_KEY; else process.env.ORBIT_ERASURE_LEDGER_KEY = original.key;
    if (original.path === undefined) delete process.env.ORBIT_ERASURE_LEDGER_PATH; else process.env.ORBIT_ERASURE_LEDGER_PATH = original.path;
    await rm(directory, { recursive: true, force: true });
  }
});

test('ledger fails closed on truncation, tampering, missing head, and missing key', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-erasure-ledger-'));
  const original = { key: process.env.ORBIT_ERASURE_LEDGER_KEY, path: process.env.ORBIT_ERASURE_LEDGER_PATH };
  const path = join(directory, 'ledger.jsonl');
  process.env.ORBIT_ERASURE_LEDGER_KEY = '92'.repeat(32);
  process.env.ORBIT_ERASURE_LEDGER_PATH = path;
  try {
    await initializeErasureLedger();
    await appendErasureLedger(entry);
    const bytes = await readFile(path);
    await writeFile(path, bytes.subarray(0, bytes.length - 2));
    await assert.rejects(readErasureLedger(), /truncated/);
    await writeFile(path, bytes);
    await writeFile(`${path}.head`, '{}');
    await assert.rejects(readErasureLedger(), /head is invalid/);
    await rm(`${path}.head`);
    await assert.rejects(readErasureLedger(), /ENOENT/);
    await writeFile(`${path}.head`, JSON.stringify({ version: 1, sequence: 1, mac: '0'.repeat(64), signature: '0'.repeat(64) }));
    process.env.ORBIT_ERASURE_LEDGER_KEY = '';
    await assert.rejects(readErasureLedger(), /ORBIT_ERASURE_LEDGER_KEY/);
  } finally {
    if (original.key === undefined) delete process.env.ORBIT_ERASURE_LEDGER_KEY; else process.env.ORBIT_ERASURE_LEDGER_KEY = original.key;
    if (original.path === undefined) delete process.env.ORBIT_ERASURE_LEDGER_PATH; else process.env.ORBIT_ERASURE_LEDGER_PATH = original.path;
    await rm(directory, { recursive: true, force: true });
  }
});

test('operator recovery advances only an authenticated complete tail after a crash', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-erasure-ledger-'));
  const original = { key: process.env.ORBIT_ERASURE_LEDGER_KEY, path: process.env.ORBIT_ERASURE_LEDGER_PATH };
  const path = join(directory, 'ledger.jsonl');
  process.env.ORBIT_ERASURE_LEDGER_KEY = '93'.repeat(32);
  process.env.ORBIT_ERASURE_LEDGER_PATH = path;
  try {
    await initializeErasureLedger();
    const genesisHead = await readFile(`${path}.head`, 'utf8');
    await appendErasureLedger(entry);
    await markErasureLedgerCommitted(operationId);
    await writeFile(`${path}.head`, genesisHead);
    await assert.rejects(readErasureLedger(), /disagree/);
    await assert.rejects(readErasureLedger(), /disagree/);
    assert.deepEqual(await recoverErasureLedgerHead(), { recovered: true, entries: 2 });
    assert.equal((await readErasureLedger())[0].state, 'committed');
  } finally {
    if (original.key === undefined) delete process.env.ORBIT_ERASURE_LEDGER_KEY; else process.env.ORBIT_ERASURE_LEDGER_KEY = original.key;
    if (original.path === undefined) delete process.env.ORBIT_ERASURE_LEDGER_PATH; else process.env.ORBIT_ERASURE_LEDGER_PATH = original.path;
    await rm(directory, { recursive: true, force: true });
  }
});

test('cancelled erasures are terminal and not applied', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-erasure-ledger-'));
  const original = { key: process.env.ORBIT_ERASURE_LEDGER_KEY, path: process.env.ORBIT_ERASURE_LEDGER_PATH };
  process.env.ORBIT_ERASURE_LEDGER_KEY = '94'.repeat(32);
  process.env.ORBIT_ERASURE_LEDGER_PATH = join(directory, 'ledger.jsonl');
  try {
    await initializeErasureLedger();
    await appendErasureLedger(entry);
    await markErasureLedgerCancelled(operationId);
    assert.equal((await readErasureLedger())[0].state, 'cancelled');
    await assert.rejects(markErasureLedgerCommitted(operationId), /already cancelled/);
    await assert.rejects(appendErasureLedger(entry), /cancelled/);
    await assert.rejects(
      restoreDatabaseBackup('/missing.backup.enc', 'postgres://u:p@127.0.0.1:5432/orbit_restore_cancelled'),
      /ENOENT/,
    );
  } finally {
    if (original.key === undefined) delete process.env.ORBIT_ERASURE_LEDGER_KEY; else process.env.ORBIT_ERASURE_LEDGER_KEY = original.key;
    if (original.path === undefined) delete process.env.ORBIT_ERASURE_LEDGER_PATH; else process.env.ORBIT_ERASURE_LEDGER_PATH = original.path;
    await rm(directory, { recursive: true, force: true });
  }
});

test('concurrent appends serialize without losing or duplicating ledger entries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-erasure-ledger-'));
  const original = { key: process.env.ORBIT_ERASURE_LEDGER_KEY, path: process.env.ORBIT_ERASURE_LEDGER_PATH };
  process.env.ORBIT_ERASURE_LEDGER_KEY = '96'.repeat(32);
  process.env.ORBIT_ERASURE_LEDGER_PATH = join(directory, 'ledger.jsonl');
  const second = { ...entry, operationId: 'a0000000-0000-4000-8000-000000000004' };
  try {
    await initializeErasureLedger();
    const same = await Promise.allSettled([appendErasureLedger(entry), appendErasureLedger(entry)]);
    assert.ok(same.some(item => item.status === 'fulfilled'));
    await appendErasureLedger(entry);
    const different = await Promise.allSettled([appendErasureLedger(entry), appendErasureLedger(second)]);
    assert.ok(different.some(item => item.status === 'fulfilled'));
    await appendErasureLedger(entry);
    await appendErasureLedger(second);
    const records = await readErasureLedger();
    assert.equal(records.length, 2);
    assert.deepEqual(records.map(item => item.state), ['prepared', 'prepared']);
  } finally {
    if (original.key === undefined) delete process.env.ORBIT_ERASURE_LEDGER_KEY; else process.env.ORBIT_ERASURE_LEDGER_KEY = original.key;
    if (original.path === undefined) delete process.env.ORBIT_ERASURE_LEDGER_PATH; else process.env.ORBIT_ERASURE_LEDGER_PATH = original.path;
    await rm(directory, { recursive: true, force: true });
  }
});

test('restore refuses prepared entries before touching an archive or database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-erasure-ledger-'));
  const original = { key: process.env.ORBIT_ERASURE_LEDGER_KEY, path: process.env.ORBIT_ERASURE_LEDGER_PATH };
  process.env.ORBIT_ERASURE_LEDGER_KEY = '95'.repeat(32);
  process.env.ORBIT_ERASURE_LEDGER_PATH = join(directory, 'ledger.jsonl');
  try {
    await initializeErasureLedger();
    await appendErasureLedger(entry);
    await assert.rejects(
      restoreDatabaseBackup('/missing.backup.enc', 'postgres://u:p@127.0.0.1:5432/orbit_restore_prepared'),
      /unresolved prepared operations/,
    );
  } finally {
    if (original.key === undefined) delete process.env.ORBIT_ERASURE_LEDGER_KEY; else process.env.ORBIT_ERASURE_LEDGER_KEY = original.key;
    if (original.path === undefined) delete process.env.ORBIT_ERASURE_LEDGER_PATH; else process.env.ORBIT_ERASURE_LEDGER_PATH = original.path;
    await rm(directory, { recursive: true, force: true });
  }
});
