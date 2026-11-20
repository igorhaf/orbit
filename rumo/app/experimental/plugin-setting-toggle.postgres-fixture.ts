import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import type {TestContext} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import type {ExecutionContext} from '@nestjs/common';
import jwt from 'jsonwebtoken';
import type {Pool} from 'pg';
import {AccessService} from '../apps/api/src/access/access';
import type {Db} from '../apps/api/src/db';
import {PluginRegistry} from '../apps/api/src/execution/registries';
import {EditorialAuthorizationGenerationRepository} from '../../../packages/orbit-core/src/execution/editorial-authorization-generation';
import {createExperimentalPluginSettingToggle as createToggle} from './plugin-setting-toggle';

/** Runs inside the R5-PRE harness with its real migrations and restricted logins. */
export async function exerciseDevPluginSettingToggle(
 t:TestContext, owner:Pool, general:Pool, writer:Pool, reader:Pool, monitor:Pool,
){
 await owner.query(`
  CREATE TABLE users(id uuid PRIMARY KEY,name text,email text,is_root boolean,disabled boolean,session_version integer);
  CREATE TABLE access_roles(id text PRIMARY KEY,name text,permissions text[]);
  CREATE TABLE access_grants(user_id uuid,role_id text,scope_type text,scope_id text);
  CREATE TABLE access_groups(id uuid,permissions text[]);
  CREATE TABLE access_group_members(group_id uuid,user_id uuid);
  CREATE TABLE access_user_exceptions(user_id uuid,permission_id text,effect text);
  CREATE TABLE access_permission_settings(permission_id text,enabled boolean);
  CREATE TABLE access_audit(actor_id uuid,action text,target text,scope_type text,scope_id uuid);
  GRANT SELECT ON users,access_roles,access_grants,access_groups,access_group_members,
    access_user_exceptions,access_permission_settings TO r5_app;
  GRANT INSERT ON access_audit TO r5_app;
 `);
 const manager='9b687cff-d23e-4115-b8c2-d710d51e49bb';
 const viewer='5ebfcfe7-6b83-42ad-8d8a-50d62a812073';
 await owner.query("INSERT INTO users VALUES($1,'Manager','manager@test',false,false,0),($2,'Viewer','viewer@test',false,false,0)",[manager,viewer]);
 await owner.query("INSERT INTO access_roles VALUES('manager','Manager',ARRAY['plugins.manage']),('viewer','Viewer',ARRAY['plugins.read'])");
 await owner.query("INSERT INTO access_grants VALUES($1,'manager','global','*'),($2,'viewer','global','*')",[manager,viewer]);
 const db:Db={
  pool:general,
  async query(sql,values){return (await general.query(sql,values)).rows},
  async one(sql,values){return (await general.query(sql,values)).rows[0]??null},
  async onModuleDestroy(){await general.end()},
 };
 const priorSecret=process.env.JWT_SECRET;
 const secret=randomBytes(32).toString('hex');
 process.env.JWT_SECRET=secret;
 // Construct one request object per call so Guard annotations survive reads.
 function command(id:string,user=manager,signingKey=secret,version=0){
  const request={path:`/plugins/${id}`,method:'PATCH',orbitActor:manager,
   headers:{authorization:`Bearer ${jwt.sign({version},signingKey,{subject:user})}`}};
  return {switchToHttp:()=>({getRequest:()=>request})} as unknown as ExecutionContext;
 }
 const makeRegistry=()=>{
  const registry=new PluginRegistry();
  for(const id of ['board-view','structured-view','vault']){
   registry.register({id,name:id,version:'1.0.0'});
  }
  registry.register({id:'vault-child',name:'Child',version:'1.0.0',dependencies:['vault']});
  return registry;
 };
 const ref=async()=> (await reader.query('SELECT revision::text FROM editorial_authorization_generation')).rows[0].revision as string;
 const sqlEnabled=async(id:string)=> (await general.query('SELECT enabled FROM plugin_settings WHERE plugin_id=$1',[id])).rows[0]?.enabled;
 const a=makeRegistry(),b=makeRegistry();
 const events:string[]=[];
 const hostA=createToggle(db,new AccessService(db),writer,a,async id=>{
  assert.equal(await sqlEnabled(id),a.catalog().find(item=>item.id===id)?.configuredEnabled);
  events.push(id);
 });
 const hostB=createToggle(db,new AccessService(db),writer,b,()=>{});
 try{
  await t.test('real session and plugins.manage precede all writes',async()=>{
   const before=await ref();
   await assert.rejects(hostA.toggle(command('vault',viewer),'vault',false),{status:403});
   assert.deepEqual((await owner.query('SELECT actor_id,action,target FROM access_audit')).rows,
    [{actor_id:viewer,action:'access.denied',target:'plugins.manage'}]);
   await assert.rejects(hostA.toggle(command('vault',manager,'wrong-signature'),'vault',false),{status:401});
   await assert.rejects(hostA.toggle(command('vault',manager,secret,1),'vault',false),{status:401});
   await assert.rejects(hostA.toggle(command('vault'),'structured-view',false),{status:403});
   assert.equal((await hostA.toggle(command('vault'),'vault','false')).status,'rejected');
   assert.equal((await hostA.toggle(command('absent'),'absent',false)).status,'rejected');
   assert.equal(await ref(),before);
   await assert.rejects(general.query("INSERT INTO plugin_settings(plugin_id,enabled) VALUES('vault',false) ON CONFLICT(plugin_id) DO UPDATE SET enabled=EXCLUDED.enabled"),{code:'42501'});
   assert.throws(()=>createToggle(db,new AccessService(db),general,a,()=>{}),/separate_plugin_configuration_pool_required/);
   assert.deepEqual(Object.keys(hostA).sort(),['recover','toggle']);
   const result=await hostA.toggle(command('vault'),'vault',false);
   assert.equal(result.status,'committed_reconciled');
   assert.equal(result.authorizationState,'unavailable');
   assert.equal(await ref(),String(BigInt(before)+1n));
   assert.equal(await sqlEnabled('vault'),false);
   assert.equal(a.isEnabled('vault-child'),false);
   assert.equal(b.isEnabled('vault-child'),true);
   assert.deepEqual(events,['vault']);
  });

  await t.test('two hosts use server-observed CAS and preserve the last board view',async()=>{
   // Start with both modes implicitly enabled.
   await owner.query("DELETE FROM plugin_settings WHERE plugin_id IN ('board-view','structured-view')");
   const repository=new EditorialAuthorizationGenerationRepository(writer);
   const before=await repository.observe();
   const held=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
   const hold=repository.withPinned(before,async()=>{held.resolve();await release.promise});
   await Promise.race([held.promise,hold]);
   const attempts=Promise.all([
    hostA.toggle(command('board-view'),'board-view',false),
    hostB.toggle(command('structured-view'),'structured-view',false),
   ]);
   try{
    const deadline=Date.now()+2500;
    for(;;){
     const {rows:[row]}=await monitor.query(`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname='r5pre' AND usename='r5_writer' AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE%'`);
     if(row.n===2)break;
     assert.ok(Date.now()<deadline,'both writers must wait after observing the same revision');
     await delay(10);
    }
    assert.equal(await sqlEnabled('board-view'),undefined);
    assert.equal(await sqlEnabled('structured-view'),undefined);
    assert.equal(await ref(),before.revision);
   }finally{release.resolve();await Promise.allSettled([hold,attempts])}
   const results=await attempts;
   assert.deepEqual(results.map(result=>result.status).sort(),['committed_reconciled','rejected']);
   const declined=results.find(result=>result.status==='rejected');
   assert.ok(declined&&'reason' in declined);
   assert.equal(declined.reason,'editorial_generation_conflict');
   assert.equal(await ref(),String(BigInt(before.revision)+1n));
   const remaining=(await sqlEnabled('board-view'))===false?'structured-view':'board-view';
   const last=await hostA.toggle(command(remaining),remaining,false);
   assert.equal(last.status,'rejected');
   assert.equal(last.status==='rejected'&&last.reason,'required_board_view');
   assert.equal(await sqlEnabled(remaining),undefined);
  });

  await t.test('post-COMMIT failure and lost reply preserve outcome, restart only reads',async()=>{
   const notificationFailure=createToggle(db,new AccessService(db),writer,a,()=>{throw new Error('fixture notification failure')});
   const stale=await notificationFailure.toggle(command('vault'),'vault',true);
   assert.equal(stale.status,'committed_local_stale');
   assert.equal(stale.readiness.state,'stale');
   assert.equal(await sqlEnabled('vault'),true);

   let upserts=0,notifications=0,writes=0;
   const lostReply={async connect(){
    const client=await writer.connect();
    let mutated=false;
    return {async query(sql:string,values?:unknown[]){
     if(sql.startsWith('INSERT INTO plugin_settings')){mutated=true;upserts++}
     const result=await client.query(sql,values);
     if(mutated&&sql==='COMMIT'){writes++;throw new Error('fixture lost committed response')}
     return result;
    },release(discard?:boolean){client.release(discard)}};
   }} as unknown as Pool;
   const before=await ref();
   const interrupted=createToggle(db,new AccessService(db),lostReply,a,()=>{notifications++});
   const result=await interrupted.toggle(command('vault'),'vault',false);
   assert.equal(result.status,'commit_uncertain');
   assert.equal(result.readiness.state,'unknown');
   assert.equal(result.authorizationState,'unavailable');
   assert.equal(await ref(),String(BigInt(before)+1n));
   assert.equal(await sqlEnabled('vault'),false);
   assert.equal(a.isEnabled('vault'),true);
   assert.deepEqual({upserts,writes,notifications},{upserts:1,writes:1,notifications:0});
   const restarted=makeRegistry();
   const recovered=await createToggle(db,new AccessService(db),lostReply,restarted,()=>{notifications++}).recover('vault');
   assert.equal(recovered.status,'reconciled_observed');
   assert.equal(recovered.authorizationState,'unavailable');
   assert.equal(restarted.isEnabled('vault-child'),false);
   assert.equal(a.isEnabled('vault'),true);
   assert.deepEqual({upserts,writes,notifications},{upserts:1,writes:1,notifications:0});
  });
 }finally{
  if(priorSecret===undefined)delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET=priorSecret;
 }
}
