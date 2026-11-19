import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomInt, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(join(root, 'dev/app/package.json'));
const modulePath = join(root, 'packages/orbit-core/src/execution/context-manifest.ts');
const migrationPath = join(root, 'packages/orbit-core/sql/migrations/160_context_manifests.sql');
const pgBin = '/usr/lib/postgresql/16/bin';
const clone = value => JSON.parse(JSON.stringify(value));
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const scrubbed = key => key === 'HOME' || key.includes('DATABASE_URL') || /^(PG|CODEX|OPENAI)/.test(key);

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
  const directory = mkdtempSync(join(tmpdir(), 'orbit-context-manifests-pg-'));
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
  pg('initdb', ['-D', data, '-U', 'orbit_context_fixture', '-A', 'trust', '--encoding=UTF8', '--locale=C', '--no-instructions']);
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
  pool = new Pool({ host: socket, port, user: 'orbit_context_fixture', database: 'postgres', password: 'synthetic-unused', ssl: false, max: 8, connectionTimeoutMillis: 3000, options: '-c statement_timeout=5000' });
  // Before the first DDL, prove physical database ownership, PG16 and no TCP listener.
  const identity = (await pool.query("SELECT current_setting('data_directory') AS directory,current_setting('listen_addresses') AS listeners,inet_server_addr() AS address,current_user AS actor,current_setting('server_version_num')::int AS version")).rows[0];
  assert.equal(realpathSync(identity.directory), realpathSync(data));
  assert.equal(identity.listeners, ''); assert.equal(identity.address, null); assert.equal(identity.actor, 'orbit_context_fixture');
  assert.ok(identity.version >= 160000 && identity.version < 170000);
  await pool.query('CREATE TABLE fake_cards(id uuid PRIMARY KEY,title text NOT NULL)');
  await pool.query(readFileSync(migrationPath, 'utf8'));
  t.diagnostic(`PostgreSQL ${identity.version}; owned mkdtemp verified before DDL; Unix socket only; no product schema/bootstrap`);
  return { pool, directory, connections, denied, blockedLoaderIpc };
}

