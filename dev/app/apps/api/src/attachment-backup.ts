import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Db } from './db';
import { backupDirectory } from './database-backup';

const MAGIC=Buffer.from('ORBITATT1');
const ARCHIVE=/^(card|comment)-[0-9a-f-]{36}-[0-9a-f]{16}\.attachment\.enc$/;
const MAX_FILE_BYTES=10_000_000;
type Kind='card'|'comment';
type Source={id:string;card_id:string;comment_id:string|null;name:string;mime_type:string|null;created_at:string;data:Buffer};
type Snapshot={format:'orbit-attachment-v1';owner_id:string;source_kind:Kind;source_id:string;card_id:string;comment_id:string|null;name:string;mime_type:string|null;created_at:string;data:string};
export type AttachmentBackupManifest={format:'orbit-attachment-aes-256-gcm-v1';archive:string;created_at:string;owner_id:string;source_kind:Kind;source_id:string;card_id:string;file_bytes:number;archive_bytes:number;sha256:string;content_fingerprint:string;key_fingerprint:string};
const hash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
function key(){const root=process.env.ORBIT_BACKUP_KEY||'';if(!/^[0-9a-f]{64}$/i.test(root))throw new Error('Configure ORBIT_BACKUP_KEY para proteger os anexos.');return Buffer.from(hkdfSync('sha256',Buffer.from(root,'hex'),Buffer.alloc(0),'orbit-attachment-backup-v1',32))}
export const attachmentBackupDirectory=()=>join(backupDirectory(),'attachments');
export function attachmentBackupPath(archive:string){if(!ARCHIVE.test(archive))throw new Error('Arquivo de anexo inválido.');return join(attachmentBackupDirectory(),archive)}
function validate(snapshot:unknown):Snapshot{
  if(!snapshot||typeof snapshot!=='object')throw new Error('Backup de anexo inválido.');
  const item=snapshot as Partial<Snapshot>;
  if(item.format!=='orbit-attachment-v1'||!['card','comment'].includes(item.source_kind||'')||typeof item.owner_id!=='string'||typeof item.source_id!=='string'||typeof item.card_id!=='string'||typeof item.name!=='string'||typeof item.data!=='string'||typeof item.created_at!=='string'||item.name.length>255||item.mime_type!==null&&typeof item.mime_type!=='string'||item.comment_id!==null&&typeof item.comment_id!=='string')throw new Error('Backup de anexo inválido.');
  const data=Buffer.from(item.data,'base64');
  if(!data.length||data.length>MAX_FILE_BYTES||data.toString('base64')!==item.data)throw new Error('Conteúdo do anexo inválido.');
  return item as Snapshot;
}
function decrypt(encrypted:Buffer,secret:Buffer){
  if(encrypted.length<MAGIC.length+29||encrypted.length>MAX_FILE_BYTES*2||!encrypted.subarray(0,MAGIC.length).equals(MAGIC))throw new Error('Backup de anexo inválido.');
  const start=MAGIC.length,decipher=createDecipheriv('aes-256-gcm',secret,encrypted.subarray(start,start+12));
  decipher.setAAD(MAGIC);decipher.setAuthTag(encrypted.subarray(start+12,start+28));
  return validate(JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(start+28)),decipher.final()]).toString('utf8')));
}
export async function readAttachmentBackup(path:string){
  const manifest=JSON.parse(await readFile(`${path}.manifest.json`,'utf8')) as AttachmentBackupManifest;
  if(manifest.format!=='orbit-attachment-aes-256-gcm-v1'||manifest.archive!==basename(path)||!ARCHIVE.test(manifest.archive))throw new Error('Manifesto de anexo inválido.');
  const encrypted=await readFile(path),secret=key();
  if(encrypted.length!==manifest.archive_bytes||hash(encrypted)!==manifest.sha256||hash(secret).slice(0,16)!==manifest.key_fingerprint)throw new Error('Integridade do backup de anexo inválida.');
  const snapshot=decrypt(encrypted,secret),data=Buffer.from(snapshot.data,'base64');
  const fingerprint=createHmac('sha256',secret).update(data).digest('hex');
  if(snapshot.owner_id!==manifest.owner_id||snapshot.source_kind!==manifest.source_kind||snapshot.source_id!==manifest.source_id||snapshot.card_id!==manifest.card_id||data.length!==manifest.file_bytes||fingerprint!==manifest.content_fingerprint||manifest.archive!==`${snapshot.source_kind}-${snapshot.source_id}-${fingerprint.slice(0,16)}.attachment.enc`)throw new Error('Identidade ou conteúdo do anexo inválido.');
  return {manifest,snapshot};
}
export async function verifyAttachmentBackup(path:string){return (await readAttachmentBackup(path)).manifest}
export async function listAttachmentBackups(){
  const dir=attachmentBackupDirectory();await mkdir(dir,{recursive:true,mode:0o700});
  const list:AttachmentBackupManifest[]=[];
  for(const file of (await readdir(dir)).filter(name=>ARCHIVE.test(name)).sort().reverse()){
    try{list.push(JSON.parse(await readFile(join(dir,`${file}.manifest.json`),'utf8')) as AttachmentBackupManifest)}catch{continue}
  }
  return list.sort((a,b)=>b.created_at.localeCompare(a.created_at));
}
export async function createAttachmentBackup(db:Db,ownerId:string,kind:Kind,id:string){
  const sql=kind==='card'
    ?"SELECT a.id,a.card_id,NULL::uuid AS comment_id,a.name,a.mime_type,a.created_at,a.data FROM attachments a JOIN cards c ON c.id=a.card_id JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id WHERE a.id=$1 AND b.owner_id=$2 AND a.kind='file' AND a.data IS NOT NULL"
    :"SELECT a.id,c.card_id,a.comment_id,a.name,a.mime_type,a.created_at,a.data FROM comment_attachments a JOIN comments c ON c.id=a.comment_id JOIN cards card ON card.id=c.card_id JOIN lists l ON l.id=card.list_id JOIN boards b ON b.id=l.board_id WHERE a.id=$1 AND b.owner_id=$2 AND a.kind='file' AND a.data IS NOT NULL";
  const source=await db.one<Source>(sql,[id,ownerId]);
  if(!source)throw new Error('Anexo não encontrado para esta conta.');
  if(!source.data.length||source.data.length>MAX_FILE_BYTES)throw new Error('Anexo excede o limite de backup de 10 MB.');
  const secret=key(),fingerprint=createHmac('sha256',secret).update(source.data).digest('hex');
  const archive=`${kind}-${source.id}-${fingerprint.slice(0,16)}.attachment.enc`,dir=attachmentBackupDirectory(),path=join(dir,archive);
  await mkdir(dir,{recursive:true,mode:0o700});
  try{return await verifyAttachmentBackup(path)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  const snapshot:Snapshot={format:'orbit-attachment-v1',owner_id:ownerId,source_kind:kind,source_id:source.id,card_id:source.card_id,comment_id:source.comment_id,name:source.name,mime_type:source.mime_type,created_at:source.created_at,data:source.data.toString('base64')};
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,iv);cipher.setAAD(MAGIC);
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(snapshot)),cipher.final()]);
  const encrypted=Buffer.concat([MAGIC,iv,cipher.getAuthTag(),ciphertext]);
  const manifest:AttachmentBackupManifest={format:'orbit-attachment-aes-256-gcm-v1',archive,created_at:new Date().toISOString(),owner_id:ownerId,source_kind:kind,source_id:source.id,card_id:source.card_id,file_bytes:source.data.length,archive_bytes:encrypted.length,sha256:hash(encrypted),content_fingerprint:fingerprint,key_fingerprint:hash(secret).slice(0,16)};
  await writeFile(path,encrypted,{flag:'wx',mode:0o600});
  try{
    await writeFile(`${path}.manifest.json`,`${JSON.stringify(manifest,null,2)}\n`,{flag:'wx',mode:0o600});
    await verifyAttachmentBackup(path);
  }catch(error){await rm(path,{force:true});await rm(`${path}.manifest.json`,{force:true});throw error}
  return manifest;
}
export async function extractAttachmentBackup(path:string,targetDirectory:string){
  const {manifest,snapshot}=await readAttachmentBackup(resolve(path));
  const name=basename(snapshot.name);
  if(!name||name==='.'||name==='..')throw new Error('Nome do anexo inválido.');
  const target=resolve(targetDirectory);await mkdir(target,{recursive:true,mode:0o700});
  await writeFile(join(target,name),Buffer.from(snapshot.data,'base64'),{flag:'wx',mode:0o600});
  return {archive:manifest.archive,name,bytes:manifest.file_bytes};
}
