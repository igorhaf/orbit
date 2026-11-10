import {HttpException} from '@nestjs/common';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parse} from 'dotenv';
import {Db} from './db';
import {decryptVaultPayload} from './vault-crypto';
import {SecretVault} from './secrets';

export type VaultCredential={id:string;name:string;constant:string;value:string};
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const referencePattern=new RegExp(`^orbit-vault://(${uuid})/(${uuid})/(${uuid})$`,'i');
const categories:Record<string,string>={site:'Sites e apps',api:'Tokens e APIs',ssh:'Chaves públicas e privadas',bank_test:'Dados bancários de teste',license:'Licenças e softwares',custom:'Outros textos'};
export function credentials(value:unknown):VaultCredential[]{
  if(value===undefined)return [];
  if(!Array.isArray(value))throw new HttpException('Campos do cofre inválidos.',400);
  const ids=new Set<string>();
  return value.map(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(key=>!['id','name','constant','value'].includes(key)))throw new HttpException('Campo do cofre inválido.',400);
    const entry=row as VaultCredential;
    if(typeof entry.id!=='string'||!new RegExp(`^${uuid}$`,'i').test(entry.id)||ids.has(entry.id)||typeof entry.name!=='string'||entry.name.length>300||typeof entry.constant!=='string'||entry.constant.length>120||typeof entry.value!=='string'||entry.value.length>20000)throw new HttpException('Nome, constante ou valor do cofre inválido.',400);
    const constant=entry.constant.trim();
    if(constant&&!/^[A-Za-z_][A-Za-z0-9_]*$/.test(constant))throw new HttpException('A constante deve usar letras, números e sublinhado, começando por letra ou sublinhado.',400);
    ids.add(entry.id);return {id:entry.id,name:entry.name,constant,value:entry.value};
  });
}
export function vaultReference(owner:string,item:string,credential:string){return `orbit-vault://${owner}/${item}/${credential}`}
export function parseVaultReference(value:string){const found=referencePattern.exec(value);return found?{owner:found[1],item:found[2],credential:found[3]}:null}
export async function vaultConstants(db:Db,owner:string){
  const rows=await db.query<{id:string;title:string;category:string;category_name:string|null;secret_data:string}>('SELECT v.id,v.title,v.category,c.name AS category_name,v.secret_data FROM vault_items v LEFT JOIN vault_categories c ON c.id::text=v.category AND c.owner_id=v.owner_id WHERE v.owner_id=$1 ORDER BY v.title,v.id',[owner]);
  return rows.flatMap(row=>credentials(decryptVaultPayload(row.secret_data).credentials).filter(field=>field.constant).map(field=>({reference:vaultReference(owner,row.id,field.id),name:field.name,constant:field.constant,notebook:row.title,category:row.category_name||categories[row.category]||row.category,label:`${row.category_name||categories[row.category]||row.category} · ${field.constant}`})));
}
export async function resolveVaultReference(db:Db,reference:string,owner?:string){
  const parsed=parseVaultReference(reference);
  if(!parsed||(owner!==undefined&&owner!==parsed.owner))throw new HttpException('Referência do cofre não autorizada.',403);
  const row=await db.one<{secret_data:string}>('SELECT secret_data FROM vault_items WHERE id=$1 AND owner_id=$2',[parsed.item,parsed.owner]);
  const field=row&&credentials(decryptVaultPayload(row.secret_data).credentials).find(field=>field.id===parsed.credential&&field.constant);
  if(!field)throw new HttpException('Constante do cofre não encontrada.',409);
  if(!field.value)throw new HttpException('A constante selecionada está sem valor.',409);
  if(owner!==undefined)await db.query('INSERT INTO access_audit(actor_id,action,target,scope_type,scope_id) VALUES($1,$2,$3,$4,$5)',[owner,'vault.credential.resolved',field.id,'vault_item',parsed.item]);
  return field.value;
}
export async function assertVaultReferencesRetained(db:Db,owner:string,item:string,next:VaultCredential[]){
  let stored:Record<string,string>={};
  try{stored=parse(await readFile(resolve(process.env.ORBIT_API_ENV_FILE||resolve(__dirname,'../.env')),'utf8'))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  const references=Object.values(stored);
  for(const row of await db.query<{encrypted_value:string}>('SELECT encrypted_value FROM delivery_credentials WHERE owner_id=$1',[owner]))references.push(new SecretVault().open<{value:string}>(row.encrypted_value).value);
  function collect(value:unknown){if(typeof value==='string')references.push(value);else if(value&&typeof value==='object')Object.values(value).forEach(collect)}
  for(const row of await db.query<{credentials_encrypted:string}>("SELECT credentials_encrypted FROM integration_connections WHERE owner_id=$1 AND credentials_encrypted<>''",[owner]))collect(new SecretVault().open(row.credentials_encrypted));
  for(const reference of references){const parsed=parseVaultReference(reference);if(parsed?.owner===owner&&parsed.item===item&&!next.some(field=>field.id===parsed.credential&&field.constant&&field.value))throw new HttpException('Esta constante está em uso. Remova o vínculo na integração antes de apagar o campo, a constante ou o valor.',409)}
}
export async function loadVaultEnvironment(db:Db){
  for(const [key,value] of Object.entries(process.env))if(value?.startsWith('orbit-vault://')){
    if(['DATABASE_URL','JWT_SECRET','VAULT_ENCRYPTION_KEY','VAULT_ENCRYPTION_KEY_PREVIOUS','ORBIT_SECRET_KEY','ORBIT_SECRET_KEY_PREVIOUS','ORBIT_BACKUP_KEY'].includes(key))throw new Error(`Referência do cofre não permitida em ${key}.`);
    try{process.env[key]=await resolveVaultReference(db,value)}catch{delete process.env[key];console.error(`Constante do cofre indisponível para ${key}. Configure novamente esta integração.`)}
  }
}
export async function refreshVaultEnvironment(owner:string,item:string,fields:VaultCredential[]){
  let stored:Record<string,string>={};
  try{stored=parse(await readFile(resolve(process.env.ORBIT_API_ENV_FILE||resolve(__dirname,'../.env')),'utf8'))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  for(const [key,value] of Object.entries(stored)){const reference=parseVaultReference(value);if(reference?.owner===owner&&reference.item===item){const field=fields.find(field=>field.id===reference.credential&&field.constant);if(field?.value)process.env[key]=field.value;else delete process.env[key]}}
}
