import assert from 'node:assert/strict';
import { execFileSync, fork, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { assertPluginSettingsDatabaseBoundary, createPluginSettingsPrivatePool } from '../apps/api/src/plugins/plugin-settings-boundary';
import { PluginSettingsService } from '../apps/api/src/plugins/plugin-settings';
import { composePluginSettingsHost, pluginSettingsRuntimeConfiguration } from '../apps/api/src/plugins/plugin-settings-host';
import { Db } from '../apps/api/src/db';
import { PluginRegistry } from '../apps/api/src/execution/registries';

const bin = '/usr/lib/postgresql/16/bin';
const database = 'orbit_r5ca_fixture';
const manager = '9b687cff-d23e-4115-b8c2-d710d51e49bb';
const viewer = '5ebfcfe7-6b83-42ad-8d8a-50d62a812073';
const source = 'dev/app/apps/api/sql/migrations';

test('DEV plugin settings over HTTP with independent processes and PostgreSQL 16', { timeout: 65000 }, async t => {
  const host = await mkdtemp('/tmp/orbit-r6-http-');
  const data = join(host, 'data');
  const runner = (name: string, args: string[]) => execFileSync(join(bin, name), args, {
    env: { PATH: '/usr/bin:/bin', LANG: 'C' }, timeout: 15000, stdio: 'pipe',
  });
  const sql = (db: string, args: string[]) => runner('psql', [
    '-X', '-h', host, '-p', '55446', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', ...args,
  ]);
  const connection = { host, port: 55446, database };
  let owner = new Pool({ ...connection, user: 'http_owner', statement_timeout: 5000, idleTimeoutMillis: 500 });
  const general = new Pool({ ...connection, user: 'http_app', statement_timeout: 5000, idleTimeoutMillis: 500 });
  const children = new Set<ChildProcess>();
  const secret = randomBytes(32).toString('hex');
  const sign = (user: string, version = 0) => jwt.sign({ version }, secret, { subject: user });
  const auth = sign(manager);
  type Instance = { child: ChildProcess; url: string; };
  async function start(poll = 150, mode?: 'legacy' | 'paused'): Promise<Instance> {
    const child = fork(resolve('dev/app/experimental/fixtures/plugin-settings-http.ts'), [], {
      execArgv: ['--import', resolve('dev/app/node_modules/tsx/dist/loader.mjs')],
      env: { PATH: '/usr/bin:/bin', LANG: 'C', TSX_TSCONFIG_PATH: resolve('dev/app/experimental/tsconfig.plugin-settings.json'),
        R6_TEST_SOCKET: host, JWT_SECRET: secret, R6_TEST_POLL_MS: String(poll),
        ...(mode ? { ORBIT_PLUGIN_SETTINGS_MODE: mode } : {}) },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    children.add(child);
    const port = await Promise.race([
      once(child, 'message').then(([message]) => Number(message.port)),
      once(child, 'exit').then(([code]) => { throw new Error('Fixture API exited ' + code); }),
      delay(12000, undefined, { ref: false }).then(() => { throw new Error('Fixture API startup timeout'); }),
    ]);
    assert.ok(port);
    return { child, url: 'http://127.0.0.1:' + port };
  }
  async function ipc(instance: Instance, value: string) {
    const reply = once(instance.child, 'message');
    instance.child.send(value);
    return (await reply)[0];
  }
  async function stop(instance: Instance) {
    const done = once(instance.child, 'exit');
    instance.child.send('stop');
    assert.equal((await done)[0], 0);
    children.delete(instance.child);
  }
  const toggle = (instance: Instance, id: string, enabled: unknown, token = auth) => fetch(instance.url + '/plugins/' + id, {
    method: 'PATCH', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ enabled, revision: '999', reviewerId: viewer }), signal: AbortSignal.timeout(8000),
  });
  const entry = async (instance: Instance, id: string) => {
    const response = await fetch(instance.url + '/plugins', { headers: { authorization: 'Bearer ' + auth }, signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 200);
    return (await response.json() as { id: string; enabled: boolean; configuredEnabled: boolean }[]).find(plugin => plugin.id === id)!;
  };
  const revision = async () => Number((await owner.query('SELECT revision FROM editorial_authorization_generation')).rows[0].revision);
  let started = false;
  try {
    runner('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale']);
    runner('pg_ctl', ['-D', data, '-l', join(host, 'postgres.log'), '-o',
      `-k ${host} -p 55446 -c listen_addresses='' -c unix_socket_permissions=0700`, '-w', 'start']);
    started = true;
    for (const db of ['postgres', database]) {
      if (db === database) sql('postgres', ['-c', 'CREATE DATABASE orbit_r5ca_fixture OWNER http_owner']);
      const found = sql(db, ['-Atc', "SELECT current_setting('data_directory'),inet_server_addr() IS NULL,current_database()"])
        .toString().trim();
      assert.equal(found, `${data}|t|${db}`);
      if (db === 'postgres') sql(db, ['-c', 'CREATE ROLE http_owner LOGIN; CREATE ROLE http_app LOGIN; CREATE ROLE http_writer LOGIN; CREATE ROLE http_reader LOGIN']);
    }
    const settings = await readFile(join(source, '024_plugin_settings.sql'), 'utf8');
    const installs = await readFile(join(source, '142_optional_plugin_installations.sql'), 'utf8');
    sql(database, ['-c', `GRANT CREATE ON SCHEMA public TO http_app;
      SET ROLE http_app; ${settings} ${installs} RESET ROLE;
      SET ROLE http_owner;
      CREATE TABLE schema_migrations(version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());`]);
    await owner.query(`
      CREATE TABLE users(id uuid PRIMARY KEY,name text,email text,is_root boolean,disabled boolean,session_version integer);
      CREATE TABLE access_roles(id text PRIMARY KEY,name text,permissions text[]);
      CREATE TABLE access_grants(user_id uuid,role_id text,scope_type text,scope_id text);
      CREATE TABLE access_groups(id uuid,permissions text[]);
      CREATE TABLE access_group_members(group_id uuid,user_id uuid);
      CREATE TABLE access_user_exceptions(user_id uuid,permission_id text,effect text);
      CREATE TABLE access_permission_settings(permission_id text,enabled boolean);
      CREATE TABLE access_audit(actor_id uuid,action text,target text,scope_type text,scope_id uuid);
      GRANT SELECT ON users,access_roles,access_grants,access_groups,access_group_members,access_user_exceptions,access_permission_settings TO http_app;
      GRANT INSERT ON access_audit TO http_app;
    `);
    await owner.query("INSERT INTO users VALUES($1,'Manager','manager@test',false,false,0),($2,'Viewer','viewer@test',false,false,0)", [manager, viewer]);
    await owner.query("INSERT INTO access_roles VALUES('manager','Manager',ARRAY['plugins.manage','plugins.read']),('viewer','Viewer',ARRAY['plugins.read'])");
    await owner.query("INSERT INTO access_grants VALUES($1,'manager','global','*'),($2,'viewer','global','*')", [manager, viewer]);
    await t.test('legacy and paused HTTP modes use the same controller before cutover', async () => {
      const legacy = await start(100, 'legacy');
      assert.equal((await toggle(legacy, 'vault', false)).status, 200);
      assert.equal((await entry(legacy, 'vault')).enabled, false);
      assert.equal((await toggle(legacy, 'vault', true)).status, 200);
      await stop(legacy);
      const paused = await start(100, 'paused');
      assert.equal((await toggle(paused, 'vault', false)).status, 503);
      await stop(paused);
      assert.equal(sql(database, ['-Atc', "SELECT enabled FROM plugin_settings WHERE plugin_id='vault'"]).toString().trim(), 't');
    });
    await owner.end();
    sql(database, ['-v', 'approval=DISPOSABLE', '-v', 'owner_role=http_owner', '-v', 'app_role=http_app',
      '-v', 'writer_role=http_writer', '-v', 'reader_role=http_reader', '-f', 'tools/orbit/dev-db-cutover/prepare.sql']);
    owner = new Pool({ ...connection, user: 'http_owner', statement_timeout: 5000, idleTimeoutMillis: 500 });

    await t.test('host composition checks approval evidence, credential and migration integrity', async () => {
      const db = Object.create(Db.prototype) as Db;
      db.pool = general;
      const registry = new PluginRegistry();
      registry.register({ id: 'vault', name: 'Vault', version: '1.0.0' });
      const approvalFile = join(host, 'approval.json');
      const credentialFile = join(host, 'writer.json');
      const { rows: [{ domain_id: generationDomain }] } = await owner.query('SELECT domain_id FROM editorial_authorization_generation');
      const approval = { version: 1, database, generalRole: 'http_app', writerRole: 'http_writer', ownerRole: 'http_owner', generationDomain };
      const env = {
        ORBIT_PLUGIN_SETTINGS_MODE: 'participant',
        ORBIT_PLUGIN_SETTINGS_APPROVAL_FILE: approvalFile,
        ORBIT_PLUGIN_SETTINGS_WRITER_CREDENTIAL_FILE: credentialFile,
      };
      const rejection = /plugin_settings_participant_startup_refused/;
      const setup = () => composePluginSettingsHost(db, registry, new Map(), () => {}, env);
      assert.throws(() => pluginSettingsRuntimeConfiguration({ ORBIT_PLUGIN_SETTINGS_MODE: 'participant' }), /configuration_invalid/);
      await assert.rejects(setup(), rejection);
      await writeFile(approvalFile, JSON.stringify(approval), { mode: 0o600 });
      await writeFile(credentialFile, JSON.stringify({ ...connection, user: 'http_writer' }), { mode: 0o600 });
      await chmod(credentialFile, 0o644);
      await assert.rejects(setup(), rejection);
      await chmod(credentialFile, 0o600);
      await writeFile(approvalFile, JSON.stringify({ ...approval, generationDomain: '00000000-0000-0000-0000-000000000000' }));
      await assert.rejects(setup(), rejection);
      await writeFile(approvalFile, JSON.stringify({ ...approval, minimumRevision: '1' }));
      await assert.rejects(setup(), rejection);
      await writeFile(approvalFile, JSON.stringify({ ...approval, minimumRevision: '0' }));

      const { rows: [{ checksum }] } = await owner.query("SELECT checksum FROM schema_migrations WHERE version='212_editorial_authorization_generation.sql'");
      await owner.query("UPDATE schema_migrations SET checksum=repeat('0',64) WHERE version='212_editorial_authorization_generation.sql'");
      try { await assert.rejects(setup(), rejection); }
      finally { await owner.query("UPDATE schema_migrations SET checksum=$1 WHERE version='212_editorial_authorization_generation.sql'", [checksum]); }

      await owner.query("CREATE OR REPLACE VIEW orbit_plugin_settings_migration_212 WITH (security_barrier=true) AS SELECT '2619740b0897181d8503f398bc37a16d054b581c83843c9ae4df2bc8dab9d8e9'::text AS checksum");
      try { await assert.rejects(setup(), rejection); }
      finally {
        await owner.query("CREATE OR REPLACE VIEW orbit_plugin_settings_migration_212 WITH (security_barrier=true) AS SELECT checksum FROM public.schema_migrations WHERE version='212_editorial_authorization_generation.sql'");
      }

      await owner.query('GRANT INSERT ON plugin_settings TO http_app');
      try { await assert.rejects(setup(), rejection); }
      finally { await owner.query('REVOKE INSERT ON plugin_settings FROM http_app'); }
      await owner.query('GRANT SELECT ON users TO http_writer');
      try { await assert.rejects(setup(), rejection); }
      finally { await owner.query('REVOKE SELECT ON users FROM http_writer'); }
      sql(database, ['-c', 'ALTER ROLE http_writer NOLOGIN']);
      try { await assert.rejects(setup(), rejection); }
      finally { sql(database, ['-c', 'ALTER ROLE http_writer LOGIN']); }

      const service = await setup();
      await Promise.all([service.onModuleDestroy(), service.onModuleDestroy()]);
      await assert.rejects(service.toggle('vault', false, async () => {}), { status: 503 });
      const recovered = await setup();
      await recovered.onModuleDestroy();
      assert.equal(await revision(), 0);
    });

    await t.test('startup rejects elevated credentials and legacy mode cannot write after migration', async () => {
      const adminWriter = createPluginSettingsPrivatePool({ ...connection, user: 'http_owner' });
      const privateWriter = createPluginSettingsPrivatePool({ ...connection, user: 'http_writer' });
      try {
        await assert.rejects(assertPluginSettingsDatabaseBoundary(general, adminWriter), /boundary_unverified/);
        await assert.rejects(assertPluginSettingsDatabaseBoundary(privateWriter, privateWriter), /boundary_unverified/);
        await assertPluginSettingsDatabaseBoundary(general, privateWriter);
      } finally { await Promise.all([adminWriter.end(), privateWriter.end()]); }

      const db = Object.create(Db.prototype) as Db;
      db.pool = general;
      const registry = new PluginRegistry();
      registry.register({ id: 'vault', name: 'Vault', version: '1.0.0' });
      const preCutover = PluginSettingsService.beforeCutover(db, registry, new Map(), () => {},
        pluginSettingsRuntimeConfiguration({}).mode as 'legacy');
      const paused = PluginSettingsService.beforeCutover(db, registry, new Map(), () => {},
        pluginSettingsRuntimeConfiguration({ ORBIT_PLUGIN_SETTINGS_WRITER_CREDENTIAL_FILE: '/fixture/placeholder' }).mode as 'paused');
      for (const service of [preCutover, paused]) {
        await assert.rejects(service.toggle('vault', false, async () => {}), { status: 503 });
        await service.onModuleDestroy();
      }
      assert.equal(await revision(), 0);
    });

    await t.test('build guard detects Core projection drift without rewriting files', async () => {
      const api = 'dev/app/apps/api';
      const core = 'packages/orbit-core/src/execution';
      const checker = api + '/check-core-projections.mjs';
      execFileSync(process.execPath, [checker], { stdio: 'pipe' });
      const sandbox = join(host, 'parity');
      await mkdir(join(sandbox, api, 'src/execution'), { recursive: true });
      await mkdir(join(sandbox, core), { recursive: true });
      await copyFile(checker, join(sandbox, checker));
      for (const name of ['editorial-authorization-generation', 'editorial-plugin-settings-writer',
        'editorial-plugin-settings-orchestration', 'editorial-plugin-settings-recovery']) {
        await copyFile(`${api}/src/execution/${name}.ts`, join(sandbox, api, 'src/execution', name + '.ts'));
        await copyFile(`${core}/${name}.ts`, join(sandbox, core, name + '.ts'));
      }
      for (const src of [api + '/src', 'packages/orbit-core/src']) {
        await mkdir(join(sandbox, src, 'access'), { recursive: true });
        await copyFile(src + '/access/management.ts', join(sandbox, src, 'access/management.ts'));
      }
      execFileSync(process.execPath, [join(sandbox, checker)], { stdio: 'pipe' });
      const edited = join(sandbox, core, 'editorial-plugin-settings-writer.ts');
      await writeFile(edited, '// deliberate fixture drift');
      assert.throws(() => execFileSync(process.execPath, [join(sandbox, checker)], { stdio: 'pipe' }),
        /DEV Core projection differs: execution\/editorial-plugin-settings-writer.ts/);
      assert.equal(await readFile(edited, 'utf8'), '// deliberate fixture drift');
    });

    const a = await start(100);
    const b = await start(60000);
    assert.notEqual(a.child.pid, b.child.pid);

    await t.test('real guard, permissions, defaults and protected legacy DML', async () => {
      assert.equal((await toggle(a, 'vault', false, 'invalid')).status, 401);
      assert.equal((await toggle(a, 'vault', false, sign(viewer))).status, 403);
      await owner.query('UPDATE users SET session_version=1 WHERE id=$1', [manager]);
      assert.equal((await toggle(a, 'vault', false)).status, 401);
      await owner.query('UPDATE users SET session_version=0 WHERE id=$1', [manager]);
      assert.equal((await toggle(a, 'vault', 'false')).status, 400);
      assert.equal((await toggle(a, 'unregistered', false)).status, 404);
      assert.equal((await entry(a, 'default-off')).configuredEnabled, false);
      assert.equal(await revision(), 0);
      await assert.rejects(general.query("UPDATE plugin_settings SET enabled=false WHERE plugin_id='vault'"), { code: '42501' });
    });

    await t.test('two processes diverge, reread after duplicate hints, and recover after restart', async () => {
      assert.equal((await toggle(a, 'vault', false)).status, 200);
      assert.equal((await entry(a, 'vault-child')).enabled, false);
      assert.equal((await entry(b, 'vault')).enabled, true);
      await ipc(b, 'hint');
      await ipc(b, 'hint');
      assert.equal((await entry(b, 'vault')).enabled, false);
      assert.equal((await toggle(b, 'vault', true)).status, 200);
      const deadline = Date.now() + 2500;
      while (!(await entry(a, 'vault')).enabled) {
        assert.ok(Date.now() < deadline, 'periodic observation must recover a missed notification');
        await delay(25);
      }
      await ipc(b, 'hint');
      assert.equal((await entry(b, 'vault')).enabled, true);
      await stop(b);
      const restored = await start(100);
      assert.equal((await entry(restored, 'vault')).enabled, true);
      assert.equal((await entry(restored, 'default-off')).configuredEnabled, false);
      await stop(restored);
    });

    await t.test('offline writer freezes the local registry and reconnect recovers without replay', async () => {
      const other = await start(100);
      const initial = await revision();
      try {
        await ipc(a, 'disconnect-writer');
        assert.equal((await toggle(a, 'vault', false)).status, 503);
        assert.equal(await revision(), initial);
        assert.equal((await toggle(other, 'vault', false)).status, 200);
        assert.deepEqual(await ipc(a, 'hint'), { hint: false });
        assert.equal((await entry(a, 'vault')).enabled, true);
        await ipc(a, 'reconnect-writer');
        const deadline = Date.now() + 3000;
        while ((await entry(a, 'vault')).enabled) {
          assert.ok(Date.now() < deadline, 'poll should recover the authoritative snapshot');
          await delay(25);
        }
        assert.equal(await revision(), initial + 1);
        assert.equal((await toggle(other, 'vault', true)).status, 200);
        assert.deepEqual(await ipc(a, 'hint'), { hint: true });
      } finally {
        await ipc(a, 'reconnect-writer');
        await stop(other);
      }
    });

    await t.test('competing API processes leave the last mandatory view enabled', async () => {
      const second = await start(100);
      const first = await revision();
      const responses = await Promise.all([toggle(a, 'board-view', false), toggle(second, 'structured-view', false)]);
      assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
      assert.equal(await revision(), first + 1);
      const row = (await owner.query("SELECT plugin_id FROM plugin_settings WHERE NOT enabled AND plugin_id IN ('board-view','structured-view')")).rows[0];
      const other = row.plugin_id === 'board-view' ? 'structured-view' : 'board-view';
      const last = await toggle(second, other, false);
      assert.equal(last.status, 409);
      assert.equal((await last.json() as { code: string }).code, 'required_board_view');
      await stop(second);
    });

    await t.test('a role revoked after the last authorization check blocks the next command', async () => {
      const initial = await revision();
      const holder = await owner.connect();
      await holder.query('BEGIN');
      await holder.query('SELECT revision FROM editorial_authorization_generation FOR SHARE');
      const inFlight = toggle(a, 'vault', false);
      try {
        const deadline = Date.now() + 3000;
        for (;;) {
          const waiting = sql(database, ['-Atc', `SELECT EXISTS (SELECT FROM pg_stat_activity
            WHERE datname='orbit_r5ca_fixture' AND usename='http_writer' AND wait_event_type='Lock'
              AND query LIKE '%FOR UPDATE%')`]).toString().trim();
          if (waiting === 't') break;
          assert.ok(Date.now() < deadline, 'writer must wait after checking authorization');
          await delay(20);
        }
        await owner.query("DELETE FROM access_grants WHERE user_id=$1 AND role_id='manager'", [manager]);
      } finally {
        await holder.query('ROLLBACK');
        holder.release();
      }
      // Permission was checked before the SQL transaction. This is the observed
      // boundary of the toggle, and cannot be used as editorial authorization.
      assert.equal((await inFlight).status, 200);
      assert.equal((await toggle(a, 'vault', true)).status, 403);
      assert.equal(await revision(), initial + 1);
      await owner.query("INSERT INTO access_grants VALUES($1,'manager','global','*')", [manager]);
      assert.equal((await toggle(a, 'vault', true)).status, 200);
    });

    await t.test('registry and notification failures preserve COMMIT; lost ACK never replays', async () => {
      const initial = await revision();
      await ipc(a, 'registry');
      const stale = await toggle(a, 'vault', false);
      assert.equal(stale.status, 200);
      assert.equal((await stale.json() as { sync: string }).sync, 'stale');
      assert.equal((await entry(a, 'vault')).enabled, false);
      await ipc(a, 'notification');
      assert.equal((await toggle(a, 'vault', true)).status, 200);
      await ipc(a, 'ack');
      const uncertain = await toggle(a, 'vault', false);
      assert.equal(uncertain.status, 503);
      assert.equal((await uncertain.json() as { code: string }).code, 'commit_uncertain');
      assert.equal(await revision(), initial + 3);
      assert.equal((await entry(a, 'vault')).enabled, false);
      const restarted = await start();
      assert.equal((await entry(restarted, 'vault')).enabled, false);
      await stop(restarted);
    });
    await stop(a);
  } finally {
    for (const child of children) {
      if (child.exitCode !== null) continue;
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
    await Promise.all([owner.ending ? undefined : owner.end(), general.end()]);
    if (started) runner('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
    await rm(host, { recursive: true, force: true });
  }
});
