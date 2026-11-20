import {DiscoveryEditorialPolicyStore} from './discovery-editorial-policy-store';
import {EditorialConditionsResolver,EditorialSourceError,editorialPolicyHash,editorialEvidenceHash,type EditorialConditions,type EditorialSourceAuthority} from './discovery-review-sources';
import {hashContextValue} from './context-manifest';
import {discoveryReviewAccessHost} from './discovery-review-access-host';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir,userInfo} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {DiscoveryReviewApplication,DiscoveryReviewApplicationError,discoveryReviewHttpError,type DiscoveryReviewHost} from './discovery-review-application';
import {DiscoveryReviewRepository,type DiscoveryReviewOrigin} from './discovery-review-repository';
import {DiscoveryJournalRepository,discoveryProposalHash,type DiscoveryBinding,type DiscoverySubmission} from './discovery-journal-repository';
import {type DiscoveryReviewCommand,type DiscoveryReviewPolicy} from './discovery-review';
const require=createRequire(join(process.cwd(),'forge/app/package.json'));
const {Pool}=require('pg');
const bin='/usr/lib/postgresql/16/bin';
const policy:DiscoveryReviewPolicy={schemaVersion:1,minimumReviewRevision:1,requiredEvidenceCompatibility:['compatible'],allowIneligibleApproval:false};
const command=(action:DiscoveryReviewCommand['action'],rev:number,extra:Partial<DiscoveryReviewCommand>={}):DiscoveryReviewCommand=>({action,expectedReviewRevision:rev,reviewerId:'attributed-editor',reason:'Human editorial assessment.',recordedAt:'2026-11-17T12:00:00.000Z',idempotencyKey:randomUUID(),...extra});

