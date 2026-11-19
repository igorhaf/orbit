import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { randomInt, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../..', import.meta.url));
const filename = fileURLToPath(import.meta.url);
const require = createRequire(join(root, 'dev/app/package.json'));
const pgBin = '/usr/lib/postgresql/16/bin';
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const coordinatorPath = join(root, 'packages/orbit-core/src/execution/workspace-coordinator.ts');

// The worker imports only canonical core helpers, never bootstrap, plugins, providers or APIs.
async function runClient() {
  const config = JSON.parse(process.argv[3]);
  require('tsx/cjs/api').register();
  const { withWorkspaceWriteLease, currentWorkspaceWriteLease } = require(coordinatorPath);
  const { Pool } = require('pg');
  const pool = new Pool({ ...config.database, application_name: config.name, max: 1 });
  let release, start, cancel;
  const released = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { start = resolve; });
  const controller = new AbortController();
  process.on('message', message => {
    if (message === 'start') start();
    if (message === 'release') release();
    if (message === 'cancel') { controller.abort(new Error('Fixture cancellation')); cancel?.(); }
  });
  process.send({ event: 'ready' });
  await started;
  try {
    const result = await withWorkspaceWriteLease({ pool }, {
      ...config.request, signal: controller.signal,
      onState: state => { process.send({ event: 'state', state }); },
    }, async lease => {
      await lease.assertActive();
      assert.equal(currentWorkspaceWriteLease(), lease);
      let verify;
      if (config.scope) {
        const { captureFileScope } = require(join(root, 'packages/orbit-core/src/execution/file-scope.ts'));
        verify = await captureFileScope(config.request.projectRoot, [config.scope.path]);
      }
      process.send({ event: 'acquired', owner: lease.owner, resource: lease.resource });
      await Promise.race([released, new Promise(resolve => {
        cancel = resolve;
        lease.signal.addEventListener('abort', resolve, { once: true });
      })]);
      await lease.assertActive();
      if (config.scope) {
        writeFileSync(join(config.request.projectRoot, config.scope.path), config.scope.body);
        await verify();
      }
      return 'completed';
    });
    process.send({ event: 'done', result });
  } catch (error) {
    process.send({ event: 'failed', error: { message: String(error.message), code: error.code, name: error.name } });
  } finally {
    await pool.end();
    process.disconnect();
  }
}

async function isolatedPostgres(t) {
  if (!existsSync(join(pgBin, 'initdb')) || !existsSync(join(pgBin, 'pg_ctl'))) throw new Error('Native PostgreSQL 16 binaries are required; never fall back to DATABASE_URL.');
  const inherited = Object.entries(process.env).filter(([key]) => key.startsWith('PG') || key === 'DATABASE_URL');
  for (const [key] of inherited) delete process.env[key];
  t.after(() => { for (const [key, value] of inherited) process.env[key] = value; });
  const directory = mkdtempSync(join(tmpdir(), 'orbit-workspace-coordinator-pg-'));
  const data = join(directory, 'database'), socket = join(directory, 'socket');
  mkdirSync(socket, { mode: 0o700 });
  const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: directory, LC_ALL: 'C', LANG: 'C', TZ: 'UTC' };
  const port = randomInt(20_000, 60_000);
  const pg = (binary, args) => execFileSync(join(pgBin, binary), args, { env, cwd: directory, encoding: 'utf8', timeout: 30_000, stdio: 'pipe' });
  let pool;
  t.after(async () => {
    try { if (pool) await pool.end(); }
    finally {
      if (existsSync(join(data, 'postmaster.pid'))) pg('pg_ctl', ['-D', data, '-m', 'immediate', '-w', '-t', '20', 'stop']);
      rmSync(directory, { recursive: true, force: true });
    }
  });
  pg('initdb', ['-D', data, '-U', 'orbit_fixture', '-A', 'trust', '--encoding=UTF8', '--locale=C', '--no-instructions']);
  pg('pg_ctl', ['-D', data, '-l', join(directory, 'postgres.log'), '-w', '-t', '20', '-o', `-k ${quote(socket)} -p ${port} -c listen_addresses='' -c fsync=off`, 'start']);
  const database = { host: socket, port, user: 'orbit_fixture', database: 'postgres', password: 'ephemeral-fixture-unused', ssl: false, connectionTimeoutMillis: 3000, options: '-c statement_timeout=5000' };
  const { Pool } = require('pg');
  pool = new Pool({ ...database, max: 4 });
  const identity = (await pool.query("SELECT current_setting('data_directory') AS data_directory,current_setting('listen_addresses') AS listen_addresses,inet_server_addr() AS inet,current_user AS actor")).rows[0];
  assert.equal(realpathSync(identity.data_directory), realpathSync(data));
  assert.equal(identity.listen_addresses, ''); assert.equal(identity.inet, null); assert.equal(identity.actor, 'orbit_fixture');
  return { pool, directory, database };
}

