import 'reflect-metadata';
import 'dotenv/config';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {parse} from 'dotenv';
import * as jwt from 'jsonwebtoken';
import {Db} from './db';
import {SecretVault} from './secrets';
import {SINGLE_EMAIL} from './features';
import {encryptVaultPayload} from './vault-crypto';
import {parseVaultReference,vaultReference,resolveVaultReference} from './credential-store';

type Field={key:string;label:string;configured:boolean;vaultReference?:string};
type Group={id:string;label:string;fields:Field[]};
export async function migrateIntegrationCredentials(){
  if(process.env.ORBIT_CREDENTIAL_MIGRATION_APPLY!=='development')throw new Error('Defina ORBIT_CREDENTIAL_MIGRATION_APPLY=development para executar a migração DEV.');
  const paths=[...new Set((process.env.ORBIT_CREDENTIAL_ENV_PATHS||'').split(',').filter(Boolean).map(path=>resolve(path)))];
  if(!paths.length)throw new Error('Informe os arquivos de configuração DEV em ORBIT_CREDENTIAL_ENV_PATHS.');
  const sources=new Map<string,string>();for(const path of paths)sources.set(path,await readFile(path,'utf8'));
  const stored=parse(sources.get(paths[0])!);
  if(stored.ORBIT_ENV&&stored.ORBIT_ENV!=='development')throw new Error('A configuração informada não é DEV.');
  // Encryption roots and database credentials must continue to match the application.
  for(const key of ['VAULT_ENCRYPTION_KEY','ORBIT_SECRET_KEY','JWT_SECRET'])if(stored[key]&&process.env[key]!==stored[key])throw new Error(`A configuração DEV diverge em ${key}. Migração cancelada.`);
  if(process.env.ORBIT_SELENIUM_DB_HOST){const url=new URL(process.env.DATABASE_URL!);url.hostname=process.env.ORBIT_SELENIUM_DB_HOST;process.env.DATABASE_URL=url.toString()}
  const db=new Db(),vault=new SecretVault();
  try{
    const user=await db.one<{id:string;email:string}>('SELECT id,email FROM users WHERE email=$1',[SINGLE_EMAIL]);if(!user)throw new Error('Administrador não encontrado.');
    const owner=user.id,token=jwt.sign({sub:owner,email:user.email},process.env.JWT_SECRET!,{expiresIn:'20m'});
    const base=process.env.ORBIT_CREDENTIAL_API_URL||'http://127.0.0.1:4001';
    async function get<T>(path:string):Promise<T>{const response=await fetch(base+path,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error(`Não foi possível consultar ${path}: HTTP ${response.status}.`);return response.json() as Promise<T>}
    const core=await get<{groups:Group[]}>('/settings/environment'),catalog=await get<{plugins:Array<{id:string;name:string;configurable:boolean}>}>('/plugins');
    const groups=core.groups.filter(group=>['google','microsoft','email'].includes(group.id));
    for(const plugin of catalog.plugins.filter(plugin=>plugin.configurable)){const settings=await get<{fields:Field[]}>(`/settings/environment/plugins/${plugin.id}`);groups.push({id:plugin.id,label:plugin.name,fields:settings.fields})}
    for(const group of groups)for(const field of group.fields)if(stored[field.key]&&!parseVaultReference(stored[field.key]))for(const source of sources.values()){const other=parse(source)[field.key];if(other&&other!==stored[field.key]&&!parseVaultReference(other))throw new Error(`Configurações divergentes em ${field.key}. Migração cancelada.`)}
    const backupRoot=resolve(process.env.ORBIT_CREDENTIAL_MIGRATION_BACKUP_DIR||'');if(!process.env.ORBIT_CREDENTIAL_MIGRATION_BACKUP_DIR)throw new Error('Informe uma pasta privada para recuperação da migração.');
    await mkdir(backupRoot,{recursive:true,mode:0o700});
    const client=await db.pool.connect();const changes:Record<string,string>={},expected:Array<{reference:string;value:string}>=[];const created:string[]=[];
    let committed=false;
    try{
      await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['orbit:vault-credential-migration']);
      const connections=(await client.query<{id:string;plugin_id:string;display_name:string;credentials_encrypted:string;metadata:Record<string,unknown>}>("SELECT id,plugin_id,display_name,credentials_encrypted,metadata FROM integration_connections WHERE owner_id=$1 AND credentials_encrypted<>'' ORDER BY id FOR UPDATE",[owner])).rows;
      const delivery=(await client.query<{id:string;name:string;kind:string;encrypted_value:string}>('SELECT id,name,kind,encrypted_value FROM delivery_credentials WHERE owner_id=$1 ORDER BY id FOR UPDATE',[owner])).rows;
      const backup=join(backupRoot,`credentials-${new Date().toISOString().replaceAll(':','-')}-${randomUUID()}.rollback.enc`);
      await writeFile(backup,vault.seal({format:'orbit-credential-migration-v1',owner,environment:Object.fromEntries(sources),connections,delivery}),{mode:0o600,flag:'wx'});
      async function notebook(categoryName:string,title:string,fields:Array<{key:string;label:string;value:string}>,description:string){
        const category=(await client.query<{id:string}>('INSERT INTO vault_categories(owner_id,name,icon) VALUES($1,$2,$3) ON CONFLICT(owner_id,name) DO UPDATE SET name=excluded.name RETURNING id',[owner,categoryName,'KeyRound'])).rows[0];
        const id=randomUUID(),credentials=fields.map(field=>({id:randomUUID(),name:field.label,constant:field.key,value:field.value}));
        const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
        const notes=`<h2>${escape(title)}</h2><p>${escape(description)}</p><ul>${fields.map(field=>`<li><strong>${escape(field.key)}</strong>: ${escape(field.label)}.</li>`).join('')}</ul><p>Os valores ficam nos campos protegidos acima. As integrações usam referências a estas constantes; não copie os valores para cards ou comentários. Remova o vínculo da integração antes de excluir uma constante em uso.</p>`;
        await client.query('INSERT INTO vault_items(id,owner_id,title,category,secret_data) VALUES($1,$2,$3,$4,$5)',[id,owner,title,category.id,encryptVaultPayload({content_html:notes,credentials})]);created.push(id);
        return credentials.map(field=>{const reference=vaultReference(owner,id,field.id);expected.push({reference,value:field.value});return reference});
      }
      const seen=new Set<string>();
      for(const group of groups){const fields=group.fields.filter(field=>!seen.has(field.key)&&stored[field.key]&&!parseVaultReference(stored[field.key]));for(const field of group.fields)seen.add(field.key);if(!fields.length)continue;
        const refs=await notebook(group.id.startsWith('google')||group.id==='gmail'?'Google':group.id==='microsoft'?'Microsoft':'Integrações',`${group.label} · configuração`,fields.map(field=>({key:field.key,label:field.label,value:stored[field.key]})),`Configuração de ${group.label}. Estes campos substituem os valores diretos da configuração DEV. O seletor de cada variável já fica vinculado à constante correspondente. Credenciais compartilhadas permanecem nas configurações do core; campos específicos permanecem no plugin.`);
        fields.forEach((field,index)=>{changes[field.key]=refs[index]});
      }
      for(const connection of connections){
        const payload=vault.open<Record<string,unknown>>(connection.credentials_encrypted);
        const keys=Object.keys(payload).filter(key=>typeof payload[key]==='string'&&payload[key]&&!parseVaultReference(String(payload[key]))&&/^(access_token|refresh_token|token|api_key|client_secret|password|private_key)$/.test(key));if(!keys.length)continue;
        if(!['google','cloudflare-tunnel'].includes(connection.plugin_id))throw new Error(`Conexão ${connection.plugin_id} exige suporte de referências antes da migração.`);
        const isGoogle=connection.plugin_id==='google';
        const refs=await notebook(isGoogle?'Google':'Cloudflare',`${isGoogle?'Conta Google':'Cloudflare Tunnel'} · ${connection.display_name}`,keys.map(key=>({key:(isGoogle?'GOOGLE_':'CLOUDFLARE_')+key.toUpperCase(),label:key==='access_token'?'Token de acesso (renovado automaticamente)':key==='refresh_token'?'Token de renovação da conta':'Token de execução do tunnel',value:String(payload[key])})),isGoogle?'Conta Google já autorizada no Orbit. O token de acesso permite acessar os serviços autorizados; o token de renovação mantém a conexão ativa. O Orbit atualiza os campos durante a renovação OAuth. As permissões e a conta selecionada foram preservadas.':'Credencial do Cloudflare Tunnel já instalado. O token autentica o conector do domínio público configurado. Nome do tunnel, rotas, execução e preferências existentes foram preservados. A configuração do plugin seleciona a constante deste caderno.');
        keys.forEach((key,index)=>{payload[key]=refs[index]});await client.query('UPDATE integration_connections SET credentials_encrypted=$2,updated_at=now() WHERE id=$1',[connection.id,vault.seal(payload)]);
      }
      for(const credential of delivery){const payload=vault.open<{value:string}>(credential.encrypted_value);if(parseVaultReference(payload.value))continue;const [reference]=await notebook('Implantação',`Deploy · ${credential.name}`,[{key:credential.kind,label:credential.name,value:payload.value}],`Credencial de implantação do tipo ${credential.kind}. Servidores, repositórios e pipelines continuam usando o mesmo registro; o valor agora é resolvido pela constante do cofre.`);await client.query('UPDATE delivery_credentials SET encrypted_value=$2 WHERE id=$1',[credential.id,vault.seal({value:reference})])}
      await client.query('COMMIT');committed=true;
      // Database records are visible before changing persisted configuration references.
      for(const [path,source] of sources){const parsed=parse(source),lines=source.split(/\r?\n/);for(const [key,reference] of Object.entries(changes)){if(!parsed[key])continue;if(parsed[key]!==stored[key]&&!parseVaultReference(parsed[key]))throw new Error(`Configurações divergentes em ${key}; consulte o arquivo de recuperação.`);const pattern=new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);for(let index=0;index<lines.length;index++)if(pattern.test(lines[index]))lines[index]=`${key}=${JSON.stringify(reference)}`;}const temporary=`${path}.${randomUUID()}.tmp`;await writeFile(temporary,lines.join('\n'),{mode:0o600,flag:'wx'});await rename(temporary,path)}
      for(const entry of expected)if(await resolveVaultReference(db,entry.reference,owner)!==entry.value)throw new Error('Falha de validação da credencial migrada.');
      // Set runtime values through the normal settings API and trigger the existing encrypted config backup.
      for(const group of groups){const values=Object.fromEntries(group.fields.filter(field=>changes[field.key]).map(field=>[field.key,changes[field.key]]));if(!Object.keys(values).length)continue;const coreGroup=['google','microsoft','email'].includes(group.id);const response=await fetch(base+(coreGroup?'/settings/environment':`/settings/environment/plugins/${group.id}`),{method:'PATCH',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({values,clear:[]}),signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error(`Migração persistida; aplicação em memória de ${group.id} retornou HTTP ${response.status}.`)}
      console.log(JSON.stringify({notebooks:created.length,credentials:expected.length,environmentFields:Object.keys(changes),validated:true,recovery:backup}));
    }catch(error){if(!committed)await client.query('ROLLBACK');throw error}finally{client.release()}
  }finally{await db.pool.end()}
}
if(require.main===module)void migrateIntegrationCredentials().catch(error=>{console.error((error as Error).message);process.exitCode=1});
