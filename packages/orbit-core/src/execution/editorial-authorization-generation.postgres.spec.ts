import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir,userInfo} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import {
 EditorialAuthorizationGenerationRepository as Repository,
 assertEditorialAuthorizationGeneration as assertGeneration,
} from './editorial-authorization-generation';
import {RequiredBoardViewError,writeEditorialPluginSetting} from './editorial-plugin-settings-writer';
import {reconcileEditorialPluginSetting as reconcile} from './editorial-plugin-settings-orchestration';
import {recoverEditorialPluginSetting as recover} from './editorial-plugin-settings-recovery';

const require=createRequire(join(process.cwd(),'forge/app/package.json'));
const {Pool}=require('pg');
const postgres='/usr/lib/postgresql/16/bin';
const migration='packages/orbit-core/sql/migrations/212_editorial_authorization_generation.sql';

test('07D-R3C-A on an owned PostgreSQL cluster', {timeout:60000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'orbit-07dr3ca-'));
 const data=join(root,'data');
 const pools:InstanceType<typeof Pool>[]=[];
 const run=(bin:string,args:string[])=>execFileSync(join(postgres,bin),args,{
  env:{PATH:'/usr/bin:/bin',LANG:'C'},timeout:15000,stdio:'pipe',
 });
 const connectPool=(name:string,database='postgres',user=userInfo().username)=>{
  const pool=new Pool({host:root,port:55443,user,database,application_name:name,
   options:'-c lock_timeout=4000 -c statement_timeout=6000 -c idle_in_transaction_session_timeout=9000'});
  // The loss scenario also exercises errors delivered while a client is checked out.
  pool.on('connect',(client:{on:(event:string,handler:()=>void)=>void})=>client.on('error',()=>{}));
  pools.push(pool);
  return pool;
 };
 let started=false;
 try{
  run('initdb',['-D',data,'-A','trust','--no-locale','-E','UTF8']);
  run('pg_ctl',['-D',data,'-l',join(root,'postgres.log'),'-o',`-k ${root} -p 55443 -c listen_addresses='' -c unix_socket_permissions=0700`,'-w','start']);
  started=true;
  const admin=connectPool('r3ca_admin');
  const readerPool=connectPool('r3ca_reader');
  const writerPool=connectPool('r3ca_writer');
  const reader=new Repository(readerPool);
  const writer=new Repository(writerPool);
  assert.equal((await admin.query('SHOW data_directory')).rows[0].data_directory,data);
  assert.equal((await admin.query('SELECT inet_server_addr() AS addr')).rows[0].addr,null);
  const ddl=await readFile(migration,'utf8');
  await admin.query('BEGIN; '+ddl+' COMMIT;');
  await admin.query("CREATE TABLE r3ca_fixture_settings(enabled boolean NOT NULL); INSERT INTO r3ca_fixture_settings VALUES (true)");
  const enabled=async()=> (await admin.query('SELECT enabled FROM r3ca_fixture_settings')).rows[0].enabled;
  const first=await reader.observe();

  await t.test('initial domain is database-generated and unavailable for authorization',async()=>{
   assert.match(first.domainId,/^[0-9a-f-]{36}$/);
   assert.deepEqual(first,{domainId:first.domainId,revision:'0',authorizationState:'unavailable',configurationVerification:'unknown'});
   assert.ok(Object.isFrozen(first));
   await admin.query('CREATE DATABASE r3ca_other');
   const other=connectPool('r3ca_other','r3ca_other');
   await other.query('BEGIN; '+ddl+' COMMIT;');
   const otherRef=await new Repository(other).observe();
   assert.notEqual(otherRef.domainId,first.domainId);
   assert.throws(()=>assertGeneration(first,otherRef),{code:'editorial_generation_domain_mismatch'});
   await assert.rejects(new Repository(other).withPinned(first,async()=>assert.fail()),{code:'editorial_generation_domain_mismatch'});
   for(const sql of [
    "UPDATE editorial_authorization_generation SET authorization_state='verified'",
    'UPDATE editorial_authorization_generation SET revision=revision+2',
    'DELETE FROM editorial_authorization_generation',
    'TRUNCATE editorial_authorization_generation',
   ])await assert.rejects(admin.query(sql),{code:'23514'});
  });

  await t.test('a writer arriving after the last check waits until reader COMMIT',async()=>{
   const ready=Promise.withResolvers<number>();
   const finish=Promise.withResolvers<void>();
   const reading=reader.withPinned(first,async db=>{
    ready.resolve((await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    await finish.promise;
   });
   const pid=await ready.promise;
   let entered=false;
   const writing=writer.advance(first,async db=>{
    entered=true;
    await db.query('UPDATE r3ca_fixture_settings SET enabled=false');
   });
   void writing.catch(()=>{});
   try{
    const deadline=Date.now()+2500;
    for(;;){
     const state=await admin.query(`SELECT pid FROM pg_stat_activity
      WHERE application_name='r3ca_writer' AND $1::int=ANY(pg_blocking_pids(pid))`,[pid]);
     if(state.rowCount)break;
     assert.ok(Date.now()<deadline,'writer must wait on the reader backend');
     await delay(10);
    }
    assert.equal(entered,false);
    assert.equal(await enabled(),true);
   }finally{
    finish.resolve();
    await Promise.allSettled([reading,writing]);
   }
   await reading;
   const next=await writing;
   assert.equal(next.revision,'1');
   assert.equal(await enabled(),false);
   assert.deepEqual(await reader.observe(),next);
   await assert.rejects(reader.withPinned(first,async()=>assert.fail()),{code:'editorial_generation_conflict'});
   await assert.rejects(writer.advance(first,async()=>assert.fail()),{code:'editorial_generation_conflict'});
  });

  await t.test('competing writers with the same expected generation allow one change',async()=>{
   const ref=await reader.observe();
   let applied=0;
   const mutate=async(db:{query:(sql:string)=>Promise<unknown>})=>{
    applied++;
    await db.query('UPDATE r3ca_fixture_settings SET enabled=NOT enabled');
   };
   const results=await Promise.allSettled([reader.advance(ref,mutate),writer.advance(ref,mutate)]);
   assert.equal(applied,1);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   assert.equal(results.find(r=>r.status==='rejected')?.reason.code,'editorial_generation_conflict');
   assert.equal((await reader.observe()).revision,'2');
  });

  await t.test('rollback undoes the configuration write and does not advance the revision',async()=>{
   const ref=await reader.observe(),before=await enabled();
   await assert.rejects(writer.advance(ref,async db=>{
    await db.query('UPDATE r3ca_fixture_settings SET enabled=NOT enabled');
    throw new Error('private fixture detail');
   }),{code:'editorial_generation_operation_failed',message:'editorial_generation_operation_failed'});
   assert.equal(await enabled(),before);
   assert.deepEqual(await reader.observe(),ref);
  });

  await t.test('lost connection before COMMIT rolls back and releases its lock',async()=>{
   const ref=await reader.observe(),before=await enabled();
   await assert.rejects(writer.advance(ref,async db=>{
    await db.query('UPDATE r3ca_fixture_settings SET enabled=NOT enabled');
    const {rows}=await db.query('SELECT pg_backend_pid() AS pid');
    const stopped=await admin.query('SELECT pg_terminate_backend($1,2000) AS stopped',[rows[0].pid]);
    assert.equal(stopped.rows[0].stopped,true);
    await db.query('SELECT 1');
   }),{code:'editorial_generation_operation_failed'});
   assert.equal(await enabled(),before);
   assert.deepEqual(await writer.observe(),ref);
  });

  await t.test('a lost COMMIT response requires fresh observation without automatic retry',async()=>{
   const ref=await reader.observe(),before=await enabled();
   let discarded=false,commitRequests=0;
   const uncertain=new Repository({async connect(){
    const client=await writerPool.connect();
    return {async query(sql,parameters){
     const result=await client.query(sql,parameters);
     if(sql==='COMMIT'){
      commitRequests++;
      throw new Error('fixture drops the response after PostgreSQL commits');
     }
     return result;
    },release(discard){
     discarded=discard===true;
     client.release(discard);
    }};
   }});
   await assert.rejects(uncertain.advance(ref,async db=>{
    await db.query('UPDATE r3ca_fixture_settings SET enabled=NOT enabled');
   }),{code:'editorial_generation_commit_uncertain'});
   assert.equal(discarded,true);
   assert.equal(commitRequests,1);
   assert.equal(await enabled(),!before);
   const reobserved=await reader.observe();
   assert.equal(BigInt(reobserved.revision),BigInt(ref.revision)+1n);
   assert.equal(reobserved.authorizationState,'unavailable');
   await assert.rejects(writer.advance(ref,async()=>assert.fail()),{code:'editorial_generation_conflict'});
  });

  await t.test('a nonparticipating writer remains outside the generation protocol',async()=>{
   const ref=await reader.observe(),before=await enabled();
   await reader.withPinned(ref,async(_db,pinned)=>{
    await admin.query('UPDATE r3ca_fixture_settings SET enabled=NOT enabled');
    assert.equal(await enabled(),!before);
    assert.equal(pinned.configurationVerification,'unknown');
   });
   assert.deepEqual(await reader.observe(),ref);
  });

  await t.test('07D-R3C-B participant uses the real plugin_settings schema',async b=>{
   const pluginSettingsDdl=await readFile('forge/app/apps/api/sql/migrations/024_plugin_settings.sql','utf8');
   await admin.query(pluginSettingsDdl);
   const setting=async(id:string)=>(await admin.query('SELECT enabled FROM plugin_settings WHERE plugin_id=$1',[id])).rows[0]?.enabled;
   const awaitBlock=async(waiting:string,blocker:string|number)=>{
    const deadline=Date.now()+2500;
    for(;;){
     const state=await admin.query(`SELECT 1 FROM pg_stat_activity waiting JOIN pg_stat_activity blocker
      ON blocker.pid=ANY(pg_blocking_pids(waiting.pid))
      WHERE waiting.application_name=$1 AND (blocker.application_name=$2 OR blocker.pid::text=$2)`,
     [waiting,String(blocker)]);
     if(state.rowCount)return;
     assert.ok(Date.now()<deadline,`${waiting} must be blocked by ${blocker}`);
     await delay(10);
    }
   };

   await b.test('pin blocks the writer before DML and database advances without updating memory',async()=>{
    const {PluginRegistry}=require('./apps/api/src/execution/registries.ts');
    const registry=new PluginRegistry();
    registry.register({id:'vault',version:'1.0.0',name:'Fixture'});
    const ref=await reader.observe();
    const ready=Promise.withResolvers<void>(),finish=Promise.withResolvers<void>();
    const pinned=reader.withPinned(ref,async()=>{
     ready.resolve();
     await finish.promise;
    });
    await ready.promise;
    const writing=writeEditorialPluginSetting(writer,ref,'vault',false);
    void writing.catch(()=>{});
    try{
     await awaitBlock('r3ca_writer','r3ca_reader');
     assert.equal(await setting('vault'),undefined);
     assert.equal(registry.isEnabled('vault'),true);
    }finally{
     finish.resolve();
     await Promise.allSettled([pinned,writing]);
    }
    await pinned;
    const next=await writing;
    assert.equal(BigInt(next.revision),BigInt(ref.revision)+1n);
    assert.equal(await setting('vault'),false);
    assert.deepEqual(await reader.observe(),next);
    assert.equal(registry.isEnabled('vault'),true);
    assert.equal(next.authorizationState,'unavailable');
    assert.equal(next.configurationVerification,'unknown');
    await assert.rejects(writeEditorialPluginSetting(writer,ref,'vault',true),{code:'editorial_generation_conflict'});
    assert.equal(await setting('vault'),false);
   });

   await b.test('a database failure after plugin upsert rolls back both changes',async()=>{
    const ref=await reader.observe();
    await admin.query(`CREATE FUNCTION r3cb_reject_revision() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN
      IF NOT EXISTS(SELECT 1 FROM plugin_settings WHERE plugin_id='vault' AND enabled) THEN
       RAISE EXCEPTION 'plugin DML was not performed first';
      END IF;
      RAISE EXCEPTION 'fixture failure after plugin DML' USING ERRCODE='P7777';
     END $$;
     CREATE TRIGGER r3cb_reject_revision BEFORE UPDATE ON editorial_authorization_generation
      FOR EACH ROW EXECUTE FUNCTION r3cb_reject_revision()`);
    let pgCode:string|undefined;
    const observedWriter=new Repository({async connect(){
     const client=await writerPool.connect();
     return {async query(sql,parameters){
      try{return await client.query(sql,parameters)}
      catch(error){pgCode=(error as {code?:string}).code;throw error}
     },release(discard){client.release(discard)}};
    }});
    try{
     await assert.rejects(writeEditorialPluginSetting(observedWriter,ref,'vault',true),{code:'editorial_generation_operation_failed'});
     assert.equal(pgCode,'P7777');
     assert.equal(await setting('vault'),false);
     assert.deepEqual(await reader.observe(),ref);
    }finally{
     await admin.query('DROP TRIGGER r3cb_reject_revision ON editorial_authorization_generation; DROP FUNCTION r3cb_reject_revision()');
    }
   });

   await b.test('neither configuration nor generation is visible to other sessions before COMMIT',async()=>{
    const ref=await reader.observe();
    const reachedCommit=Promise.withResolvers<void>(),finish=Promise.withResolvers<void>();
    const staged=new Repository({async connect(){
     const client=await writerPool.connect();
     return {async query(sql,parameters){
      if(sql==='COMMIT'){
       reachedCommit.resolve();
       await finish.promise;
      }
      return client.query(sql,parameters);
     },release(discard){client.release(discard)}};
    }});
    const writing=writeEditorialPluginSetting(staged,ref,'fixture-atomic',false);
    const observeBoth=async()=> (await admin.query(`SELECT revision::text,
     (SELECT enabled FROM plugin_settings WHERE plugin_id='fixture-atomic') AS enabled
     FROM editorial_authorization_generation WHERE singleton`)).rows[0];
    try{
     await Promise.race([reachedCommit.promise,writing.then(()=>assert.fail('expected commit barrier'))]);
     assert.deepEqual(await observeBoth(),{revision:ref.revision,enabled:null});
    }finally{
     finish.resolve();
     await Promise.allSettled([writing]);
    }
    assert.deepEqual(await observeBoth(),{revision:(await writing).revision,enabled:false});
   });

   await b.test('generation precedes advisory lock, which precedes DML, while legacy writer can commit',async()=>{
    const ref=await reader.observe();
    const legacy=await admin.connect();
    const advisory="SELECT pg_advisory_xact_lock(hashtextextended('orbit.required-board-view',0))";
    let writing:ReturnType<typeof writeEditorialPluginSetting>|undefined;
    let reading:ReturnType<typeof reader.observe>|undefined;
    try{
     await legacy.query('BEGIN');
     const pid=(await legacy.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
     await legacy.query(advisory);
     writing=writeEditorialPluginSetting(writer,ref,'board-view',false);
     void writing.catch(()=>{});
     await awaitBlock('r3ca_writer',pid);
     reading=reader.observe();
     void reading.catch(()=>{});
     await awaitBlock('r3ca_reader','r3ca_writer');
     assert.equal(await setting('board-view'),undefined);
     await legacy.query("INSERT INTO plugin_settings(plugin_id,enabled) VALUES ('structured-view',true)");
     await legacy.query('COMMIT');
     assert.equal((await writing).revision,(BigInt(ref.revision)+1n).toString());
     assert.equal((await reading).revision,(BigInt(ref.revision)+1n).toString());
     assert.equal(await setting('board-view'),false);
     assert.equal(await setting('structured-view'),true);
    }finally{
     try{await legacy.query('ROLLBACK')}finally{legacy.release()}
     await Promise.allSettled([writing,reading]);
    }
   });

   await b.test('competing view disables permit one advance and reject disabling the last view',async()=>{
    const setup=await reader.observe();
    const ref=await writeEditorialPluginSetting(writer,setup,'board-view',true);
    const attempts=await Promise.allSettled([
     writeEditorialPluginSetting(writer,ref,'board-view',false),
     writeEditorialPluginSetting(reader,ref,'structured-view',false),
    ]);
    assert.equal(attempts.filter(attempt=>attempt.status==='fulfilled').length,1);
    assert.equal(attempts.find(attempt=>attempt.status==='rejected')?.reason.code,'editorial_generation_conflict');
    const next=await reader.observe();
    const active=(await setting('board-view'))?'board-view':'structured-view';
    assert.equal(await setting(active),true);
    await assert.rejects(writeEditorialPluginSetting(writer,next,active,false),RequiredBoardViewError);
    assert.deepEqual(await reader.observe(),next);
    assert.equal(await setting(active),true);
   });

   await b.test('unparticipating plugin DML can commit during a pin without a generation change',async()=>{
    const ref=await reader.observe();
    await reader.withPinned(ref,async()=>{
     await admin.query("UPDATE plugin_settings SET enabled=true WHERE plugin_id='vault'");
     assert.equal(await setting('vault'),true);
    });
    assert.deepEqual(await reader.observe(),ref);
   });

   await b.test('lost COMMIT acknowledgement is reported once and requires new observation',async()=>{
    const ref=await reader.observe();
    let connections=0,commitRequests=0,discarded=false;
    const uncertain=new Repository({async connect(){
     connections++;
     const client=await writerPool.connect();
     return {async query(sql,parameters){
      const result=await client.query(sql,parameters);
      if(sql==='COMMIT'){
       commitRequests++;
       throw new Error('fixture drops COMMIT response');
      }
      return result;
     },release(discard){discarded=discard===true;client.release(discard)}};
    }});
    await assert.rejects(writeEditorialPluginSetting(uncertain,ref,'vault',false),{code:'editorial_generation_commit_uncertain'});
    assert.equal(connections,1);
    assert.equal(commitRequests,1);
    assert.equal(discarded,true);
    const next=await reader.observe();
    assert.equal(next.revision,(BigInt(ref.revision)+1n).toString());
    assert.equal(next.authorizationState,'unavailable');
    assert.equal(await setting('vault'),false);
   });
  });

  await t.test('07D-R3C-C isolated DEV orchestration',async c=>{
   await admin.query(await readFile('forge/app/apps/api/sql/migrations/024_plugin_settings.sql','utf8'));
   const {PluginRegistry}=require('./apps/api/src/execution/registries.ts');
   const registryFor=(id:string,dependencies:string[]=[] )=>{
    const registry=new PluginRegistry();
    registry.register({id,name:'Fixture',version:'1.0.0',dependencies});
    return registry;
   };
   const stored=async(id:string)=>(await admin.query('SELECT enabled FROM plugin_settings WHERE plugin_id=$1',[id])).rows[0]?.enabled;

   await c.test('commit is observable before registry update and notification, with dependency semantics intact',async()=>{
    const id='r3cc-dependent',registry=registryFor(id,['r3cc-parent']);
    registry.register({id:'r3cc-parent',name:'Fixture parent',version:'1.0.0'});
    registry.setEnabled('r3cc-parent',false);
    registry.setEnabled(id,false);
    const ref=await reader.observe();
    const setEnabled=registry.setEnabled.bind(registry);
    const events:string[]=[];
    registry.setEnabled=(name:string,enabled:boolean)=>{events.push('registry');setEnabled(name,enabled)};
    const result=await reconcile(writer,registry,async name=>{
     events.push('notification');
     assert.equal(name,id);
     assert.equal(await stored(id),true);
     assert.equal((await reader.observe()).revision,(BigInt(ref.revision)+1n).toString());
     assert.equal(registry.catalog().find((item:{id:string})=>item.id===id).configuredEnabled,true);
    },ref,id,true);
    assert.deepEqual(events,['registry','notification']);
    assert.equal(result.status,'committed_reconciled');
    assert.equal(result.authorizationState,'unavailable');
    assert.equal(result.readiness.state,'synchronized');
    if(result.readiness.state==='synchronized')assert.equal(result.readiness.effectiveEnabled,false);
   });

   await c.test('registry update failure leaves SQL committed and memory stale',async()=>{
    const id='r3cc-registry-failure',registry=registryFor(id),ref=await reader.observe();
    registry.setEnabled=()=>{throw new Error('private registry detail')};
    let notifications=0;
    const result=await reconcile(writer,registry,()=>{notifications++},ref,id,false);
    assert.equal(result.status,'committed_local_stale');
    assert.equal('reason' in result&&result.reason,'registry_update_failed');
    assert.equal(result.readiness.state,'stale');
    assert.equal(await stored(id),false);
    assert.equal((await reader.observe()).revision,(BigInt(ref.revision)+1n).toString());
    assert.equal(registry.isEnabled(id),true);
    assert.equal(notifications,0);
   });

   await c.test('notification failure preserves committed state but does not report full reconciliation',async()=>{
    const id='r3cc-notification-failure',registry=registryFor(id),ref=await reader.observe();
    let notifications=0;
    const result=await reconcile(writer,registry,async()=>{
     notifications++;
     assert.equal(registry.isEnabled(id),false);
     assert.equal(await stored(id),false);
     throw new Error('private notification detail');
    },ref,id,false);
    assert.equal(result.status,'committed_local_stale');
    assert.equal('reason' in result&&result.reason,'notification_failed');
    assert.equal(registry.isEnabled(id),false);
    assert.equal(notifications,1);
   });

   await c.test('SQL failure confirms rollback without updating registry or notifying',async()=>{
    const id='r3cc-rollback',registry=registryFor(id),ref=await reader.observe();
    await admin.query("ALTER TABLE plugin_settings ADD CONSTRAINT r3cc_reject_fixture CHECK(plugin_id<>'r3cc-rollback')");
    let notifications=0;
    try{
     const result=await reconcile(writer,registry,()=>{notifications++},ref,id,false);
     assert.equal(result.status,'failed_rolled_back');
     assert.equal(await stored(id),undefined);
     assert.deepEqual(await reader.observe(),ref);
     assert.equal(registry.isEnabled(id),true);
     assert.equal(notifications,0);
    }finally{await admin.query('ALTER TABLE plugin_settings DROP CONSTRAINT r3cc_reject_fixture')}
   });

   await c.test('uncertain commit skips memory and notification, then a fresh read can observe persisted state',async()=>{
    const id='r3cc-uncertain',registry=registryFor(id),ref=await reader.observe();
    let commits=0,notifications=0;
    const uncertain=new Repository({async connect(){
     const client=await writerPool.connect();
     return {async query(sql,parameters){
      const result=await client.query(sql,parameters);
      if(sql==='COMMIT'){commits++;throw new Error('fixture loses COMMIT reply')}
      return result;
     },release(discard){client.release(discard)}};
    }});
    const result=await reconcile(uncertain,registry,()=>{notifications++},ref,id,false);
    assert.equal(result.status,'commit_uncertain');
    assert.equal(result.readiness.state,'unknown');
    assert.equal(commits,1);
    assert.equal(notifications,0);
    assert.equal(registry.isEnabled(id),true);
    assert.equal(await stored(id),false);
    assert.equal((await reader.observe()).revision,(BigInt(ref.revision)+1n).toString());
   });

   await c.test('a missing rollback acknowledgement is distinguished from a confirmed rollback',async()=>{
    const id='r3cc-rollback-unconfirmed',registry=registryFor(id),ref=await reader.observe();
    let discarded=false;
    const noAcknowledgement=new Repository({async connect(){
     const client=await writerPool.connect();
     return {async query(sql,parameters){
      if(sql.startsWith('INSERT INTO plugin_settings'))throw new Error('fixture failure before commit');
      const result=await client.query(sql,parameters);
      if(sql==='ROLLBACK')throw new Error('fixture loses ROLLBACK reply');
      return result;
     },release(discard){discarded=discard===true;client.release(discard)}};
    }});
    const result=await reconcile(noAcknowledgement,registry,()=>assert.fail('failure must not notify'),ref,id,false);
    assert.equal(result.status,'failed_unconfirmed');
    assert.equal(discarded,true);
    assert.equal(registry.isEnabled(id),true);
    assert.equal(await stored(id),undefined);
    assert.deepEqual(await reader.observe(),ref);
   });

   await c.test('one CAS succeeds and only that writer applies post-COMMIT effects',async()=>{
    const id='r3cc-concurrent',registry=registryFor(id),otherRegistry=registryFor(id),ref=await reader.observe();
    const pinned=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
    const holder=new Repository(connectPool('r3cc_holder'));
    const holding=holder.withPinned(ref,async()=>{pinned.resolve();await release.promise});
    await pinned.promise;
    let notifications=0;
    const attempts=[
     reconcile(writer,registry,()=>{notifications++},ref,id,false),
     reconcile(reader,otherRegistry,()=>{notifications++},ref,id,false),
    ];
    try{
     const deadline=Date.now()+2500;
     for(;;){
      const {rows}=await admin.query(`SELECT application_name FROM pg_stat_activity
       WHERE application_name IN ('r3ca_reader','r3ca_writer') AND cardinality(pg_blocking_pids(pid))>0`);
      if(new Set(rows.map((row:{application_name:string})=>row.application_name)).size===2)break;
      assert.ok(Date.now()<deadline,'both writers must be waiting on the generation');
      await delay(10);
     }
    }finally{
     release.resolve();
     await Promise.allSettled([holding,...attempts]);
    }
    const results=await Promise.all(attempts);
    assert.deepEqual(results.map(r=>r.status).sort(),['committed_reconciled','rejected']);
    const declined=results.find(r=>r.status==='rejected');
    assert.ok(declined&&'reason' in declined);
    assert.equal(declined.reason,'editorial_generation_conflict');
    assert.equal(notifications,1);
    assert.equal([registry,otherRegistry].filter(r=>r.isEnabled(id)===false).length,1);
   });

   await c.test('verification detects legacy SQL drift even when the generation still agrees',async()=>{
    const id='r3cc-legacy',registry=registryFor(id),ref=await reader.observe();
    const result=await reconcile(writer,registry,async()=>{
     await admin.query('UPDATE plugin_settings SET enabled=true WHERE plugin_id=$1',[id]);
    },ref,id,false);
    assert.equal(result.status,'committed_local_stale');
    assert.equal('reason' in result&&result.reason,'verification_failed');
    assert.equal(registry.isEnabled(id),false);
    assert.equal(await stored(id),true);
    assert.equal((await reader.observe()).revision,(BigInt(ref.revision)+1n).toString());
    assert.equal(result.authorizationState,'unavailable');
   });

   await c.test('last board view, hidden plugins and invalid values are rejected before local effects',async()=>{
    await admin.query(`INSERT INTO plugin_settings(plugin_id,enabled) VALUES ('structured-view',false),('board-view',true)
     ON CONFLICT(plugin_id) DO UPDATE SET enabled=EXCLUDED.enabled`);
    const registry=registryFor('board-view'),ref=await reader.observe();
    const notify=()=>assert.fail('a rejection must not notify');
    const last=await reconcile(writer,registry,notify,ref,'board-view',false);
    assert.equal(last.status,'rejected');
    assert.equal('reason' in last&&last.reason,'required_board_view');
    assert.equal(await stored('board-view'),true);
    const invalid=await reconcile(writer,registry,notify,ref,'board-view','invalid' as unknown as boolean);
    assert.equal(invalid.status,'rejected');
    registry.setInstalled('board-view',false);
    const hidden=await reconcile(writer,registry,notify,ref,'board-view',false);
    assert.equal(hidden.status,'rejected');
    assert.deepEqual(await reader.observe(),ref);
   });
  });

  await t.test('07D-R3C-D local recovery observes SQL and treats events only as hints',async d=>{
   await admin.query(await readFile('forge/app/apps/api/sql/migrations/024_plugin_settings.sql','utf8'));
   const {PluginRegistry}=require('./apps/api/src/execution/registries.ts');
   const make=()=>{
    const registry=new PluginRegistry();
    registry.register({id:'r3cd-plugin',name:'Recovery fixture',version:'1.0.0'});
    return registry;
   };
   const id='r3cd-plugin';
   const setSql=async(enabled:boolean|null)=>{
    if(enabled===null)await admin.query('DELETE FROM plugin_settings WHERE plugin_id=$1',[id]);
    else await admin.query('INSERT INTO plugin_settings(plugin_id,enabled) VALUES($1,$2) ON CONFLICT(plugin_id) DO UPDATE SET enabled=EXCLUDED.enabled',[id,enabled]);
   };
   const local=(registry:InstanceType<typeof PluginRegistry>)=>registry.catalog().find((item:{id:string})=>item.id===id).configuredEnabled;
   const ref=await reader.observe();
   await d.test('restart reconstructs state, including default for absent row, without replaying a write',async()=>{
    const registry=make();
    await setSql(null);
    const result=await recover(reader,registry,id);
    assert.equal(result.status,'reconciled_observed');
    assert.equal(local(registry),true);
    assert.equal(result.generation?.revision,ref.revision);
    const absent=await admin.query('SELECT 1 FROM plugin_settings WHERE plugin_id=$1',[id]);
    assert.equal(absent.rowCount,0);
   });
   await d.test('duplicate and out-of-order notifications reread SQL instead of applying payload',async()=>{
    const registry=make();
    await setSql(false);
    const first=await recover(reader,registry,id,{id,enabled:false,generation:'old'});
    assert.equal(first.status,'reconciled_observed');
    assert.equal(local(registry),false);
    await setSql(true); // Legacy writer demonstrates notification-free drift.
    const duplicate=await recover(reader,registry,id,{id,enabled:false,generation:ref.revision});
    const older=await recover(reader,registry,id,{id,enabled:false,generation:'0'});
    assert.equal(duplicate.status,'reconciled_observed');
    assert.equal(older.status,'reconciled_observed');
    assert.equal(local(registry),true);
    assert.equal(duplicate.generation?.revision,older.generation?.revision);
   });
   await d.test('read failure and registry update failure stay conservative',async()=>{
    const registry=make(),before=local(registry);
    const offline=new Repository({connect:async()=>{throw new Error('offline')}});
    assert.equal((await recover(offline,registry,id)).status,'unknown');
    registry.setEnabled=()=>{throw new Error('local failure')};
    await setSql(false);
    const result=await recover(reader,registry,id);
    assert.equal(result.status,'stale');
    assert.equal(local(registry),before);
    assert.equal(result.authorizationState,'unavailable');
   });
   await d.test('an uncertain COMMIT is resolved only by a fresh SQL observation',async()=>{
    const idRef=await reader.observe();
    const uncertain=new Repository({async connect(){
     const client=await writerPool.connect();
     return {async query(sql:string,parameters?:unknown[]){
      const result=await client.query(sql,parameters);
      if(sql==='COMMIT')throw new Error('lost COMMIT reply');
      return result;
     },release(discard?:boolean){client.release(discard)}};
    }});
    await assert.rejects(writeEditorialPluginSetting(uncertain,idRef,id,false),{code:'editorial_generation_commit_uncertain'});
    const registry=make();
    const result=await recover(reader,registry,id);
    assert.equal(result.status,'reconciled_observed');
    assert.equal(local(registry),false);
    assert.equal((await admin.query('SELECT enabled FROM plugin_settings WHERE plugin_id=$1',[id])).rows[0]?.enabled,false);
   });
   await d.test('hidden plugins and plugins with unavailable dependencies are not reconciled',async()=>{
    const hidden=make();hidden.setInstalled(id,false);
    assert.equal((await recover(reader,hidden,id)).status,'unavailable');
    const registry=new PluginRegistry();
    registry.register({id:'r3cd-parent',name:'Parent fixture',version:'1.0.0'});
    registry.register({id,name:'Recovery fixture',version:'1.0.0',dependencies:['r3cd-parent']});
    registry.setEnabled('r3cd-parent',false);
    await setSql(null);
    const result=await recover(reader,registry,id);
    assert.equal(result.status,'unavailable');
    assert.equal(result.reason,'dependency_unavailable');
    assert.equal(registry.catalog().find((item:{id:string})=>item.id===id).configuredEnabled,true);
   });
   await d.test('overlapping local recoveries are serialized per repository and plugin',async()=>{
    const registry=make();let localWrites=0;
    const setEnabled=registry.setEnabled.bind(registry);
    registry.setEnabled=(name:string,enabled:boolean)=>{localWrites++;setEnabled(name,enabled)};
    await setSql(false);
    const results=await Promise.all([recover(reader,registry,id),recover(reader,registry,id)]);
    assert.deepEqual(results.map(result=>result.status),['reconciled_observed','reconciled_observed']);
    assert.equal(localWrites,1);
    assert.equal(local(registry),false);
   });
   await d.test('a failure during the second observation remains unknown after local update',async()=>{
    const registry=make();await setSql(false);
    let reads=0;
    const failing=new Repository({async connect(){
     const client=await readerPool.connect();
     return {async query(sql:string,parameters?:unknown[]){
      if(sql.includes('FROM plugin_settings')&&++reads===2)throw new Error('source lost after local effect');
      return client.query(sql,parameters);
     },release(discard?:boolean){client.release(discard)}};
    }});
    const result=await recover(failing,registry,id);
    assert.equal(result.status,'unknown');
    assert.equal(result.reason,'source_unavailable');
    assert.equal(local(registry),false);
   });
   await d.test('generation does not verify software or protect a legacy write during recovery',async()=>{
    const registry=make(),first=Promise.withResolvers<void>(),continueRead=Promise.withResolvers<void>();
    registry.setEnabled(id,false);
    await setSql(true);
    const observe=reader.observePluginSetting.bind(reader);
    const readyToApply=Promise.withResolvers<void>(),allowApply=Promise.withResolvers<void>();
    let reads=0;
    reader.observePluginSetting=async name=>{
     const state=await observe(name);
     if(++reads===1){first.resolve();await continueRead.promise}
     return state;
    };
    const setEnabled=registry.setEnabled.bind(registry);
    registry.setEnabled=async(name:string,enabled:boolean)=>{
     readyToApply.resolve();
     await allowApply.promise;
     setEnabled(name,enabled);
    };
    const pending=recover(reader,registry,id);
    await first.promise;
    await setSql(false);
    continueRead.resolve();
    await readyToApply.promise;
    await new Promise(resolve=>setImmediate(resolve));
    allowApply.resolve();
    const result=await pending;
    assert.equal(result.status,'stale');
    assert.equal(result.reason,'configuration_mismatch');
    assert.equal(registry.catalog().find((item:{id:string})=>item.id===id).configuredEnabled,true);
    assert.equal(result.authorizationState,'unavailable');
   });
  });
  await t.test('07D-R5-PRE separates SQL logins and fences the legacy writer',async s=>{
   const database='r5pre';
   const owner='r5_owner',legacy='r5_app',config='r5_writer',read='r5_reader';
   const logins=[owner,legacy,config,read];
   for(const role of logins){
    await admin.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
   }
   await admin.query(`CREATE DATABASE ${database} OWNER ${owner}`);
   const [migrationPool,appPool,configPool,readPool]=logins.map(role=>connectPool(role,database,role));
   for(const [i,pool] of [migrationPool,appPool,configPool,readPool].entries()){
    const {rows}=await pool.query('SELECT current_user AS effective, session_user AS login');
    assert.deepEqual(rows,[{effective:logins[i],login:logins[i]}]);
   }
   const settings='plugin_settings',installations='plugin_installations',gen='editorial_authorization_generation';
   const tables=[settings,installations,gen];
   const sqlDir='forge/app/apps/api/sql/migrations';
   const migrations=await Promise.all([
    readFile(`${sqlDir}/024_plugin_settings.sql`,'utf8'),
    readFile(`${sqlDir}/142_optional_plugin_installations.sql`,'utf8'),
   ]);
   await migrationPool.query(['BEGIN',...migrations,ddl,'COMMIT'].join(';\n'));
   await migrationPool.query(`
    REVOKE ALL ON SCHEMA public FROM PUBLIC;
    REVOKE CONNECT, TEMPORARY ON DATABASE ${database} FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION orbit_editorial_generation_guard() FROM PUBLIC;
    GRANT CONNECT ON DATABASE ${database} TO ${legacy},${config},${read};
    GRANT USAGE ON SCHEMA public TO ${legacy},${config},${read};
    GRANT SELECT ON ${settings},${installations} TO ${legacy},${read};
    GRANT SELECT ON ${gen} TO ${read},${config};
    GRANT SELECT (plugin_id,enabled), INSERT (plugin_id,enabled), UPDATE (enabled,updated_at) ON ${settings} TO ${config};
    GRANT UPDATE (revision) ON ${gen} TO ${config};
   `);
   const restricted=new Repository(configPool);
   const observed=async()=> (await readPool.query(`SELECT domain_id,revision::text,authorization_state FROM ${gen}`)).rows[0];
   const setting=async(id:string)=> (await readPool.query(`SELECT enabled FROM ${settings} WHERE plugin_id=$1`,[id])).rows[0]?.enabled;
   const denied={code:'42501'};

   await s.test('effective ACLs deny legacy and reader writes and role elevation',async()=>{
    const {rows}=await migrationPool.query(`
     SELECT c.relname,pg_get_userbyid(c.relowner) AS owner,
       EXISTS (SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0) AS public_grant
     FROM pg_class c WHERE c.oid IN ($1::regclass,$2::regclass,$3::regclass) ORDER BY c.relname`,tables);
    assert.deepEqual(rows,tables.slice().sort().map(relname=>({relname,owner,public_grant:false})));
    const {rows:[acl]}=await migrationPool.query(`
     SELECT NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member IN
       (SELECT oid FROM pg_roles WHERE rolname=ANY($1::text[]))) AS no_membership,
     NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=ANY($1::text[]) AND
       (rolinherit OR rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)) AS restricted_roles,
     NOT EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
       WHERE p.oid='orbit_editorial_generation_guard()'::regprocedure AND a.grantee=0) AS private_guard`,[logins.slice(1)]);
    assert.deepEqual(acl,{no_membership:true,restricted_roles:true,private_guard:true});
    for(const pool of [appPool,readPool,configPool]){
     await assert.rejects(pool.query(`SET ROLE ${owner}`),denied);
     if(pool!==configPool)await assert.rejects(pool.query(`SET ROLE ${config}`),denied);
     await assert.rejects(pool.query(`ALTER TABLE ${gen} DISABLE TRIGGER editorial_generation_update_guard`),denied);
     await assert.rejects(pool.query(`ALTER TABLE ${settings} ADD COLUMN r5_unauthorized boolean`),denied);
     await assert.rejects(pool.query('SET session_replication_role=replica'),denied);
     const {rows:[schema]}=await pool.query(`SELECT has_schema_privilege(current_user,'public','CREATE') AS can_create,
       has_database_privilege(current_user,current_database(),'TEMPORARY') AS can_create_temp`);
     assert.deepEqual(schema,{can_create:false,can_create_temp:false});
     for(const table of tables){
      const {rows:[row]}=await pool.query("SELECT has_table_privilege(current_user,$1,'UPDATE WITH GRANT OPTION') AS can_grant, has_any_column_privilege(current_user,$1,'UPDATE WITH GRANT OPTION') AS column_grant",[table]);
      assert.deepEqual(row,{can_grant:false,column_grant:false});
     }
    }
    const settingsAcl=async()=> (await migrationPool.query(
     'SELECT relacl::text AS acl FROM pg_class WHERE oid=$1::regclass',[settings])).rows;
    const before=await settingsAcl();
    await appPool.query(`GRANT UPDATE ON ${settings} TO ${read}`).catch((error:{code:string})=>assert.equal(error.code,'42501'));
    assert.deepEqual(await settingsAcl(),before);
    for(const pool of [appPool,readPool]){
     assert.equal((await pool.query(`SELECT enabled FROM ${settings} WHERE plugin_id='vault'`)).rows[0].enabled,true);
     await pool.query(`SELECT installed FROM ${installations}`);
     for(const sql of [
      `INSERT INTO ${settings}(plugin_id,enabled) VALUES('vault',false) ON CONFLICT(plugin_id) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()`,
      `UPDATE ${settings} SET enabled=false`, `DELETE FROM ${settings}`, `TRUNCATE ${settings}`,
      `UPDATE ${installations} SET installed=false`, `UPDATE ${gen} SET revision=revision+1`,
     ])await assert.rejects(pool.query(sql),denied);
    }
    await assert.rejects(readPool.query(`SELECT revision FROM ${gen} FOR SHARE`),denied);
    await assert.rejects(writeEditorialPluginSetting(new Repository(appPool),await restricted.observe(),'vault',false),
     {code:'editorial_generation_operation_failed',rollbackConfirmed:true});
    assert.equal(await setting('vault'),true);
    assert.equal((await observed()).revision,'0');
   });

   await s.test('restricted writer takes generation then advisory lock and advances exactly once',async()=>{
    const ref=await restricted.observe();
    const holder=await migrationPool.connect();
    await holder.query('BEGIN');
    await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('orbit.required-board-view',0))");
    const attempts=[
     writeEditorialPluginSetting(restricted,ref,'board-view',false),
     writeEditorialPluginSetting(restricted,ref,'structured-view',false),
    ];
    const settled=Promise.allSettled(attempts);
    try{
     const deadline=Date.now()+2500;
     for(;;){
      const {rows}=await admin.query(`SELECT wait_event FROM pg_stat_activity
       WHERE datname=$1 AND usename=$2 AND wait_event_type='Lock'`,[database,config]);
      const waits=rows.map((row:{wait_event:string})=>row.wait_event);
      if(waits.includes('advisory')&&waits.includes('transactionid'))break;
      assert.ok(Date.now()<deadline,'expected advisory and generation waits on independent connections');
      await delay(10);
     }
     assert.equal((await observed()).revision,ref.revision);
     assert.equal(await setting('board-view'),undefined);
     assert.equal(await setting('structured-view'),undefined);
    }finally{
     try{await holder.query('ROLLBACK')}finally{holder.release();await settled}
    }
    const outcomes=await settled;
    assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(outcomes.find(result=>result.status==='rejected')?.reason.code,'editorial_generation_conflict');
    const ref2=await restricted.observe();
    assert.equal(ref2.revision,'1');
    assert.equal(ref2.authorizationState,'unavailable');
    const remaining=(await setting('board-view'))===false?'structured-view':'board-view';
    assert.equal(await setting(remaining),undefined);
    assert.equal(await setting(remaining==='board-view'?'structured-view':'board-view'),false);
    await assert.rejects(writeEditorialPluginSetting(restricted,ref2,remaining,false),RequiredBoardViewError);
   });

   await s.test('failed generation update rolls back the upsert and original guards remain active',async()=>{
    const ref=await restricted.observe();
    await migrationPool.query(`ALTER TABLE ${gen} ADD CONSTRAINT r5_stop_increment CHECK(revision < 2)`);
    try{
     await assert.rejects(writeEditorialPluginSetting(restricted,ref,'vault',false),
      {code:'editorial_generation_operation_failed',rollbackConfirmed:true});
     assert.equal(await setting('vault'),true);
     assert.deepEqual(await restricted.observe(),ref);
    }finally{await migrationPool.query(`ALTER TABLE ${gen} DROP CONSTRAINT r5_stop_increment`)}
    for(const sql of [
     `UPDATE ${gen} SET revision=revision+2`, `UPDATE ${gen} SET revision=-1`,
    ])await assert.rejects(configPool.query(sql),{code:'23514'});
    for(const sql of [
     `UPDATE ${gen} SET authorization_state='verified'`,`DELETE FROM ${gen}`,`TRUNCATE ${gen}`,
     `DELETE FROM ${settings}`,`TRUNCATE ${settings}`,`UPDATE ${installations} SET installed=false`,
    ])await assert.rejects(configPool.query(sql),denied);
    await assert.rejects(migrationPool.query(`UPDATE ${gen} SET authorization_state='verified'`),{code:'23514'});
    await assert.rejects(migrationPool.query(`TRUNCATE ${gen}`),{code:'23514'});
    const {rows:guards}=await migrationPool.query(`SELECT tgname FROM pg_trigger
     WHERE tgrelid=$1::regclass AND tgenabled='O' ORDER BY tgname`,[gen]);
    assert.deepEqual(guards,[{tgname:'editorial_generation_no_truncate'},{tgname:'editorial_generation_update_guard'}]);
    assert.deepEqual(await restricted.observe(),ref);
   });
   await s.test('07D-R5A DEV toggle through real host authorization',async dev=>{
    const {exerciseDevPluginSettingToggle}=require('./experimental/plugin-setting-toggle.postgres-fixture.ts');
    await exerciseDevPluginSettingToggle(dev,migrationPool,appPool,configPool,readPool,admin);
   });
  });
 }finally{
  try{await Promise.all(pools.map(pool=>pool.end()))}
  finally{
   if(started)run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);
   await rm(root,{recursive:true,force:true});
  }
 }
});
