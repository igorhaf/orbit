import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Db } from './db';
import { backupDirectory } from './database-backup';
import { decryptVaultPayload, encryptVaultPayload, vaultItemHtml } from './vault-crypto';

const MAGIC = Buffer.from('ORBITVLT1');
const ARCHIVE = /^orbit-vault-\d{4}-\d{2}-\d{2}T[^/]+\.vault\.enc$/;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

type Category = { id: string; name: string; icon: string; position: number };
type Item = { id: string; title: string; category: string; content_html: string; created_at: string; updated_at: string };
type Snapshot = { format: 'orbit-vault-v1'; created_at: string; owner_id: string; categories: Category[]; items: Item[] };
export type VaultBackupManifest = { format: 'orbit-vault-aes-256-gcm-v1'; archive: string; owner_id: string; created_at: string; item_count: number; archive_bytes: number; sha256: string; key_fingerprint: string };

function key() {
  const root = process.env.ORBIT_BACKUP_KEY || '';
  if (!/^[0-9a-f]{64}$/i.test(root)) throw new Error('Configure ORBIT_BACKUP_KEY para proteger o backup do cofre.');
  return Buffer.from(hkdfSync('sha256', Buffer.from(root, 'hex'), Buffer.alloc(0), 'orbit-vault-backup-v1', 32));
}
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
export const vaultBackupDirectory = () => join(backupDirectory(), 'vault');
export function vaultBackupPath(archive: string) {
  if (!ARCHIVE.test(archive)) throw new Error('Arquivo de backup do cofre inválido.');
  return join(vaultBackupDirectory(), archive);
}

function encrypt(snapshot: Snapshot, secret: Buffer) {
  const plain = Buffer.from(JSON.stringify(snapshot));
  if (plain.length > MAX_ARCHIVE_BYTES) throw new Error('O cofre excede o limite de backup de 100 MB.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secret, iv);
  cipher.setAAD(MAGIC);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), data]);
}

