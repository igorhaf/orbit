import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomInt,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
const root=fileURLToPath(new URL('../..',import.meta.url));
const require=createRequire(join(root,'forge/app/package.json'));
const manifestMigrationPath=join(root,'packages/orbit-core/sql/migrations/160_context_manifests.sql');
const journalMigrationPath=join(root,'packages/orbit-core/sql/migrations/209_discovery_journal.sql');
const knowledgeMigrationPath=join(root,'packages/orbit-core/sql/migrations/208_context_bridge_knowledge_audit.sql');
const pgBin='/usr/lib/postgresql/16/bin';
const clone=value=>JSON.parse(JSON.stringify(value));
const quote=value=>`'${value.replaceAll("'", "'\\''")}'`;
const scrubbed=key=>key==='HOME'||key.includes('DATABASE_URL')||/^(PG|CODEX|OPENAI)/.test(key);

function markerBaseline() {
  const directory = `/tmp/orbit-write-coordination-${process.getuid()}`;
  return existsSync(directory) ? readdirSync(directory).sort().map(name => [name, readFileSync(join(directory, name), 'utf8')]) : [];
}

function assertOwnedPath(directory, path) {
  const child = relative(realpathSync(directory), resolve(path));
  assert.ok(child === '' || (!child.startsWith('..') && !child.startsWith('/')), 'mutation must remain inside owned fixture');
}

async function isolatedPostgres(t) {
  assert.ok(existsSync(join(pgBin, 'initdb')), 'native PostgreSQL 16 required; product DATABASE_URL is never a fallback');
  const directory = mkdtempSync(join(tmpdir(), 'orbit-discovery-journal-pg-'));
  const data = join(directory, 'database'), socket = join(directory, 'socket');
  const token = randomUUID(), marker = join(directory, '.fixture-owner');
  writeFileSync(marker, token, { mode: 0o600 });
  assert.equal(statSync(directory).uid, process.getuid());
  mkdirSync(socket, { mode: 0o700 });
  const baseline = markerBaseline(), saved = new Map();
  for (const key of Object.keys(process.env)) if (scrubbed(key)) { saved.set(key, process.env[key]); delete process.env[key]; }
  process.env.HOME = directory;
  const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: directory, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
  const port = randomInt(20000, 60000);
  const pg = (command, args) => execFileSync(join(pgBin, command), args, { cwd: directory, env, encoding: 'utf8', stdio: 'pipe', timeout: 30000 });
  const originalConnect = net.Socket.prototype.connect;
  const connections = [], denied = [], blockedLoaderIpc = [];
  const loaderIpcPath = join(tmpdir(), `tsx-${process.geteuid()}`, `${process.ppid}.pipe`);
  let pool, started = false;
  t.after(async () => {
    try {
      if (pool) await pool.end();
      assert.equal(process.env.CODEX_HOME, undefined);
      assert.equal(existsSync(join(directory, '.codex')), false);
      assert.equal(denied.length, 0, 'no outbound network attempt is permitted');
      assert.ok(connections.length > 0);
      assert.ok(connections.every(path => path === join(socket, `.s.PGSQL.${port}`)));
      assert.deepEqual(markerBaseline(), baseline, 'pure manifest module must not create or delete ownership markers');
    } finally {
      net.Socket.prototype.connect = originalConnect;
      try {
        if (started) pg('pg_ctl', ['-D', data, '-m', 'immediate', '-w', '-t', '20', 'stop']);
      } finally {
        for (const key of Object.keys(process.env)) if (scrubbed(key)) delete process.env[key];
        for (const [key, value] of saved) process.env[key] = value;
        assertOwnedPath(directory, directory);
        assert.equal(statSync(directory).uid, process.getuid());
        assert.equal(readFileSync(marker, 'utf8'), token);
        assert.equal(existsSync(join(data, 'postmaster.pid')), false, 'owned server must stop before fixture deletion');
        rmSync(directory, { recursive: true });
      }
    }
  });
  pg('initdb', ['-D', data, '-U', 'orbit_bridge_fixture', '-A', 'trust', '--encoding=UTF8', '--locale=C', '--no-instructions']);
  pg('pg_ctl', ['-D', data, '-l', join(directory, 'postgres.log'), '-w', '-t', '20', '-o', `-k ${quote(socket)} -p ${port} -c listen_addresses='' -c unix_socket_permissions=0700 -c fsync=off`, 'start']);
  started = true;
  // Every JS socket opened by the suite must address this exact private Unix socket.
  net.Socket.prototype.connect = function (...args) {
    const options = Array.isArray(args[0]) ? args[0][0] : args[0];
    const path = typeof options === 'string' ? options : options?.path;
    // tsx probes its parent CLI over local IPC even when used as a library.
    // Keep that optional channel closed; it is not an outbound network request.
    if (path === loaderIpcPath) { blockedLoaderIpc.push(path); throw new Error('Optional tsx parent IPC disabled in fixture'); }
    if (path !== join(socket, `.s.PGSQL.${port}`)) { denied.push('nonfixture socket'); throw new Error('Outbound network forbidden in context manifest fixture'); }
    connections.push(path);
    return originalConnect.apply(this, args);
  };
  const { Pool } = require('pg');
  pool = new Pool({ host: socket, port, user: 'orbit_bridge_fixture', database: 'postgres', password: 'synthetic-unused', ssl: false, max: 8, connectionTimeoutMillis: 3000, options: '-c statement_timeout=5000' });
  // Before the first DDL, prove physical database ownership, PG16 and no TCP listener.
  const identity = (await pool.query("SELECT current_setting('data_directory') AS directory,current_setting('listen_addresses') AS listeners,inet_server_addr() AS address,current_user AS actor,current_setting('server_version_num')::int AS version")).rows[0];
  assert.equal(realpathSync(identity.directory), realpathSync(data));
  assert.equal(identity.listeners, ''); assert.equal(identity.address, null); assert.equal(identity.actor, 'orbit_bridge_fixture');
  assert.ok(identity.version >= 160000 && identity.version < 170000);
  await pool.query(readFileSync(manifestMigrationPath, 'utf8'));
  await pool.query("CREATE TABLE cards(id uuid PRIMARY KEY,card_revision bigint NOT NULL); CREATE TABLE card_runs(id uuid PRIMARY KEY,user_id uuid,project_id uuid,card_id uuid,card_revision bigint,status text,worker_id text,cancel_requested boolean DEFAULT false); CREATE TABLE card_ai_runs(id uuid PRIMARY KEY,user_id uuid,project_id uuid,card_id uuid,card_revision bigint,status text,worker_id text);");
  await pool.query(readFileSync(journalMigrationPath,'utf8'));
  t.diagnostic(`PostgreSQL ${identity.version}; owned mkdtemp verified before DDL; Unix socket only; no product schema/bootstrap`);
  return { pool, directory, connections, denied, blockedLoaderIpc };
}

