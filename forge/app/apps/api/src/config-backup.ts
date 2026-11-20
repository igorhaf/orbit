import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { parse } from 'dotenv';
import { backupDirectory } from './database-backup';

const MAGIC = Buffer.from('ORBITCFG1');
const ARCHIVE = /^orbit-config-[0-9TZ-]+-[0-9a-f]{8}\.config\.enc$/;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const ENV_NAMES = new Set(['.env', '.env.local', '.env.development.local', '.env.production.local', '.env.test.local']);
const execFileAsync=promisify(execFile);
type ConfigFile = { path: string; mode: number; data: string };
type Snapshot = { format: 'orbit-config-v1'; files: ConfigFile[] };
export type ConfigBackupManifest = { format: 'orbit-config-aes-256-gcm-v1'; archive: string; created_at: string; file_count: number; archive_bytes: number; sha256: string; fingerprint: string; key_fingerprint: string };

const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
function key() {
  const root = process.env.ORBIT_BACKUP_KEY || '';
  if (!/^[0-9a-f]{64}$/i.test(root)) throw new Error('Configure ORBIT_BACKUP_KEY para proteger o backup das configurações.');
  return Buffer.from(hkdfSync('sha256', Buffer.from(root, 'hex'), Buffer.alloc(0), 'orbit-config-backup-v1', 32));
}
export const configBackupRoot = () => resolve(__dirname, '../../..');
export const configBackupDirectory = () => join(backupDirectory(), 'config');
export function configBackupPath(archive: string) {
  if (!ARCHIVE.test(archive)) throw new Error('Arquivo de backup de configurações inválido.');
  return join(configBackupDirectory(), archive);
}
function safePath(root: string, file: string) {
  if (!file || isAbsolute(file)) throw new Error('Caminho de configuração inválido.');
  const full = resolve(root, file);
  const inside = relative(root, full);
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error('Caminho de configuração fora do projeto.');
  const parts=inside.split(sep);
  if (parts.includes('.git') || parts.includes('node_modules') || parts[0] === 'backups') throw new Error('Caminho de configuração não permitido.');
  return { full, inside: inside.split(sep).join('/') };
}
async function capture(root: string) {
  const paths = new Set<string>();
  const extras = new Set<string>();
  const runtimeRoot = root === configBackupRoot();
  for (const dir of ['', 'apps/api', 'apps/web']) {
    for (const name of await readdir(join(root, dir)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [] as string[];
      throw error;
    })) if (ENV_NAMES.has(name)) paths.add(join(dir, name));
  }
  if (runtimeRoot && process.env.ORBIT_API_ENV_FILE) paths.add('apps/api/.env');
  if (runtimeRoot && process.env.ORBIT_WEB_ENV_FILE) paths.add('apps/web/.env.local');
  let configuredPaths=process.env.ORBIT_CONFIG_BACKUP_PATHS || '';
  try { configuredPaths=parse(await readFile(runtimeRoot && process.env.ORBIT_API_ENV_FILE || join(root,'apps/api/.env'),'utf8')).ORBIT_CONFIG_BACKUP_PATHS || ''; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  for (const path of configuredPaths.split(/[\n,]/).map(value => value.trim()).filter(Boolean)) { paths.add(path); extras.add(path); }
  const gitAvailable=await lstat(join(root,'.git')).then(()=>true).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return false;throw error});
  const files: ConfigFile[] = [];
  let total = 0;
  for (const path of [...paths].sort()) {
    const { full, inside } = safePath(root, path);
    const source = runtimeRoot && inside === 'apps/api/.env' && process.env.ORBIT_API_ENV_FILE
      ? resolve(process.env.ORBIT_API_ENV_FILE)
      : runtimeRoot && inside === 'apps/web/.env.local' && process.env.ORBIT_WEB_ENV_FILE
        ? resolve(process.env.ORBIT_WEB_ENV_FILE) : full;
    if (gitAvailable && extras.has(path)) {
      try { await execFileAsync('git',['check-ignore','--quiet','--',inside],{cwd:root}); }
      catch (error) { if ((error as {code?:number}).code===1) throw new Error(`Inclua ${inside} no .gitignore antes do backup.`); throw error; }
    }
    let stat;
    try { stat = await lstat(source); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    if (source === full) {
      const parts = inside.split('/');
      for (let index = 1; index < parts.length; index++) {
        const parent = await lstat(resolve(root, ...parts.slice(0, index)));
        if (parent.isSymbolicLink()) throw new Error(`Link simbólico não permitido no backup: ${inside}`);
      }
    }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Arquivo de configuração inválido: ${inside}`);
    if (stat.size > MAX_FILE_BYTES) throw new Error(`Arquivo de configuração excede 1 MB: ${inside}`);
    const data = await readFile(source);
    total += data.length;
    if (total > MAX_TOTAL_BYTES) throw new Error('Arquivos de configuração excedem 5 MB.');
    files.push({ path: inside, mode: stat.mode & 0o777, data: data.toString('base64') });
  }
  return files;
}
function validate(snapshot: unknown): Snapshot {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Backup de configurações inválido.');
  const value = snapshot as Partial<Snapshot>;
  if (value.format !== 'orbit-config-v1' || !Array.isArray(value.files) || value.files.length > 100) throw new Error('Backup de configurações inválido.');
  let total = 0;
  for (const file of value.files) {
    if (!file || typeof file.path !== 'string' || typeof file.data !== 'string' || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777) throw new Error('Arquivo inválido no backup de configurações.');
    safePath('/orbit-root', file.path);
    const data = Buffer.from(file.data, 'base64');
    if (data.length > MAX_FILE_BYTES || data.toString('base64') !== file.data) throw new Error('Arquivo inválido no backup de configurações.');
    total += data.length;
  }
  if (total > MAX_TOTAL_BYTES || new Set(value.files.map(file => file.path)).size !== value.files.length) throw new Error('Backup de configurações inválido.');
  return value as Snapshot;
}
function decrypt(encrypted: Buffer, secret: Buffer) {
  if (encrypted.length < MAGIC.length + 29 || encrypted.length > MAX_TOTAL_BYTES * 2 || !encrypted.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Backup de configurações inválido.');
  const start = MAGIC.length;
  const decipher = createDecipheriv('aes-256-gcm', secret, encrypted.subarray(start, start + 12));
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(encrypted.subarray(start + 12, start + 28));
  return validate(JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(start + 28)), decipher.final()]).toString('utf8')));
}
export async function readConfigBackup(path: string) {
  const manifest = JSON.parse(await readFile(`${path}.manifest.json`, 'utf8')) as ConfigBackupManifest;
  if (manifest.format !== 'orbit-config-aes-256-gcm-v1' || manifest.archive !== basename(path)) throw new Error('Manifesto de configurações inválido.');
  const encrypted = await readFile(path), secret = key();
  if (encrypted.length !== manifest.archive_bytes || hash(encrypted) !== manifest.sha256 || hash(secret).slice(0, 16) !== manifest.key_fingerprint) throw new Error('Integridade do backup de configurações inválida.');
  const snapshot = decrypt(encrypted, secret);
  if (snapshot.files.length !== manifest.file_count) throw new Error('Contagem de configurações inválida.');
  return { manifest, snapshot };
}
export async function verifyConfigBackup(path: string) { return (await readConfigBackup(path)).manifest; }
export async function listConfigBackups(dir = configBackupDirectory()) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const list: ConfigBackupManifest[] = [];
  for (const file of (await readdir(dir)).filter(name => ARCHIVE.test(name)).sort().reverse()) {
    try { list.push(JSON.parse(await readFile(join(dir, `${file}.manifest.json`), 'utf8')) as ConfigBackupManifest); } catch { continue; }
  }
  return list;
}
export async function createConfigBackup(root = configBackupRoot(), dir = configBackupDirectory()) {
  const secret = key(), files = await capture(root);
  if (!files.length) return null;
  const fingerprint = createHmac('sha256', secret).update(JSON.stringify(files)).digest('hex');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  for (const existing of await listConfigBackups(dir)) {
    if (existing.fingerprint === fingerprint && existing.key_fingerprint === hash(secret).slice(0, 16)) {
      try { return await verifyConfigBackup(join(dir, existing.archive)); } catch { break; }
    }
    break;
  }
  const created_at = new Date().toISOString();
  const archive = `orbit-config-${created_at.replaceAll(':', '-').replaceAll('.', '-')}-${randomBytes(4).toString('hex')}.config.enc`;
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secret, iv);
  cipher.setAAD(MAGIC);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ format: 'orbit-config-v1', files })), cipher.final()]);
  const encrypted = Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
  const manifest: ConfigBackupManifest = { format: 'orbit-config-aes-256-gcm-v1', archive, created_at, file_count: files.length, archive_bytes: encrypted.length, sha256: hash(encrypted), fingerprint, key_fingerprint: hash(secret).slice(0, 16) };
  const path = join(dir, archive);
  try {
    await writeFile(path, encrypted, { mode: 0o600, flag: 'wx' });
    await writeFile(`${path}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await verifyConfigBackup(path);
  } catch (error) { await rm(path, { force: true }); await rm(`${path}.manifest.json`, { force: true }); throw error; }
  const keep = Number(process.env.ORBIT_BACKUP_KEEP || 30);
  if (Number.isInteger(keep) && keep >= 2) for (const old of (await readdir(dir)).filter(name => ARCHIVE.test(name)).sort().reverse().slice(keep)) {
    await rm(join(dir, old), { force: true }); await rm(join(dir, `${old}.manifest.json`), { force: true });
  }
  return manifest;
}
export async function restoreConfigBackup(path: string, targetRoot: string) {
  const { manifest, snapshot } = await readConfigBackup(resolve(path));
  const root = resolve(targetRoot), restored: string[] = [];
  for (const file of snapshot.files) {
    const { full, inside } = safePath(root, file.path);
    try {
      const parts = inside.split('/');
      for (let index = 1; index < parts.length; index++) {
        const parent = resolve(root, ...parts.slice(0, index));
        await mkdir(parent, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
        if (!(await lstat(parent)).isDirectory()) throw new Error('Pasta de recuperação inválida.');
      }
      await writeFile(full, Buffer.from(file.data, 'base64'), { flag: 'wx', mode: 0o600 });
      restored.push(file.path);
    } catch (error) {
      for (const created of restored) await rm(resolve(root, created), { force: true });
      throw error;
    }
  }
  return { archive: manifest.archive, restored };
}
