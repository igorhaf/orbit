import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { EditorialAuthorizationGenerationRepository as Repository } from '../../../packages/orbit-core/src/execution/editorial-authorization-generation';
import { recoverEditorialPluginSetting } from '../../../packages/orbit-core/src/execution/editorial-plugin-settings-recovery';
import { RequiredBoardViewError, writeEditorialPluginSetting } from '../../../packages/orbit-core/src/execution/editorial-plugin-settings-writer';

const { Pool } = createRequire(resolve('forge/app/package.json'))('pg');
const database = 'orbit_r5ca_fixture';
const [owner, app, writer, reader] = ['fixture_owner', 'fixture_app', 'fixture_writer', 'fixture_reader'];
const names = { owner_role: owner, app_role: app, writer_role: writer, reader_role: reader };
const migrations = 'forge/app/apps/api/sql/migrations';
const scripts = 'tools/orbit/dev-db-cutover';
const migration212 = 'packages/orbit-core/sql/migrations/212_editorial_authorization_generation.sql';
const legacy = "INSERT INTO plugin_settings(plugin_id,enabled) VALUES('vault',false) ON CONFLICT(plugin_id) DO UPDATE SET enabled=EXCLUDED.enabled";
const denied = { code: '42501' };

test('R5C-A transitions legacy ownership on a private PostgreSQL 16 cluster', { timeout: 60000 }, async t => {
  const socket = await mkdtemp(join(tmpdir(), 'orbit-r5ca-'));
  const data = join(socket, 'data');
  const port = 55444;
  const operator = userInfo().username;
  const connection = ['-h', socket, '-p', String(port), '-U', operator];
  const run = (bin: string, args: string[]) => execFileSync(join('/usr/lib/postgresql/16/bin', bin), args, {
    env: { PATH: '/usr/bin:/bin', LANG: 'C' }, timeout: 15000, stdio: 'pipe',
  });
  const sql = (command: string, db = database) =>
    run('psql', ['-X', ...connection, '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', command]).toString().trim();
  const script = (name: string, mode = 'DISPOSABLE') => run('psql', [
    '-X', ...connection, '-d', database, '-v', 'approval=' + mode,
    ...Object.entries(names).flatMap(([key, value]) => ['-v', key + '=' + value]),
    '-f', join(scripts, name + '.sql'),
  ]);
  const pools: any[] = [];
  const connect = (user: string) => {
    const pool = new Pool({ host: socket, port, database, user, connectionTimeoutMillis: 2000,
      options: '-c lock_timeout=3000 -c statement_timeout=5000' });
    pools.push(pool);
    return pool;
  };

  let running = false;
  try {
    run('initdb', ['-D', data, '-A', 'trust', '--no-locale']);
    run('pg_ctl', ['-D', data, '-l', join(socket, 'postgres.log'), '-o',
      `-k ${socket} -p ${port} -c listen_addresses='' -c unix_socket_permissions=0700`, '-w', 'start']);
    running = true;
    assert.equal(sql('SHOW data_directory', 'postgres'), data);
    for (const role of Object.values(names)) sql(`CREATE ROLE ${role} LOGIN`, 'postgres');
    sql(`CREATE DATABASE ${database} OWNER ${owner}`, 'postgres');
    const [settings, installations] = await Promise.all([
      readFile(join(migrations, '024_plugin_settings.sql'), 'utf8'),
      readFile(join(migrations, '142_optional_plugin_installations.sql'), 'utf8'),
    ]);
    sql(`GRANT USAGE, CREATE ON SCHEMA public TO ${app};
      SET ROLE ${app}; ${settings} ${installations} ${legacy}; RESET ROLE;
      SET ROLE ${owner};
      CREATE TABLE schema_migrations(version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE ordinary_audit(message text NOT NULL);
      GRANT SELECT, INSERT ON ordinary_audit TO ${app};`);
    assert.equal(sql("SELECT relowner::regrole FROM pg_class WHERE oid='plugin_settings'::regclass"), app);
    assert.equal(sql("SELECT enabled FROM plugin_settings WHERE plugin_id='vault'"), 'f');
    assert.equal(sql("SELECT to_regclass('editorial_authorization_generation')"), '');

    await t.test('preflight repeats and preparation rejects drift without leaving partial changes', () => {
      script('preflight');
      script('preflight');
      assert.throws(() => script('prepare', 'OPERATOR_APPROVED'), /Unexpected target/);
      sql(`GRANT ${owner} TO ${app} WITH INHERIT FALSE, SET TRUE`);
      assert.throws(() => script('preflight'), /without memberships/);
      sql(`REVOKE ${owner} FROM ${app}`);
      sql(`SET ROLE ${app}; CREATE TABLE unreviewed(id integer)`);
      assert.throws(() => script('prepare'), /owns additional objects/);
      sql('DROP TABLE unreviewed');
      sql('CREATE ROLE unexpected');
      sql('GRANT UPDATE ON plugin_settings TO unexpected');
      assert.throws(() => script('prepare'), /Unexpected or delegable ACL/);
      assert.equal(sql("SELECT relowner::regrole FROM pg_class WHERE oid='plugin_settings'::regclass"), app);
      assert.equal(sql("SELECT to_regclass('editorial_authorization_generation')"), '');
      sql('REVOKE UPDATE ON plugin_settings FROM unexpected');
      script('prepare');
      script('validate');
      script('validate');
      script('contingency');
      assert.throws(() => script('prepare'), /Unexpected generation/);
    });

    const general = connect(app), privatePool = connect(writer), observer = connect(reader), migration = connect(owner);
    const repo = new Repository(privatePool);
    const checksum = createHash('sha256').update(await readFile(migration212)).digest('hex');
    assert.equal((await migration.query('SELECT checksum FROM schema_migrations')).rows[0].checksum, checksum);

    await t.test('real logins retain necessary reads, with no legacy DML or role escalation', async () => {
      for (const [pool, role] of [[general, app], [privatePool, writer], [observer, reader], [migration, owner]]) {
        assert.deepEqual((await pool.query('SELECT session_user AS login,current_user AS effective')).rows,
          [{ login: role, effective: role }]);
      }
      for (const pool of [general, privatePool, observer]) {
        for (const query of [
          `SET ROLE ${owner}`, 'CREATE SCHEMA unauthorized', 'CREATE TABLE public.unauthorized(id integer)',
          'CREATE TEMP TABLE unauthorized(id integer)',
          'ALTER TABLE editorial_authorization_generation DISABLE TRIGGER editorial_generation_update_guard',
          'SET session_replication_role=replica',
          'UPDATE plugin_installations SET installed=false',
          'DELETE FROM plugin_settings',
          'UPDATE editorial_authorization_generation SET authorization_state = \'verified\'',
        ]) await assert.rejects(pool.query(query), denied);
        assert.equal((await pool.query('SHOW search_path')).rows[0].search_path, 'pg_catalog, public');
      }
      for (const pool of [general, observer]) {
        await assert.rejects(pool.query(legacy), denied);
        await assert.rejects(pool.query(`SET ROLE ${writer}`), denied);
        assert.equal((await pool.query("SELECT enabled FROM plugin_settings WHERE plugin_id='vault'")).rows[0].enabled, false);
        await pool.query('SELECT installed FROM plugin_installations');
      }
      const acl = () => sql("SELECT relacl FROM pg_class WHERE oid='plugin_settings'::regclass");
      const before = acl();
      await general.query(`GRANT UPDATE ON plugin_settings TO ${reader}`).catch((e: unknown) => assert.deepEqual((e as {code:string}).code, denied.code));
      assert.equal(acl(), before);
      await general.query("INSERT INTO ordinary_audit VALUES ('allowed')");
      assert.equal((await general.query('SELECT message FROM ordinary_audit')).rows[0].message, 'allowed');
      await assert.rejects(privatePool.query('INSERT INTO ordinary_audit VALUES (\'denied\')'), denied);
      await migration.query('CREATE TABLE admin_ddl_probe(id integer); DROP TABLE admin_ddl_probe');
    });

    await t.test('two private connections enforce CAS and preserve the last board view', async () => {
      const first = await repo.observe();
      const competing = new Repository(connect(writer));
      const outcomes = await Promise.allSettled([
        writeEditorialPluginSetting(repo, first, 'board-view', false),
        writeEditorialPluginSetting(competing, first, 'structured-view', false),
      ]);
      assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
      const conflict = outcomes.find(x => x.status === 'rejected');
      assert.equal(conflict?.reason.code, 'editorial_generation_conflict');
      const next = await repo.observe();
      assert.equal(next.revision, '1');
      assert.equal(next.authorizationState, 'unavailable');
      const disabled = (await general.query("SELECT plugin_id FROM plugin_settings WHERE plugin_id IN ('board-view','structured-view') AND NOT enabled")).rows;
      assert.equal(disabled.length, 1);
      await assert.rejects(writeEditorialPluginSetting(repo, next,
        disabled[0].plugin_id === 'board-view' ? 'structured-view' : 'board-view', false), RequiredBoardViewError);
      assert.deepEqual(await repo.observe(), next);
    });

    await t.test('SQL failure reverts both writes and an uncertain COMMIT reconciles from SQL', async () => {
      const before = await repo.observe();
      await migration.query('ALTER TABLE editorial_authorization_generation ADD CONSTRAINT fixture_failure CHECK(revision < 2)');
      await assert.rejects(writeEditorialPluginSetting(repo, before, 'vault', true),
        { code: 'editorial_generation_operation_failed', rollbackConfirmed: true });
      assert.deepEqual(await repo.observe(), before);
      assert.equal((await repo.observePluginSetting('vault')).enabled, false);
      await migration.query('ALTER TABLE editorial_authorization_generation DROP CONSTRAINT fixture_failure');

      let commits = 0;
      const uncertain = new Repository({ async connect() {
        const client = await privatePool.connect();
        return { async query(sql, parameters) {
          const result = await client.query(sql, parameters);
          if (sql === 'COMMIT') {
            commits++;
            throw new Error('Fixture drops COMMIT acknowledgement');
          }
          return result;
        }, release(discard) { client.release(discard); } };
      } });
      await assert.rejects(writeEditorialPluginSetting(uncertain, before, 'vault', true),
        { code: 'editorial_generation_commit_uncertain' });
      assert.equal(commits, 1);
      let configured = false;
      const recovery = await recoverEditorialPluginSetting(new Repository(connect(writer)), {
        isInstalled: () => true,
        getById: () => ({}),
        setEnabled: (_, enabled) => { configured = enabled; },
        catalog: () => [{ id: 'vault', configuredEnabled: configured, enabled: configured }],
      }, 'vault');
      assert.equal(recovery.status, 'reconciled_observed');
      assert.equal(recovery.authorizationState, 'unavailable');
      assert.equal(configured, true);
      assert.equal((await repo.observe()).revision, '2');
    });

    await t.test('administrative restore into a fresh clone requires ACL reapplication', () => {
      const archive = join(socket, 'fixture.dump');
      const clone = 'orbit_restore_r5ca_fixture';
      sql(`CREATE DATABASE ${clone} OWNER ${owner}`, 'postgres');
      run('pg_dump', [...connection, '-Fc', '--no-owner', '--no-acl', '-f', archive, database]);
      run('pg_restore', [...connection, '--role', owner, '--single-transaction', '--no-owner', '--no-privileges', '-d', clone, archive]);
      assert.equal(sql("SELECT relowner::regrole FROM pg_class WHERE oid='plugin_settings'::regclass", clone), owner);
      assert.equal(sql(`SELECT has_table_privilege('${app}','plugin_settings','SELECT')`, clone), 'f');
      assert.equal(sql("SELECT revision || ':' || authorization_state FROM editorial_authorization_generation", clone), '2:unavailable');
    });
  } finally {
    try { await Promise.all(pools.map(pool => pool.end())); }
    finally {
      if (running) run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
      await rm(socket, { recursive: true, force: true });
    }
  }
});