function decrypt(archive: Buffer, secret: Buffer): Snapshot {
  if (archive.length <= MAGIC.length + 28 || archive.length > MAX_ARCHIVE_BYTES + 128 || !archive.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Backup do cofre inválido.');
  const start = MAGIC.length;
  const decipher = createDecipheriv('aes-256-gcm', secret, archive.subarray(start, start + 12));
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(archive.subarray(start + 12, start + 28));
  const parsed: unknown = JSON.parse(Buffer.concat([decipher.update(archive.subarray(start + 28)), decipher.final()]).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Backup do cofre inválido.');
  const value = parsed as Partial<Snapshot>;
  if (value.format !== 'orbit-vault-v1' || typeof value.owner_id !== 'string' || !Array.isArray(value.categories) || !Array.isArray(value.items)) throw new Error('Backup do cofre inválido.');
  for (const category of value.categories) if (typeof category.id !== 'string' || typeof category.name !== 'string' || typeof category.icon !== 'string' || !Number.isInteger(category.position)) throw new Error('Categoria inválida no backup do cofre.');
  for (const item of value.items) if (typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.category !== 'string' || typeof item.content_html !== 'string' || item.content_html.length > 500_000) throw new Error('Item inválido no backup do cofre.');
  return value as Snapshot;
}

export async function createVaultBackup(db: Db, ownerId: string): Promise<VaultBackupManifest> {
  const client = await db.pool.connect();
  let categories: Category[], items: Item[];
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    categories = (await client.query<Category>('SELECT id,name,icon,position FROM vault_categories WHERE owner_id=$1 ORDER BY position,id', [ownerId])).rows;
    const rows = (await client.query<{id:string;title:string;category:string;notes:string;secret_data:string;created_at:string;updated_at:string}>(
      'SELECT v.id,COALESCE(c.title,v.title) AS title,v.category,COALESCE(c.description,v.notes) AS notes,v.secret_data,v.created_at,v.updated_at FROM vault_items v LEFT JOIN cards c ON c.id=v.card_id WHERE v.owner_id=$1 ORDER BY v.created_at,v.id', [ownerId],
    )).rows;
    items = rows.map(row => ({id:row.id,title:row.title,category:row.category,content_html:vaultItemHtml(decryptVaultPayload(row.secret_data),row.notes),created_at:row.created_at,updated_at:row.updated_at}));
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  const created_at = new Date().toISOString();
  const archive = `orbit-vault-${created_at.replaceAll(':','-').replaceAll('.','-')}-${randomBytes(4).toString('hex')}.vault.enc`;
  const secret = key();
  const encrypted = encrypt({format:'orbit-vault-v1',created_at,owner_id:ownerId,categories,items},secret);
  const manifest: VaultBackupManifest = {format:'orbit-vault-aes-256-gcm-v1',archive,owner_id:ownerId,created_at,item_count:items.length,archive_bytes:encrypted.length,sha256:hash(encrypted),key_fingerprint:hash(secret).slice(0,16)};
  const root = vaultBackupDirectory();
  await mkdir(root,{recursive:true,mode:0o700});await chmod(root,0o700);
  const path = vaultBackupPath(archive),temporary = `${path}.tmp`;
  try {
    await writeFile(temporary,encrypted,{mode:0o600,flag:'wx'});
    decrypt(await readFile(temporary),secret);
    await rename(temporary,path);
    await writeFile(`${path}.manifest.json`,`${JSON.stringify(manifest,null,2)}\n`,{mode:0o600,flag:'wx'});
  } catch (error) { await rm(temporary,{force:true});await rm(path,{force:true});throw error; }
  await pruneVaultBackups().catch(error=>console.warn(`Vault backup is safe, but retention cleanup failed: ${(error as Error).message}`));
  return manifest;
}

export async function readVaultBackup(path: string): Promise<{manifest:VaultBackupManifest;snapshot:Snapshot}> {
  const manifest = JSON.parse(await readFile(`${path}.manifest.json`,'utf8')) as VaultBackupManifest;
  if (manifest.format !== 'orbit-vault-aes-256-gcm-v1' || manifest.archive !== basename(path)) throw new Error('Manifesto do cofre inválido.');
  const archive = await readFile(path);
  const secret = key();
  if (archive.length !== manifest.archive_bytes || hash(archive) !== manifest.sha256 || hash(secret).slice(0,16) !== manifest.key_fingerprint) throw new Error('Integridade do backup do cofre inválida.');
  const snapshot = decrypt(archive,secret);
  if (snapshot.items.length !== manifest.item_count || snapshot.owner_id !== manifest.owner_id) throw new Error('Identidade ou contagem de itens do cofre inválida.');
  return {manifest,snapshot};
}
export async function verifyVaultBackup(path: string) { return (await readVaultBackup(path)).manifest; }

export async function listVaultBackups(ownerId?:string): Promise<VaultBackupManifest[]> {
  const root=vaultBackupDirectory();await mkdir(root,{recursive:true,mode:0o700});
  const files=(await readdir(root)).filter(name=>ARCHIVE.test(name)).sort().reverse();
  const list:VaultBackupManifest[]=[];
  for(const file of files){try{const manifest=JSON.parse(await readFile(join(root,`${file}.manifest.json`),'utf8')) as VaultBackupManifest;if(!ownerId||manifest.owner_id===ownerId)list.push(manifest)}catch{continue}}
  return list;
}

async function pruneVaultBackups() {
  const keep=Number(process.env.ORBIT_BACKUP_KEEP||30);
  if(!Number.isInteger(keep)||keep<2)throw new Error('ORBIT_BACKUP_KEEP deve ser pelo menos 2.');
  const root=vaultBackupDirectory();
  const files=(await readdir(root)).filter(name=>ARCHIVE.test(name)).sort().reverse();
  for(const name of files.slice(keep)){await rm(join(root,name),{force:true});await rm(join(root,`${name}.manifest.json`),{force:true})}
}

export async function restoreVaultBackup(db: Db, ownerId: string, path: string) {
  const {manifest,snapshot}=await readVaultBackup(resolve(path));
  const client=await db.pool.connect();
  try {
    await client.query('BEGIN');
    const marker=await client.query('INSERT INTO vault_backup_restores(owner_id,sha256,item_count) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING sha256',[ownerId,manifest.sha256,manifest.item_count]);
    if(!marker.rowCount)throw new Error('Este backup do cofre já foi restaurado nesta conta.');
    const categories=new Map<string,string>();
    for(const category of snapshot.categories){
      const result=await client.query<{id:string}>('INSERT INTO vault_categories(owner_id,name,icon,position) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,name) DO UPDATE SET name=excluded.name RETURNING id',[ownerId,category.name,category.icon,category.position]);
      categories.set(category.id,result.rows[0].id);
    }
    for(const item of snapshot.items){
      const category=categories.get(item.category)||item.category;
      await client.query('INSERT INTO vault_items(owner_id,title,category,secret_data,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6)',[ownerId,item.title,category,encryptVaultPayload({content_html:item.content_html}),item.created_at,item.updated_at]);
    }
    await client.query('COMMIT');
    return {restoredItems:snapshot.items.length,restoredCategories:snapshot.categories.length,archive:manifest.archive};
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
