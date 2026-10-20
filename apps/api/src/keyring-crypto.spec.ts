import 'reflect-metadata';
import assert from 'node:assert/strict';
import {createCipheriv,createHash,randomBytes} from 'node:crypto';
import {test} from 'node:test';
import {SecretVault} from './secrets';
import {decryptVaultPayload,encryptVaultPayload} from './vault-crypto';

const envKeys=['ORBIT_SECRET_KEY','ORBIT_SECRET_KEY_PREVIOUS','VAULT_ENCRYPTION_KEY','VAULT_ENCRYPTION_KEY_PREVIOUS','JWT_SECRET'];
async function withEnv(values:Record<string,string|undefined>,run:()=>Promise<void>|void){
  const previous=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
  for(const key of envKeys){const value=values[key];if(value===undefined)delete process.env[key];else process.env[key]=value}
  try{await run()}finally{for(const key of envKeys){const value=previous[key];if(value===undefined)delete process.env[key];else process.env[key]=value}}
}
function legacy(secret:string,value:unknown,versioned:boolean){
  const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',createHash('sha256').update(secret).digest(),iv);
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  const parts=[iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')];
  return versioned?['v1',...parts].join('.'):parts.join('.');
}

test('integration credentials rotate with an explicit previous key and use versioned envelopes',async()=>withEnv({ORBIT_SECRET_KEY:'integration-key-old'},()=>{
  const oldEncrypted=new SecretVault().seal({access_token:'kept-access'});assert.ok(oldEncrypted.startsWith('v2.'));
  process.env.ORBIT_SECRET_KEY='integration-key-new';process.env.ORBIT_SECRET_KEY_PREVIOUS='integration-key-old';
  assert.deepEqual(new SecretVault().open(oldEncrypted),{access_token:'kept-access'});
  const newEncrypted=new SecretVault().seal({access_token:'new-access'});
  assert.deepEqual(new SecretVault().open(newEncrypted),{access_token:'new-access'});
  delete process.env.ORBIT_SECRET_KEY_PREVIOUS;
  assert.throws(()=>new SecretVault().open(oldEncrypted),/chave indisponível/);
}));

test('legacy integration ciphertext remains readable with JWT fallback while new writes use the active key',async()=>withEnv({JWT_SECRET:'legacy-jwt-secret'},()=>{
  const oldEncrypted=legacy('legacy-jwt-secret',{refresh_token:'preserved'},true);
  process.env.ORBIT_SECRET_KEY='new-integration-key';
  assert.deepEqual(new SecretVault().open(oldEncrypted),{refresh_token:'preserved'});
}));

test('vault credentials rotate independently and retain legacy payload compatibility',async()=>withEnv({VAULT_ENCRYPTION_KEY:'vault-key-old'},()=>{
  const payload={content_html:'<p>preservado</p>',credentials:[{id:'test',value:'sensitive'}]};
  const oldEncrypted=encryptVaultPayload(payload);assert.ok(oldEncrypted.startsWith('v2.'));
  process.env.VAULT_ENCRYPTION_KEY='vault-key-new';process.env.VAULT_ENCRYPTION_KEY_PREVIOUS='vault-key-old';
  assert.deepEqual(decryptVaultPayload(oldEncrypted),payload);
  assert.deepEqual(decryptVaultPayload(legacy('vault-key-old',payload,false)),payload);
  assert.notEqual(encryptVaultPayload(payload),oldEncrypted);
}));

test('ciphertext purposes are isolated and key failures expose no key or plaintext',async()=>withEnv({ORBIT_SECRET_KEY:'shared-key',VAULT_ENCRYPTION_KEY:'shared-key'},()=>{
  const integration=new SecretVault().seal({token:'private-marker'});
  const notebook=encryptVaultPayload({content_html:'<p>private-marker</p>'});
  assert.throws(()=>new SecretVault().open(notebook),/chave indisponível/);
  assert.throws(()=>decryptVaultPayload(integration),/chave indisponível/);
  process.env.ORBIT_SECRET_KEY='wrong-key';
  assert.throws(()=>new SecretVault().open(integration),error=>error instanceof Error&&!error.message.includes('private-marker')&&!error.message.includes('shared-key'));
}));
