import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import test from 'node:test';
import {
 compareEditorialAuthorizationSnapshots as compare,
 sealEditorialAuthorizationSnapshot as seal,
 verifyEditorialAuthorizationSnapshot as verify,
} from './editorial-authorization-snapshot';

const partialSource=()=>{
 const providers=[{family:'scope',count:2,ids:['workspace','record']},{family:'membership',count:0,ids:[]}];
 const permissions=['projects.read','boards.read'];
 const source={
  runtimeId:'dev',
  access:{
   catalog:()=>permissions,
   editorialProviderInventory:()=>providers,
   editorialScopeProvidersPresent:()=>true,
  },
  registry:{catalog:()=>[],getById:()=>{throw new Error('unused')},isInstalled:()=>false,isEnabled:()=>false},
 };
 return {source,providers,permissions};
};

test('canonical snapshot is detached, frozen and stable across ordering and JSON round trips',()=>{
 const {source,providers,permissions}=partialSource();
 const first=seal(source);
 providers[0].ids.reverse();
 providers.reverse();
 permissions.reverse();
 assert.equal(seal(source).digest,first.digest);
 assert.deepEqual(verify(JSON.parse(JSON.stringify(first))),first);
 assert.ok([first,first.providers,first.providers[0],first.providers[0].ids,first.permissions,first.reasons].every(Object.isFrozen));
 permissions.push('boards.write');
 assert.deepEqual(first.permissions,['boards.read','projects.read']);
 assert.deepEqual(compare(first,seal(source)),{status:'changed',changes:['permissions']});
 assert.equal(compare(first,first).status,'unverifiable');
});

test('unknown families, missing entries and unsafe source failures do not establish authority',()=>{
 const {source,providers}=partialSource();
 providers.push({family:'unknown-family',count:1,ids:['unknown-id']});
 const snapshot=seal(source);
 assert.equal(snapshot.completeness,'partial');
 assert.equal(snapshot.verification,'unverifiable');
 assert.ok(snapshot.reasons.includes('provider_inventory_partial'));
 assert.ok(snapshot.reasons.includes('unknown_provider_family'));
 assert.ok(snapshot.reasons.includes('provider_not_homologated'));
 assert.doesNotMatch(JSON.stringify(snapshot),/unknown-family|unknown-id/);
 source.registry.catalog=()=>{throw new Error('fixture-sensitive-detail')};
 assert.throws(()=>seal(source),{code:'editorial_snapshot_source_unavailable',message:'editorial_snapshot_source_unavailable'});
 assert.throws(()=>verify({...snapshot,schemaVersion:2}),{code:'editorial_snapshot_invalid'});
 assert.throws(()=>verify({...snapshot,digest:'0'.repeat(64)}),{code:'editorial_snapshot_integrity'});
 assert.throws(()=>verify({...snapshot,extra:'not-in-schema'}),{code:'editorial_snapshot_integrity'});
});

