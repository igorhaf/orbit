import 'reflect-metadata';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {credentials,parseVaultReference,vaultReference,vaultConstants,resolveVaultReference,loadVaultEnvironment} from './vault-credentials';
import {encryptVaultPayload,decryptVaultPayload} from './vault-crypto';
import {Db} from './db';

const owner=randomUUID(),item=randomUUID(),id=randomUUID();
const rows=[{id,name:'Token deploy',constant:'DEPLOY_TOKEN',value:'private-test-value'},{id:randomUUID(),name:'Senha pessoal',constant:'',value:'personal-test-value'}];
const old=process.env.VAULT_ENCRYPTION_KEY;process.env.VAULT_ENCRYPTION_KEY='unit-vault-key';
const sealed=encryptVaultPayload({content_html:'<p>Observações</p>',credentials:rows});
const db={query:async()=>[{id:item,title:'Servidor',category:'ssh',category_name:null,secret_data:sealed}],one:async(_sql:string,parameters:string[])=>parameters[0]===item&&parameters[1]===owner?{secret_data:sealed}:null} as unknown as Db;
test('credential payload stays encrypted with notes and validates stable IDs',()=>{
  assert(!sealed.includes(rows[0].value));assert.deepEqual(decryptVaultPayload(sealed).credentials,rows);
  assert.deepEqual(credentials(undefined),[]);assert.deepEqual(credentials(rows),rows);
  assert.throws(()=>credentials([rows[0],rows[0]]),/inválido/);
  assert.throws(()=>credentials([{...rows[0],constant:'bad constant'}]),/constante/);
  assert.throws(()=>credentials([{...rows[0],invented:'field'}]),/inválido/);
});
test('integration catalogue excludes personal passwords and all secret values',async()=>{
  const constants=await vaultConstants(db,owner);assert.equal(constants.length,1);assert.equal(constants[0].label,'Chaves públicas e privadas · DEPLOY_TOKEN');assert(!JSON.stringify(constants).includes('test-value'));
  assert.deepEqual(parseVaultReference(constants[0].reference),{owner,item,credential:id});
  assert.equal(await resolveVaultReference(db,constants[0].reference,owner),rows[0].value);
  await assert.rejects(()=>resolveVaultReference(db,constants[0].reference,randomUUID()),/não autorizada/);
  await assert.rejects(()=>resolveVaultReference(db,vaultReference(owner,item,rows[1].id),owner),/não encontrada/);
});
test('startup resolves credential references before constructing integrations',async()=>{
  const previous=process.env.ORBIT_TEST_VAULT_TOKEN;
  try{process.env.ORBIT_TEST_VAULT_TOKEN=vaultReference(owner,item,id);await loadVaultEnvironment(db);assert.equal(process.env.ORBIT_TEST_VAULT_TOKEN,rows[0].value)}finally{if(previous===undefined)delete process.env.ORBIT_TEST_VAULT_TOKEN;else process.env.ORBIT_TEST_VAULT_TOKEN=previous}
});
test('encryption keys cannot be replaced by notebook references',async()=>{
  const previous=process.env.ORBIT_SECRET_KEY_PREVIOUS;
  try{process.env.ORBIT_SECRET_KEY_PREVIOUS=vaultReference(owner,item,id);await assert.rejects(()=>loadVaultEnvironment(db),/Referência do cofre não permitida/)}finally{if(previous===undefined)delete process.env.ORBIT_SECRET_KEY_PREVIOUS;else process.env.ORBIT_SECRET_KEY_PREVIOUS=previous}
});
test.after(()=>{if(old===undefined)delete process.env.VAULT_ENCRYPTION_KEY;else process.env.VAULT_ENCRYPTION_KEY=old});
