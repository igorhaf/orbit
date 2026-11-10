import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Client, Pool } from 'pg';
import { erasureSubjectRef, readErasureLedger } from './erasure-ledger';
import { migrateVersions } from './migrations';

const MAGIC = Buffer.from('ORBITBK1');
const HEADER_LENGTH = MAGIC.length + 12 + 16;
const BACKUP_PATTERN = /^orbit-\d{4}-\d{2}-\d{2}T[^/]+\.backup\.enc$/;

export type BackupManifest = {
  format: 'orbit-aes-256-gcm-v1';
  key_fingerprint: string;
  created_at: string;
  reason: string;
  database: string;
  server: { host: string; port: string };
  postgres_server: string;
  postgres_client: string;
  application_revision: string | null;
  archive: string;
  archive_bytes: number;
  sha256: string;
};

type Connection = { host: string; port: string; database: string; user: string; password: string; sslmode?: string; sslrootcert?: string; sslcert?: string; sslkey?: string };

function backupKey() {
  const value = process.env.ORBIT_BACKUP_KEY || '';
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error('ORBIT_BACKUP_KEY must be 64 hexadecimal characters. Generate it with: openssl rand -hex 32');
  return Buffer.from(value, 'hex');
}

function keyFingerprint(key: Buffer) { return createHash('sha256').update(key).digest('hex').slice(0, 16); }

function parseConnection(connectionString: string): Connection {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use postgres:// or postgresql://.');
  const value = (key: string) => url.searchParams.get(key) || undefined;
  return {
    host: url.hostname || '/var/run/postgresql', port: url.port || '5432',
    database: decodeURIComponent(url.pathname.slice(1)), user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), sslmode: value('sslmode'), sslrootcert: value('sslrootcert'),
    sslcert: value('sslcert'), sslkey: value('sslkey'),
  };
}

function pgEnvironment(connection: Connection, passfile: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, PGHOST: connection.host, PGPORT: connection.port, PGDATABASE: connection.database, PGUSER: connection.user, PGPASSFILE: passfile };
  if (connection.sslmode) env.PGSSLMODE = connection.sslmode;
  if (connection.sslrootcert) env.PGSSLROOTCERT = connection.sslrootcert;
  if (connection.sslcert) env.PGSSLCERT = connection.sslcert;
  if (connection.sslkey) env.PGSSLKEY = connection.sslkey;
  return env;
}

function pgpassValue(value: string) { return value.replaceAll('\\', '\\\\').replaceAll(':', '\\:'); }

function command(binary: string, args: string[], env = process.env) {
  return new Promise<void>((resolveCommand, reject) => {
    const child = spawn(binary, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-4000); });
    child.once('error', cause => reject(new Error(`Could not start ${binary}: ${(cause as Error).message}`)));
    child.once('close', code => code === 0 ? resolveCommand() : reject(new Error(`${binary} exited with code ${code}: ${error.trim()}`)));
  });
}

function commandOutput(binary: string, args: string[]) {
  return new Promise<string>((resolveOutput, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    child.once('error', cause => reject(new Error(`Could not start ${binary}: ${(cause as Error).message}`)));
    child.once('close', code => code === 0 ? resolveOutput(stdout.trim()) : reject(new Error(`${binary} exited with code ${code}: ${stderr.trim()}`)));
  });
}

async function sha256(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function encryptFile(input: string, output: string, key: Buffer, work: string) {
  const iv = randomBytes(12);
  const cipherFile = join(work, 'ciphertext.tmp');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  await pipeline(createReadStream(input), cipher, createWriteStream(cipherFile, { mode: 0o600, flags: 'wx' }));
  const tag = cipher.getAuthTag();
  const final = createWriteStream(output, { mode: 0o600, flags: 'wx' });
  async function* parts() {
    yield Buffer.concat([MAGIC, iv, tag]);
    for await (const chunk of createReadStream(cipherFile)) yield chunk as Buffer;
  }
  await pipeline(Readable.from(parts()), final);
}

async function decryptFile(input: string, output: string, key: Buffer) {
  const info = await stat(input);
  if (info.size <= HEADER_LENGTH) throw new Error('Backup file is truncated.');
  const handle = await open(input, 'r');
  const header = Buffer.alloc(HEADER_LENGTH);
  try { await handle.read(header, 0, HEADER_LENGTH, 0); } finally { await handle.close(); }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Backup format is not recognized.');
  const iv = header.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = header.subarray(MAGIC.length + 12, HEADER_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  await pipeline(createReadStream(input, { start: HEADER_LENGTH }), decipher, createWriteStream(output, { mode: 0o600, flags: 'wx' }));
}

async function revision() {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const result = await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: process.cwd() });
    return result.stdout.trim() || null;
  } catch { return null; }
}

