import {realpath,stat,readFile} from 'node:fs/promises';
import {isAbsolute,relative,resolve,sep} from 'node:path';

export const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,79}$/.test(value);
const sensitive=/(^|\/)(\.env(?:\..*)?|\.git|\.ssh|\.codex|node_modules|(?:.*\.)?(?:pem|key|p12|pfx)|credentials(?:\..*)?|auth\.json)(\/|$)/i;
export async function safePath(root:string,path:string,kind:'file'|'directory'='file'){
  if(typeof path!=='string'||path.length>1000||path.includes('\0')||path.includes('\\'))throw new Error('Caminho inválido.');
  const base=await realpath(root),candidate=await realpath(isAbsolute(path)?path:resolve(base,path));
  const rel=relative(base,candidate);
  if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)||sensitive.test(rel.replaceAll(sep,'/')))throw new Error('Caminho fora do projeto ou recurso reservado.');
  const info=await stat(candidate);
  if(kind==='directory'?!info.isDirectory():!info.isFile())throw new Error('Tipo de recurso inválido.');
  if(kind==='file'&&info.size>64000)throw new Error('Recurso excede 64 KB.');
  return candidate;
}
export async function readResource(root:string,path:string){return readFile(await safePath(root,path),'utf8')}
export function noSecrets(value:unknown){
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)){
    if(/(?:password|secret|token|credential|api[_-]?key|authorization|private[_-]?key)/i.test(key))throw new Error('Credenciais não podem ser armazenadas no cartão. Configure-as no servidor.');
    if(typeof item==='string'&&/(?:-----BEGIN .*PRIVATE KEY-----|\b(?:sk-|ghp_)[A-Za-z0-9_-]{15,}|\bBearer\s+[A-Za-z0-9._-]{10,})/.test(item))throw new Error('Remova a credencial da configuração.');
    noSecrets(item);
  }
}
export function redact(value:string){
  let text=value.replace(/(?:Bearer\s+)[\w.-]+/gi,'Bearer [REDACTED]').replace(/\b(?:sk-|ghp_)[A-Za-z0-9_-]{15,}/g,'[REDACTED]').replace(/((?:password|token|secret|api[_-]?key)["']?\s*[=:]\s*)[^\s,;]+/gi,'$1[REDACTED]');
  for(const [key,secret] of Object.entries(process.env))if(/PASSWORD|TOKEN|SECRET|KEY|DATABASE_URL/i.test(key)&&secret&&secret.length>=8)text=text.split(secret).join('[REDACTED]');
  return text.slice(0,64000);
}
export function scrub(value:unknown):unknown {
  if(typeof value==='string')return redact(value);
  if(Array.isArray(value))return value.map(scrub);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/(?:password|secret|token|credential|api[_-]?key)/i.test(key)?'[REDACTED]':scrub(item)]));
  return value;
}