function request(projectRoot, queue = 'card_runs') {
  return { queue, runId: randomUUID(), cardId: randomUUID(), projectId: randomUUID(), projectRoot };
}

function client(t, database, req, extra = {}) {
  const name = `orbit-workspace-fixture-${randomUUID()}`;
  // Deliberately do not pass DATABASE_URL, PG* defaults, credentials or app environment.
  const child = fork(filename, ['--workspace-client', JSON.stringify({ database, request: req, name, ...extra })], {
    execArgv: [], env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '', exit;
  const events = [], waiters = new Set();
  child.stderr.on('data', data => { stderr += data; });
  const wake = () => { for (const waiter of waiters) waiter(); };
  child.on('message', message => { events.push(message); wake(); });
  child.on('exit', (code, signal) => { exit = { code, signal }; wake(); });
  t.after(async () => {
    if (!exit) child.kill('SIGKILL');
    if (!exit) await new Promise(resolve => child.once('exit', resolve));
    const acquired=events.find(message=>message.event==='acquired');
    if(acquired){
      const marker=join(`/tmp/orbit-write-coordination-${process.getuid()}`,acquired.owner+'.json');
      if(existsSync(marker)){
        const value=JSON.parse(readFileSync(marker,'utf8'));
        assert.equal(value.runId,req.runId,'only fixture ownership may be removed by test cleanup');
        assert.ok(value.roots.every(resource=>resource.path.startsWith('/tmp/orbit-workspace-coordinator-pg-')));
        rmSync(marker);
      }
    }
  });
  async function wait(event, timeout = 10_000) {
    const found = () => events.find(message => message.event === event);
    if (found()) return found();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiters.delete(check); reject(new Error(`${name} timed out waiting for ${event}; events=${JSON.stringify(events)} stderr=${stderr}`)); }, timeout);
      const check = () => {
        if (found()) { clearTimeout(timer); waiters.delete(check); resolve(found()); }
        else if (exit || (event !== 'failed' && events.some(message => message.event === 'failed'))) {
          clearTimeout(timer); waiters.delete(check); reject(new Error(`${name} failed before ${event}; exit=${JSON.stringify(exit)} events=${JSON.stringify(events)} stderr=${stderr}`));
        }
      };
      waiters.add(check); check();
    });
  }
  return { child, name, events, wait, async start() { await wait('ready'); child.send('start'); }, release() { child.send('release'); }, cancel() { child.send('cancel'); } };
}

async function contenderBlocked(first, second) {
  await first.start(); await first.wait('acquired');
  await second.start();
  await delay(180);
  assert.equal(second.events.some(message => message.event === 'acquired'), false, 'contender entered a live writer workspace');
  first.release(); await first.wait('done');
  await second.wait('acquired'); second.release(); await second.wait('done');
}

