import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Client } from 'pg';
import { uploadBackupToGoogleDrive } from './google-drive-backup';

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
    const driveConfigured = [process.env.ORBIT_DRIVE_CLIENT_ID, process.env.ORBIT_DRIVE_CLIENT_SECRET, process.env.ORBIT_DRIVE_REFRESH_TOKEN, process.env.ORBIT_DRIVE_FOLDER_ID].every(Boolean);
    if (driveConfigured) await uploadBackupToGoogleDrive(archive);
    else console.warn('Backup salvo localmente. Configure o Google Drive para enviar uma cópia remota.');
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

export async function restoreDatabaseBackup(archiveInput: string, targetUrl: string) {
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
