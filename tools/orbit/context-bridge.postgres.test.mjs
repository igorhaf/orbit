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
const bridgeMigrationPath=join(root,'packages/orbit-core/sql/migrations/207_context_bridge_audit.sql');
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
  const directory = mkdtempSync(join(tmpdir(), 'orbit-context-bridge-pg-'));
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
  await pool.query(readFileSync(bridgeMigrationPath, 'utf8'));
  t.diagnostic(`PostgreSQL ${identity.version}; owned mkdtemp verified before DDL; Unix socket only; no product schema/bootstrap`);
  return { pool, directory, connections, denied, blockedLoaderIpc };
}

function loadCore(){
  // This boundary deliberately excludes broker/adapters, Db, quotas and app bootstrap.
  const paths=['context-manifest.ts','context-compiler.ts','context-bridge-repository.ts'].map(name=>join(root,'packages/orbit-core/src/execution',name));
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

test('06 Bridge query audit uses additive immutable SQL207 and only disposable PG16',{timeout:90000},async t=>{
  const {pool}=await isolatedPostgres(t),core=loadCore();
  const manifests=new core.ContextManifestRepository(pool),audit=new core.ContextBridgeRepository(pool);
  const store=(value,options)=>transaction(pool,client=>manifests.store(client,core.createContextManifest(value),options));
  let captured;
  const capturingRepo=new core.ContextBridgeRepository({query:async(sql,values)=>{captured={sql,values:clone(values)};return pool.query(sql,values)}});
  const raw=async mutate=>{const values=clone(captured.values);values[0]=randomUUID();mutate(values);return pool.query(captured.sql,values)};

  await t.test('both queues keep bounded audit phases distinct and do not mutate the captured context',async()=>{
    for(const queue of ['card_runs','card_ai_runs']){
      const record=await store(manifestInput(core,queue)),host=binding(record),before=JSON.stringify(record.manifest);
      await audit.append(host,observation('bridge_created'));
      await audit.append(host,observation('request_received',{requestId:'request-1',capability:'sources.read'}));
      await audit.append(host,observation('authorized',{requestId:'request-1',capability:'sources.read',status:'authorized'}));
      const sourceId='src_'+core.hashContextText('opaque-'+host.bridgeId),responseHash=core.hashContextText('synthetic returned data');
      await audit.append(host,observation('response_emitted',{requestId:'request-1',capability:'sources.read',sourceId,sourceHash:record.manifest.sources[0].contentHash,sourceIdentityHash:core.hashContextText(record.manifest.sources[0].id),sourceVersion:'1',responseHash,returnedBytes:23,chargedBytes:23,status:'ok'}));
      await audit.append(host,observation('delivery_unverified',{requestId:'request-1',status:'model_receipt_unverified'}));
      await audit.append(host,observation('closed',{status:'closed'}));
      const history=await audit.history(record.id);
      assert.deepEqual(history.map(row=>row.event.phase),['closed','delivery_unverified','response_emitted','authorized','request_received','bridge_created']);
      assert.equal(history[2].event.sourceId,sourceId);assert.equal(history[2].event.responseHash,responseHash);assert.equal(history[2].event.sourceIdentityHash,core.hashContextText(record.manifest.sources[0].id));
      assert.equal(JSON.stringify((await manifests.get(record.id)).manifest),before);
      assert.equal((await pool.query('SELECT count(*) FROM context_manifest_verifications WHERE manifest_id=$1',[record.id])).rows[0].count,'0');
      const stored=(await pool.query('SELECT audit FROM context_bridge_events WHERE manifest_id=$1 ORDER BY event_sequence',[record.id])).rows;
      assert.ok(!JSON.stringify(stored).includes('synthetic returned data'));assert.ok(!JSON.stringify(history).includes(host.ownerId));
    }
  });
  await t.test('SQL binds relational columns, full host identity, captured turn and immutable fingerprint',async()=>{
    const record=await store(manifestInput(core)),host=binding(record);
    await capturingRepo.append(host,observation('bridge_created'));
    const substitutions={queue:'card_ai_runs',runId:randomUUID(),turn:1,runtimeId:'suinda',projectId:randomUUID(),workspaceId:randomUUID(),cardId:randomUUID(),cardRevision:4,actorId:randomUUID(),contextFingerprint:'f'.repeat(64)};
    for(const [key,value] of Object.entries(substitutions))await assert.rejects(()=>audit.append({...host,bridgeId:randomUUID(),[key]:value},observation('request_received',{requestId:'wrong-binding'})),{code:'23514'});
    await assert.rejects(()=>audit.append({...host,ownerId:randomUUID()},observation('closed')),{code:'23514'});
    await assert.rejects(()=>raw(values=>{values[13]='f'.repeat(64)}),{code:'23514'});
    await assert.rejects(()=>raw(values=>{const body=JSON.parse(values[26]);body.binding.ownerId=randomUUID();values[26]=JSON.stringify(body)}),{code:'23514'});
    const original=manifestInput(core,'card_ai_runs'),first=await store(original),child=await store(original,{parentId:first.id});
    await assert.rejects(()=>audit.append(binding(child,{turn:0}),observation('bridge_created')),{code:'23514'});
    assert.equal((await audit.append(binding(child),observation('bridge_created'))).manifestId,child.id);
  });
  await t.test('SQL refuses bodies, tokens, socket paths and unbound event metadata',async()=>{
    const record=await store(manifestInput(core));await capturingRepo.append(binding(record),observation('request_received',{requestId:'safe-request'}));
    for(const [key,value] of Object.entries({body:'PRIVATE-SOURCE-BODY',token:'PRIVATE-CREDENTIAL',socketPath:'/private/socket',parameters:{path:'../../secret'}}))await assert.rejects(()=>raw(values=>{const payload=JSON.parse(values[26]);payload.event[key]=value;values[26]=JSON.stringify(payload)}),{code:'23514'});
    await assert.rejects(()=>raw(values=>{const payload=JSON.parse(values[26]);payload.body='PRIVATE-SOURCE-BODY';values[26]=JSON.stringify(payload)}),{code:'23514'});
    await assert.rejects(()=>raw(values=>{values[14]='authorized'}),{code:'23514'});
    await assert.rejects(()=>raw(values=>{values[27]='a'.repeat(64)}),{code:'23514'});
    await assert.rejects(()=>raw(values=>{values[23]=-1}),{code:'23514'});
    await assert.rejects(()=>raw(values=>{values[17]='file:../../private'}),{code:'23514'});
  });
  await t.test('SQL rejects UPDATE DELETE and TRUNCATE without rewriting manifest evidence',async()=>{
    const record=await store(manifestInput(core)),stored=await audit.append(binding(record),observation('bridge_created'));
    await assert.rejects(()=>pool.query('UPDATE context_bridge_events SET phase=phase WHERE id=$1',[stored.id]),{code:'55000'});
    await assert.rejects(()=>pool.query('DELETE FROM context_bridge_events WHERE id=$1',[stored.id]),{code:'55000'});
    await assert.rejects(()=>pool.query('TRUNCATE context_bridge_events'),{code:'55000'});
    assert.equal((await audit.history(record.id)).length,1);
    assert.deepEqual((await manifests.get(record.id)).manifest,record.manifest);
  });
  await t.test('concurrent first events cannot attach one Bridge to two owner bindings',async()=>{
    const record=await store(manifestInput(core)),first=binding(record),second={...first,ownerId:randomUUID()};
    const results=await Promise.allSettled([audit.append(first,observation('bridge_created')),audit.append(second,observation('bridge_created'))]);
    assert.equal(results.filter(value=>value.status==='fulfilled').length,1);
    assert.equal(results.find(value=>value.status==='rejected').reason.code,'23514');
    assert.equal((await audit.history(record.id)).length,1);
  });
  await t.test('history is scoped and bounded while independent audit sequences retain ordering',async()=>{
    const a=await store(manifestInput(core)),b=await store(manifestInput(core)),host=binding(a);
    const first=await audit.append(host,observation('bridge_created'));
    const second=await audit.append(host,observation('denied',{requestId:'request-denied',reason:'budget_exhausted',status:'denied'}));
    const last=await audit.append(host,observation('closed'));
    await audit.append(binding(b),observation('bridge_created'));
    assert.ok(BigInt(first.sequence)<BigInt(second.sequence)&&BigInt(second.sequence)<BigInt(last.sequence));
    assert.deepEqual((await audit.history(a.id,1)).map(row=>row.id),[last.id]);
    assert.equal((await audit.history(b.id)).length,1);assert.equal((await audit.history(randomUUID())).length,0);
    const fks=(await pool.query("SELECT confrelid::regclass::text AS target FROM pg_constraint WHERE conrelid='context_bridge_events'::regclass AND contype='f'")).rows;
    assert.deepEqual(fks.map(value=>value.target),['context_run_manifests']);
  });
  await t.test('07B additive208 persists safe dynamic search evidence without changing207 rows or binding guards',async()=>{
    // All preceding tests ran with207 only: old five-capability events do not require208.
    const oldRows=(await pool.query('SELECT id,audit FROM context_bridge_events ORDER BY event_sequence')).rows;
    const versionConstraints=(await pool.query("SELECT conname FROM pg_constraint WHERE conrelid='context_bridge_events'::regclass AND conname='context_bridge_events_source_version_check'")).rows;
    assert.equal(versionConstraints.length,1,'207 generated source_version CHECK name verified before208');
    const beforeSchema=await store(manifestInput(core));
    await assert.rejects(()=>audit.append(binding(beforeSchema),observation('response_prepared',{capability:'sources.read',sourceVersion:'sha256:'+'a'.repeat(64)})),{code:'23514'});
    await pool.query(readFileSync(knowledgeMigrationPath,'utf8'));
    assert.deepEqual((await pool.query('SELECT id,audit FROM context_bridge_events ORDER BY event_sequence')).rows,oldRows);
    const record=await store(manifestInput(core)),host=binding(record),before=JSON.stringify(record.manifest);
    const metadata={schemaVersion:1,queryHash:'1'.repeat(64),corpusHash:'2'.repeat(64),policy:'orbit-lexical-retrieval/1',found:3,returned:1,omitted:2,sources:[{sourceId:'src_'+'3'.repeat(64),sourceIdentityHash:'4'.repeat(64),sourceHash:'5'.repeat(64),sourceVersion:'sha256:'+'6'.repeat(64)}]};
    const appended=await capturingRepo.append(host,observation('response_emitted',{requestId:'search-1',capability:'knowledge.search',knowledge:metadata,returnedBytes:1024,chargedBytes:1280,status:'ok'}));
    assert.deepEqual(appended.event.knowledge,metadata);assert.deepEqual((await audit.history(record.id))[0].event.knowledge,metadata);
    const row=(await pool.query('SELECT audit,knowledge_metadata FROM context_bridge_events WHERE id=$1',[appended.id])).rows[0];assert.equal(row.audit.event.knowledge,undefined);assert.deepEqual(row.knowledge_metadata,metadata);
    const withEstimate={...metadata,remainingBytes:1000000};const estimate=await capturingRepo.append(host,observation('response_prepared',{requestId:'search-budget-estimate',capability:'knowledge.search',knowledge:withEstimate}));assert.deepEqual(estimate.event.knowledge,withEstimate);
    for(const invalid of [{...metadata,remainingBytes:-1},{...metadata,remainingBytes:0.5},{...metadata,remainingBytes:1000001},{...metadata,remainingBytes:'8'},{...metadata,remainingBytes:null},{...metadata,query:'PRIVATE QUERY'},{...metadata,returned:7},{...metadata,found:1.5},{...metadata,queryHash:'bad'},{...metadata,sources:[{...metadata.sources[0],body:'PRIVATE BODY'}]},{...metadata,sources:[{...metadata.sources[0],sourceId:'file:/private'}]},{...metadata,sources:[{...metadata.sources[0],sourceVersion:'private/path'}]}])await assert.rejects(()=>raw(values=>{values[28]=JSON.stringify(invalid)}),{code:'23514'});
    for(const capability of ['sources.read',null])await assert.rejects(()=>raw(values=>{values[16]=capability;const body=JSON.parse(values[26]);if(capability===null)delete body.event.capability;else body.event.capability=capability;values[26]=JSON.stringify(body)}),{code:'23514'});
    await assert.rejects(()=>raw(values=>{const body=JSON.parse(values[26]);body.event.knowledge=metadata;values[26]=JSON.stringify(body)}),{code:'23514'});
    await assert.rejects(()=>pool.query('UPDATE context_bridge_events SET knowledge_metadata=NULL WHERE id=$1',[appended.id]),{code:'55000'});
    const fullVersion='sha256:'+'a'.repeat(64);
    const sourceRead=await capturingRepo.append(host,observation('response_prepared',{requestId:'read-07a-source',capability:'sources.read',sourceId:'src_'+'7'.repeat(64),sourceHash:'8'.repeat(64),sourceVersion:fullVersion}));
    assert.equal(sourceRead.event.sourceVersion,fullVersion);
    const storedVersion=(await pool.query('SELECT source_version FROM context_bridge_events WHERE id=$1',[sourceRead.id])).rows[0];assert.equal(storedVersion.source_version,fullVersion);
    for(const sourceVersion of ['sha256:short','internal:private','sha256:'+'A'.repeat(64)])await assert.rejects(()=>raw(values=>{values[19]=sourceVersion;const payload=JSON.parse(values[26]);payload.event.sourceVersion=sourceVersion;values[26]=JSON.stringify(payload)}),{code:'23514'});
    assert.equal(JSON.stringify((await manifests.get(record.id)).manifest),before);
  });
  await t.test('legacy manifests and unknown observation payloads cannot masquerade as compiled Bridge history',async()=>{
    const value=manifestInput(core);delete value.configuration.contextCompilation;value.assemblyPolicy='orbit-context-builder/1';
    const legacy=await store(value);await assert.rejects(()=>audit.append(binding(legacy),observation('bridge_created')),{code:'23514'});
    const compiled=await store(manifestInput(core));
    await assert.rejects(()=>audit.append(binding(compiled),observation('response_emitted',{data:{body:'not-metadata'}})),/Invalid bridge audit event/);
    assert.equal((await audit.history(compiled.id)).length,0);
  });
});