if (process.argv[2] === '--workspace-client') {
  await runClient();
} else {
  test('workspace coordinator serializes physical writers in an isolated PostgreSQL cluster', { timeout: 120_000 }, async t => {
    const { pool, directory, database } = await isolatedPostgres(t);
    const fixture = name => { const path = join(directory, name); mkdirSync(path, { recursive: true }); return path; };

    await t.test('F1: different cards and logical projects sharing a tree never overlap', async t => {
      const tree = fixture('same-tree');
      await contenderBlocked(client(t, database, request(tree)), client(t, database, request(tree)));
    });

    await t.test('F2: generic and AI queues exclude each other in both directions', async t => {
      for (const [index, queues] of [['card_runs', 'card_ai_runs'], ['card_ai_runs', 'card_runs']].entries()) {
        const tree = fixture(`dual-queues-${index}`);
        await contenderBlocked(client(t, database, request(tree, queues[0])), client(t, database, request(tree, queues[1])));
      }
    });

    await t.test('F3: independent roots execute concurrently', async t => {
      const first = client(t, database, request(fixture('independent-a'))), second = client(t, database, request(fixture('independent-b')));
      await first.start(); await first.wait('acquired');
      await second.start(); await second.wait('acquired');
      assert.equal(first.events.some(message => message.event === 'done'), false);
      first.release(); second.release(); await Promise.all([first.wait('done'), second.wait('done')]);
    });

    await t.test('different databases sharing the physical checkout still exclude each other', async t => {
      await pool.query('CREATE DATABASE orbit_other_fixture');
      const tree=fixture('cross-database');
      await contenderBlocked(client(t,database,request(tree)),client(t,{...database,database:'orbit_other_fixture'},request(tree,'card_ai_runs')));
    });
    await t.test('F4/F5: real Node processes unify aliases, Git subdirectories and nested non-Git roots', async t => {
      const tree = fixture('aliases'), alias = join(directory, 'tree-alias'); symlinkSync(tree, alias);
      await contenderBlocked(client(t, database, request(tree)), client(t, database, request(alias)));
      const git = fixture('git-root'), nested = join(git, 'src/deep'); mkdirSync(nested, { recursive: true });
      execFileSync('git', ['init', '--quiet', git], { encoding: 'utf8', stdio: 'pipe', env:{PATH:process.env.PATH,HOME:directory,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'} });
      await contenderBlocked(client(t, database, request(git)), client(t, database, { ...request(nested), workingDirectory: nested }));
      const parent = fixture('nongit'), child = join(parent, 'nested'); mkdirSync(child);
      await contenderBlocked(client(t, database, request(parent)), client(t, database, request(child)));
      await contenderBlocked(client(t, database, request(child)), client(t, database, request(parent)));
    });

    await t.test('linked Git worktrees share metadata protection before worktree isolation exists', async t => {
      const main=fixture('linked-git-main'),other=join(directory,'linked-git-other');
      const git=(...args)=>execFileSync('git',args,{stdio:'pipe',env:{PATH:process.env.PATH,HOME:directory,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
      git('init','--quiet',main);writeFileSync(join(main,'fixture.txt'),'synthetic');git('-C',main,'add','fixture.txt');git('-C',main,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','fixture');git('-C',main,'worktree','add','--quiet','-b','other',other);
      await contenderBlocked(client(t,database,request(main)),client(t,database,request(other,'card_ai_runs')));
    });

    await t.test('F6: a canceled waiter never enters or releases its live predecessor', async t => {
      const tree = fixture('cancel-waiter'), first = client(t, database, request(tree)), second = client(t, database, request(tree));
      await first.start(); await first.wait('acquired'); await second.start(); await delay(150);
      second.cancel(); await second.wait('failed');
      assert.equal(second.events.some(message => message.event === 'acquired'), false);
      const third = client(t, database, request(tree)); await third.start(); await delay(150);
      assert.equal(third.events.some(message => message.event === 'acquired'), false);
      first.release(); await first.wait('done'); await third.wait('acquired'); third.release(); await third.wait('done');
    });

    await t.test('F6: database loss aborts the old owner and quarantines unsafe takeover', async t => {
      const tree=fixture('connection-loss'),first=client(t,database,request(tree));
      await first.start();await first.wait('acquired');
      const connection=(await pool.query('SELECT pid FROM pg_stat_activity WHERE application_name=$1',[first.name])).rows[0];
      assert.ok(connection);await pool.query('SELECT pg_terminate_backend($1)',[connection.pid]);
      await first.wait('failed');
      const second=client(t,database,request(tree));await second.start();
      const rejected=await second.wait('failed');
      assert.equal(rejected.error.code,'WORKSPACE_QUARANTINED');
      assert.equal(second.events.some(event=>event.event==='acquired'),false);
    });
    await t.test('F6: killed owner never permits silent reclamation by another process', async t => {
      const tree=fixture('owner-killed'),first=client(t,database,request(tree));
      await first.start();await first.wait('acquired');
      const ended=new Promise(resolve=>first.child.once('exit',resolve));first.child.kill('SIGKILL');await ended;
      const second=client(t,database,request(tree));await second.start();
      assert.equal((await second.wait('failed')).error.code,'WORKSPACE_QUARANTINED');
      assert.equal(second.events.some(event=>event.event==='acquired'),false);
    });

    await t.test('F7: real sequential file-scope captures preserve the previous card output', async t => {
      const tree = fixture('file-scopes'); writeFileSync(join(tree, 'baseline.txt'), 'baseline');
      const first = client(t, database, request(tree), { scope: { path: 'a.txt', body: 'card A output' } });
      const second = client(t, database, request(tree, 'card_ai_runs'), { scope: { path: 'b.txt', body: 'card B output' } });
      await contenderBlocked(first, second);
      assert.equal(readFileSync(join(tree, 'a.txt'), 'utf8'), 'card A output');
      assert.equal(readFileSync(join(tree, 'b.txt'), 'utf8'), 'card B output');
      assert.equal(readFileSync(join(tree, 'baseline.txt'), 'utf8'), 'baseline');
    });

    await t.test('F8: migration 157 still binds both queue revisions and preserves legacy freshness', async () => {
      await pool.query(`
        CREATE TABLE cards (
          id uuid PRIMARY KEY, title text NOT NULL, description text NOT NULL DEFAULT '',
          kind text NOT NULL DEFAULT 'normal', target_board_id uuid, link_url text,
          ai_project_id uuid, ai_model text, ai_effort text, ai_execution_mode text NOT NULL DEFAULT 'bypass',
          start_date timestamptz, due_date timestamptz, reminder_minutes integer, recurrence text,
          schedule_start_at timestamptz, schedule_end_at timestamptz, schedule_all_day boolean NOT NULL DEFAULT false,
          schedule_time_zone text, position double precision NOT NULL DEFAULT 0, list_id uuid,
          completed boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE card_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,status text NOT NULL DEFAULT 'queued');
        CREATE TABLE card_ai_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,status text NOT NULL DEFAULT 'queued');
      `);
      const baseline = randomUUID();
      await pool.query("INSERT INTO cards(id,title) VALUES($1,'Legacy fixture')", [baseline]);
      for (const table of ['card_runs', 'card_ai_runs']) await pool.query(`INSERT INTO ${table}(card_id,status) VALUES($1,'success')`, [baseline]);
      await pool.query(readFileSync(join(root, 'packages/orbit-core/sql/migrations/157_card_revisions.sql'), 'utf8'));
      await pool.query(readFileSync(join(root, 'packages/orbit-core/sql/migrations/158_workspace_coordination.sql'),'utf8'));
      require('tsx/cjs/api').register();
      const { cardRevisionFreshnessSql } = require(join(root, 'packages/orbit-core/src/card-versions.ts'));
      for (const table of ['card_runs', 'card_ai_runs']) {
        const legacy = (await pool.query(`SELECT r.card_revision,${cardRevisionFreshnessSql()} AS freshness FROM ${table} r JOIN cards c ON c.id=r.card_id WHERE c.id=$1`, [baseline])).rows[0];
        assert.equal(legacy.card_revision, null); assert.equal(legacy.freshness, 'unversioned');
        await pool.query(`INSERT INTO ${table}(card_id,card_revision,status) VALUES($1,1,'running')`, [baseline]);
      }
      await pool.query("UPDATE cards SET title='Edited fixture' WHERE id=$1", [baseline]);
      assert.equal((await pool.query('SELECT card_revision FROM cards WHERE id=$1', [baseline])).rows[0].card_revision, 2);
      for (const table of ['card_runs', 'card_ai_runs']) {
        await pool.query(`UPDATE ${table} SET status='success' WHERE card_id=$1 AND card_revision=1`, [baseline]);
        const run = (await pool.query(`SELECT r.status,r.finished_card_revision,${cardRevisionFreshnessSql()} AS freshness FROM ${table} r JOIN cards c ON c.id=r.card_id WHERE c.id=$1 AND r.card_revision=1`, [baseline])).rows[0];
        assert.equal(run.status, 'success'); assert.equal(run.freshness, 'stale'); assert.equal(run.finished_card_revision, 2);
      }
    });

    await t.test('F10: actual RunRepository preserves quota hooks, idempotency, worker ownership and history', async () => {
      await pool.query(`
        CREATE TABLE users(id uuid PRIMARY KEY,preferences jsonb DEFAULT '{}'::jsonb);
        ALTER TABLE card_runs ADD COLUMN project_id uuid,ADD COLUMN user_id uuid,ADD COLUMN agent text,
          ADD COLUMN executor text,ADD COLUMN action text,ADD COLUMN input jsonb,ADD COLUMN request_key text,
          ADD COLUMN stage text DEFAULT 'queued',ADD COLUMN started_at timestamptz,ADD COLUMN created_at timestamptz DEFAULT now(),
          ADD COLUMN heartbeat_at timestamptz,ADD COLUMN finished_at timestamptz,ADD COLUMN output jsonb,
          ADD COLUMN error text,ADD COLUMN cancel_requested boolean DEFAULT false,ADD COLUMN metadata jsonb DEFAULT '{}'::jsonb;
        CREATE TABLE card_run_logs(run_id uuid,stage text,message text);
      `);
      const ts=require('typescript'),path=join(root,'packages/orbit-core/src/execution/run-repository.ts'),loaded={exports:{}},calls=[];
      const compiled=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
      const local=createRequire(path);
      vm.runInThisContext(`(function(require,module,exports,__filename,__dirname){${compiled}\n})`)(specifier=>specifier==='../codex-limits'?{enforceCodexQuota:async(_db,force=false)=>calls.push(force)}:local(specifier),loaded,loaded.exports,path,join(root,'dev/app/apps/api/src/execution'));
      const {RunRepository}=loaded.exports;
      const db={pool},repository=new RunRepository(db),foreign=new RunRepository(db),id=randomUUID(),user=randomUUID();
      await pool.query("INSERT INTO cards(id,title) VALUES($1,'Run repository fixture')",[id]);await pool.query("INSERT INTO users(id) VALUES($1)",[user]);
      const config={project_id:randomUUID(),agent:null,executor:'plugin',action:'execute'};
      const connection=await pool.connect();let run;
      try{await connection.query('BEGIN');run=await repository.enqueue(connection,{id,title:'Run repository fixture',description:'',board_id:randomUUID(),card_revision:1},user,config,'fixture-key');await connection.query('COMMIT')}finally{connection.release()}
      const claimed=await repository.claim();assert.equal(claimed.id,run.id);assert.equal(claimed.worker_id,repository.workerId);assert.deepEqual(calls,[false]);
      await assert.rejects(()=>foreign.stage(run.id,'executor','foreign writer'),/pertencer/);
      await foreign.finish(claimed,'success',{summary:'must not finish',outputs:[]});
      assert.equal((await pool.query('SELECT status FROM card_runs WHERE id=$1',[run.id])).rows[0].status,'running');
      await repository.stage(run.id,'active_workspace','owned');await repository.finish(claimed,'success',{summary:'completed',outputs:[]});
      const completed=(await pool.query('SELECT * FROM card_runs WHERE id=$1',[run.id])).rows[0];assert.equal(completed.status,'success');assert.equal(completed.card_revision,1);assert.equal(completed.finished_card_revision,1);assert.ok(calls.includes(true));
      assert.ok((await pool.query('SELECT * FROM card_run_logs WHERE run_id=$1',[run.id])).rows.length>=3);
      await pool.query("UPDATE cards SET title='Edited after finish' WHERE id=$1",[id]);
      const replay=await pool.connect();try{await replay.query('BEGIN');const same=await repository.enqueue(replay,{id,title:'Edited after finish',description:'',board_id:randomUUID(),card_revision:2},user,config,'fixture-key');assert.equal(same.id,run.id);assert.equal(same.card_revision,1);await replay.query('COMMIT')}finally{replay.release()}
    });

    await t.test('F9: coordination starts and completes without AI, registry or runtime initialization', async t => {
      const source = readFileSync(coordinatorPath, 'utf8');
      assert.doesNotMatch(source, /(?:from|import\()\s*['"][^'"]*(?:plugins\/ai|project-registry|registries|execution\.service|card-service)/);
      const worker = client(t, database, request(fixture('no-ai-core')));
      await worker.start(); await worker.wait('acquired'); worker.release(); await worker.wait('done');
    });
  });
}