function loadCore() {
  // Reviewable import boundary: canonical module depends only on node:crypto.
  const imports = [...readFileSync(modulePath, 'utf8').matchAll(/^import\s+.*?from\s+['"]([^'"]+)['"]/gm)].map(match => match[1]);
  assert.deepEqual(imports, ['node:crypto']);
  const before = new Set(Object.keys(require.cache));
  require('tsx/cjs/api').register();
  const core = require(modulePath);
  const added = Object.keys(require.cache).filter(path => !before.has(path));
  assert.deepEqual(added.filter(path => path.startsWith(join(root, 'packages/orbit-core/src/'))), [modulePath]);
  assert.ok(!added.some(path => /\/apps\/api\/src\//.test(path)), 'no app bootstrap, Db constructor, quotas or providers imported');
  return core;
}

async function transaction(pool, callback) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await callback(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

function input(core, queue = 'card_runs') {
  const scope = { runtimeId: 'dev', projectId: randomUUID(), workspaceId: randomUUID(), actorId: randomUUID() };
  return {
    identity: { ...scope, queue, runId: randomUUID(), cardId: randomUUID(), cardRevision: 7, executor: 'synthetic-no-executor', executionType: 'analysis' },
    sources: [{ schemaVersion: 1, id: 'selected-rules', type: 'project-rule', origin: 'explicit-fixture', logicalPath: 'rules.md', resourceId: 'fixture-rule', ownerId: scope.projectId, scope, version: '1', contentHash: core.hashContextText('synthetic documentary rule'), availability: 'available', required: true, selectionReason: 'Explicit fixture selection', dependencies: [], trust: 'documental', observedAt: '2026-01-01T00:00:00.000Z' }],
    configuration: { plugins: { core: '1.6.2' }, permissions: ['read'] },
    git: { reference: 'HEAD', baseCommit: 'a'.repeat(40) }, checkout: null,
    assemblyPolicy: { version: 1, selection: 'explicit' },
    material: { contextHash: core.hashContextText('synthetic context'), promptHash: core.hashContextText('synthetic prompt') }, capturedAt: '2026-01-01T00:00:00.000Z',
  };
}

async function insertRaw(pool, manifest, overrides = {}) {
  const identity = manifest.identity;
  const row = { id: randomUUID(), queue: identity.queue, runId: identity.runId, turn: 0, parentId: null, cardId: identity.cardId, cardRevision: identity.cardRevision, projectId: identity.projectId, workspaceId: identity.workspaceId, actorId: identity.actorId, runtimeId: identity.runtimeId, fingerprint: manifest.fingerprint, integrityHash: manifest.integrityHash, manifest, ...overrides };
  return pool.query(`INSERT INTO context_run_manifests(id,queue,run_id,turn,parent_id,card_id,card_revision,project_id,workspace_id,actor_id,runtime_id,fingerprint,integrity_hash,manifest)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb) RETURNING *`,
  [row.id,row.queue,row.runId,row.turn,row.parentId,row.cardId,row.cardRevision,row.projectId,row.workspaceId,row.actorId,row.runtimeId,row.fingerprint,row.integrityHash,JSON.stringify(row.manifest)]);
}

test('04 context manifests use canonical pure module and disposable PostgreSQL 16', { timeout: 90000 }, async t => {
  const { pool, directory, connections, denied, blockedLoaderIpc } = await isolatedPostgres(t);
  const core = loadCore(), repo = new core.ContextManifestRepository(pool);
  const store = (manifest, options) => transaction(pool, client => repo.store(client, manifest, options));

  await t.test('T7: both queues return their original initial capture on equivalent retry', async () => {
    for (const queue of ['card_runs', 'card_ai_runs']) {
      const original = input(core, queue), first = await store(core.createContextManifest(original));
      const retry = clone(original); retry.capturedAt = '2026-02-01T00:00:00.000Z'; retry.sources[0].observedAt = retry.capturedAt;
      const again = await store(core.createContextManifest(retry));
      assert.equal(first.id, again.id); assert.equal(again.manifest.capturedAt, original.capturedAt);
      assert.equal(again.manifest.integrityHash, first.manifest.integrityHash); assert.equal(again.turn, 0);
      assert.equal((await repo.latest(queue, original.identity.runId)).id, first.id);
      const different = clone(original); different.material.promptHash = core.hashContextText('replacement');
      await assert.rejects(() => store(core.createContextManifest(different)), { code: 'CONTEXT_MANIFEST_CONFLICT' });
      assert.equal((await pool.query('SELECT count(*) FROM context_run_manifests WHERE queue=$1 AND run_id=$2', [queue, original.identity.runId])).rows[0].count, '1');
    }
  });

  await t.test('SQL160 preserves JSONB evidence and binds every relational identity and digest column', async () => {
    const manifest = core.createContextManifest(input(core)), stored = await store(manifest);
    assert.deepEqual((await repo.get(stored.id)).manifest, manifest);
    for (const [key, value] of Object.entries({ queue: 'card_ai_runs', runId: randomUUID(), cardId: randomUUID(), cardRevision: 8, projectId: randomUUID(), workspaceId: randomUUID(), actorId: randomUUID(), runtimeId: 'suinda', fingerprint: 'b'.repeat(64), integrityHash: 'c'.repeat(64) })) {
      await assert.rejects(() => insertRaw(pool, manifest, { [key]: value }), error => error.code === '23514', `binding ${key}`);
    }
    for (const malformed of [[], null, {}, { ...clone(manifest), schemaVersion: 2 }]) {
      await assert.rejects(() => insertRaw(pool, manifest, { manifest: malformed }), error => error.code === '23514');
    }
    for (const malformed of ['invalid', '', 'A'.repeat(64)]) await assert.rejects(() => insertRaw(pool, manifest, { fingerprint: malformed }), error => error.code === '23514');
    const tampered = clone(manifest); tampered.sources[0].contentHash = core.hashContextText('tampered');
    assert.throws(() => core.assertContextManifestIntegrity(tampered), { code: 'CONTEXT_MANIFEST_INTEGRITY' });
    await assert.rejects(() => store(tampered), { code: 'CONTEXT_MANIFEST_INTEGRITY' });
  });

  await t.test('SQL160 rejects manifest UPDATE DELETE and TRUNCATE', async () => {
    const stored = await store(core.createContextManifest(input(core)));
    for (const sql of ['UPDATE context_run_manifests SET manifest=manifest WHERE id=$1', 'DELETE FROM context_run_manifests WHERE id=$1']) await assert.rejects(() => pool.query(sql, [stored.id]), { code: '55000' });
    await assert.rejects(() => pool.query('TRUNCATE context_run_manifests CASCADE'), { code: '55000' });
    assert.equal((await repo.get(stored.id)).manifest.integrityHash, stored.manifest.integrityHash);
  });

  await t.test('T4: deleting a synthetic card leaves context and its captured revision retained without card FK', async () => {
    const original = input(core); await pool.query('INSERT INTO fake_cards VALUES($1,$2)', [original.identity.cardId, 'synthetic card']);
    const stored = await store(core.createContextManifest(original));
    await pool.query('DELETE FROM fake_cards WHERE id=$1', [original.identity.cardId]);
    assert.equal((await repo.get(stored.id)).manifest.identity.cardRevision, 7);
    const fks = (await pool.query("SELECT confrelid::regclass::text AS target FROM pg_constraint WHERE conrelid='context_run_manifests'::regclass AND contype='f'")).rows;
    assert.deepEqual(fks.map(row => row.target), ['context_run_manifests']);
  });

  await t.test('T13 T14 T17: Suinda source and same-ID forged scope fail library capture and comparison', () => {
    const original = input(core), manifest = core.createContextManifest(original);
    for (const [key, value] of Object.entries({ runtimeId: 'suinda', projectId: randomUUID(), workspaceId: randomUUID(), actorId: randomUUID() })) {
      const forged = clone(original); forged.sources[0].scope[key] = value;
      assert.equal(forged.sources[0].id, original.sources[0].id);
      assert.throws(() => core.createContextManifest(forged), { code: 'CONTEXT_SOURCE_SCOPE' });
      assert.equal(core.compareContextManifest(manifest, { sources: forged.sources }).status, 'unavailable');
    }
    const malformed = clone(original); malformed.sources[0].dependencies = 'not-an-array';
    assert.throws(() => core.createContextManifest(malformed), { code: 'CONTEXT_MANIFEST_INVALID' });
    assert.equal(manifest.sources[0].trust, 'documental', 'fixture supplies no historical approval');
  });

  await t.test('initial concurrent transactions return one immutable snapshot', async () => {
    const original = input(core), manifest = core.createContextManifest(original);
    const results = await Promise.all([store(manifest), store(manifest)]);
    assert.equal(results[0].id, results[1].id);
    assert.equal((await pool.query('SELECT count(*) FROM context_run_manifests WHERE run_id=$1', [original.identity.runId])).rows[0].count, '1');
  });

  await t.test('CAS parent allows one concurrent answer turn; unique SQL parent and identity binding reject forks', async () => {
    const original = input(core, 'card_ai_runs'), initial = await store(core.createContextManifest(original));
    const answer = clone(original); answer.material.promptHash = core.hashContextText('synthetic authorized answer');
    const answerManifest = core.createContextManifest(answer);
    const results = await Promise.allSettled([store(answerManifest, { parentId: initial.id }), store(answerManifest, { parentId: initial.id })]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'CONTEXT_MANIFEST_PARENT');
    const child = results.find(result => result.status === 'fulfilled').value;
    assert.equal(child.parentId, initial.id); assert.equal(child.turn, 1);
    assert.equal((await repo.get(initial.id)).manifest.material.promptHash, original.material.promptHash);
    await assert.rejects(() => insertRaw(pool, answerManifest, { turn: 1, parentId: initial.id }), { code: '23505' });
    const other = core.createContextManifest(input(core, 'card_ai_runs'));
    await assert.rejects(() => insertRaw(pool, other, { turn: 2, parentId: child.id }), { code: '23514' });
    await assert.rejects(() => insertRaw(pool, answerManifest, { turn: 3, parentId: child.id }), { code: '23514' });
    const next = await store(answerManifest, { parentId: child.id }); assert.equal(next.turn, 2);
  });

  await t.test('T9: observations append separately and SQL denies their mutation or deletion', async () => {
    const original = input(core), stored = await store(core.createContextManifest(original));
    const before = JSON.stringify((await repo.get(stored.id)).manifest);
    const changed = clone(original.sources); changed[0].contentHash = core.hashContextText('changed during synthetic work');
    const first = await repo.observe(stored.id, { phase: 'before_executor', compatibility: core.compareContextManifest(stored.manifest, { sources: original.sources }), observedAt: '2026-01-01T00:00:00.000Z' });
    await repo.observe(stored.id, { phase: 'after_executor', compatibility: core.compareContextManifest(stored.manifest, { sources: changed }), delivery: { promptHash: original.material.promptHash, executorStatus: 'success', resultHash: core.hashContextText('retained synthetic result') }, observedAt: '2026-01-01T00:01:00.000Z' });
    const history = await repo.history(stored.id);
    assert.deepEqual(history.map(item => item.compatibility.status), ['compatible', 'changed']);
    assert.equal(history[1].delivery.executorStatus, 'success'); assert.equal(JSON.stringify((await repo.get(stored.id)).manifest), before);
    for (const sql of ['UPDATE context_manifest_verifications SET observation=observation WHERE id=$1', 'DELETE FROM context_manifest_verifications WHERE id=$1']) await assert.rejects(() => pool.query(sql, [first.id]), { code: '55000' });
    await assert.rejects(() => pool.query('TRUNCATE context_manifest_verifications'), { code: '55000' });
    assert.equal((await repo.history(stored.id)).length, 2);
  });

  await t.test('T12 T18: legacy remains absent; no Codex HOME, bootstrap, paid APIs or outbound sockets used', async () => {
    assert.equal(await repo.latest('card_runs', randomUUID()), null);
    assert.equal(core.compareContextManifest(null).status, 'legacy');
    assert.equal(process.env.HOME, directory); assert.equal(process.env.CODEX_HOME, undefined);
    assert.equal(existsSync(join(directory, '.codex')), false);
    assert.ok(!Object.keys(process.env).some(key => /^(CODEX|PG|OPENAI)/.test(key) || key.includes('DATABASE_URL')));
    assert.ok(connections.length > 0); assert.equal(denied.length, 0);
    t.diagnostic(`Only fixture pg Unix sockets connected; ${blockedLoaderIpc.length} optional tsx parent IPC probe(s) blocked. Canonical module imports node:crypto only; no executor/provider/quota path loaded.`);
  });
});