const runtimeProbe=String.raw`
const assert=require('node:assert/strict');
const {AccessService}=require('./apps/api/src/access/access.ts');
const {PluginRegistry}=require('./apps/api/src/execution/registries.ts');
const {sealEditorialAuthorizationSnapshot:seal,compareEditorialAuthorizationSnapshots:compare}=require(process.argv[1]);
const {discoveryReviewAccessHost}=require(process.argv[2]);
const runtimeId=process.argv[3];
const definition={id:'vault',name:'Fixture',version:'1.0.0',dependencies:[]};
const restart=()=>{
 const registry=new PluginRegistry();
 registry.register({...definition,dependencies:[]});
 return {runtimeId,access:new AccessService({}),registry,knownPluginIds:['vault']};
};
async function probe(){
 const source=restart();
 const {access,registry}=source;
 const before=seal(source);
 assert.equal(seal(restart()).digest,before.digest);
 assert.equal(before.providers.length,runtimeId==='suinda'?13:11);
 assert.ok(!before.reasons.includes('provider_inventory_partial'));
 assert.equal(access.editorialScopeProvidersPresent(),false);
 const principal={actorId:'fixture',subjectId:'fixture'};
 const host=discoveryReviewAccessHost(access,runtimeId,{...principal,simulated:false,sessionVersion:0});
 const origin={discoveryId:'fixture',queue:'card_runs'};
 const stop=new Error('fixture-stop');
 let calls=0;
 const db={query:async(sql)=>{
  calls++;
  assert.equal(sql,'LOCK TABLE users,access_roles,access_grants,access_groups,access_group_members,access_user_exceptions,access_permission_settings,boards,board_members,lists,cards,ai_projects,vault_items IN SHARE MODE');
  throw stop;
 }};
 await assert.rejects(host.authorize(principal,db,origin,'read'),e=>e===stop);
 assert.equal(calls,1);
 access.registerScope('fixture',async()=>true);
 const added=seal(source);
 assert.ok(compare(before,added).changes.includes('providers'));
 assert.ok(added.reasons.includes('provider_not_homologated'));
 access.registerScope('fixture',async()=>false);
 const replaced=seal(source);
 assert.equal(replaced.digest,added.digest);
 assert.equal(compare(added,replaced).status,'unverifiable');
 await assert.rejects(host.authorize(principal,db,origin,'read'),{code:'review_scope_adapter_unavailable'});
 assert.equal(calls,1);
 access.registerPermissions(['fixture.permission']);
 const withPermission=seal(source);
 assert.ok(compare(replaced,withPermission).changes.includes('permissions'));
 registry.setEnabled('vault',false);
 const disabled=seal(source);
 assert.equal(disabled.plugins[0].enabled,false);
 assert.equal(disabled.plugins[0].configuredEnabled,false);
 assert.deepEqual(compare(withPermission,disabled).changes,['plugins']);
 registry.setInstalled('vault',false);
 const uninstalled=seal(source);
 assert.equal(uninstalled.plugins[0].installed,false);
 assert.equal(uninstalled.plugins[0].configuredEnabled,null);
 assert.deepEqual(compare(disabled,uninstalled).changes,['plugins']);
 const live=registry.getById('vault');
 live.dependencies.push('fixture-dependency');
 assert.deepEqual(uninstalled.plugins[0].dependencies,[]);
 const changedDefinition=seal(source);
 assert.deepEqual(changedDefinition.plugins[0].dependencies,['fixture-dependency']);
 assert.deepEqual(compare(uninstalled,changedDefinition).changes,['plugins']);
 registry.setInstalled('vault',true);
 const missingDependency=seal(source);
 registry.setEnabled('vault',true);
 const configuredDespiteMissingDependency=seal(source);
 assert.equal(configuredDespiteMissingDependency.plugins[0].enabled,false);
 assert.equal(configuredDespiteMissingDependency.plugins[0].configuredEnabled,true);
 assert.deepEqual(compare(missingDependency,configuredDespiteMissingDependency).changes,['plugins']);
 registry.setAuthorizer(async()=>{throw Error('fixture')});
 assert.equal(compare(configuredDespiteMissingDependency,seal(source)).status,'unverifiable');
 assert.equal(compare(before,seal(source)).status,'changed');
 if(runtimeId==='suinda'){
  const scoped=restart();
  scoped.access.registerScopedPermissionProvider(async()=>[]);
  scoped.access.registerRequestPermissionProvider(async()=>null);
  const snapshot=seal(scoped);
  for(const family of ['scoped_permission','request_permission']){
   assert.equal(snapshot.providers.find(p=>p.family===family).count,1);
  }
  assert.ok(snapshot.reasons.includes('provider_not_homologated'));
 }
}
probe().catch(error=>{console.error(error);process.exitCode=1});
`;

for(const {runtime,directory} of [
 {runtime:'dev',directory:'forge'},
 {runtime:'prod',directory:'workspace'},
 {runtime:'safdoulas',directory:'safdoulas'},
 {runtime:'suinda',directory:'suinda'},
]){
 test(`${runtime}: actual authorization inventory and registry mutations`,()=>{
  const root=process.cwd();
  const cwd=join(root,directory,'app');
  const canonical=join(root,'packages/orbit-core/src/execution');
  execFileSync(process.execPath,[
   '--import',join(cwd,'node_modules/tsx/dist/loader.mjs'),'--eval',runtimeProbe,
   join(canonical,'editorial-authorization-snapshot.ts'),join(canonical,'discovery-review-access-host.ts'),runtime,
  ],{cwd,env:{PATH:process.env.PATH,TSX_TSCONFIG_PATH:join(cwd,'apps/api/tsconfig.json'),TSX_DISABLE_CACHE:'1'},timeout:15000});
 });
}