test('07D-B PostgreSQL disposable cluster: transactions, history and concurrency',{timeout:120000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'orbit-review07db-'));let started=false;let pool:any;
 try{
  execFileSync(join(bin,'initdb'),['-D',join(root,'data'),'-A','trust','--no-locale','-E','UTF8'],{stdio:'pipe',timeout:15000});
  execFileSync(join(bin,'pg_ctl'),['-D',join(root,'data'),'-l',join(root,'postgres.log'),'-o',`-k ${root} -p 55439 -c listen_addresses=''`,'-w','start'],{stdio:'pipe',timeout:15000});started=true;
  const config={host:root,port:55439,database:'postgres',user:userInfo().username,max:8,options:'-c lock_timeout=2000 -c statement_timeout=5000 -c idle_in_transaction_session_timeout=15000'};pool=new Pool(config);
  const {rows:[target]}=await pool.query("SELECT current_database() db,inet_server_addr() IS NULL local_socket,current_setting('data_directory') data_directory");
  assert.deepEqual(target,{db:'postgres',local_socket:true,data_directory:join(root,'data')});
  // Only prerequisite tables touched by 209. Actual Journal and Review migrations run unchanged.
  await pool.query(`CREATE TABLE context_run_manifests(id uuid primary key,runtime_id text,project_id uuid,workspace_id uuid,actor_id uuid,card_id uuid,card_revision bigint,queue text,run_id uuid,turn int,fingerprint text);
   CREATE TABLE cards(id uuid primary key,card_revision bigint);
   CREATE TABLE card_runs(id uuid primary key,user_id uuid,project_id uuid,card_id uuid,card_revision bigint,status text,worker_id text,cancel_requested boolean);
   CREATE TABLE card_ai_runs(LIKE card_runs INCLUDING ALL);
   CREATE FUNCTION orbit_context_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable evidence' USING ERRCODE='23514';END;$$;`);
  await pool.query(await readFile('packages/orbit-core/sql/migrations/209_discovery_journal.sql','utf8'));
  await pool.query(await readFile('packages/orbit-core/sql/migrations/210_discovery_review.sql','utf8'));
  await pool.query(await readFile('packages/orbit-core/sql/migrations/211_discovery_editorial_policies.sql','utf8'));
  const seed=async(queue:DiscoveryReviewOrigin['queue']='card_runs')=>{
   const b:DiscoveryBinding={runtimeId:'dev',projectId:randomUUID(),workspaceId:null,actorId:randomUUID(),cardId:randomUUID(),cardRevision:1,queue,runId:randomUUID(),turn:0,manifestId:randomUUID(),contextFingerprint:'a'.repeat(64),workerId:'test:review'};
   await pool.query('INSERT INTO cards VALUES($1,1)',[b.cardId]);
   await pool.query(`INSERT INTO ${queue}(id,user_id,project_id,card_id,card_revision,status,worker_id,cancel_requested) VALUES($1,$2,$3,$4,1,'running',$5,false)`,[b.runId,b.actorId,b.projectId,b.cardId,b.workerId]);
   await pool.query('INSERT INTO context_run_manifests VALUES($1,$2,$3,NULL,$4,$5,1,$6,$7,0,$8)',[b.manifestId,b.runtimeId,b.projectId,b.actorId,b.cardId,queue,b.runId,b.contextFingerprint]);
   const proposal={category:'technical_observation' as const,statement:'Fixture proposed observation.',evidence:[]};
   const s:DiscoverySubmission={submissionKey:'b'.repeat(64),artifactId:'output:0',artifactHash:'c'.repeat(64),origin:'structured_output',executor:'fixture',policy:{schemaVersion:1,id:'orbit-discovery-capture/1',retention:'explicit_admin_policy',textHandling:'review_required',maxProposals:8,maxStatementBytes:2048},proposals:[{...proposal,proposalHash:discoveryProposalHash(proposal)}]};
   const captured=await new DiscoveryJournalRepository(pool).capture(b,s);
   return {discoveryId:captured.records[0].id,queue};
  };
  const repo=new DiscoveryReviewRepository(pool),compatible=new DiscoveryReviewRepository(pool,async()=> 'compatible');
  await t.test('07D-R2 PostgreSQL defaults and restricted principals preserve the editorial boundary',async()=>{
   const tables=[
    'discovery_journal_captures','discovery_journal_entries','discovery_review_decisions',
    'discovery_editorial_policy_versions','discovery_editorial_policy_events',
   ];
   const db=await pool.connect();
   try{
    await db.query('BEGIN');
    await db.query('CREATE ROLE orbit_r2_reader NOLOGIN; CREATE ROLE orbit_r2_member NOLOGIN IN ROLE orbit_r2_reader');
    const owners=await db.query(
     'SELECT relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned FROM pg_class WHERE oid IN (SELECT unnest($1::regclass[]))',
     [tables],
    );
    assert.deepEqual(owners.rows,tables.map(()=>({owned:true})));
    const publicTableGrants=await db.query(
     'SELECT c.relname FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl WHERE c.oid IN (SELECT unnest($1::regclass[])) AND acl.grantee=0',
     [tables],
    );
    assert.deepEqual(publicTableGrants.rows,[]);
    await db.query(`GRANT SELECT ON ${tables.join(',')} TO orbit_r2_reader`);
    await db.query('SET LOCAL ROLE orbit_r2_member');
    const capture='orbit_discovery_capture(jsonb,jsonb,text)';
    const capability=await db.query(
     "SELECT has_function_privilege(current_user,$1,'EXECUTE') AS executable, prosecdef FROM pg_proc WHERE oid=$1::regprocedure",
     [capture],
    );
    // PUBLIC has EXECUTE by default, but this invoker function cannot lend table privileges.
    assert.deepEqual(capability.rows,[{executable:true,prosecdef:false}]);
    for(const table of tables){
     await db.query(`SELECT * FROM ${table} LIMIT 0`);
     for(const sql of [`INSERT INTO ${table} DEFAULT VALUES`,`DELETE FROM ${table} WHERE false`,`TRUNCATE ${table}`]){
      await db.query('SAVEPOINT denied');
      await assert.rejects(db.query(sql),{code:'42501'});
      await db.query('ROLLBACK TO SAVEPOINT denied');
     }
     const column=table==='discovery_review_decisions'?'state':table.startsWith('discovery_editorial_policy')?'version':'id';
     await db.query('SAVEPOINT denied_update');
     await assert.rejects(db.query(`UPDATE ${table} SET ${column}=${column} WHERE false`),{code:'42501'});
     await db.query('ROLLBACK TO SAVEPOINT denied_update');
    }
    await db.query('RESET ROLE');
    await db.query(`REVOKE EXECUTE ON FUNCTION ${capture} FROM PUBLIC`);
    await db.query('SET LOCAL ROLE orbit_r2_member');
    await assert.rejects(db.query("SELECT orbit_discovery_capture('{}','{}','invalid')"),{code:'42501'});
    await db.query('ROLLBACK');
    await db.query('BEGIN');
    await db.query(`CREATE ROLE orbit_r2_capture NOLOGIN;
     REVOKE EXECUTE ON FUNCTION ${capture} FROM PUBLIC;
     GRANT EXECUTE ON FUNCTION ${capture} TO orbit_r2_capture;
     SET LOCAL ROLE orbit_r2_capture`);
    await assert.rejects(db.query("SELECT orbit_discovery_capture('{}','{}','invalid')"),{code:'23514'});
   }finally{await db.query('ROLLBACK');db.release()}
  });
  await t.test('07D-R2 a separate fixture writer remains subject to SQL guards but role does not authenticate reviewer',async()=>{
   const o=await seed();
   await pool.query(`CREATE ROLE orbit_r2_writer LOGIN;
    GRANT SELECT ON discovery_journal_captures,discovery_journal_entries,discovery_review_decisions TO orbit_r2_writer;
    GRANT INSERT ON discovery_review_decisions TO orbit_r2_writer`);
   const writerPool=new Pool({...config,user:'orbit_r2_writer'});
   try{
    const writerRepo=new DiscoveryReviewRepository(writerPool);
    const attribution='fixture-editor-attribution';
    const c=command('start_review',0,{reviewerId:attribution});
    assert.equal((await writerRepo.record(o,c,policy)).decision.reviewerId,attribution);
    assert.equal((await writerRepo.record(o,c,policy)).duplicate,true);
    await assert.rejects(writerRepo.record(o,command('start_review',0),policy),{code:'review_conflict'});
    assert.equal((await writerRepo.history(o)).length,1);
    await assert.rejects(writerPool.query(
     `INSERT INTO discovery_review_decisions
      SELECT discovery_id,queue,99,98,state,action,idempotency_key,request_hash,command,decision,evidence_compatibility,policy,persisted_at
      FROM discovery_review_decisions WHERE discovery_id=$1`,[o.discoveryId],
    ),{code:'PDR01'});
    await assert.rejects(writerPool.query('ALTER TABLE discovery_review_decisions DISABLE TRIGGER discovery_review_immutable'),{code:'42501'});
   }finally{await writerPool.end()}
  });
  await t.test('07D-R2 a non-superuser owner can change trigger enforcement',async()=>{
   const db=await pool.connect();
   try{
    await db.query('BEGIN');
    await db.query(`CREATE ROLE orbit_r2_owner NOLOGIN NOSUPERUSER;
     ALTER TABLE discovery_review_decisions OWNER TO orbit_r2_owner;
     SET LOCAL ROLE orbit_r2_owner`);
    await db.query('ALTER TABLE discovery_review_decisions DISABLE TRIGGER discovery_review_immutable');
    const {rows}=await db.query(`SELECT tgenabled FROM pg_trigger
     WHERE tgrelid='discovery_review_decisions'::regclass AND tgname='discovery_review_immutable'`);
    assert.deepEqual(rows,[{tgenabled:'D'}]);
   }finally{await db.query('ROLLBACK');db.release()}
  });
  const origin=await seed();
  await t.test('initial state without decisions is proposed, unassessed and ineligible',async()=>{
   const s=await repo.current(origin,policy);assert.equal(s.state,'proposed');assert.equal(s.reviewRevision,0);assert.equal(s.evidenceCompatibility,'unassessed');assert.equal(s.publicationEligibility,'ineligible');assert.deepEqual(await repo.history(origin),[]);
  });
  const first=command('start_review',0);let original:any;
  await t.test('first valid transition is persisted',async()=>{original=await repo.record(origin,first,policy);assert.equal(original.snapshot.state,'in_review');assert.equal(original.snapshot.reviewRevision,1)});
  await t.test('history is ordered and revision increases',async()=>{
   await repo.record(origin,command('request_information',1,{informationRequest:'Provide reference.'}),policy);
   assert.deepEqual((await repo.history(origin)).map(x=>x.decision.cas.nextRevision),[1,2]);assert.equal((await repo.current(origin,policy)).requestedInformation,'Provide reference.');
  });
  await t.test('old command duplicate wins over stale CAS and returns original decision',async()=>{const r=await repo.record(origin,first,policy);assert.equal(r.duplicate,true);assert.deepEqual(r.decision,original.decision);assert.equal(r.snapshot.reviewRevision,2)});
  await t.test('same key changed payload conflicts',async()=>{await assert.rejects(repo.record(origin,{...first,reason:'Changed'},policy),{code:'review_idempotency_conflict'})});
  await t.test('stale CAS fails',async()=>{await assert.rejects(repo.record(origin,command('start_review',0),policy),{code:'review_conflict'})});
  await t.test('different concurrent keys permit only one next revision',async()=>{
   const o=await seed();const r=await Promise.allSettled([repo.record(o,command('start_review',0),policy),repo.record(o,command('start_review',0),policy)]);
   assert.equal(r.filter(x=>x.status==='fulfilled').length,1);const failure=r.find(x=>x.status==='rejected') as PromiseRejectedResult;assert.equal(failure.reason.code,'review_conflict');assert.equal((await repo.history(o)).length,1);
  });
  await t.test('same concurrent key produces one decision and one duplicate',async()=>{
   const o=await seed('card_ai_runs'),c=command('start_review',0);const r=await Promise.all([repo.record(o,c,policy),repo.record(o,c,policy)]);
   assert.equal(r.filter(x=>x.duplicate).length,1);assert.deepEqual(r[0].decision,r[1].decision);assert.equal((await repo.history(o)).length,1);
  });
  await t.test('failure after insertion rolls back whole operation',async()=>{
   const o=await seed();
   await pool.query(`CREATE FUNCTION review_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.decision->>'reviewerId'='fail-after-insert' THEN RAISE EXCEPTION 'injected';END IF;RETURN NEW;END;$$; CREATE TRIGGER review_test_failure AFTER INSERT ON discovery_review_decisions FOR EACH ROW EXECUTE FUNCTION review_test_failure();`);
   await assert.rejects(repo.record(o,command('start_review',0,{reviewerId:'fail-after-insert'}),policy),{code:'review_persistence_failed'});
   assert.equal((await repo.current(o,policy)).reviewRevision,0);assert.deepEqual(await repo.history(o),[]);
   assert.equal((await repo.record(o,command('start_review',0),policy)).snapshot.reviewRevision,1);
  });
  await t.test('history resists UPDATE DELETE TRUNCATE and parent deletion',async()=>{
   for(const q of ['UPDATE discovery_review_decisions SET state=state WHERE discovery_id=$1','DELETE FROM discovery_review_decisions WHERE discovery_id=$1','DELETE FROM discovery_journal_entries WHERE id=$1'])await assert.rejects(pool.query(q,[origin.discoveryId]));
   await assert.rejects(pool.query('TRUNCATE discovery_review_decisions'));assert.equal((await repo.history(origin)).length,2);
  });
  await t.test('state and decisions survive reopening connections',async()=>{
   const before=await repo.history(origin);await pool.end();pool=new Pool(config);const reopened=new DiscoveryReviewRepository(pool);assert.deepEqual(await reopened.history(origin),before);assert.equal((await reopened.current(origin,policy)).reviewRevision,2);
  });
  await t.test('evidence defaults closed and changing assessments never rewrites decisions',async()=>{
   const o=await seed(),r=new DiscoveryReviewRepository(pool);await r.record(o,command('start_review',0),policy);await assert.rejects(r.record(o,command('approve',1),policy),{code:'review_evidence_incompatible'});
   const trusted=new DiscoveryReviewRepository(pool,async()=> 'compatible');await trusted.record(o,command('approve',1),policy);const history=await r.history(o);
   assert.equal((await trusted.current(o,policy)).publicationEligibility,'eligible');assert.equal((await r.current(o,policy)).publicationEligibility,'ineligible');assert.deepEqual(await r.history(o),history);
  });
  await t.test('07D-C3 versioned policy/evidence receipts persist without rewriting decisions',async()=>{
   const o=await seed(),project=(await pool.query('SELECT c.project_id FROM discovery_journal_entries e JOIN discovery_journal_captures c ON c.id=e.capture_id WHERE e.id=$1',[o.discoveryId])).rows[0].project_id;
   const scope={...o,runtimeId:'dev',projectId:project};
   const p={schemaVersion:1 as const,scope,status:'active' as const,validFrom:'2026-11-17T11:00:00.000Z',validUntil:'2026-11-17T13:00:00.000Z',policy};
   const e={schemaVersion:1 as const,scope,presence:'present' as const,compatibility:'compatible' as const,verifiedAt:'2026-11-17T11:59:00.000Z',validUntil:'2026-11-17T13:00:00.000Z'};
   let value:EditorialConditions={policy:{...p,reference:{sourceId:'fixture-policy',id:'approval',version:'1',hash:editorialPolicyHash(p)}},evidence:{...e,reference:{sourceId:'fixture-evidence',id:'assessment',version:'1',hash:editorialEvidenceHash(e)}}};
   await pool.query('CREATE TABLE review_test_conditions(payload jsonb); CREATE TABLE review_test_source_history(kind text,hash text,version text,payload jsonb,PRIMARY KEY(kind,hash,version))');
   await pool.query('INSERT INTO review_test_conditions VALUES($1)',[value]);
   const update=async()=>{
    for(const [kind,record] of [['policy',value.policy!],['evidence',value.evidence!]] as const)await pool.query('INSERT INTO review_test_source_history VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[kind,record.reference.hash,record.reference.version,record]);
    await pool.query('UPDATE review_test_conditions SET payload=$1',[value]);
   };await update();
   const authority:EditorialSourceAuthority={consistency:'postgresql_transaction',policySourceIds:['fixture-policy'],evidenceSourceIds:['fixture-evidence'],
    resolve:async db=>(await db.query('SELECT payload FROM review_test_conditions')).rows[0].payload,
    historical:async(db,ref,kind)=>(await db.query('SELECT payload FROM review_test_source_history WHERE kind=$1 AND hash=$2 AND version=$3',[kind,ref.hash,ref.version])).rows[0]?.payload??null,
    pinCurrent:async(db,expected)=>{const current=(await db.query('SELECT payload FROM review_test_conditions FOR SHARE')).rows[0].payload;if(hashContextValue(current)!==hashContextValue(expected))throw new EditorialSourceError('review_sources_changed')}
   };
   const resolver=new EditorialConditionsResolver(authority,()=>Date.parse('2026-11-17T12:00:00.000Z'));
   const sourceRepo=new DiscoveryReviewRepository(pool,undefined,undefined,(db)=>resolver.resolve(db,scope));
   await sourceRepo.record(o,command('start_review',0),null);
   await sourceRepo.record(o,command('approve',1),null);
   const original=await sourceRepo.history(o);assert.equal((await sourceRepo.current(o,null)).publicationEligibility,'eligible');
   assert.equal((original[1].policy as any).editorialProvenance.policy.reference.version,'1');
   value.policy!.reference.version='2';await update();
   assert.equal((await sourceRepo.current(o,null)).publicationEligibility,'ineligible');assert.deepEqual(await sourceRepo.history(o),original);
   value.evidence!.compatibility='incompatible';const {reference,...body}=value.evidence!;reference.hash=editorialEvidenceHash(body);await update();
   assert.equal((await sourceRepo.current(o,null)).evidenceCompatibility,'incompatible');assert.equal((await sourceRepo.current(o,null)).publicationEligibility,'ineligible');assert.deepEqual(await sourceRepo.history(o),original);
   const stale=structuredClone(value);stale.evidence!.validUntil='2026-11-17T11:59:59.000Z';const {reference:sr,...sb}=stale.evidence!;sr.hash=editorialEvidenceHash(sb);value=stale;await update();
   await assert.rejects(sourceRepo.record(o,command('withdraw_approval',2),null),{code:'review_evidence_stale'});assert.deepEqual(await sourceRepo.history(o),original);
   value={policy:(original[0].policy as any).editorialProvenance.policy,evidence:(original[0].policy as any).editorialProvenance.evidence};await update();
   let pins=0;const originalPin=authority.pinCurrent;
   authority.pinCurrent=async(db,conditions)=>{await originalPin(db,conditions);if(++pins===4)throw new EditorialSourceError('review_sources_changed')};
   await assert.rejects(sourceRepo.record(o,command('withdraw_approval',2),null),{code:'review_sources_changed'});
   assert.deepEqual(await sourceRepo.history(o),original);
   assert.equal(Object.hasOwn(original[1],'published'),false);
  });
  await t.test('07D-C5A persistent policy candidates remain inactive with immutable governance',async tt=>{
   const o=await seed();const project=(await pool.query('SELECT c.project_id FROM discovery_journal_entries e JOIN discovery_journal_captures c ON c.id=e.capture_id WHERE e.id=$1',[o.discoveryId])).rows[0].project_id;
   const scope={...o,runtimeId:'dev',projectId:project},store=new DiscoveryEditorialPolicyStore(pool);
   const input={id:'institution-candidate',version:'1',scope,policy,validFrom:'2026-11-17T11:00:00.000Z',validUntil:'2026-11-17T13:00:00.000Z',provenance:{origin:'test-submission',attributedActor:'unverified-attribution',reference:'fixture:proposal'}};
   let reference:any;
   await tt.test('empty source provides no active policy',async()=>{assert.equal(await store.current(pool,scope),null);assert.equal((await pool.query('SELECT count(*) FROM discovery_editorial_policy_versions')).rows[0].count,'0')});
   await tt.test('registration is versioned but neither approved nor active',async()=>{
    reference=await store.register(input);const result=await store.historical(pool,reference,scope);assert.equal(result?.governance,'registered');assert.equal(result?.record.status,'unavailable');assert.equal(result?.record.reference.hash,reference.hash);assert.equal(await store.current(pool,scope),null);
   });
   await tt.test('versions are unique and content plus complete references are verified',async()=>{
    await assert.rejects(store.register(input),{code:'review_policy_version_conflict'});
    const v2=await store.register({...input,version:'2',policy:{...policy,minimumReviewRevision:2}});assert.notEqual(v2.hash,reference.hash);
    assert.equal((await store.historical(pool,reference,scope))?.record.policy.minimumReviewRevision,1);
    assert.equal(await store.historical(pool,{...reference,version:'unknown'},scope),null);assert.equal(await store.historical(pool,{...reference,hash:'a'.repeat(64)},scope),null);
    await assert.rejects(store.historical(pool,reference,{...scope,projectId:randomUUID()}),{code:'review_policy_scope_invalid'});
    await assert.rejects(store.register({...input,id:'wrong-scope',scope:{...scope,projectId:randomUUID()}}),{code:'review_policy_store_failed'});
   });
   await tt.test('structural validation has its own append-only event',async()=>{
    await store.event(reference,scope,'content_validated','attributed-root','Schema checked, no institutional approval.');
    const result=await store.historical(pool,reference,scope);assert.equal(result?.governance,'content_validated');assert.equal(result?.events.length,1);assert.equal(result?.record.status,'unavailable');
    await assert.rejects(store.event(reference,scope,'content_validated','attributed-root','Repeat'),{code:'review_policy_governance_conflict'});
   });
   await tt.test('institutional approval and activation have no authority or SQL action',async()=>{
    await assert.rejects(store.approve(),{code:'review_policy_approval_authority_unavailable'});await assert.rejects(store.activate(),{code:'review_policy_activation_authority_unavailable'});await assert.rejects(store.pinActive(pool,reference,scope),{code:'review_policy_approval_authority_unavailable'});
    await assert.rejects(pool.query("INSERT INTO discovery_editorial_policy_events(source_id,policy_id,version,revision,action,attributed_actor,reason) VALUES($1,$2,$3,2,'activated','ROOT','force')",[reference.sourceId,reference.id,reference.version]));
   });
   await tt.test('history resists retroactive modification and destructive deletion',async()=>{
    for(const table of ['discovery_editorial_policy_versions','discovery_editorial_policy_events']){
     await assert.rejects(pool.query(`UPDATE ${table} SET version=version`));await assert.rejects(pool.query(`DELETE FROM ${table}`));await assert.rejects(pool.query(`TRUNCATE ${table} CASCADE`));
    }
    assert.equal((await store.historical(pool,reference,scope))?.events.length,1);
   });
   await tt.test('candidate pin coordinates concurrent revocation through parent lock',async()=>{
    const db=await pool.connect(),writer=await pool.connect();
    try{
     await db.query('BEGIN');await store.pinCandidate(db,reference,scope);
     await writer.query('BEGIN');await writer.query("SET LOCAL lock_timeout='100ms'");
     await assert.rejects(writer.query("INSERT INTO discovery_editorial_policy_events(source_id,policy_id,version,revision,action,attributed_actor,reason) VALUES($1,$2,$3,2,'revoked','attributed-actor','withdraw candidate')",[reference.sourceId,reference.id,reference.version]),{code:'55P03'});
     await writer.query('ROLLBACK');await db.query('COMMIT');
    }finally{await db.query('ROLLBACK');await writer.query('ROLLBACK');db.release();writer.release()}
    await store.event(reference,scope,'revoked','attributed-actor','Withdraw candidate');
    assert.equal((await store.historical(pool,reference,scope))?.governance,'revoked');
    assert.equal((await store.historical(pool,reference,scope))?.record.reference.hash,reference.hash);
    await assert.rejects(store.pinCandidate(pool,reference,scope),{code:'review_policy_unavailable'});
    await assert.rejects(store.event(reference,scope,'content_validated','actor','restore'),{code:'review_policy_governance_conflict'});
   });
   await tt.test('C3 rejects stored candidate as active policy even with matching origin',async()=>{
    const candidate=await store.historical(pool,reference,scope);
    const authority:EditorialSourceAuthority={consistency:'postgresql_transaction',policySourceIds:[reference.sourceId],evidenceSourceIds:[],resolve:async()=>({policy:candidate!.record,evidence:null}),historical:async()=>candidate!.record,pinCurrent:async()=>{}};
    await assert.rejects(new EditorialConditionsResolver(authority).resolve(pool,scope),{code:'review_policy_unavailable'});
    assert.equal(await store.current(pool,scope),null);
   });
  });
  // Test-only authority model: no runtime permission or production adapter is invented.
  await pool.query('CREATE TABLE review_test_acl(discovery_id uuid,actor_id uuid,can_read boolean,can_decide boolean,PRIMARY KEY(discovery_id,actor_id)); CREATE TABLE review_test_audit(actor_id uuid,discovery_id uuid,operation text)');
  const editor=randomUUID(),other=randomUUID();
  type Session={actorId:string;subjectId:string;simulated:boolean}|null;
  const host:DiscoveryReviewHost<Session>={
   session:async s=>s,policy:async()=>policy,evidence:async()=> 'compatible',
   authorize:async(principal,db,o,operation)=>{
    const r=await db.query('SELECT * FROM review_test_acl WHERE discovery_id=$1 AND actor_id=$2 FOR SHARE',[o.discoveryId,principal.actorId]);
    const row=r.rows[0];
    if(!row||!row.can_read||operation==='decide'&&!row.can_decide)throw new DiscoveryReviewApplicationError('review_forbidden',403);
    await db.query('INSERT INTO review_test_audit VALUES($1,$2,$3)',[principal.actorId,o.discoveryId,operation]);
   }
  };
  const session:Session={actorId:editor,subjectId:editor,simulated:false};
  const app=new DiscoveryReviewApplication(pool,host),o=await seed();
  await pool.query('INSERT INTO review_test_acl VALUES($1,$2,true,true)',[o.discoveryId,editor]);
  const body=(action:DiscoveryReviewCommand['action'],rev:number)=>{const {reviewerId,...rest}=command(action,rev);return rest};
  await t.test('07D-C authorized read and ordered history',async()=>{assert.equal((await app.current(session,o)).state,'proposed');assert.deepEqual(await app.history(session,o),[])});
  await t.test('07D-C unauthenticated read is denied',async()=>{await assert.rejects(app.history(null,o),{code:'review_unauthenticated',status:401})});
  await t.test('07D-C foreign scope is denied',async()=>{await assert.rejects(app.history(session,await seed()),{code:'review_forbidden'})});
  const start=body('start_review',0);
  await t.test('07D-C identity is host-derived and reviewer spoofing is rejected',async()=>{
   await assert.rejects(app.decide(session,o,{...start,reviewerId:other}),{code:'review_request_invalid'});
   const r=await app.decide(session,o,start);assert.equal(r.decision.reviewerId,editor);
  });
  await t.test('07D-C missing decision permission refuses approval',async()=>{
   await pool.query('UPDATE review_test_acl SET can_decide=false WHERE discovery_id=$1',[o.discoveryId]);
   await assert.rejects(app.decide(session,o,body('approve',1)),{code:'review_forbidden'});
   await pool.query('UPDATE review_test_acl SET can_decide=true WHERE discovery_id=$1',[o.discoveryId]);
  });
  await t.test('07D-C authorized independent editor approves without publication',async()=>{
   const r=await app.decide(session,o,body('approve',1));assert.equal(r.snapshot.state,'approved');assert.equal(Object.hasOwn(r,'published'),false);
   assert.deepEqual((await app.history(session,o)).map(x=>x.decision.cas.nextRevision),[1,2]);
  });
  await t.test('07D-C proposer cannot approve own discovery',async()=>{
   const x=await seed();const proposer=(await pool.query('SELECT c.actor_id FROM discovery_journal_entries e JOIN discovery_journal_captures c ON c.id=e.capture_id WHERE e.id=$1',[x.discoveryId])).rows[0].actor_id;
   await pool.query('INSERT INTO review_test_acl VALUES($1,$2,true,true)',[x.discoveryId,proposer]);
   const own={actorId:proposer,subjectId:proposer,simulated:false};await app.decide(own,x,body('start_review',0));
   await assert.rejects(app.decide(own,x,body('approve',1)),{code:'review_separation_required'});
  });
  await t.test('07D-C authorized retry returns original and foreign identity cannot retrieve duplicate',async()=>{
   assert.equal((await app.decide(session,o,start)).duplicate,true);
   await assert.rejects(app.decide({actorId:other,subjectId:other,simulated:false},o,start),{code:'review_forbidden'});
  });
  await t.test('07D-C stale CAS and idempotency errors remain typed',async()=>{
   await assert.rejects(app.decide(session,o,body('withdraw_approval',0)),e=>discoveryReviewHttpError(e).status===409);
   await assert.rejects(app.decide(session,o,{...start,reason:'Different'}),e=>discoveryReviewHttpError(e).code==='review_idempotency_conflict');
  });
  await t.test('07D-C revocation committed while command waits is enforced inside transaction',async()=>{
   const x=await seed();await pool.query('INSERT INTO review_test_acl VALUES($1,$2,true,true)',[x.discoveryId,editor]);
   const blocker=await pool.connect();await blocker.query('BEGIN');await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('discovery-review:'||$1,0))",[x.discoveryId]);
   const pending=app.decide(session,x,body('start_review',0));
   // Revocation can commit while aggregate is blocked, before transactional authorization.
   await pool.query('UPDATE review_test_acl SET can_decide=false WHERE discovery_id=$1',[x.discoveryId]);
   await blocker.query('COMMIT');blocker.release();await assert.rejects(pending,{code:'review_forbidden'});assert.deepEqual(await new DiscoveryReviewRepository(pool).history(x),[]);
  });
  await t.test('07D-C authorization is repeated immediately before persistence',async()=>{
   const x=await seed();let checks=0;
   const twice=new DiscoveryReviewApplication(pool,{...host,authorize:async()=>{if(++checks===2)throw new DiscoveryReviewApplicationError('review_forbidden',403)}});
   await assert.rejects(twice.decide(session,x,body('start_review',0)),{code:'review_forbidden'});assert.equal(checks,2);assert.deepEqual(await new DiscoveryReviewRepository(pool).history(x),[]);
  });
  await t.test('07D-C missing policy or evidence and unconfigured host stay unavailable',async()=>{
   await assert.rejects(new DiscoveryReviewApplication(pool,{...host,policy:async()=>null}).decide(session,o,start),{code:'review_conditions_unavailable'});
   await assert.rejects(new DiscoveryReviewApplication(pool,{...host,evidence:undefined}).decide(session,o,start),{code:'review_conditions_unavailable'});
   await assert.rejects(new DiscoveryReviewApplication(pool).history(session,o),{code:'review_host_unavailable'});
   await assert.rejects(app.history({...session!,simulated:true},o),{code:'review_forbidden'});
   assert.deepEqual(discoveryReviewHttpError(new Error('private SQL detail')),{status:503,code:'review_unavailable'});
  });
  await pool.query(`CREATE TABLE users(id uuid PRIMARY KEY,name text,email text);
   CREATE TABLE workspaces(id uuid PRIMARY KEY,owner_id uuid,archived_at timestamptz);
   CREATE TABLE boards(id uuid PRIMARY KEY,owner_id uuid,workspace_id uuid,closed_at timestamptz,is_collection boolean DEFAULT false);
   CREATE TABLE board_members(board_id uuid,user_id uuid,role text);
   CREATE TABLE lists(id uuid PRIMARY KEY,board_id uuid,archived_at timestamptz);
   CREATE TABLE ai_projects(id uuid PRIMARY KEY,owner_id uuid);
   CREATE TABLE plugin_settings(plugin_id text,enabled boolean);
   CREATE TABLE vault_items(card_id uuid); ALTER TABLE cards ADD COLUMN archived_at timestamptz; ALTER TABLE cards ADD COLUMN list_id uuid;`);
  for(const name of ['065_rbac_core.sql','068_rbac_privileges_groups.sql','070_rbac_editable_defaults.sql','096_access_audit_scopes.sql'])await pool.query(await readFile('forge/app/apps/api/sql/migrations/'+name,'utf8'));
  const {AccessService}=require(join(process.cwd(),'forge/app/apps/api/src/access/access.ts'));
  const realAccess=new AccessService({query:async(sql:string,p:any[]) => (await pool.query(sql,p)).rows,one:async(sql:string,p:any[]) => (await pool.query(sql,p)).rows[0]??null});
  const realActor=randomUUID(),realGroup=randomUUID();
  await pool.query("INSERT INTO users(id,name,email,is_root) VALUES($1,'Editor','fixture@invalid.test',true)",[realActor]);
  await realAccess.initializeDefaults();
  const realOrigin=await seed();
  const capture=(await pool.query('SELECT c.* FROM discovery_journal_entries e JOIN discovery_journal_captures c ON c.id=e.capture_id WHERE e.id=$1',[realOrigin.discoveryId])).rows[0];
  const board=randomUUID(),list=randomUUID();
  await pool.query('INSERT INTO boards(id,owner_id) VALUES($1,$2)',[board,realActor]);await pool.query('INSERT INTO lists(id,board_id) VALUES($1,$2)',[list,board]);
  await pool.query('UPDATE cards SET list_id=$1 WHERE id=$2',[list,capture.card_id]);await pool.query('INSERT INTO ai_projects VALUES($1,$2)',[capture.project_id,realActor]);
  const realHost=discoveryReviewAccessHost(realAccess,'dev',{actorId:realActor,subjectId:realActor,simulated:false,sessionVersion:0});
  const realGuard=async(db:any,origin:any,operation:any,c?:any)=>realHost.authorize({actorId:realActor,subjectId:realActor,readKind:'history'},db,origin,operation,c);
  const realRepo=new DiscoveryReviewRepository(pool,undefined,realGuard);
  await t.test('07D-C2 actual AccessService: ROOT has no automatic editorial permission',async()=>{
   await assert.rejects(realRepo.history(realOrigin),{code:'review_forbidden'});
   assert.equal(await realAccess.has(realActor,'discovery_review.approve'),false);
   assert.ok(! (await pool.query("SELECT permissions FROM access_roles WHERE id='administrator'")).rows[0].permissions.includes('discovery_review.approve'));
  });
  await pool.query("INSERT INTO access_groups(id,name,permissions) VALUES($1,'Explicit editors',$2)",[realGroup,['boards.read','projects.read','discovery_review.history','discovery_review.start_review','discovery_review.approve']]);
  await pool.query('INSERT INTO access_group_members VALUES($1,$2)',[realGroup,realActor]);
  await t.test('07D-C2 real groups authorize native scope and audit committed reads',async()=>{
   assert.deepEqual(await realRepo.history(realOrigin),[]);assert.ok((await pool.query('SELECT 1 FROM access_audit WHERE actor_id=$1 AND target=$2',[realActor,realOrigin.discoveryId])).rowCount);
  });
  await t.test('07D-C2 real permission: decision succeeds with explicit group grant',async()=>{
   await realRepo.record(realOrigin,command('start_review',0,{reviewerId:realActor}),policy);assert.equal((await realRepo.history(realOrigin)).length,1);
  });
  await t.test('07D-C2 locks block role/group mutation until editorial transaction ends',async()=>{
   const db=await pool.connect(),writer=await pool.connect();
   try{
    await db.query('BEGIN');await realGuard(db,realOrigin,'read');
    for(const sql of ["UPDATE access_groups SET permissions='{}' WHERE id=$1", "DELETE FROM access_group_members WHERE group_id=$1", "UPDATE access_roles SET permissions='{}' WHERE id='user'"]){
     await writer.query('BEGIN');await writer.query("SET LOCAL lock_timeout='100ms'");
     await assert.rejects(writer.query(sql,sql.includes('$1')?[realGroup]:[]),{code:'55P03'});await writer.query('ROLLBACK');
    }
    await db.query('COMMIT');
   }finally{await db.query('ROLLBACK');db.release();writer.release()}
  });
  await t.test('07D-C2 real revocation rejects old idempotent duplicate and rolls back',async()=>{
   const stored=(await realRepo.history(realOrigin))[0];
   await pool.query("INSERT INTO access_user_exceptions VALUES($1,'discovery_review.start_review','deny')",[realActor]);
   const c=stored.decision;
   await assert.rejects(realRepo.record(realOrigin,{action:c.action,expectedReviewRevision:c.expectedReviewRevision,reviewerId:c.reviewerId,idempotencyKey:c.idempotencyKey,reason:c.reason,recordedAt:c.recordedAt},policy),{code:'review_forbidden'});
   assert.equal((await realRepo.history(realOrigin)).length,1);
  });
  await t.test('07D-C2 actual adapter rejects simulation and keeps current/history permissions distinct',async()=>{
   const db=await pool.connect();
   try{
    await db.query('BEGIN');
    await assert.rejects(realHost.authorize({actorId:realActor,subjectId:realActor,readKind:'current'},db,realOrigin,'read'),{code:'review_forbidden'});
    const simulated=discoveryReviewAccessHost(realAccess,'dev',{actorId:realActor,subjectId:other,simulated:true,sessionVersion:0});
    await assert.rejects(simulated.authorize({actorId:realActor,subjectId:other},db,realOrigin,'read'),{code:'review_forbidden'});
   }finally{await db.query('ROLLBACK');db.release()}
  });
  await t.test('07D-C2 actual adapter denies self approval from immutable capture identity',async()=>{
   await pool.query("INSERT INTO users(id,name,email) VALUES($1,'Proposer','proposer@invalid.test')",[capture.actor_id]);
   await pool.query('INSERT INTO access_group_members VALUES($1,$2)',[realGroup,capture.actor_id]);
   await pool.query('UPDATE ai_projects SET owner_id=$1 WHERE id=$2',[capture.actor_id,capture.project_id]);
   await pool.query('UPDATE boards SET owner_id=$1 WHERE id=$2',[capture.actor_id,board]);
   const own=discoveryReviewAccessHost(realAccess,'dev',{actorId:capture.actor_id,subjectId:capture.actor_id,simulated:false,sessionVersion:0});
   try{
    const r=new DiscoveryReviewRepository(pool,undefined,(db,o,op,c)=>own.authorize({actorId:capture.actor_id,subjectId:capture.actor_id},db,o,op,c));
    await assert.rejects(r.record(realOrigin,command('approve',1,{reviewerId:capture.actor_id}),policy),{code:'review_separation_required'});
   }finally{
    await pool.query('UPDATE ai_projects SET owner_id=$1 WHERE id=$2',[realActor,capture.project_id]);await pool.query('UPDATE boards SET owner_id=$1 WHERE id=$2',[realActor,board]);
   }
  });
  await t.test('07D-C4 all registered callback categories are conservatively blocked',async()=>{
   const registrations=[
    (a:any)=>a.registerRecordPermissionProvider(async()=>true),
    (a:any)=>a.registerResourceAvailability(()=>true),
    (a:any)=>a.registerResources({list:async()=>[],authorize:async()=>true}),
    (a:any)=>a.registerBoardListProvider(async()=>[]),
    (a:any)=>a.registerBoardScopeProvider(async()=>null),
    (a:any)=>a.registerBoardMembersProvider(async()=>[]),
    (a:any)=>a.registerBoardListingPolicy(async()=>true),
    (a:any)=>a.registerBoardPolicy(async()=>true),
    (a:any)=>a.registerBoardAccessProvider(async()=>true),
    (a:any)=>a.registerScope('fixture',async()=>true),
    (a:any)=>a.registerMembership('fixture',async()=>true),
   ];
   for(const register of registrations){const a=new AccessService({});assert.equal(a.editorialScopeProvidersPresent(),false);register(a);assert.equal(a.editorialScopeProvidersPresent(),true);
    const h=discoveryReviewAccessHost(a,'dev',{actorId:realActor,subjectId:realActor,simulated:false,sessionVersion:0});
    await assert.rejects(h.authorize({actorId:realActor,subjectId:realActor},{query:async()=>{throw Error('must refuse before SQL')}},realOrigin,'read'),{code:'review_scope_adapter_unavailable'});
   }
  });
  await t.test('07D-C4 actual Suinda extra scoped provider is detected',async()=>{
   const runtime=join(process.cwd(),'suinda/app');
   execFileSync(process.execPath,['--import',join(runtime,'node_modules/tsx/dist/loader.mjs'),'--eval',"const assert=require('node:assert/strict');const {AccessService}=require('./apps/api/src/access/access.ts');const a=new AccessService({});a.registerScopedPermissionProvider(async()=>['discovery_review.approve']);assert.equal(a.editorialScopeProvidersPresent(),true);const b=new AccessService({});b.registerRequestPermissionProvider(async()=>true);assert.equal(b.editorialScopeProvidersPresent(),true)"],{cwd:runtime,env:{...process.env,TSX_TSCONFIG_PATH:join(runtime,'apps/api/tsconfig.json')},timeout:15000,stdio:'pipe'});
  });
  const lockSql=(await readFile('packages/orbit-core/src/execution/discovery-review-access-host.ts','utf8')).match(/LOCK TABLE [^']+ IN SHARE MODE/)![0];
  await t.test('07D-C4 independent aggregates share read locks but unrelated writes wait',async()=>{
   const a=await pool.connect(),b=await pool.connect(),writer=await pool.connect();const start=Date.now();
   try{
    assert.equal(lockSql.split(' IN SHARE MODE')[0].replace('LOCK TABLE ','').split(',').length,13);
    await a.query('BEGIN');await b.query('BEGIN');
    await a.query("SELECT pg_advisory_xact_lock(hashtextextended('discovery-review:fixture-a',0))");
    await b.query("SELECT pg_advisory_xact_lock(hashtextextended('discovery-review:fixture-b',0))");
    await a.query(lockSql);await b.query(lockSql);
    await writer.query('BEGIN');await writer.query("SET LOCAL lock_timeout='100ms'");
    await assert.rejects(writer.query('UPDATE users SET name=name WHERE id=$1',[other]),{code:'55P03'});
    assert.ok(Date.now()-start<4000);
   }finally{for(const c of [a,b,writer]){await c.query('ROLLBACK');c.release()}}
  });
  await t.test('07D-C4 scope transfers are blocked while table locks are held',async()=>{
   const a=await pool.connect(),writer=await pool.connect();
   try{await a.query('BEGIN');await a.query(lockSql);
    for(const [sql,args] of [['UPDATE ai_projects SET owner_id=$1 WHERE id=$2',[other,capture.project_id]],['UPDATE boards SET workspace_id=$1 WHERE id=$2',[randomUUID(),board]],['UPDATE cards SET list_id=$1 WHERE id=$2',[randomUUID(),capture.card_id]]]){
     await writer.query('BEGIN');await writer.query("SET LOCAL lock_timeout='100ms'");await assert.rejects(writer.query(sql,args),{code:'55P03'});await writer.query('ROLLBACK');
    }
   }finally{await a.query('ROLLBACK');await writer.query('ROLLBACK');a.release();writer.release()}
  });
  await t.test('07D-C4 opposite writer lock order demonstrates real deadlock and rollback',async()=>{
   const a=await pool.connect(),b=await pool.connect();
   try{
    for(const c of [a,b]){await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='4s'");await c.query("SET LOCAL statement_timeout='5s'")}
    await a.query('LOCK TABLE users IN SHARE MODE');await b.query('LOCK TABLE access_grants IN ROW EXCLUSIVE MODE');
    const x=a.query('LOCK TABLE access_grants IN SHARE MODE').then(()=>({ok:true}),async(e:any)=>{await a.query('ROLLBACK');return {ok:false,code:e.code}});
    const y=b.query('UPDATE users SET session_version=session_version+1 WHERE id=$1',[realActor]).then(()=>({ok:true}),async(e:any)=>{await b.query('ROLLBACK');return {ok:false,code:e.code}});
    const results=await Promise.all([x,y]);assert.equal(results.filter(r=>!r.ok).length,1);assert.ok(results.some(r=>!r.ok&&r.code==='40P01'));
   }finally{for(const c of [a,b]){await c.query('ROLLBACK');c.release()}}
   assert.equal((await pool.query('SELECT session_version FROM users WHERE id=$1',[realActor])).rows[0].session_version,0);
  });
  await t.test('07D-R8 linked Vault mutations follow cards-first lock order and preserve rollback',async()=>{
   const fromDev=(path:string)=>require(join(process.cwd(),'forge/app/apps/api/src',path));
   const {VaultService}=fromDev('plugins/vault/vault.service.ts');
   const {encryptVaultPayload}=fromDev('vault-crypto.ts');
   const cardId=randomUUID(),linkedId=randomUUID(),standaloneId=randomUUID();
   const key=process.env.VAULT_ENCRYPTION_KEY,envFile=process.env.ORBIT_API_ENV_FILE;
   process.env.VAULT_ENCRYPTION_KEY='r8-disposable-vault-key';
   process.env.ORBIT_API_ENV_FILE=join(root,'missing-synthetic-env');
   await pool.query(`ALTER TABLE cards ADD COLUMN title text, ADD COLUMN description text,
     ADD COLUMN updated_at timestamptz, ADD COLUMN url_token text;
    ALTER TABLE vault_items ADD COLUMN id uuid PRIMARY KEY, ADD COLUMN owner_id uuid,
     ADD COLUMN title text, ADD COLUMN category text, ADD COLUMN notes text,
     ADD COLUMN secret_data text, ADD COLUMN created_at timestamptz DEFAULT now(),
     ADD COLUMN updated_at timestamptz DEFAULT now(),
     ADD FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE;
    CREATE TABLE delivery_credentials(owner_id uuid,encrypted_value text);
    CREATE TABLE integration_connections(owner_id uuid,credentials_encrypted text);
    CREATE ROLE orbit_r8_vault LOGIN NOSUPERUSER;
    GRANT SELECT,UPDATE,DELETE ON cards,vault_items TO orbit_r8_vault;
    GRANT SELECT ON lists,delivery_credentials,integration_connections TO orbit_r8_vault`);
   await pool.query("INSERT INTO cards(id,card_revision,list_id,title,description) VALUES($1,1,$2,'Linked','Original')",[cardId,list]);
   await pool.query(`INSERT INTO vault_items(id,owner_id,card_id,title,category,notes,secret_data) VALUES
    ($1,$3,$4,'Linked','custom','',$5),($2,$3,NULL,'Standalone','custom','',$5)`,
   [linkedId,standaloneId,realActor,cardId,encryptVaultPayload({content_html:'<p>Original</p>',credentials:[]})]);
   const vaultPool=new Pool({...config,user:'orbit_r8_vault',application_name:'orbit-r8-vault'});
   const db={pool:vaultPool,query:async(sql:string,args?:unknown[]) => (await vaultPool.query(sql,args)).rows,
    one:async(sql:string,args?:unknown[]) => (await vaultPool.query(sql,args)).rows[0]??null};
   const vault=new VaultService(db,{}, {isEnabled:()=>true});
   const reader=await pool.connect(),legacy=await pool.connect();
   const readerPid=(await reader.query('SELECT pg_backend_pid() pid')).rows[0].pid;
   const state=async()=> (await pool.query(`SELECT c.title,c.description,v.secret_data,v.title AS vault_title
     FROM cards c JOIN vault_items v ON v.card_id=c.id WHERE v.id=$1`,[linkedId])).rows[0];
   let change:Promise<{error?:unknown}>|undefined;
   const waitingWriter=async()=>{
    const deadline=Date.now()+1500;
    for(;;){
     const blocked=(await pool.query(`SELECT pid FROM pg_stat_activity WHERE application_name='orbit-r8-vault'
      AND $1=ANY(pg_blocking_pids(pid))`,[readerPid])).rows[0];
     if(blocked){
      const held=await pool.query(`SELECT 1 FROM pg_locks WHERE pid=$1 AND relation='vault_items'::regclass
       AND mode IN ('RowExclusiveLock','RowShareLock') AND granted`,[blocked.pid]);
      assert.equal(held.rowCount,0);return;
     }
     assert.ok(Date.now()<deadline,'Vault writer should wait on cards before touching the Vault row');
     await new Promise(resolve=>setTimeout(resolve,20));
    }
   };
   try{
    await reader.query('BEGIN');await legacy.query('BEGIN');
    for(const c of [reader,legacy]) await c.query("SET LOCAL deadlock_timeout='100ms'; SET LOCAL lock_timeout='4s'");
    await reader.query('LOCK TABLE cards IN SHARE MODE');
    await legacy.query("UPDATE vault_items SET title='Uncommitted' WHERE id=$1",[linkedId]);
    const attempt=async(client:typeof reader,sql:string,args?:unknown[])=>{
     try{await client.query(sql,args);await client.query('ROLLBACK');return undefined}
     catch(error){await client.query('ROLLBACK');return (error as {code?:string}).code}
    };
    const deadlock=await Promise.all([attempt(reader,'LOCK TABLE vault_items IN SHARE MODE'),
     attempt(legacy,"UPDATE cards SET title='Uncommitted' WHERE id=$1",[cardId])]);
    assert.deepEqual(deadlock.filter(Boolean),['40P01']);
    assert.equal((await state()).vault_title,'Linked');

    await reader.query('BEGIN');await reader.query('LOCK TABLE cards IN SHARE MODE');
    assert.equal((await vault.updateVaultItem(standaloneId,realActor,{title:'Independent'})).title,'Independent');
    change=vault.updateVaultItem(linkedId,realActor,{title:'Updated',content_html:'<p>New text</p>'})
     .then(()=>({}),(error:unknown)=>({error}));
    await waitingWriter();
    await reader.query(lockSql);await reader.query('ROLLBACK');
    assert.deepEqual(await change,{});
    const updated=await state();
    assert.equal(updated.title,'Updated');assert.equal(updated.vault_title,'Updated');
    assert.equal(updated.description,'New text');

    await pool.query("ALTER TABLE cards ADD CONSTRAINT r8_reject_vault_update CHECK(title <> 'Rejected')");
    await assert.rejects(vault.updateVaultItem(linkedId,realActor,{title:'Rejected'}),{code:'23514'});
    assert.deepEqual(await state(),updated);
    await pool.query('CREATE TABLE r8_vault_delete_hold(card_id uuid REFERENCES cards(id)); INSERT INTO r8_vault_delete_hold VALUES (NULL)');
    await pool.query('INSERT INTO r8_vault_delete_hold VALUES ($1)',[cardId]);
    await assert.rejects(vault.deleteVaultItem(linkedId,realActor),{code:'23503'});
    assert.deepEqual(await state(),updated);
    await pool.query('DROP TABLE r8_vault_delete_hold');

    await reader.query('BEGIN');await reader.query('LOCK TABLE cards IN SHARE MODE');
    await vault.deleteVaultItem(standaloneId,realActor);
    change=vault.deleteVaultItem(linkedId,realActor).then(()=>({}),(error:unknown)=>({error}));
    await waitingWriter();
    await reader.query(lockSql);await reader.query('ROLLBACK');
    assert.deepEqual(await change,{});
    assert.equal(await state(),undefined);
    assert.equal((await pool.query('SELECT id FROM cards WHERE id=$1',[cardId])).rowCount,0);
    assert.equal((await pool.query('SELECT id FROM vault_items WHERE id=ANY($1::uuid[])',[[linkedId,standaloneId]])).rowCount,0);
   }finally{
    await reader.query('ROLLBACK');reader.release();
    await legacy.query('ROLLBACK');legacy.release();
    await change;await vaultPool.end();
    if(key===undefined)delete process.env.VAULT_ENCRYPTION_KEY;else process.env.VAULT_ENCRYPTION_KEY=key;
    if(envFile===undefined)delete process.env.ORBIT_API_ENV_FILE;else process.env.ORBIT_API_ENV_FILE=envFile;
   }
  });
  await t.test('07D-R6 record role effects wait on users before touching access grants',async()=>{
   const {ExtensionRecords}=require(join(process.cwd(),'forge/app/apps/api/src/plugins/records/records.service.ts'));
   const {PluginRegistry}=require(join(process.cwd(),'forge/app/apps/api/src/execution/registries.ts'));
   const userId=randomUUID(),recordId=randomUUID(),workspace=randomUUID(),roleId='administrator';
   await pool.query(`CREATE TABLE extension_records(id uuid PRIMARY KEY,workspace_id uuid,plugin_id text,kind text,revision integer);
    CREATE TABLE extension_record_versions(record_id uuid,revision integer)`);
   await pool.query("INSERT INTO users(id,name,email) VALUES($1,'Grantee','r6-grantee@invalid.test')",[userId]);
   await pool.query("INSERT INTO extension_records VALUES($1,$2,'r6-fixture','record',1)",[recordId,workspace]);
   await pool.query('INSERT INTO extension_record_versions VALUES($1,1)',[recordId]);
   const registry=new PluginRegistry();
   registry.register({id:'r6-fixture',name:'Fixture',version:'1.0.0',
    contributions:{recordKinds:{record:{label:'Record',schema:{type:'object'},initial:'draft',transitions:{draft:[]},example:{},resourceScoped:true}}}});
   const records=new ExtensionRecords({},realAccess,registry,{});
   const effect={userId,recordId,roleId,effect:'grant'};
   const reader=await pool.connect(),writer=await pool.connect();
   const writerPid=(await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
   const readerPid=(await reader.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
   const observe=async()=>{
    const out=await pool.query(`SELECT session_version,
      EXISTS(SELECT 1 FROM access_grants WHERE user_id=$1 AND role_id=$2 AND scope_type='extension_record' AND scope_id=$3) AS granted
      FROM users WHERE id=$1`,[userId,roleId,recordId]);
    return out.rows[0];
   };
   let outcome:Promise<{error?:unknown}>|undefined;
   try{
    await reader.query('BEGIN');
    await reader.query('LOCK TABLE users IN SHARE MODE');
    await writer.query('BEGIN');
    outcome=records.applyRecordRoleEffects(writer,workspace,realActor,[effect])
     .then(()=>({}), (error:unknown)=>({error}));
    const deadline=Date.now()+1000;
    while(true){
     const blocked=(await pool.query('SELECT $1=ANY(pg_blocking_pids($2)) AS blocked',[readerPid,writerPid])).rows[0].blocked;
     if(blocked)break;
     assert.ok(Date.now()<deadline,'record writer should wait on the editorial users lock');
     await new Promise(resolve=>setTimeout(resolve,20));
    }
    const grantsWriteLock=await pool.query(`SELECT 1 FROM pg_locks
      WHERE pid=$1 AND relation='access_grants'::regclass AND mode='RowExclusiveLock' AND granted`,[writerPid]);
    assert.equal(grantsWriteLock.rowCount,0);
    await reader.query(lockSql);
    assert.deepEqual(await observe(),{session_version:0,granted:false});
    await reader.query('ROLLBACK');
    assert.deepEqual(await outcome,{});
    await writer.query('COMMIT');
    assert.deepEqual(await observe(),{session_version:1,granted:true});
    assert.equal((await pool.query("SELECT 1 FROM access_audit WHERE actor_id=$1 AND action='role.scope.grant' AND scope_id=$2",[realActor,recordId])).rowCount,1);

    await writer.query('BEGIN');
    await assert.rejects(records.applyRecordRoleEffects(writer,workspace,randomUUID(),[{...effect,effect:'revoke'}]),{code:'23503'});
    await writer.query('ROLLBACK');
    assert.deepEqual(await observe(),{session_version:1,granted:true});
    await writer.query('BEGIN');
    await records.applyRecordRoleEffects(writer,workspace,realActor,[{...effect,effect:'revoke'}]);
    await writer.query('COMMIT');
    assert.deepEqual(await observe(),{session_version:2,granted:false});
   }finally{
    await reader.query('ROLLBACK');
    await outcome;
    await writer.query('ROLLBACK');
    reader.release();writer.release();
   }
  });
  await t.test('07D-R7 scoped roles and user exceptions acquire users first and roll back atomically',async()=>{
   const {AccessManagement}=require(join(process.cwd(),'forge/app/apps/api/src/access/management.ts'));
   const db={pool,query:async(sql:string,p:unknown[])=>(await pool.query(sql,p)).rows,
    one:async(sql:string,p:unknown[])=>(await pool.query(sql,p)).rows[0]??null};
   const access=new AccessService(db),management=new AccessManagement(db,access);
   const target=randomUUID(),scope=randomUUID();
   await pool.query("INSERT INTO users(id,name,email) VALUES($1,'Scoped user','r7-scoped@invalid.test')",[target]);
   access.registerScope('fixture',async()=>true);
   const writerInputs=[
    {table:'access_grants',mutate:()=>access.assignScopedRoles(realActor,target,'fixture',scope,['editor'])},
    {table:'access_user_exceptions',mutate:()=>management.saveExceptions(realActor,target,{exceptions:[{permission_id:'boards.read',effect:'allow'}]})},
   ];
   const reader=await pool.connect();
   const readerPid=(await reader.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
   const snapshot=async()=>{
    const {rows:[state]}=await pool.query(`SELECT session_version,
     ARRAY(SELECT role_id FROM access_grants WHERE user_id=$1 AND scope_type='fixture' AND scope_id=$2 ORDER BY role_id) roles,
     ARRAY(SELECT effect FROM access_user_exceptions WHERE user_id=$1 AND permission_id='boards.read') effects
     FROM users WHERE id=$1`,[target,scope]);
    return state;
   };
   let writer:Promise<{error?:unknown}>|undefined;
   try{
    for(const entry of writerInputs){
     await reader.query('BEGIN');await reader.query('LOCK TABLE users IN SHARE MODE');
     writer=entry.mutate().then(()=>({}),(error:unknown)=>({error}));
     const deadline=Date.now()+1200;
     for(;;){
      const {rows:[state]}=await pool.query(`SELECT pid FROM pg_stat_activity
       WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))`,[readerPid]);
      if(state){
       const held=await pool.query(`SELECT 1 FROM pg_locks WHERE pid=$1 AND relation=$2::regclass
        AND mode='RowExclusiveLock' AND granted`,[state.pid,entry.table]);
       assert.equal(held.rowCount,0,entry.table);
       break;
      }
      assert.ok(Date.now()<deadline,'the actual writer should wait on users');
      await new Promise(resolve=>setTimeout(resolve,20));
     }
     await reader.query(lockSql);await reader.query('ROLLBACK');
     assert.deepEqual(await writer,{});
    }
    const expected={session_version:2,roles:['editor'],effects:['allow']};
    assert.deepEqual(await snapshot(),expected);
    await pool.query("ALTER TABLE access_grants ADD CONSTRAINT r7_reject_reader CHECK(role_id <> 'reader') NOT VALID");
    try{
     await assert.rejects(access.assignScopedRoles(realActor,target,'fixture',scope,['reader']),{code:'23514'});
     assert.deepEqual(await snapshot(),expected);
    }finally{await pool.query('ALTER TABLE access_grants DROP CONSTRAINT r7_reject_reader')}
    await assert.rejects(management.saveExceptions(realActor,target,{exceptions:[
     {permission_id:'boards.read',effect:'deny'},{permission_id:'boards.read',effect:'allow'},
    ]}),{code:'23505'});
    assert.deepEqual(await snapshot(),expected);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM access_audit
      WHERE (action='role.scope.updated' AND scope_id=$1) OR (action='user.exceptions.updated' AND target=$2)`,[scope,target])).rows[0].n,2);
   }finally{await reader.query('ROLLBACK');reader.release();await writer}
  });
  await t.test('07D-R7 a provider added after decision SQL is refused before COMMIT dispatch',async()=>{
   const a=new AccessService({});
   const h=discoveryReviewAccessHost(a,'dev',{actorId:realActor,subjectId:realActor,simulated:false,sessionVersion:0});
   const historyBefore=await new DiscoveryReviewRepository(pool).history(realOrigin);
   const count=async()=>Number((await pool.query('SELECT count(*) FROM access_audit WHERE target=$1',[realOrigin.discoveryId])).rows[0].count);
   const originalAuditCount=await count();
   let insertApplied=false,commitDispatched=false;
   const delayedPool={async connect(){
    const client=await pool.connect();
    return {
     async query(sql:string,parameters?:unknown[]){
      if(sql==='COMMIT')commitDispatched=true;
      const result=await client.query(sql,parameters);
      if(sql.startsWith('INSERT INTO discovery_review_decisions')){
       insertApplied=true;
       await new Promise<void>(resolve=>setImmediate(()=>{
        a.registerResources({list:async()=>[],authorize:async()=>false});
        resolve();
       }));
      }
      return result;
     },
     release:()=>client.release(),
    };
   }};
   const app=new DiscoveryReviewApplication(delayedPool,{...h,policy:async()=>policy,evidence:async()=>'compatible'});
   await assert.rejects(app.decide(undefined,realOrigin,body('approve',1)),{code:'review_scope_adapter_unavailable'});
   assert.equal(insertApplied,true);
   assert.equal(commitDispatched,false);
   assert.deepEqual(await new DiscoveryReviewRepository(pool).history(realOrigin),historyBefore);
   assert.equal(await count(),originalAuditCount);
  });
  await t.test('07D-C4 provider registered during actual permission evaluation aborts decision',async()=>{
   const a=new AccessService({query:async(sql:string,p:any[])=>(await pool.query(sql,p)).rows,one:async(sql:string,p:any[])=>(await pool.query(sql,p)).rows[0]??null});
   const original=a.editorialPermissions.bind(a);a.editorialPermissions=async(db:any,user:string)=>{const permissions=await original(db,user);a.registerResourceAvailability(()=>true);return permissions};
   const h=discoveryReviewAccessHost(a,'dev',{actorId:realActor,subjectId:realActor,simulated:false,sessionVersion:0});
   const guarded=new DiscoveryReviewRepository(pool,async()=>'compatible',(db,o,op,c)=>h.authorize({actorId:realActor,subjectId:realActor},db,o,op,c));
   const history=await new DiscoveryReviewRepository(pool).history(realOrigin);
   await assert.rejects(guarded.record(realOrigin,command('approve',1,{reviewerId:realActor}),policy),{code:'review_scope_adapter_unavailable'});
   assert.deepEqual(await new DiscoveryReviewRepository(pool).history(realOrigin),history);
  });
  await t.test('07D-C2 session revocation, wrong runtime and unhomologated plugin scopes fail closed',async()=>{
   const wrong=discoveryReviewAccessHost(realAccess,'foreign',{actorId:realActor,subjectId:realActor,simulated:false,sessionVersion:0});
   await assert.rejects(new DiscoveryReviewRepository(pool,undefined,(db,o,op,c)=>wrong.authorize({actorId:realActor,subjectId:realActor},db,o,op,c)).history(realOrigin),{code:'review_forbidden'});
   await pool.query('UPDATE users SET session_version=1 WHERE id=$1',[realActor]);await assert.rejects(realRepo.history(realOrigin),{code:'review_unauthenticated'});
   await pool.query('UPDATE users SET session_version=0 WHERE id=$1',[realActor]);realAccess.registerBoardPolicy(async()=>true);
   await assert.rejects(realRepo.history(realOrigin),{code:'review_scope_adapter_unavailable'});
   await assert.rejects(new DiscoveryReviewApplication(pool,realHost).decide(undefined,realOrigin,body('approve',1)),{code:'review_conditions_unavailable'});
  });
  await t.test('SQL guard rejects direct invalid revisions independently of repository',async()=>{
   const row=(await pool.query('SELECT * FROM discovery_review_decisions WHERE discovery_id=$1 ORDER BY review_revision LIMIT 1',[origin.discoveryId])).rows[0];
   await assert.rejects(pool.query(`INSERT INTO discovery_review_decisions SELECT discovery_id,queue,99,98,state,action,'direct-key',request_hash,command,decision,evidence_compatibility,policy,persisted_at FROM discovery_review_decisions WHERE discovery_id=$1 AND review_revision=1`,[row.discovery_id]),{code:'PDR01'});
  });
 }finally{if(pool)await pool.end();if(started)execFileSync(join(bin,'pg_ctl'),['-D',join(root,'data'),'-m','immediate','-w','stop'],{stdio:'pipe',timeout:15000});await rm(root,{recursive:true,force:true})}
});
