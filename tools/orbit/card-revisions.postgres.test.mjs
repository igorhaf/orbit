import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { randomInt, randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(join(root, 'forge/app/package.json'));
const { Pool } = require('pg');
const pgBin = '/usr/lib/postgresql/16/bin';
const migrationPath = join(root, 'packages/orbit-core/sql/migrations/157_card_revisions.sql');
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

async function isolatedPostgres(t) {
  if (!existsSync(join(pgBin, 'initdb')) || !existsSync(join(pgBin, 'pg_ctl'))) throw new Error('Native PostgreSQL 16 binaries are required; never fall back to DATABASE_URL.');
  // pg reads PG* defaults lazily even when host/user/database are explicit.
  // This test file has its own Node process; restore inherited values at teardown.
  const inherited = Object.entries(process.env).filter(([key]) => key.startsWith('PG') || key === 'DATABASE_URL');
  for (const [key] of inherited) delete process.env[key];
  t.after(() => { for (const [key, value] of inherited) process.env[key] = value; });
  const directory = mkdtempSync(join(tmpdir(), 'orbit-card-revisions-pg-'));
  const data = join(directory, 'database'), socket = join(directory, 'socket');
  mkdirSync(socket, { mode: 0o700 });
  const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: directory, LC_ALL: 'C', LANG: 'C', TZ: 'UTC' };
  const port = randomInt(20_000, 60_000);
  const pg = (binary, args) => execFileSync(join(pgBin, binary), args, { env, cwd: directory, encoding: 'utf8', timeout: 30_000, stdio: 'pipe' });
  let pool;
  t.after(async () => {
    try { if (pool) await pool.end(); }
    finally {
      // The path comes only from this test's mkdtemp, never from external configuration.
      if (existsSync(join(data, 'postmaster.pid'))) pg('pg_ctl', ['-D', data, '-m', 'immediate', '-w', '-t', '20', 'stop']);
      rmSync(directory, { recursive: true, force: true });
    }
  });
  pg('initdb', ['-D', data, '-U', 'orbit_fixture', '-A', 'trust', '--encoding=UTF8', '--locale=C', '--no-instructions']);
  pg('pg_ctl', ['-D', data, '-l', join(directory, 'postgres.log'), '-w', '-t', '20', '-o', `-k ${quote(socket)} -p ${port} -c listen_addresses='' -c fsync=off`, 'start']);
  pool = new Pool({ host: socket, port, user: 'orbit_fixture', database: 'postgres', password: 'ephemeral-fixture-unused', ssl: false, max: 4, connectionTimeoutMillis: 3000, options: '-c statement_timeout=5000' });
  const identity = (await pool.query("SELECT current_setting('data_directory') AS data_directory,current_setting('listen_addresses') AS listen_addresses,inet_server_addr() AS inet,current_user AS actor")).rows[0];
  assert.equal(realpathSync(identity.data_directory), realpathSync(data));
  assert.equal(identity.listen_addresses, ''); assert.equal(identity.inet, null); assert.equal(identity.actor, 'orbit_fixture');
  return pool;
}