function directory() { return resolve(process.env.ORBIT_BACKUP_DIR || join(__dirname, '../../../backups')); }
export const backupDirectory=directory;
export function backupPath(archive:string){if(!BACKUP_PATTERN.test(archive))throw new Error('Arquivo de backup inválido.');return join(directory(),archive)}

export async function createDatabaseBackup(reason = 'manual'): Promise<BackupManifest> {
  const key = backupKey();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const connection = parseConnection(databaseUrl);
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  let serverVersion: string;
  try { serverVersion = (await database.query("SELECT current_setting('server_version') AS version")).rows[0].version; }
  finally { await database.end(); }
  const root = directory();
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const work = await mkdtemp(join(root, '.orbit-backup-'));
  await chmod(work, 0o700);
  const passfile = join(work, 'pgpass');
  const dump = join(work, 'database.dump');
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const archive = join(root, `orbit-${timestamp}-${randomBytes(4).toString('hex')}.backup.enc`);
  const archiveTemp = join(work, 'archive.tmp');
  const manifestPath = `${archive}.manifest.json`;
  try {
    await writeFile(passfile, `${pgpassValue(connection.host)}:${pgpassValue(connection.port)}:${pgpassValue(connection.database)}:${pgpassValue(connection.user)}:${pgpassValue(connection.password)}\n`, { mode: 0o600 });
    await chmod(passfile, 0o600);
    const env = pgEnvironment(connection, passfile);
    await command('pg_dump', ['--format=custom', '--compress=9', '--no-owner', '--no-acl', '--file', dump, '--dbname', connection.database], env);
    await command('pg_restore', ['--list', dump]);
    await encryptFile(dump, archiveTemp, key, work);
    const manifest: BackupManifest = {
      format: 'orbit-aes-256-gcm-v1', key_fingerprint: keyFingerprint(key), created_at: new Date().toISOString(), reason: reason.slice(0, 120),
      database: connection.database, server: { host: connection.host, port: connection.port }, postgres_server: serverVersion,
      postgres_client: await commandOutput('pg_dump', ['--version']),
      application_revision: await revision(), archive: basename(archive), archive_bytes: (await stat(archiveTemp)).size, sha256: await sha256(archiveTemp),
    };
    await verifyArchiveFile(archiveTemp, manifest, key, work);
    await rename(archiveTemp, archive);
    const manifestTemp = `${manifestPath}.tmp`;
    await writeFile(manifestTemp, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(manifestTemp, manifestPath);
    try { await pruneDatabaseBackups(); }
    catch (error) { console.warn(`Backup is safe, but retention cleanup failed: ${(error as Error).message}`); }
    return manifest;
  } catch (error) {
    await rm(archiveTemp, { force: true });
    throw error;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function verifyArchiveFile(archive: string, manifest: BackupManifest, key: Buffer, work: string) {
  if (manifest.key_fingerprint !== keyFingerprint(key)) throw new Error('ORBIT_BACKUP_KEY does not match this archive.');
  if (await sha256(archive) !== manifest.sha256) throw new Error('Backup checksum does not match its manifest.');
  const dump = join(work, 'verified.dump');
  await decryptFile(archive, dump, key);
  await command('pg_restore', ['--list', dump]);
  await rm(dump, { force: true });
}

export async function verifyDatabaseBackup(archiveInput: string) {
  const archive = resolve(archiveInput);
  const manifest = JSON.parse(await readFile(`${archive}.manifest.json`, 'utf8')) as BackupManifest;
  if (manifest.format !== 'orbit-aes-256-gcm-v1' || manifest.archive !== basename(archive)) throw new Error('Backup manifest does not match this archive.');
  const work = await mkdtemp(join(tmpdir(), 'orbit-verify-'));
  try {
    await verifyArchiveFile(archive, manifest, backupKey(), work);
    return manifest;
  } finally { await rm(work, { recursive: true, force: true }); }
}

export function assertIsolatedRestoreTarget(targetUrl: string) {
  const target = parseConnection(targetUrl);
  if (!/^orbit_restore_[a-z0-9_]+$/.test(target.database)) {
    throw new Error('Restore target database must use the isolated orbit_restore_ prefix; never target DEV, production, or a customer database.');
  }
}

export async function restoreDatabaseBackup(archiveInput: string, targetUrl: string) {
  assertIsolatedRestoreTarget(targetUrl);
  // Read and authenticate before touching the disposable target. Missing/corrupt ledger blocks recovery.
  const ledgerState = await readErasureLedger();
  if (ledgerState.some(entry => entry.state === 'prepared')) throw new Error('Erasure ledger has unresolved prepared operations. Reconcile them against the active database before restoring.');
  const erasures = ledgerState.filter(entry => entry.state === 'committed');
  const archive = resolve(archiveInput);
  const manifest = await verifyDatabaseBackup(archive);
  const target = parseConnection(targetUrl);
  if (target.database === manifest.database && target.host === manifest.server.host && target.port === manifest.server.port) {
    throw new Error('Restore target must be a different database. Restore to a new database, verify it, then switch the application connection.');
  }
  const client = new Client({ connectionString: targetUrl });
  await client.connect();
  try {
    const existing = await client.query(`SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','v','m','S','f','p')`);
    if (Number(existing.rows[0].count) > 0) throw new Error('Restore target is not empty. Create a fresh database so recovery cannot overwrite data.');
  } finally { await client.end(); }
  const work = await mkdtemp(join(tmpdir(), 'orbit-restore-'));
  const passfile = join(work, 'pgpass');
  const dump = join(work, 'database.dump');
  try {
    await writeFile(passfile, `${pgpassValue(target.host)}:${pgpassValue(target.port)}:${pgpassValue(target.database)}:${pgpassValue(target.user)}:${pgpassValue(target.password)}\n`, { mode: 0o600 });
    await chmod(passfile, 0o600);
    const env = pgEnvironment(target, passfile);
    await decryptFile(archive, dump, backupKey());
    await command('pg_restore', ['--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges', '--dbname', target.database, dump], env);
    const restored = new Client({ connectionString: targetUrl });
    await restored.connect();
    try {
      // Bring old snapshots to the current app schema before applying the ledger.
      await restored.query(await readFile(resolve(__dirname, '../sql/schema.sql'), 'utf8'));
      const migrationTable = await restored.query("SELECT to_regclass('schema_migrations') AS name");
      const compatApplied = migrationTable.rows[0]?.name
        ? Boolean((await restored.query("SELECT 1 FROM schema_migrations WHERE version='022_remove_automations.sql'")).rowCount)
        : false;
      if (!compatApplied) await restored.query(await readFile(resolve(__dirname, '../sql/pre-022-compat.sql'), 'utf8'));
      const migrationPool = new Pool({ connectionString: targetUrl });
      try { await migrateVersions(migrationPool); } finally { await migrationPool.end(); }
      await applyErasureLedger(restored, erasures);
      const required = ['users', 'boards', 'cards', 'attachments', 'board_media', 'comment_attachments', 'schema_migrations'];
      const result = await restored.query('SELECT tablename FROM pg_tables WHERE schemaname=current_schema()');
      const tables = new Set(result.rows.map(row => row.tablename));
      const missing = required.filter(table => !tables.has(table));
      if (missing.length) throw new Error(`Restored database is missing required tables: ${missing.join(', ')}.`);
      const counts = await restored.query('SELECT (SELECT count(*) FROM users)::int AS users,(SELECT count(*) FROM boards)::int AS boards,(SELECT count(*) FROM cards)::int AS cards,(SELECT count(*) FROM attachments)::int AS attachments');
      return { manifest, counts: counts.rows[0] };
    } finally { await restored.end(); }
  } finally { await rm(work, { recursive: true, force: true }); }
}

async function applyErasureLedger(client: Client, ledgerEntries: Awaited<ReturnType<typeof readErasureLedger>>) {
  if (ledgerEntries.some(entry => entry.state === 'prepared')) throw new Error('Erasure ledger has unresolved prepared operations. Restore is blocked.');
  const entries = ledgerEntries.filter(entry => entry.state === 'committed');
  if (!entries.length) return;
  const tables = new Set((await client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema()")).rows.map(row => row.table_name));
  const has = (table: string) => tables.has(table);
  const requiredTables = new Set<string>();
  for (const entry of entries) for (const target of entry.targets) {
    requiredTables.add('extension_records'); requiredTables.add('extension_record_versions');
    if ('attachmentStore' in target) requiredTables.add(target.attachmentStore === 'record_attachment' ? 'extension_record_attachments' : 'extension_files');
  }
  const missing = [...requiredTables].filter(table => !has(table));
  if (missing.length) throw new Error(`Erasure ledger targets require missing migrated tables: ${missing.join(', ')}. Restore remains quarantined.`);
  if (!has('suinda_privacy_erasures')) throw new Error('Restored schema lacks the approved-erasure execution schema (migration 162). Restore remains quarantined.');
  if (!has('suinda_privacy_restore_targets')) throw new Error('Restored schema lacks the narrow restore-target staging table (migration 162). Restore remains quarantined.');
  if (!has('users')) throw new Error('Erasure ledger requires the migrated users table. Restore remains quarantined.');
  const completedInSnapshot = new Set<string>();
  const markersToConfirm = new Set<string>();
  for (const entry of entries) {
    const operation = await client.query<{ state: string; external_ledger_state: string; subject_user_id: string }>(
      'SELECT state,external_ledger_state,subject_user_id::text AS subject_user_id FROM suinda_privacy_erasures WHERE id=$1', [entry.operationId],
    );
    if (!operation.rowCount) continue;
    const stored = operation.rows[0];
    if (stored.state !== 'completed' || !['prepared', 'committed'].includes(stored.external_ledger_state)) throw new Error(`Restore contains an unresolved or inconsistent Suindá erasure operation ${entry.operationId}.`);
    const storedSubjectRef = erasureSubjectRef(stored.subject_user_id);
    if (storedSubjectRef !== entry.subjectRef) throw new Error(`Restore operation ${entry.operationId} does not match its pseudonymous subject reference.`);
    completedInSnapshot.add(entry.operationId);
    if (stored.external_ledger_state === 'prepared') markersToConfirm.add(entry.operationId);
  }
  const entriesToApply = entries.filter(entry => !completedInSnapshot.has(entry.operationId));
  const userIds = (await client.query<{ id: string; session_version: number; is_root: boolean }>('SELECT id::text AS id,session_version,is_root FROM users')).rows;
  const subjects = new Map<string, string>();
  const originalSessionVersions = new Map<string, number>();
  const rootUsers = new Set<string>();
  for (const user of userIds) {
    const ref = erasureSubjectRef(user.id);
    subjects.set(ref, user.id);
    originalSessionVersions.set(user.id, user.session_version);
    if (user.is_root) rootUsers.add(user.id);
  }
  const accountTargets = entries.map(entry => ({ entry, userId: subjects.get(entry.subjectRef) })).filter(item => item.userId);
  const accountTargetsToApply = accountTargets.filter(target => !completedInSnapshot.has(target.entry.operationId));
  if (accountTargetsToApply.some(target => rootUsers.has(target.userId!))) throw new Error('Erasure ledger resolves to a ROOT account without a completed operation in the restored snapshot; restore remains quarantined.');
  const targetIds = [...new Set(entries.flatMap(entry => entry.targets.map(target => target.recordId)))];
  const present = targetIds.length && has('extension_records')
    ? (await client.query<{ id: string }>('SELECT id::text AS id FROM extension_records WHERE id=ANY($1::uuid[])', [targetIds])).rows.map(row => row.id)
    : [];
  // An approved locator absent from an older snapshot is already absent. But if present, all requested scrub targets must be executable.
  const activeIds = new Set(present);
  await client.query('BEGIN');
  try {
    for (const operationId of markersToConfirm) {
      const updated = await client.query("UPDATE suinda_privacy_erasures SET external_ledger_state='committed' WHERE id=$1 AND state='completed' AND external_ledger_state='prepared'", [operationId]);
      if (updated.rowCount !== 1) throw new Error(`Could not confirm completed erasure operation ${operationId} in the restored snapshot.`);
    }
    const stageTarget = async (operationId: string, values: [string | null, string | null, number | null, string[] | null, string | null, string | null, string | null]) => {
      const [subjectUserId, recordId, revision, fieldPath, attachmentStore, attachmentId, accountField] = values;
      await client.query('INSERT INTO suinda_privacy_restore_targets(operation_id,subject_user_id,record_id,revision,field_path,attachment_store,attachment_id,account_field) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',
        [operationId, subjectUserId, recordId, revision, fieldPath, attachmentStore, attachmentId, accountField]);
      const exact = await client.query<{ present: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM suinda_privacy_restore_targets WHERE operation_id=$1
          AND subject_user_id IS NOT DISTINCT FROM $2::uuid AND record_id IS NOT DISTINCT FROM $3::uuid
          AND revision IS NOT DISTINCT FROM $4::integer AND field_path IS NOT DISTINCT FROM $5::text[]
          AND attachment_store IS NOT DISTINCT FROM $6::text AND attachment_id IS NOT DISTINCT FROM $7::uuid
          AND account_field IS NOT DISTINCT FROM $8::text) AS present`,
        [operationId, subjectUserId, recordId, revision, fieldPath, attachmentStore, attachmentId, accountField],
      );
      if (!exact.rows[0]?.present) throw new Error('Restore staging contains a conflicting locator for this erasure operation.');
    };
    for (const entry of entriesToApply) {
      const userId = subjects.get(entry.subjectRef);
      await client.query("SELECT set_config('suinda.privacy_restore_execution_id',$1,true)", [entry.operationId]);
      for (const target of entry.targets) {
        if (!activeIds.has(target.recordId)) continue;
        const version = await client.query<{ present: boolean }>('SELECT EXISTS(SELECT 1 FROM extension_record_versions WHERE record_id=$1 AND revision=$2) AS present', [target.recordId, target.revision]);
        if (!version.rows[0]?.present) throw new Error(`Erasure ledger target revision ${target.recordId}@${target.revision} is missing while its record exists; restore remains quarantined.`);
        if ('fieldPath' in target) await stageTarget(entry.operationId, [null, target.recordId, target.revision, target.fieldPath, null, null, null]);
        else if (target.attachmentStore === 'record_attachment') await stageTarget(entry.operationId, [null, target.recordId, target.revision, null, target.attachmentStore, target.attachmentId, null]);
        else await stageTarget(entry.operationId, [null, target.recordId, target.revision, null, target.attachmentStore, null, null]);
      }
      const set = new Set(entry.accountFields);
      if (userId) {
        if (set.size) for (const field of set) await stageTarget(entry.operationId, [userId, null, null, null, null, null, field]);
        else await stageTarget(entry.operationId, [userId, null, null, null, null, null, null]);
      }
      if (set.size) {
        const updates: string[] = [];
        const values: unknown[] = [];
        const put = (sql: string, value: unknown) => { values.push(value); updates.push(sql.replace('?', `$${values.length}`)); };
        if (set.has('name')) put('name=?', 'Dados anonimizados');
        if (set.has('email')) { put('email=?', `anon+${userId}@privacy.invalid`); updates.push('email_verified=false'); }
        if (set.has('avatar_url')) updates.push('avatar_url=NULL');
        if (set.has('preferences')) put('preferences=?::jsonb', '{}');
        if (set.has('password_hash')) { updates.push("password_hash='!erased:'||id::text"); updates.push('mfa_enabled=false'); }
        updates.push('disabled=true');
        await client.query(`UPDATE users SET ${updates.join(',')},session_version=session_version+1 WHERE id=$${values.length + 1}`, [...values, userId]);
        if (set.has('social_identities') && has('auth_social_identities'))
          await client.query('DELETE FROM auth_social_identities WHERE user_id=$1', [userId]);
      } else if (userId) await client.query('UPDATE users SET session_version=session_version+1 WHERE id=$1', [userId]);
      if (!userId) continue;
      if (has('account_auth_tokens')) await client.query("UPDATE account_auth_tokens SET consumed_at=COALESCE(consumed_at,now()) WHERE user_id=$1", [userId]);
      if (has('auth_mfa_challenges')) await client.query("UPDATE auth_mfa_challenges SET consumed_at=COALESCE(consumed_at,now()) WHERE user_id=$1 AND consumed_at IS NULL", [userId]);
      if (has('notification_push_subscriptions')) await client.query('DELETE FROM notification_push_subscriptions WHERE user_id=$1', [userId]);
      if (has('suinda_calendar_subscriptions')) await client.query("UPDATE suinda_calendar_subscriptions SET revoked_at=COALESCE(revoked_at,now()) WHERE owner_id=$1", [userId]);
    }
    for (const entry of entriesToApply) {
      await client.query("SELECT set_config('suinda.privacy_restore_execution_id',$1,true)", [entry.operationId]);
      const pathGroups = new Map<string, { recordId: string; revision: number; paths: string[][] }>();
      for (const target of entry.targets) if ('fieldPath' in target && activeIds.has(target.recordId)) {
        const groupKey = `${target.recordId}:${target.revision}`;
        const group = pathGroups.get(groupKey) || { recordId: target.recordId, revision: target.revision, paths: [] };
        if (!group.paths.some(path => JSON.stringify(path) === JSON.stringify(target.fieldPath))) group.paths.push(target.fieldPath);
        pathGroups.set(groupKey, group);
      }
      for (const group of pathGroups.values()) {
        const version = await client.query<{ present: boolean }>('SELECT EXISTS(SELECT 1 FROM extension_record_versions WHERE record_id=$1 AND revision=$2) AS present', [group.recordId, group.revision]);
        if (!version.rows[0]?.present) continue;
        const versionValues: unknown[] = [group.recordId, group.revision];
        let versionPayload = 'payload';
        for (const path of group.paths) { versionValues.push(path); versionPayload += ` #- $${versionValues.length}::text[]`; }
        await client.query(`UPDATE extension_record_versions SET payload=${versionPayload} WHERE record_id=$1 AND revision=$2`, versionValues);
        const current = await client.query<{ revision: number }>('SELECT revision FROM extension_records WHERE id=$1', [group.recordId]);
        if (current.rows[0]?.revision === group.revision) {
          const currentValues: unknown[] = [group.recordId];
          let currentPayload = 'payload';
          for (const path of group.paths) { currentValues.push(path); currentPayload += ` #- $${currentValues.length}::text[]`; }
          await client.query(`UPDATE extension_records SET payload=${currentPayload} WHERE id=$1`, currentValues);
        }
      }
      for (const target of entry.targets) {
        if (!activeIds.has(target.recordId)) continue;
        if ('fieldPath' in target) continue;
        if (target.attachmentStore === 'record_attachment') {
          await client.query("UPDATE extension_record_attachments SET file_name='redacted',mime_type='application/octet-stream',size_bytes=1,sha256=encode(digest(decode('00','hex'),'sha256'),'hex'),data=decode('00','hex') WHERE id=$1 AND record_id=$2 AND revision=$3", [target.attachmentId,target.recordId,target.revision]);
        } else {
          await client.query("UPDATE extension_files SET sha256=encode(digest(decode('00','hex'),'sha256'),'hex'),data=decode('00','hex') WHERE record_id=$1 AND revision=$2", [target.recordId,target.revision]);
        }
      }
    }
    // Verify applicable records/attachments and account refs before allowing the restore to return success.
    for (const entry of entries) for (const target of entry.targets) if (activeIds.has(target.recordId)) {
      if ('fieldPath' in target) {
        const v = await client.query<{ value: unknown }>('SELECT payload #> $3::text[] AS value FROM extension_record_versions WHERE record_id=$1 AND revision=$2', [target.recordId,target.revision,target.fieldPath]);
        if (v.rows.some(row => row.value !== null)) throw new Error('Erasure ledger payload target remains after restore scrub.');
        const c = await client.query<{ value: unknown }>('SELECT payload #> $2::text[] AS value FROM extension_records WHERE id=$1', [target.recordId,target.fieldPath]);
        if (c.rows.some(row => row.value !== null)) throw new Error('Erasure ledger current payload target remains after restore scrub.');
      } else if (target.attachmentStore === 'record_attachment') {
        const result = await client.query<{ size_bytes: number; file_name: string }>('SELECT size_bytes,file_name FROM extension_record_attachments WHERE id=$1 AND record_id=$2 AND revision=$3',[target.attachmentId,target.recordId,target.revision]);
        if (result.rowCount && (result.rows[0].size_bytes !== 1 || result.rows[0].file_name !== 'redacted')) throw new Error('Erasure ledger attachment target remains after restore scrub.');
      } else {
        const result = await client.query<{ size: number }>('SELECT octet_length(data)::int AS size FROM extension_files WHERE record_id=$1 AND revision=$2',[target.recordId,target.revision]);
        if (result.rows.some(row => row.size !== 1)) throw new Error('Erasure ledger extension file target remains after restore scrub.');
      }
    }
    for (const [userId, initialVersion] of originalSessionVersions) {
      const applicable = accountTargets.filter(target => target.userId === userId);
      if (!applicable.length) continue;
      const appliedCount = accountTargetsToApply.filter(target => target.userId === userId).length;
      const actual = (await client.query<{ name: string; email: string; email_verified: boolean; password_hash: string; mfa_enabled: boolean; avatar_url: string | null; preferences: unknown; disabled: boolean; session_version: number }>(
        'SELECT name,email,email_verified,password_hash,mfa_enabled,avatar_url,preferences,disabled,session_version FROM users WHERE id=$1', [userId],
      )).rows[0];
      if (!actual || actual.session_version !== initialVersion + appliedCount) throw new Error('Erasure ledger account session invalidation did not verify.');
      const requested = new Set(applicable.flatMap(item => item.entry.accountFields));
      if (requested.size && !actual.disabled) throw new Error('Erasure ledger account disable did not verify.');
      if (requested.has('name') && actual.name !== 'Dados anonimizados') throw new Error('Erasure ledger account name redaction did not verify.');
      if (requested.has('email') && (actual.email !== `anon+${userId}@privacy.invalid` || actual.email_verified)) throw new Error('Erasure ledger account email redaction did not verify.');
      if (requested.has('avatar_url') && actual.avatar_url !== null) throw new Error('Erasure ledger account avatar redaction did not verify.');
      if (requested.has('preferences') && JSON.stringify(actual.preferences) !== '{}') throw new Error('Erasure ledger account preferences redaction did not verify.');
      if (requested.has('password_hash') && (actual.password_hash !== `!erased:${userId}` || actual.mfa_enabled)) throw new Error('Erasure ledger account credential removal did not verify.');
      if (requested.has('social_identities') && has('auth_social_identities')) {
        const identities = await client.query('SELECT id FROM auth_social_identities WHERE user_id=$1 LIMIT 1', [userId]);
        if (identities.rowCount) throw new Error('Erasure ledger social identity removal did not verify.');
      }
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

export async function listDatabaseBackups() {
  const root = directory();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const files = (await readdir(root)).filter(name => BACKUP_PATTERN.test(name)).sort().reverse();
  const backups = [];
  for (const name of files) {
    try { backups.push(JSON.parse(await readFile(join(root, `${name}.manifest.json`), 'utf8')) as BackupManifest); }
    catch { backups.push({ archive: name, invalid_manifest: true }); }
  }
  return backups;
}

async function pruneDatabaseBackups() {
  const configured = Number(process.env.ORBIT_BACKUP_KEEP || 30);
  if (!Number.isInteger(configured) || configured < 2) throw new Error('ORBIT_BACKUP_KEEP must be an integer of at least 2.');
  const root = directory();
  const files = (await readdir(root)).filter(name => BACKUP_PATTERN.test(name)).sort().reverse();
  const complete: { archive: string; manifest: string }[] = [];
  for (const archive of files) {
    try {
      const data = JSON.parse(await readFile(join(root, `${archive}.manifest.json`), 'utf8')) as BackupManifest;
      if (data.archive === archive && data.format === 'orbit-aes-256-gcm-v1') complete.push({ archive, manifest: `${archive}.manifest.json` });
    } catch { /* Keep incomplete or unknown files for manual inspection. */ }
  }
  for (const old of complete.slice(configured)) {
    await rm(join(root, old.archive));
    await rm(join(root, old.manifest));
  }
}

export async function hasExistingOrbitSchema() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query("SELECT to_regclass('public.users') IS NOT NULL AS exists");
    return Boolean(result.rows[0].exists);
  } finally { await client.end(); }
}
