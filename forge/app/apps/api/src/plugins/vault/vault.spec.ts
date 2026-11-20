import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PluginRegistry} from '../../execution/registries';
import {AccessService} from '../../access/access';
import {corePrivileges} from '../../access/privileges';
import {vaultPlugin,vaultFeatureAccess,installVaultAccess} from './vault.plugin';
import {VaultService} from './vault.service';
import {BackupService} from '../../backup-service';
import {EnvironmentSettingsController} from '../../env-settings';
import {vaultConstants,resolveVaultReference,vaultReference} from '../../credential-store';
import {encryptVaultPayload} from '../../vault-crypto';
import type {Db} from '../../db';
import {FeaturesService} from '../../features';
import type {BackupDestinationRegistry} from '../../backup-destinations';
import type {GoogleCredentials} from '../../google/credentials';

test('uninstalling the optional Cofre blocks all routes and internal CRUD while preserving core credential resolution',async()=>{
 const previous=process.env.VAULT_ENCRYPTION_KEY;process.env.VAULT_ENCRYPTION_KEY='optional-vault-test-key';
 try{
  const owner=randomUUID(),item=randomUUID(),field=randomUUID(),value='private-optional-test-value';
  const sealed=encryptVaultPayload({content_html:'<p>Notes</p>',credentials:[{id:field,name:'Integration',constant:'TEST_TOKEN',value}]});
  const db={query:async()=>[{id:item,title:'Integration',category:'api',category_name:null,secret_data:sealed}],one:async()=>({secret_data:sealed})} as unknown as Db;
  const registry=new PluginRegistry();registry.register(vaultPlugin);registry.register({id:'vault-child',name:'Dependent',version:'1.0.0',dependencies:['vault']});
  const service=new VaultService(db,{} as FeaturesService,registry),access=new AccessService(db);installVaultAccess(registry,access);
  assert.equal(access.resourceAvailable('vault'),true);registry.setInstalled('vault',false);
  assert.equal(registry.catalog().some(plugin=>plugin.id==='vault'),false);assert.equal(registry.isEnabled('vault-child'),false);assert.deepEqual(registry.blockedBy('vault-child'),['vault']);
  registry.setEnabled('vault',true);assert.equal(registry.isEnabled('vault'),false);
  const settings=new EnvironmentSettingsController(new FeaturesService(db),registry);await assert.rejects(()=>settings.pluginSettings({orbitUser:owner} as never,'vault'),/Plugin não encontrado/);
  assert.equal(access.resourceAvailable('vault'),false);assert.equal(access.resourceAvailable('notebooks'),true);
  for(const action of [()=>service.vault(owner),()=>service.vaultCategories(owner),()=>service.createVaultItem(owner,{}),()=>service.vaultConstants(owner)])await assert.rejects(action,/não está disponível/);
  for(const path of ['/vault','/vault/constants','/vault/categories','/vault/'+item,'/cards/'+item+'/vault','/backups/vault']){
   let status=0,next=false;const res={status(code:number){status=code;return this},json(){}};
   vaultFeatureAccess(registry)({path} as never,res as never,()=>{next=true});assert.equal(status,409);assert.equal(next,false);
  }
  assert.equal(await resolveVaultReference(db,vaultReference(owner,item,field),owner),value);
  const constants=await vaultConstants(db,owner);assert.equal(constants.length,1);assert.ok(!JSON.stringify(constants).includes(value));
  registry.setInstalled('vault',true);assert.equal(registry.isEnabled('vault'),true);assert.equal(registry.isEnabled('vault-child'),true);
 }finally{if(previous===undefined)delete process.env.VAULT_ENCRYPTION_KEY;else process.env.VAULT_ENCRYPTION_KEY=previous}
});
test('Vault privileges belong to the optional plugin and never to the core',async()=>{
 assert.ok(!corePrivileges.some(item=>item.id.startsWith('vault.')));
 const access=new AccessService({query:async()=>[]} as unknown as Db);access.registerPlugins([vaultPlugin]);
 const catalog=await access.privilegeCatalog();assert.deepEqual(catalog.filter(item=>item.id.startsWith('vault.')).map(item=>item.source),['vault','vault']);
});
test('Cofre backup endpoints stop independently of database/configuration backup settings',async()=>{
 const service=new BackupService({one:async()=>null} as unknown as Db,{catalog:()=>[]} as unknown as BackupDestinationRegistry,{configured:()=>false,available:async()=>[]} as unknown as GoogleCredentials);
 service.setVaultAvailability(()=>false);
 for(const action of [()=>service.listVault('user'),()=>service.createVault('user'),()=>service.downloadVault('user','copy'),()=>service.restoreVault('user','archive'),()=>service.uploadExistingVault('user','archive','connection')])await assert.rejects(action,/não está disponível/);
 const options=await service.options('user');assert.equal(options.destinations[0].id,'local');assert.equal(options.automatic.enabled,false);
});