// Tables are intentionally synthetic. Only the new migration is applied, never runtime migrations.
test('card revisions migration and helpers preserve history in an isolated native PostgreSQL cluster', { timeout: 90_000 }, async t => {
  const pool = await isolatedPostgres(t);
  assert.ok(existsSync(migrationPath), 'Stage 02 migration must exist before this fixture is run');
  const ts = require('typescript');
  const helpers = {};
  const compiled = ts.transpileModule(readFileSync(join(root, 'packages/orbit-core/src/card-versions.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  // Compile the pure helper in memory; no tsx cache or application module is loaded.
  runInNewContext(compiled.outputText, { exports: helpers });
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
    CREATE TABLE card_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'queued');
    CREATE TABLE card_ai_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'queued');
  `);
  const baseline = randomUUID();
  await pool.query('INSERT INTO cards(id,title) VALUES($1,$2)', [baseline, 'Demand before migration']);
  for (const table of ['card_runs', 'card_ai_runs']) await pool.query(`INSERT INTO ${table}(card_id,status) VALUES($1,'success')`, [baseline]);
  await pool.query(readFileSync(migrationPath, 'utf8'));
  const card = async id => (await pool.query('SELECT * FROM cards WHERE id=$1', [id])).rows[0];
  const history = async id => (await pool.query('SELECT * FROM card_revisions WHERE card_id=$1 ORDER BY revision', [id])).rows;
  const create = async title => {
    const id = randomUUID();
    await pool.query('INSERT INTO cards(id,title) VALUES($1,$2)', [id, title]);
    return id;
  };
  const constraint = promise => assert.rejects(promise, error => error.code === '23514');

  await t.test('baseline and legacy runs are classified without inventing historical revisions', async () => {
    assert.equal((await card(baseline)).card_revision, 1);
    const snapshots = await history(baseline);
    assert.equal(snapshots.length, 1); assert.equal(snapshots[0].snapshot.title, 'Demand before migration');
    assert.equal(snapshots[0].snapshot.schema_version, 1);
    assert.match(snapshots[0].content_hash, /^[0-9a-f]{64}$/);
    for (const table of ['card_runs', 'card_ai_runs']) {
      const run = (await pool.query(`SELECT r.*,${helpers.cardRevisionFreshnessSql()} AS freshness FROM ${table} r JOIN cards c ON c.id=r.card_id WHERE c.id=$1`, [baseline])).rows[0];
      assert.equal(run.card_revision, null); assert.equal(run.freshness, 'unversioned');
      assert.equal(helpers.revisionFreshness(run.card_revision, 1, run.status), run.freshness);
    }
  });

  await t.test('edits produce monotonic immutable snapshots; noop and movement do not advance demand', async () => {
    const id = await create('Original demand');
    await pool.query("UPDATE cards SET title='Updated demand' WHERE id=$1", [id]);
    await pool.query("UPDATE cards SET description='Requirements details' WHERE id=$1", [id]);
    await pool.query("UPDATE cards SET title=title,description=description,position=42,list_id=$2,completed=true,updated_at=now() WHERE id=$1", [id, randomUUID()]);
    assert.equal((await card(id)).card_revision, 3);
    const snapshots = await history(id);
    assert.deepEqual(snapshots.map(item => item.revision), [1, 2, 3]);
    assert.equal(snapshots[0].snapshot.title, 'Original demand');
    assert.equal(snapshots[2].snapshot.description, 'Requirements details');
    assert.equal(new Set(snapshots.map(item => item.content_hash)).size, 3);
    for (const entry of snapshots) assert.match(entry.content_hash, /^[0-9a-f]{64}$/);
    await constraint(pool.query("UPDATE card_revisions SET snapshot='{}' WHERE card_id=$1", [id]));
    await constraint(pool.query('DELETE FROM card_revisions WHERE card_id=$1', [id]));
    await constraint(pool.query("INSERT INTO card_revisions(card_id,revision,snapshot,content_hash) VALUES($1,4,'{}',repeat('0',64))", [id]));
    await constraint(pool.query('UPDATE cards SET card_revision=99 WHERE id=$1', [id]));
    await constraint(pool.query("INSERT INTO cards(id,title,card_revision) VALUES($1,'forged',9)", [randomUUID()]));
    assert.deepEqual((await history(id)).map(item => item.revision), [1, 2, 3]);
  });

  await t.test('the actual card PATCH SQL rejects concurrent stale overwrites in every runtime', async () => {
    const statements = ['dev','prod','safdoulas','suinda'].map(runtime => {
      const source = readFileSync(join(root, runtime, 'app/apps/api/src/main.ts'), 'utf8');
      assert.match(source, /c\.card_revision,c\.title,c\.description,slot\.url_token/, 'board response must refresh the effective source revision');
      const statement = source.match(/const card=await this\.db\.one\(`(UPDATE cards SET title=\$2,[^`]+WHERE id=\$1 AND \(\$17::integer IS NULL OR card_revision=\$17\) RETURNING \*)`,/);
      assert.ok(statement, `${runtime} must preserve the atomic CAS query`);
      return statement[1];
    });
    assert.ok(statements.every(sql=>sql===statements[0]));
    const id=await create('Concurrent overwrite');
    const params = description => [id,'Concurrent overwrite',description,null,null,null,null,null,0,'normal',null,null,null,null,false,null,1];
    const results=await Promise.all([pool.query(statements[0],params('First candidate')),pool.query(statements[0],params('Second candidate'))]);
    assert.deepEqual(results.map(result=>result.rowCount).sort(),[0,1]);
    assert.equal((await card(id)).card_revision,2);
    assert.equal((await history(id)).length,2);
    assert.equal((await pool.query(statements[0],params('Stale overwrite'))).rowCount,0);
    assert.notEqual((await card(id)).description,'Stale overwrite');
  });

  await t.test('timestamp equality is stable across session time zones', async () => {
    const id = await create('Scheduled demand'), client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL TIME ZONE 'America/Recife'");
      await client.query("UPDATE cards SET due_date='2026-11-13 12:00:00-03' WHERE id=$1", [id]);
      const before = (await client.query('SELECT content_hash FROM card_revisions WHERE card_id=$1 AND revision=2', [id])).rows[0].content_hash;
      await client.query("SET LOCAL TIME ZONE 'Asia/Tokyo'");
      await client.query("UPDATE cards SET due_date='2026-11-14 00:00:00+09' WHERE id=$1", [id]);
      const current = (await client.query('SELECT card_revision FROM cards WHERE id=$1', [id])).rows[0];
      assert.equal(current.card_revision, 2);
      const snapshot = (await client.query('SELECT * FROM card_revisions WHERE card_id=$1 AND revision=2', [id])).rows[0];
      assert.equal(snapshot.content_hash, before); assert.equal(snapshot.snapshot.due_date, '2026-11-13T15:00:00.000000Z');
      await client.query('COMMIT');
    } finally { await client.query('ROLLBACK'); client.release(); }
  });

  await t.test('new generic and AI runs require the captured current revision and never rebind it', async () => {
    const id = await create('Bind both queues');
    for (const table of ['card_runs', 'card_ai_runs']) {
      await constraint(pool.query(`INSERT INTO ${table}(card_id) VALUES($1)`, [id]));
      const run = (await pool.query(`INSERT INTO ${table}(card_id,card_revision) VALUES($1,1) RETURNING *`, [id])).rows[0];
      await constraint(pool.query(`UPDATE ${table} SET card_revision=2 WHERE id=$1`, [run.id]));
      await constraint(pool.query(`UPDATE ${table} SET card_id=$2 WHERE id=$1`, [run.id, baseline]));
      await constraint(pool.query(`UPDATE ${table} SET card_revision=NULL WHERE id=$1`, [run.id]));
    }
    await pool.query("UPDATE cards SET description='New revision after prompt preparation' WHERE id=$1", [id]);
    for (const table of ['card_runs', 'card_ai_runs']) {
      await constraint(pool.query(`INSERT INTO ${table}(card_id,card_revision) VALUES($1,1)`, [id]));
      await pool.query(`INSERT INTO ${table}(card_id,card_revision) VALUES($1,2)`, [id]);
    }
  });

  await t.test('freshness remains distinct from executor success in both queues', async () => {
    const id = await create('Output freshness');
    for (const table of ['card_runs', 'card_ai_runs']) await pool.query(`INSERT INTO ${table}(card_id,card_revision,status) VALUES($1,1,'queued')`, [id]);
    const assertFreshness = async expected => {
      const current = (await card(id)).card_revision;
      for (const table of ['card_runs', 'card_ai_runs']) {
        const run = (await pool.query(`SELECT r.*,${helpers.cardRevisionFreshnessSql()} AS freshness FROM ${table} r JOIN cards c ON c.id=r.card_id WHERE c.id=$1`, [id])).rows[0];
        assert.equal(run.freshness, expected);
        assert.equal(helpers.revisionFreshness(run.card_revision, current, run.status), expected);
      }
    };
    await assertFreshness('pending');
    for (const table of ['card_runs', 'card_ai_runs']) await pool.query(`UPDATE ${table} SET status='success' WHERE card_id=$1`, [id]);
    await assertFreshness('current');
    await pool.query("UPDATE cards SET title='Changed after completed execution' WHERE id=$1", [id]);
    await assertFreshness('stale');
    for (const table of ['card_runs', 'card_ai_runs']) assert.equal((await pool.query(`SELECT status FROM ${table} WHERE card_id=$1`, [id])).rows[0].status, 'success');
  });

  await t.test('completion captures the observed revision once and never fabricates legacy provenance', async () => {
    const id = await create('Completion provenance');
    for (const table of ['card_runs', 'card_ai_runs']) {
      await pool.query(`INSERT INTO ${table}(card_id,card_revision,status) VALUES($1,1,'running')`, [id]);
      await constraint(pool.query(`INSERT INTO ${table}(card_id,card_revision,finished_card_revision) VALUES($1,1,1)`, [id]));
    }
    await pool.query("UPDATE cards SET title='Changed during execution' WHERE id=$1", [id]);
    for (const table of ['card_runs', 'card_ai_runs']) {
      await pool.query(`UPDATE ${table} SET status='success' WHERE card_id=$1`, [id]);
      const completed = (await pool.query(`SELECT card_revision,finished_card_revision,status FROM ${table} WHERE card_id=$1`, [id])).rows[0];
      assert.equal(completed.card_revision, 1); assert.equal(completed.finished_card_revision, 2); assert.equal(completed.status, 'success');
      await constraint(pool.query(`UPDATE ${table} SET finished_card_revision=3 WHERE card_id=$1`, [id]));
    }
    await pool.query("UPDATE cards SET description='Edited after completion' WHERE id=$1", [id]);
    for (const table of ['card_runs', 'card_ai_runs']) {
      await pool.query(`UPDATE ${table} SET status=status WHERE card_id=$1`, [id]);
      assert.equal((await pool.query(`SELECT finished_card_revision FROM ${table} WHERE card_id=$1`, [id])).rows[0].finished_card_revision, 2);
      await pool.query(`UPDATE ${table} SET status=status WHERE card_id=$1`, [baseline]);
      assert.equal((await pool.query(`SELECT finished_card_revision FROM ${table} WHERE card_id=$1`, [baseline])).rows[0].finished_card_revision, null);
    }
  });

  await t.test('card and history rollback atomically, and parent deletion preserves existing cascade behavior', async () => {
    const id = await create('Transaction demand'), client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE cards SET title='Rolled-back demand' WHERE id=$1", [id]);
      assert.equal((await client.query('SELECT count(*)::int AS count FROM card_revisions WHERE card_id=$1', [id])).rows[0].count, 2);
      await client.query('ROLLBACK');
    } finally { await client.query('ROLLBACK'); client.release(); }
    assert.equal((await card(id)).card_revision, 1); assert.equal((await history(id)).length, 1);
    for (const table of ['card_runs', 'card_ai_runs']) await pool.query(`INSERT INTO ${table}(card_id,card_revision) VALUES($1,1)`, [id]);
    await pool.query('DELETE FROM cards WHERE id=$1', [id]);
    assert.equal(await card(id), undefined); assert.equal((await history(id)).length, 0);
    for (const table of ['card_runs', 'card_ai_runs']) assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE card_id=$1`, [id])).rows[0].count, 0);
  });

  await t.test('enqueue share locks prevent card mutation until the capture transaction ends', async () => {
    const id = await create('Locked enqueue'), capture = await pool.connect(), writer = await pool.connect();
    try {
      await capture.query('BEGIN');
      await capture.query('INSERT INTO card_runs(card_id,card_revision) VALUES($1,1)', [id]);
      await writer.query('BEGIN'); await writer.query("SET LOCAL lock_timeout='100ms'");
      await assert.rejects(writer.query("UPDATE cards SET title='Concurrent edit' WHERE id=$1", [id]), error => error.code === '55P03');
      await writer.query('ROLLBACK'); await capture.query('COMMIT');
      await writer.query("UPDATE cards SET title='Edit after capture' WHERE id=$1", [id]);
      assert.equal((await card(id)).card_revision, 2);
      const run = (await pool.query(`SELECT ${helpers.cardRevisionFreshnessSql()} AS freshness FROM card_runs r JOIN cards c ON c.id=r.card_id WHERE c.id=$1`, [id])).rows[0];
      assert.equal(run.freshness, 'stale');
    } finally { await capture.query('ROLLBACK'); await writer.query('ROLLBACK'); capture.release(); writer.release(); }
  });

  await t.test('a run prepared before a concurrent edit cannot bind an older snapshot after commit', async () => {
    const id = await create('Reverse lock direction'), writer = await pool.connect(), capture = await pool.connect();
    try {
      await writer.query('BEGIN'); await writer.query("UPDATE cards SET title='Uncommitted edit' WHERE id=$1", [id]);
      await capture.query('BEGIN'); await capture.query("SET LOCAL lock_timeout='100ms'");
      await assert.rejects(capture.query('INSERT INTO card_ai_runs(card_id,card_revision) VALUES($1,1)', [id]), error => error.code === '55P03');
      await capture.query('ROLLBACK'); await writer.query('COMMIT');
      await constraint(capture.query('INSERT INTO card_ai_runs(card_id,card_revision) VALUES($1,1)', [id]));
      await capture.query('INSERT INTO card_ai_runs(card_id,card_revision) VALUES($1,2)', [id]);
      assert.deepEqual((await history(id)).map(item => item.revision), [1, 2]);
    } finally { await writer.query('ROLLBACK'); await capture.query('ROLLBACK'); writer.release(); capture.release(); }
  });
});