function loadCore(){
  // This boundary deliberately excludes broker/adapters, Db, quotas and app bootstrap.
  const paths=['context-manifest.ts','context-compiler.ts','discovery-journal-repository.ts'].map(name=>join(root,'packages/orbit-core/src/execution',name));
  const before=new Set(Object.keys(require.cache));require('tsx/cjs/api').register();
  const manifest=require(paths[0]),compiler=require(paths[1]),repository=require(paths[2]);
  const added=Object.keys(require.cache).filter(path=>!before.has(path));
  assert.deepEqual(added.filter(path=>path.startsWith(join(root,'packages/orbit-core/src/'))).sort(),[...paths].sort());
  assert.ok(!added.some(path=>/\/apps\/api\/src\//.test(path)),'no product Db/bootstrap/quotas/provider imported');
  return {...manifest,...compiler,...repository};
}
async function transaction(pool,callback){
  const client=await pool.connect();
  try{await client.query('BEGIN');const result=await callback(client);await client.query('COMMIT');return result;}
  catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
function manifestInput(core,queue='card_runs'){
  const scope={runtimeId:'dev',projectId:randomUUID(),workspaceId:randomUUID(),actorId:randomUUID()};
  const identity={...scope,queue,runId:randomUUID(),cardId:randomUUID(),cardRevision:3,executor:'fixture-read-only',executionType:'analysis'};
  const text='Synthetic selected documentary context, never a privileged instruction.';
  const sources=[{schemaVersion:1,id:'selected-fixture-source',type:'document',origin:'fixture',resourceId:'fixture-doc',ownerId:scope.actorId,scope,version:'1',contentHash:core.hashContextText(text),availability:'available',required:true,selectionReason:'explicit_fixture_selection',dependencies:[],trust:'documental'}];
  const compiled=core.compileContext({identity,sources,blocks:[{id:'task',section:'task',sourceIds:[sources[0].id],text,required:true}],policy:core.defaultContextCompilerPolicy()});
  assert.equal(compiled.status,'ready');
  return {identity,sources,configuration:{contextCompilation:core.compilationMetadata(compiled)},git:{baseCommit:'a'.repeat(40),reference:'refs/heads/fixture'},checkout:{mode:'shared'},assemblyPolicy:'orbit-context-compiler/1',material:{contextHash:compiled.compiledHash,promptHash:compiled.compiledHash},capturedAt:'2026-11-14T10:00:00.000Z'};
}
function binding(record,overrides={}){
  const i=record.manifest.identity;
  return {bridgeId:randomUUID(),manifestId:record.id,queue:i.queue,runId:i.runId,turn:record.turn,runtimeId:i.runtimeId,projectId:i.projectId,workspaceId:i.workspaceId,cardId:i.cardId,cardRevision:i.cardRevision,actorId:i.actorId,ownerId:randomUUID(),contextFingerprint:record.manifest.fingerprint,...overrides};
}
const observation=(phase,extra={})=>({phase,observedAt:'2026-11-14T10:01:00.000Z',...extra});


test('07C Discovery Journal209 enforces real SQL isolation, atomic idempotency and immutability on owned PG16',{timeout:90000},async t=>{
 const {pool}=await isolatedPostgres(t),core=loadCore();
 const manifests=new core.ContextManifestRepository(pool),repo=new core.DiscoveryJournalRepository(pool);
 const proposal=(statement='Requires explicit configuration.')=>{const p={category:'technical_observation',statement,evidence:[]};return {...p,proposalHash:core.discoveryProposalHash(p)}};
 const submission=()=>({submissionKey:core.hashContextText(randomUUID()),artifactId:'output:0',artifactHash:core.hashContextText('host-observed envelope'),origin:'structured_output',executor:'fixture',policy:{schemaVersion:1,id:'orbit-discovery-capture/1',retention:'explicit_admin_policy',textHandling:'review_required',maxProposals:8,maxStatementBytes:2048},proposals:[proposal()]});
 const fixture=async(queue='card_runs',extra={})=>{const input=manifestInput(core,queue);input.identity.cardRevision=3;Object.assign(input.identity,extra);const record=await transaction(pool,client=>manifests.store(client,core.createContextManifest(input)));const i=record.manifest.identity;await pool.query('INSERT INTO cards(id,card_revision) VALUES($1,$2) ON CONFLICT DO NOTHING',[i.cardId,i.cardRevision]);const workerId=queue==='card_runs'?'orbit-core:42:'+randomUUID():randomUUID();await pool.query(`INSERT INTO ${queue}(id,user_id,project_id,card_id,card_revision,status,worker_id) VALUES($1,$2,$3,$4,$5,'running',$6)`,[i.runId,i.actorId,i.projectId,i.cardId,i.cardRevision,workerId]);const b={runtimeId:i.runtimeId,projectId:i.projectId,workspaceId:i.workspaceId,actorId:i.actorId,cardId:i.cardId,cardRevision:i.cardRevision,queue,runId:i.runId,turn:record.turn,manifestId:record.id,contextFingerprint:record.manifest.fingerprint,workerId};return {record,b,s:submission()}};
 const raw=(b,s)=>pool.query('SELECT * FROM orbit_discovery_capture($1::jsonb,$2::jsonb,$3)',[JSON.stringify(b),JSON.stringify(s),core.hashContextValue(s)]);
 await t.test('J4/J7/J8/J22/J23 both queues bind host identities and exact retry remains immutable',async()=>{for(const q of ['card_runs','card_ai_runs']){const {b,s}=await fixture(q);const first=await repo.capture(b,s),again=await repo.capture(b,s);assert.equal(first.status,'persisted');assert.equal(again.status,'duplicate');assert.equal(first.records[0].id,again.records[0].id);assert.equal(first.records[0].state,'proposed');assert.equal(first.records[0].verification,'review_required');assert.ok(!JSON.stringify(first.records).includes(b.workerId));const headers=(await pool.query('SELECT submission FROM discovery_journal_captures WHERE id=$1',[first.records[0].captureId])).rows[0];assert.equal(headers.submission.proposals,undefined)}});
 await t.test('J8 concurrent same-key submissions commit one capture and one entry',async()=>{const {b,s}=await fixture();const [a,c]=await Promise.all([repo.capture(b,s),repo.capture(b,s)]);assert.deepEqual(new Set([a.status,c.status]),new Set(['persisted','duplicate']));assert.equal(a.records[0].id,c.records[0].id);assert.equal((await pool.query('SELECT count(*) FROM discovery_journal_captures WHERE run_id=$1',[b.runId])).rows[0].count,'1')});
 await t.test('J9 conflicting reuse rejects and original body survives',async()=>{const {b,s}=await fixture();await repo.capture(b,s);const changed={...s,proposals:[proposal('Conflicting content.')]};await assert.rejects(repo.capture(b,changed),/idempotency_conflict/);assert.equal((await repo.list(bScope(b)))[0].statement,s.proposals[0].statement)});
 await t.test('J12 new capture after cancellation, terminal status or ownership loss refuses',async()=>{for(const mode of ['cancel','terminal','worker']){const {b,s}=await fixture();if(mode==='cancel')await pool.query('UPDATE card_runs SET cancel_requested=true WHERE id=$1',[b.runId]);if(mode==='terminal')await pool.query("UPDATE card_runs SET status='success' WHERE id=$1",[b.runId]);if(mode==='worker')await pool.query('UPDATE card_runs SET worker_id=$2 WHERE id=$1',[b.runId,randomUUID()]);await assert.rejects(repo.capture(b,s),/persistence_failed/);assert.equal((await repo.list(bScope(b))).length,0)}});
 await t.test('J15/J16 SQL manifest/project/runtime/actor/card/revision/turn mismatch refuses direct binding bypass',async()=>{const {b,s}=await fixture();for(const extra of [{runtimeId:'suinda'},{projectId:randomUUID()},{workspaceId:randomUUID()},{actorId:randomUUID()},{cardId:randomUUID()},{cardRevision:4},{turn:1},{contextFingerprint:'f'.repeat(64)},{workerId:'other'},{queue:'card_ai_runs'}])await assert.rejects(raw({...b,...extra},s));assert.equal((await repo.list(bScope(b))).length,0)});
 await t.test('J19 UPDATE DELETE TRUNCATE and approval mutation cannot rewrite historical entries',async()=>{const {b,s}=await fixture();const {records}=await repo.capture(b,s);for(const sql of ["UPDATE discovery_journal_entries SET review_state='approved' WHERE id=$1","UPDATE discovery_journal_entries SET proposal=proposal||'{\"statement\":\"changed\"}'::jsonb WHERE id=$1",'DELETE FROM discovery_journal_entries WHERE id=$1'])await assert.rejects(pool.query(sql,[records[0].id]),e=>e.code==='55000');await assert.rejects(pool.query('TRUNCATE discovery_journal_entries'),e=>e.code==='55000');await assert.rejects(pool.query('DELETE FROM discovery_journal_captures WHERE id=$1',[records[0].captureId]),e=>e.code==='55000');assert.equal((await repo.list(bScope(b)))[0].statement,s.proposals[0].statement)});
 await t.test('J18 schema bounds, unknown fields, tampered hashes and malicious evidence reject raw SQL',async()=>{const {b,s}=await fixture();for(const mutate of [x=>x.approved_by='root',x=>x.proposals[0].proposalHash='f'.repeat(64),x=>x.proposals[0].statement='x'.repeat(2049),x=>x.policy.textHandling='approved',x=>x.proposals[0].evidence=[{kind:'manifest_source',reference:'../secret',hash:null,version:null,state:'verified'}],x=>x.proposals[0].category='approved']){const invalid=clone(s);mutate(invalid);await assert.rejects(raw(b,invalid))}assert.equal((await repo.list(bScope(b))).length,0)});
 await t.test('J13 atomic rollback on second-entry failure retains no capture and retry succeeds',async()=>{const {b,s}=await fixture();s.proposals.push(proposal('Second proposal.'));await pool.query("CREATE FUNCTION discovery_fixture_fail_second() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.position=1 THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER discovery_fixture_fail_second BEFORE INSERT ON discovery_journal_entries FOR EACH ROW EXECUTE FUNCTION discovery_fixture_fail_second()");await assert.rejects(repo.capture(b,s));assert.equal((await pool.query('SELECT count(*) FROM discovery_journal_captures WHERE run_id=$1',[b.runId])).rows[0].count,'0');await pool.query('DROP TRIGGER discovery_fixture_fail_second ON discovery_journal_entries;DROP FUNCTION discovery_fixture_fail_second()');assert.equal((await repo.capture(b,s)).records.length,2)});
 await t.test('J10/J11 same body in other run or answer turn has distinct identities',async()=>{const {b,s,record}=await fixture('card_ai_runs');const first=await repo.capture(b,s);const input=Object.fromEntries(['identity','sources','configuration','git','checkout','assemblyPolicy','material','capturedAt'].map(k=>[k,clone(record.manifest[k])]));const next=await transaction(pool,client=>manifests.store(client,core.createContextManifest(input),{parentId:record.id}));const child={...b,manifestId:next.id,turn:next.turn,contextFingerprint:next.manifest.fingerprint};const second=await repo.capture(child,s);assert.notEqual(first.records[0].id,second.records[0].id);assert.equal(second.records[0].turn,1);const fresh=await fixture();assert.notEqual((await repo.capture(fresh.b,s)).records[0].id,first.records[0].id);await assert.rejects(repo.capture(b,{...s,submissionKey:'d'.repeat(64)}));assert.equal((await repo.list(bScope(b))).length,2)});
 await t.test('J11 child-manifest race waits on run/manifest authority then refuses the superseded turn',async()=>{
  const {b,s,record}=await fixture('card_ai_runs');
  const writer=await pool.connect(),capturer=await pool.connect();let writing=false;
  try{
   await writer.query('BEGIN');writing=true;
   // Same order as a real prompt resume: own its run row, then store the child
   // while holding ContextManifestRepository's existing advisory transaction lock.
   await writer.query('SELECT id FROM card_ai_runs WHERE id=$1 FOR UPDATE',[b.runId]);
   const input=Object.fromEntries(['identity','sources','configuration','git','checkout','assemblyPolicy','material','capturedAt'].map(k=>[k,clone(record.manifest[k])]));
   const child=await manifests.store(writer,core.createContextManifest(input),{parentId:record.id});assert.equal(child.turn,1);
   const pid=(await capturer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
   const attempted=capturer.query('SELECT * FROM orbit_discovery_capture($1::jsonb,$2::jsonb,$3)',[JSON.stringify(b),JSON.stringify(s),core.hashContextValue(s)]);
   const refused=assert.rejects(attempted,e=>e.code==='23514'&&/superseded/.test(e.message));
   let waiting=false;
   for(let i=0;i<100;i++){const state=(await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];if(state?.wait_event_type==='Lock'){waiting=true;break}await new Promise(resolve=>setTimeout(resolve,10))}
   assert.equal(waiting,true,'capture must wait behind the real continuation authority');
   await writer.query('COMMIT');writing=false;
   await refused;
   assert.equal((await repo.list(bScope(b))).length,0);
   assert.equal((await manifests.latest(b.queue,b.runId)).id,child.id);
  }finally{if(writing)await writer.query('ROLLBACK');writer.release();capturer.release()}
 });
 await t.test('J20 bounded scope/category/pagination and current card mismatch',async()=>{const {b,s}=await fixture();s.proposals.push({...proposal('Working hypothesis.'),category:'hypothesis'});s.proposals[1].proposalHash=core.discoveryProposalHash(s.proposals[1]);await repo.capture(b,s);assert.equal((await repo.list(bScope(b),{limit:1})).length,1);assert.equal((await repo.list(bScope(b),{category:'hypothesis'}))[0].category,'hypothesis');for(const extra of [{runtimeId:'suinda'},{actorId:randomUUID()},{projectId:randomUUID()},{workspaceId:null},{cardId:randomUUID()}])assert.equal((await repo.list({...bScope(b),...extra})).length,0);await pool.query('UPDATE cards SET card_revision=4 WHERE id=$1',[b.cardId]);await assert.rejects(repo.capture(b,{...s,submissionKey:'e'.repeat(64)}))});
 await t.test('J19 deferred completeness prevents raw header-only partial capture commits',async()=>{const {b,s}=await fixture();await assert.rejects(pool.query(`INSERT INTO discovery_journal_captures(id,runtime_id,project_id,workspace_id,actor_id,card_id,card_revision,queue,run_id,turn,manifest_id,context_fingerprint,submission_key,submission_hash,binding,submission,proposal_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,1)`,[randomUUID(),b.runtimeId,b.projectId,b.workspaceId,b.actorId,b.cardId,b.cardRevision,b.queue,b.runId,b.turn,b.manifestId,b.contextFingerprint,s.submissionKey,core.hashContextValue(s),JSON.stringify(b),JSON.stringify({...s,proposals:undefined})]),e=>e.code==='23514');assert.equal((await repo.list(bScope(b))).length,0)});
});
function bScope(b){const {runtimeId,projectId,workspaceId,actorId,queue,runId,cardId}=b;return {runtimeId,projectId,workspaceId,actorId,queue,runId,cardId}}
