import {Db} from './db';
import {SecretVault} from './secrets';
import {credentials,parseVaultReference,resolveVaultReference} from './credential-store';
import {decryptVaultPayload,encryptVaultPayload} from './vault-crypto';

export async function openVaultIntegrationCredentials<T>(db:Db,vault:SecretVault,sealed:string,owner:string):Promise<T>{
  const payload=vault.open<unknown>(sealed);
  async function visit(value:unknown):Promise<unknown>{
    if(typeof value==='string'&&value.startsWith('orbit-vault://'))return resolveVaultReference(db,value,owner);
    if(Array.isArray(value))return Promise.all(value.map(visit));
    if(value&&typeof value==='object')return Object.fromEntries(await Promise.all(Object.entries(value).map(async([key,item])=>[key,await visit(item)])));
    return value;
  }
  return await visit(payload) as T;
}

/** Keep reference IDs when OAuth refreshes or reauthorizes a linked account. */
export async function sealVaultIntegrationCredentials(db:Db,vault:SecretVault,previous:string|undefined,next:unknown,owner:string){
  const old=previous?vault.open<unknown>(previous):null;
  const updates:Array<{item:string;id:string;value:string}>=[];
  function visit(value:unknown,before:unknown):unknown{
    if(typeof before==='string'&&before.startsWith('orbit-vault://')&&typeof value==='string'){
      const ref=parseVaultReference(before);if(!ref||ref.owner!==owner)throw new Error('Referência do cofre não autorizada.');
      updates.push({item:ref.item,id:ref.credential,value});return before;
    }
    if(Array.isArray(value))return value.map((entry,index)=>visit(entry,Array.isArray(before)?before[index]:undefined));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,visit(entry,before&&typeof before==='object'?(before as Record<string,unknown>)[key]:undefined)]));
    return value;
  }
  const payload=visit(next,old);
  if(updates.length){
    const client=await db.pool.connect();
    try{await client.query('BEGIN');
      for(const item of [...new Set(updates.map(update=>update.item))].sort()){
        const row=(await client.query<{secret_data:string}>('SELECT secret_data FROM vault_items WHERE id=$1 AND owner_id=$2 FOR UPDATE',[item,owner])).rows[0];
        if(!row)throw new Error('Caderno da credencial não encontrado.');
        const stored=decryptVaultPayload(row.secret_data),fields=credentials(stored.credentials);
        for(const update of updates.filter(update=>update.item===item)){const field=fields.find(field=>field.id===update.id&&field.constant);if(!field)throw new Error('Constante da credencial não encontrada.');if(!update.value||update.value.length>20000)throw new Error('Valor da credencial inválido.');field.value=update.value}
        await client.query('UPDATE vault_items SET secret_data=$3,updated_at=now() WHERE id=$1 AND owner_id=$2',[item,owner,encryptVaultPayload({...stored,credentials:fields})]);
      }
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }
  return vault.seal(payload);
}
