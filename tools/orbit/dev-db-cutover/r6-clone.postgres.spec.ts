import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { AccessService } from '../../../forge/app/apps/api/src/access/access';
import { AccessManagement } from '../../../forge/app/apps/api/src/access/management';
import { AuthLifecycle, type AuthMailer } from '../../../forge/app/apps/api/src/access/auth-lifecycle';
import { MfaService } from '../../../forge/app/apps/api/src/access/mfa';
import { authenticateLoginAccount, LoginAttemptLimiter } from '../../../forge/app/apps/api/src/access/login-attempts';
import { applyVersionedMigrations } from '../../../forge/app/apps/api/src/migrations';
import { seedDatabase } from '../../../forge/app/apps/api/src/seed';
import { WorkspacesService, workspacesPlugin } from '../../../forge/app/apps/api/src/workspaces/workspaces.plugin';
import { PluginRegistry } from '../../../forge/app/apps/api/src/execution/registries';
import { RunRepository } from '../../../forge/app/apps/api/src/execution/run-repository';
import { CardExecutionService } from '../../../forge/app/apps/api/src/execution/execution.service';
import { ProjectRegistry } from '../../../forge/app/apps/api/src/execution/project-registry';
import { emptyConfig } from '../../../forge/app/apps/api/src/execution/types';
import { QueueManagement } from '../../../forge/app/apps/api/src/plugins/ai/queue-management';
import { FeaturesService } from '../../../forge/app/apps/api/src/features';
import { OrbitEvents } from '../../../forge/app/apps/api/src/orbit-events';
import { ExtensionRecords } from '../../../forge/app/apps/api/src/plugins/records/records.service';
import { DocumentScanner } from '../../../forge/app/apps/api/src/plugins/records/documents';
import { genericPlugins, recordPlugins } from '../../../forge/app/apps/api/src/plugins/records/catalog';
import { CLAIM_WEBHOOK_DELIVERIES_SQL } from '../../../forge/app/apps/api/src/plugins/webhooks';

const { Client, Pool } = createRequire(resolve('forge/app/package.json'))('pg');
const dotenv = createRequire(resolve('forge/app/package.json'))('dotenv');
const database = 'orbit_r5ca_fixture';
const postgres = '/usr/lib/postgresql/16/bin';
const enabled = process.env.ORBIT_R6_REHEARSE_DEV_SCHEMA === '1';
const admin = userInfo().username;
const env = { PATH: '/usr/bin:/bin', LANG: 'C' };
const scripts = 'tools/orbit/dev-db-cutover';
const roleArgs = ['approval=DISPOSABLE', 'owner_role=trial_owner', 'app_role=orbit_dev_app',
  'writer_role=trial_writer', 'reader_role=trial_reader'].flatMap(x => ['-v', x]);

async function exportSchema(target: string) {
  const { DATABASE_URL } = dotenv.parse(await readFile('forge/app/apps/api/.env'));
  if (!DATABASE_URL) throw Error('Authorized DEV configuration absent');
  const source = new URL(DATABASE_URL);
  assert.ok(['postgresql:', 'postgres:'].includes(source.protocol));
  assert.equal(source.hostname, '127.0.0.1');
  assert.ok(source.port === '' || source.port === '5432');
  assert.equal(source.pathname, '/orbit_native_dev');
  assert.equal(decodeURIComponent(source.username), 'orbit_dev_app');
  if (source.search || source.hash) throw Error('DEV URL options differ from approved fixture source');
  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='6s'; SET LOCAL lock_timeout='3s'");
    const { rows: [id] } = await client.query(`SELECT current_database() database, session_user login,
      host(inet_server_addr()) host, inet_server_port() port, current_setting('server_version_num')::int version`);
    assert.deepEqual({ ...id, version: Math.floor(id.version / 10000) },
      { database: 'orbit_native_dev', login: 'orbit_dev_app', host: '127.0.0.1', port: 5432, version: 16 });
    const { rows: [meta] } = await client.query(`SELECT pg_encoding_to_char(encoding) AS encoding, datcollate, datctype
      FROM pg_database WHERE datname=current_database() AND datdba=session_user::regrole`);
    assert.deepEqual(meta, { encoding: 'UTF8', datcollate: 'pt_BR.UTF-8', datctype: 'pt_BR.UTF-8' });
    const { rows: [extension] } = await client.query(`SELECT e.extversion, n.nspname
      FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
      WHERE e.extname='pgcrypto' AND e.extowner=session_user::regrole`);
    assert.deepEqual(extension, { extversion: '1.3', nspname: 'public' });
    const snap = (await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    const { rows: [counts] } = await client.query(`SELECT COUNT(*) FILTER (WHERE relkind='r')::int tables,
      COUNT(*) FILTER (WHERE relkind='v')::int views, COUNT(*) FILTER (WHERE relkind='S')::int sequences
      FROM pg_class WHERE relnamespace='public'::regnamespace AND relowner=session_user::regrole`);
    await new Promise<void>((succeed, fail) => {
      const p = spawn(join(postgres, 'pg_dump'), ['-h', '127.0.0.1', '-p', '5432', '-U', 'orbit_dev_app',
        '-d', 'orbit_native_dev', '--schema-only', '--no-password', '--lock-wait-timeout=3s', '--snapshot=' + snap, '-f', target],
        { env: { ...env, PGPASSWORD: decodeURIComponent(source.password), PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=12000' }, stdio: 'ignore' });
      const timeout = setTimeout(() => p.kill('SIGKILL'), 15000);
      p.once('exit', code => { clearTimeout(timeout); code === 0 ? succeed() : fail(Error('DEV schema-only export failed')); });
      p.once('error', () => { clearTimeout(timeout); fail(Error('Cannot start PostgreSQL schema exporter')); });
    });
    return counts;
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}

test('R6 schema only rehearsal in private PostgreSQL 16', { skip: !enabled, timeout: 95000 }, async t => {
  const socket = await mkdtemp(join(tmpdir(), 'orbit-r6-clone-'));
  const data = join(socket, 'data');
  const schema = join(socket, 'schema.sql');
  const port = '55446';
  const pools: any[] = [];
  const demoEmail = 'r6@example.invalid';
  const demoPassword = randomBytes(24).toString('hex');
  const run = (bin: string, args: string[]) => execFileSync(join(postgres, bin), args,
    { env, timeout: 18000, stdio: 'pipe' }).toString();
  const restoreDatabase = 'orbit_restore_r6_fixture';
  const sql = (target: string, ...args: string[]) => {
    assert.ok(['postgres', database, restoreDatabase].includes(target));
    const proof = `DO $$ BEGIN IF inet_server_addr() IS NOT NULL OR current_database() <> '${target}'
      OR current_setting('data_directory') <> '${data}' THEN RAISE EXCEPTION 'Unexpected clone target'; END IF; END $$`;
    return run('psql', ['-X', '-h', socket, '-p', port, '-U', admin, '-d', target, '-qAt', '-v', 'ON_ERROR_STOP=1',
      '-c', proof, ...args]);
  };
  const file = (name: string, digest?: string) => sql(database, ...roleArgs,
    ...(digest ? ['-v', 'ownership_sha256=' + digest] : []), '-f', join(scripts, name + '.sql'));
  let started = false;
  try {
    const counts = await exportSchema(schema);
    const definition = await readFile(schema, 'utf8');
    if (/^\s*(?:CREATE\s+(?:SERVER|USER MAPPING|SUBSCRIPTION|FOREIGN (?:TABLE|DATA WRAPPER)|EVENT TRIGGER)|\\(?:connect|!|copy)\b|COPY\s)/im.test(definition)) {
      throw Error('Schema contains an unsupported external or privileged object category');
    }
    run('initdb', ['-D', data, '-A', 'trust', '--no-locale']);
    run('pg_ctl', ['-D', data, '-l', join(socket, 'postgres.log'), '-o',
      `-k ${socket} -p ${port} -c listen_addresses='' -c unix_socket_permissions=0700`, '-w', 'start']);
    started = true;
    sql('postgres', '-c', 'CREATE ROLE orbit_dev_app LOGIN; CREATE ROLE trial_owner LOGIN; CREATE ROLE trial_writer LOGIN; CREATE ROLE trial_reader LOGIN',
      '-c', `CREATE DATABASE ${database} OWNER orbit_dev_app TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'pt_BR.UTF-8' LC_CTYPE 'pt_BR.UTF-8'`);
    sql(database, '-c', 'SET ROLE orbit_dev_app; CREATE EXTENSION pgcrypto WITH SCHEMA public');
    try {
      run('psql', ['-X', '-h', socket, '-p', port, '-U', 'orbit_dev_app', '-d', database, '-q', '-v', 'ON_ERROR_STOP=1',
        '-c', `DO $$ BEGIN IF inet_server_addr() IS NOT NULL OR current_database() <> '${database}'
          OR current_user <> 'orbit_dev_app' THEN RAISE EXCEPTION 'Unexpected schema restore target'; END IF; END $$`,
        '-f', schema]);
    } catch {
      throw Error('Structural export could not be restored under the disposable legacy login');
    }
    assert.equal(sql(database, '-c', `SELECT COUNT(*) FILTER (WHERE relkind='r'),
      COUNT(*) FILTER (WHERE relkind='v'), COUNT(*) FILTER (WHERE relkind='S')
      FROM pg_class WHERE relnamespace='public'::regnamespace AND relowner='orbit_dev_app'::regrole`).trim(),
      [counts.tables, counts.views, counts.sequences].join('|'));
    assert.equal(sql(database, '-c', "SELECT count(*) FROM public.users; SELECT count(*) FROM public.schema_migrations").trim(), '0\n0');
    const extensionIdentity = sql(database, '-c',
      "SELECT oid,extversion FROM pg_extension WHERE extname='pgcrypto'").trim();

    await t.test('canonical prerequisites for the current board and worker code', async () => {
      const missing = sql(database, '-c', `SELECT NOT EXISTS(SELECT FROM pg_attribute WHERE
        attrelid='cards'::regclass AND attname='card_revision' AND NOT attisdropped),
        NOT EXISTS(SELECT FROM pg_attribute WHERE attrelid='card_runs'::regclass AND attname='worker_id' AND NOT attisdropped)`).trim();
      if (missing === 't|t') {
        const digest = /Reviewed candidate: ([0-9a-f]{64})/.exec(file('r6-ownership-plan'))?.[1];
        assert.ok(digest);
        assert.throws(() => file('r6-preflight', digest), /prerequisite DEV runtime migrations 157_card_revisions and 158_workspace_coordination/);
        const versioned = join(socket, 'runtime-prerequisites');
        await mkdir(versioned);
        for (const name of ['157_card_revisions.sql', '158_workspace_coordination.sql']) {
          await copyFile(resolve('forge/app/apps/api/sql/migrations', name), join(versioned, name));
        }
        const pool = new Pool({ host: socket, port: Number(port), database, user: 'orbit_dev_app', max: 1 });
        try {
          const client = await pool.connect();
          try {
            assert.deepEqual((await client.query("SELECT current_database(),inet_server_addr() IS NULL AS socket,session_user")).rows,
              [{ current_database: database, socket: true, session_user: 'orbit_dev_app' }]);
            await client.query('BEGIN');
            await applyVersionedMigrations(client, versioned);
            await client.query('COMMIT');
          } finally { client.release(); }
        } finally { await pool.end(); }
      } else {
        assert.equal(missing, 'f|f', 'partial prerequisite migrations require review');
      }
      assert.equal(sql(database, '-c', "SELECT to_regclass('public.card_revisions')").trim(), 'card_revisions');
    });

    await t.test('reviewed ownership transfer, rejects drift, preserves pgcrypto identity', () => {
      const plan = file('r6-ownership-plan');
      const match = /Reviewed candidate: ([0-9a-f]{64}) \((\d+) objects\)/.exec(plan);
      assert.ok(match);
      const [, digest] = match;
      assert.throws(() => file('r6-preflight', 'a'.repeat(64)), /differs from the approved review/);
      sql(database, '-c', 'GRANT SELECT (title) ON public.boards TO trial_reader');
      assert.throws(() => file('r6-preflight', digest), /owner-derived relation privileges/);
      sql(database, '-c', 'REVOKE SELECT (title) ON public.boards FROM trial_reader');
      sql('postgres', '-c', 'CREATE DATABASE unrelated OWNER orbit_dev_app');
      assert.throws(() => file('r6-prepare', digest), /legacy ownership of this database only/);
      sql('postgres', '-c', 'DROP DATABASE unrelated');
      file('r6-preflight', digest);
      sql(database, '-c', `CREATE FUNCTION public.fixture_abort_cutover() RETURNS event_trigger
        LANGUAGE plpgsql AS $body$ BEGIN RAISE EXCEPTION 'fixture failure before cutover commit'; END $body$;
        CREATE EVENT TRIGGER fixture_abort_cutover ON ddl_command_end WHEN TAG IN ('CREATE VIEW')
        EXECUTE FUNCTION public.fixture_abort_cutover()`);
      try {
        assert.throws(() => file('r6-prepare', digest), /fixture failure before cutover commit/);
        assert.equal(sql(database, '-c', `SELECT datdba::regrole,
          to_regclass('public.editorial_authorization_generation') IS NULL,
          (SELECT extowner::regrole FROM pg_extension WHERE extname='pgcrypto')
          FROM pg_database WHERE datname=current_database()`).trim(), 'orbit_dev_app|t|orbit_dev_app');
      } finally {
        sql(database, '-c', 'DROP EVENT TRIGGER fixture_abort_cutover; DROP FUNCTION public.fixture_abort_cutover()');
      }
      file('r6-prepare', digest);
      file('r6-validate');
      file('r6-contingency');
      file('r6-validate');
      assert.equal(sql(database, '-c',
        "SELECT oid,extversion FROM pg_extension WHERE extname='pgcrypto'").trim(), extensionIdentity);
      assert.equal(sql(database, '-c', "SELECT extowner::regrole FROM pg_extension WHERE extname='pgcrypto'").trim(), 'trial_owner');
    });

    await t.test('ordinary runtime uses named ACLs and never writes protected settings', async ordinary => {
      const [owner, app, writer] = ['trial_owner', 'orbit_dev_app', 'trial_writer'].map(user => {
        const pool = new Pool({ host: socket, port: Number(port), database, user, max: 2, connectionTimeoutMillis: 3000 });
        pools.push(pool);
        return pool;
      });
      for (const [i, pool] of [owner, app, writer].entries()) {
        const { rows } = await pool.query("SELECT session_user AS login,current_database() AS database,inet_server_addr() IS NULL AS socket");
        assert.deepEqual(rows, [{ login: ['trial_owner', 'orbit_dev_app', 'trial_writer'][i], database, socket: true }]);
      }
      const migrationDir = join(socket, 'migration-probe');
      const migration212 = '212_editorial_authorization_generation.sql';
      await mkdir(migrationDir);
      await copyFile(resolve('packages/orbit-core/sql/migrations', migration212), join(migrationDir, migration212));
      await writeFile(join(migrationDir, '999_fixture.sql'), 'CREATE TABLE fixture_future_ddl(id integer PRIMARY KEY);');
      const client = await owner.connect();
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          await client.query('BEGIN');
          await applyVersionedMigrations(client, migrationDir);
          await client.query('COMMIT');
        }
      } finally {
        client.release();
      }
      const originalRootEnv = ['ORBIT_BOOTSTRAP_ROOT_NAME','ORBIT_BOOTSTRAP_ROOT_EMAIL','ORBIT_BOOTSTRAP_ROOT_PASSWORD','ORBIT_SEED_DEFAULT_BOARDS']
        .map(key => [key, process.env[key]] as const);
      const password = demoPassword;
      const email = demoEmail;
      try {
        process.env.ORBIT_BOOTSTRAP_ROOT_NAME = 'Fixture root';
        process.env.ORBIT_BOOTSTRAP_ROOT_EMAIL = email;
        process.env.ORBIT_BOOTSTRAP_ROOT_PASSWORD = password;
        process.env.ORBIT_SEED_DEFAULT_BOARDS = 'true';
        await seedDatabase(owner);
        await seedDatabase(owner);
      } finally {
        for (const [key, value] of originalRootEnv) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
      assert.equal((await owner.query("SELECT count(*)::int n FROM boards WHERE is_inbox")).rows[0].n, 1);
      const actor = (await owner.query("SELECT id FROM users WHERE is_root")).rows[0].id;
      const db = { pool: app, async query(sql, args) { return (await app.query(sql, args)).rows; },
        async one(sql, args) { return (await app.query(sql, args)).rows[0]; }, async onModuleDestroy() {} };
      const access = new AccessService(db as any);
      await access.initializeDefaults();
      const limiter = new LoginAttemptLimiter(db as any, randomBytes(24).toString('hex'));
      assert.equal(await limiter.tryStartAttempt(email, '127.0.0.1'), true);
      assert.equal((await authenticateLoginAccount(db as any, email, password))?.id, actor);
      assert.equal(await authenticateLoginAccount(db as any, email, 'incorrect password'), null);
      await limiter.recordSuccess(email, '127.0.0.1');
      assert.equal((await access.account(actor)).id, actor);
      assert.equal(await access.has(actor, 'plugins.manage'), true);
      const member = (await owner.query("INSERT INTO users(name,email,password_hash) VALUES('Synthetic member','member@example.invalid','fixture') RETURNING id")).rows[0].id;
      const manager = (await owner.query("INSERT INTO users(name,email,password_hash) VALUES('Synthetic manager','manager@example.invalid','fixture') RETURNING id")).rows[0].id;
      await owner.query("INSERT INTO access_roles(id,name,permissions) VALUES('test_manager','Manager',ARRAY['plugins.manage'])");
      await owner.query("INSERT INTO access_grants(user_id,role_id,scope_type,scope_id) VALUES($1,'test_manager','global','*')", [manager]);
      assert.equal(await access.has(manager, 'plugins.manage'), true);
      assert.equal(await access.has(member, 'plugins.manage'), false);
      await access.audit(actor, 'fixture.r6');
      assert.equal((await owner.query('SELECT count(*)::int n FROM immutable_audit_events')).rows[0].n, 1);
      const workspace = await new WorkspacesService(db as any, access).create(actor, { name: 'Fixture workspace' });
      const board = (await app.query("INSERT INTO boards(title,owner_id,workspace_id) VALUES('Fixture', $1, $2) RETURNING id", [actor, workspace.id])).rows[0].id;
      await app.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'owner')", [board, actor]);
      assert.equal((await app.query('SELECT role FROM authorized_board_members WHERE board_id=$1 AND user_id=$2', [board, actor])).rows[0].role, 'owner');
      const list = (await app.query("INSERT INTO lists(board_id,title,position) VALUES($1,'Fixture',0) RETURNING id", [board])).rows[0].id;
      const card = (await app.query("INSERT INTO cards(list_id,title,position) VALUES($1,'Fixture',0) RETURNING id", [list])).rows[0].id;
      await app.query("UPDATE cards SET completed=true,title='Fixture updated' WHERE id=$1", [card]);
      await app.query("SELECT nextval('extension_protocol_seq')");
      await ordinary.test('administrative accounts, roles, groups, exceptions and scoped grants', async () => {
        const accounts = new AccessManagement(db as any, access);
        new WorkspacesService(db as any, access).onModuleInit();
        const testPassword = randomBytes(24).toString('hex');
        await access.saveRole(actor, 'r7_ops', { name: 'Synthetic operators', permissions: ['workspaces.read'] });
        const created = await access.createUser(actor, { name: 'Fixture operator', email: 'operator@example.invalid',
          password: testPassword, roles: ['r7_ops'] });
        assert.equal(await access.has(created.id, 'workspaces.read'), true);
        const group = await accounts.group(actor, { name: 'Synthetic group', permissions: ['plugins.read'], members: [created.id] });
        assert.equal(await access.has(created.id, 'plugins.read'), true);
        await accounts.group(actor, { name: 'Synthetic group renamed', permissions: ['plugins.read'], members: [created.id] }, group.id);
        assert.ok((await accounts.groups()).some(row => row.id === group.id));
        await accounts.saveExceptions(actor, created.id, { exceptions: [{ permission_id: 'plugins.read', effect: 'deny' }] });
        assert.equal(await access.has(created.id, 'plugins.read'), false);
        await accounts.saveExceptions(actor, created.id, { exceptions: [] });
        assert.equal(await access.has(created.id, 'plugins.read'), true);
        await accounts.settings(actor, { permissions: ['plugins.read'], enabled: false });
        assert.equal(await access.has(created.id, 'plugins.read'), false);
        await accounts.settings(actor, { permissions: ['plugins.read'], enabled: true });
        await accounts.delete(actor, group.id);
        await access.assignScopedRoles(actor, created.id, 'workspace', workspace.id, ['r7_ops']);
        assert.equal((await access.scopedAssignments(actor, 'workspace', workspace.id)).find(row => row.user_id === created.id)?.roles[0], 'r7_ops');
        await access.assignScopedRoles(actor, created.id, 'workspace', workspace.id, []);
        assert.deepEqual(await access.scopedAssignments(actor, 'workspace', workspace.id), []);
        await access.updateUser(actor, created.id, { password: testPassword, disabled: true, roles: [] });
        assert.equal(await authenticateLoginAccount(db as any, 'operator@example.invalid', testPassword), null);
        assert.ok((await access.users()).some(row => (row as { id: string }).id === created.id));
      });

      await ordinary.test('invitation, recovery and MFA lifecycle with a synthetic outbox', async () => {
        let link = '';
        let code = '';
        const mailer: AuthMailer = {
          async send(_to, _subject, url) { link = url; },
          async sendMessage(_to, _subject, message) {
            code = /código Orbit é (\d{6})/.exec(message)?.[1] || '';
            return {};
          },
        };
        const lifecycle = new AuthLifecycle(db as any, mailer, access);
        const inviteEmail = 'invite@example.invalid';
        await lifecycle.invite(actor, { email: inviteEmail, name: 'Synthetic recipient', roles: [] });
        const inviteToken = new URL(link).searchParams.get('token');
        assert.ok(inviteToken);
        const initialPassword = randomBytes(24).toString('hex');
        await lifecycle.complete(inviteToken, initialPassword);
        await assert.rejects(lifecycle.complete(inviteToken, initialPassword), { status: 400 });
        await lifecycle.requestRecovery(inviteEmail);
        const recoveryToken = new URL(link).searchParams.get('token');
        assert.ok(recoveryToken && recoveryToken !== inviteToken);
        const finalPassword = randomBytes(24).toString('hex');
        await lifecycle.complete(recoveryToken, finalPassword);
        assert.equal(await authenticateLoginAccount(db as any, inviteEmail, initialPassword), null);
        const account = await authenticateLoginAccount(db as any, inviteEmail, finalPassword);
        assert.ok(account);
        const mfa = new MfaService(db as any, mailer);
        const activation = await mfa.requestChange(account.id, { action: 'enable', current_password: finalPassword });
        assert.match(code, /^\d{6}$/);
        const incorrect = code === '000000' ? '111111' : '000000';
        await assert.rejects(mfa.confirmChange(account.id, { challenge_id: activation.challenge_id, code: incorrect }), { status: 401 });
        assert.deepEqual(await mfa.confirmChange(account.id, { challenge_id: activation.challenge_id, code }), { enabled: true });
        const login = await mfa.requestLogin(account.id);
        assert.equal((await mfa.completeChallenge(login.challenge_id, code, 'login'))?.id, account.id);
        await assert.rejects(mfa.completeChallenge(login.challenge_id, code, 'login'), { status: 401 });
        const deactivation = await mfa.requestChange(account.id, { action: 'disable', current_password: finalPassword });
        assert.deepEqual(await mfa.confirmChange(account.id, { challenge_id: deactivation.challenge_id, code }), { enabled: false });
      });

      await ordinary.test('queued card worker claims once and records stages, output, cancel and rollback', async () => {
        const project = (await owner.query("INSERT INTO ai_projects(owner_id,name,local_path) VALUES($1,'Synthetic queue project',$2) RETURNING id",
          [actor, socket])).rows[0].id;
        const cardSnapshot = (await app.query('SELECT id,title,description,card_revision FROM cards WHERE id=$1', [card])).rows[0];
        const config = { ...emptyConfig(), project_id: project, enabled: true, executor: 'fixture', action: 'describe' };
        const service = new CardExecutionService(db as any, new FeaturesService(db as any),
          new ProjectRegistry(db as any), new OrbitEvents(), new PluginRegistry());
        const worker = service.runs;
        const otherWorker = new RunRepository(db as any);
        async function enqueue(repository: RunRepository, requestKey: string) {
          const connection = await app.connect();
          try {
            await connection.query('BEGIN');
            const run = await repository.enqueue(connection, { ...cardSnapshot, board_id: board }, actor, config, requestKey);
            await connection.query('COMMIT');
            return run;
          } catch (error) {
            await connection.query('ROLLBACK');
            throw error;
          } finally { connection.release(); }
        }
        const vars = ['CODEX_BIN', 'CODEX_HOME'].map(key => [key, process.env[key]] as const);
        try {
          process.env.CODEX_BIN = '/usr/bin/false';
          process.env.CODEX_HOME = join(socket, 'codex-do-not-use-real-login');
          const request = randomUUID();
          const run = await enqueue(worker, request);
          assert.equal((await enqueue(otherWorker, request)).id, run.id);
          assert.equal(run.card_revision, cardSnapshot.card_revision);
          const queues = new QueueManagement(db as any, access);
          assert.equal((await queues.update(actor, { paused: true, autoResume: false })).paused, true);
          assert.equal(await worker.claim(), undefined);
          assert.equal((await queues.update(actor, { paused: false })).paused, false);
          const claims = (await Promise.all([worker.claim(), otherWorker.claim()])).filter(Boolean);
          assert.equal(claims.length, 1);
          assert.equal(claims[0].id, run.id);
          const active = claims[0].worker_id === worker.workerId ? worker : otherWorker;
          const inactive = active === worker ? otherWorker : worker;
          await assert.rejects(inactive.stage(run.id, 'context', 'Denied worker'), /deixou de pertencer/);
          await active.stage(run.id, 'preparing_workspace', 'Synthetic preparation');
          await assert.rejects(active.finish(run, 'success', { summary: 'Lost', outputs: [] }, undefined,
            async () => { throw new Error('Synthetic before commit'); }), /before commit/);
          assert.equal((await service.runDetail(run.id, actor)).status, 'running');
          await active.finish(run, 'success', { summary: 'Finished', outputs: [{ type: 'json', value: { ok: true } }] });
          const detail = await service.runDetail(run.id, actor);
          assert.equal(detail.status, 'success');
          assert.deepEqual(detail.logs.map(row => row.stage), ['queued', 'started', 'preparing_workspace', 'success']);
          assert.deepEqual(detail.outputs.map(row => row.value), [{ ok: true }]);
          const listed = (await queues.list(actor)).queues.find(queue => queue.ownerId === actor && queue.kind === 'execution');
          assert.ok(listed?.items.some(item => item.id === run.id && item.status === 'success'));
          const queuedCancel = await enqueue(worker, randomUUID());
          assert.deepEqual(await service.cancel(queuedCancel.id, actor), { ok: true });
          assert.equal((await service.runDetail(queuedCancel.id, actor)).status, 'cancelled');
          assert.equal(await worker.claim(), undefined);
        } finally {
          for (const [key, value] of vars) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        }
      });

      await ordinary.test('Registros publishes a workflow and versions a protocol with immutable history', async () => {
        const registry = new PluginRegistry();
        registry.register(workspacesPlugin);
        for (const plugin of genericPlugins) registry.register(plugin);
        access.registerPlugins(registry.list());
        const records = new ExtensionRecords(db as any, access, registry, new DocumentScanner());
        records.onModuleInit();
        const example = recordPlugins.find(item => item.plugin.id === 'workflows')!.kinds.definition.example;
        await owner.query(
          "INSERT INTO webhook_subscriptions(workspace_id,endpoint,event_types,secret_ciphertext,created_by) VALUES($1,'https://events.example.invalid',ARRAY['record.created','record.updated'],'synthetic-offline',$2)",
          [workspace.id, actor],
        );
        const definition = await records.create('workflows', workspace.id, actor, {
          kind: 'definition', title: 'Synthetic procedure', payload: example, operation_key: randomUUID(),
        });
        const published = await records.transition('workflows', definition.id, actor, {
          state: 'published', expected_revision: definition.revision, reason: 'Synthetic publication', operation_key: randomUUID(),
        });
        const createBody = {
          kind: 'process', title: 'Synthetic case',
          payload: { definition_id: published.id, definition_revision: published.revision },
          operation_key: randomUUID(),
        };
        const process = await records.create('workflows', workspace.id, actor, createBody);
        assert.match(String(process.payload.protocol), /^ORB-\d{4}-\d{8}$/);
        assert.equal((await records.create('workflows', workspace.id, actor, createBody)).id, process.id);
        await assert.rejects(records.create('workflows', workspace.id, actor, { ...createBody, title: 'Changed' }), { status: 409 });
        const moved = await records.transition('workflows', process.id, actor, {
          next_state: 'in_review', expected_revision: process.revision, reason: 'Synthetic progress', operation_key: randomUUID(),
        });
        assert.equal(moved.payload.protocol, process.payload.protocol);
        await assert.rejects(records.transition('workflows', process.id, actor, {
          next_state: 'completed', expected_revision: process.revision, reason: 'Stale revision', operation_key: randomUUID(),
        }), { status: 409 });
        const detail = await records.detail('workflows', process.id, actor);
        assert.deepEqual(detail.versions.map(row => row.revision), [2, 1]);
        assert.equal((await records.versionSnapshot('workflows', process.id, 1, actor)).payload.current_state, 'open');
        assert.equal((await records.list('workflows', workspace.id, actor)).some(row => row.id === process.id), true);
        assert.equal((await app.query("SELECT count(*)::int AS total FROM access_audit WHERE target=$1 AND action='workflows.record.active'", [process.id])).rows[0].total, 2);
        assert.deepEqual((await owner.query(
          'SELECT e.event_type,d.status FROM webhook_events e JOIN webhook_deliveries d ON d.event_id=e.id WHERE e.record_id=$1 ORDER BY e.revision',
          [process.id],
        )).rows, [{ event_type: 'record.created', status: 'pending' }, { event_type: 'record.updated', status: 'pending' }]);
        const claimedDeliveries = await app.query(CLAIM_WEBHOOK_DELIVERIES_SQL);
        assert.equal(claimedDeliveries.rows.length, 4, 'the restricted runtime claims queued webhook deliveries');
        assert.deepEqual([...new Set(claimedDeliveries.rows.map(row => row.event_type))].sort(), ['record.created', 'record.updated']);
        for (const delivery of claimedDeliveries.rows) {
          await app.query("UPDATE webhook_deliveries SET status='pending',last_error='SYNTHETIC_RETRY',available_at=now(),updated_at=now() WHERE id=$1", [delivery.id]);
        }
        await assert.rejects(app.query('DELETE FROM webhook_deliveries'), { code: '42501' });
        await owner.query('DELETE FROM webhook_subscriptions WHERE workspace_id=$1', [workspace.id]);
        await assert.rejects(app.query('UPDATE extension_record_versions SET title=$1 WHERE record_id=$2', ['Denied', process.id]), { code: '42501' });
      });

      await ordinary.test('workspace members and board lifecycle under the restricted runtime', async () => {
        const workspaces = new WorkspacesService(db as any, access);
        await workspaces.member(actor, workspace.id, member, 'workspace_admin');
        const detail = await workspaces.detail(actor, workspace.id);
        assert.ok(detail.members.some(row => row.id === member));
        const { rows: [notebook] } = await owner.query(
          "INSERT INTO notebooks(owner_id,title) VALUES($1,'Synthetic shared notebook') RETURNING id", [actor]);
        await workspaces.shareResource(actor, workspace.id, { type: 'notebooks', resource_id: notebook.id, can_edit: true });
        assert.ok((await workspaces.sharedList(actor, workspace.id)).some(row => row.resource_id === notebook.id));
        assert.ok((await workspaces.visibleResources(member, 'notebooks')).includes(notebook.id));
        await workspaces.unshare(actor, workspace.id, 'notebooks', notebook.id);
        assert.ok(!(await workspaces.visibleResources(member, 'notebooks')).includes(notebook.id));
        await workspaces.member(actor, workspace.id, member, null);
        await workspaces.update(actor, workspace.id, { name: 'Synthetic workspace renamed' });
        const second = await workspaces.create(actor, { name: 'Synthetic destination' });
        await workspaces.attach(actor, second.id, board);
        assert.equal((await app.query('SELECT workspace_id FROM boards WHERE id=$1', [board])).rows[0].workspace_id, second.id);
        await app.query("UPDATE cards SET archived_at=now() WHERE id=$1", [card]);
        assert.equal((await app.query('DELETE FROM cards WHERE id=$1 RETURNING id', [card])).rows[0].id, card);
        await app.query("UPDATE lists SET archived_at=now() WHERE id=$1", [list]);
        assert.equal((await app.query('DELETE FROM lists WHERE id=$1 RETURNING id', [list])).rows[0].id, list);
        assert.equal((await app.query('DELETE FROM boards WHERE id=$1 RETURNING id', [board])).rows[0].id, board);
      });

      await app.query('SELECT plugin_id,enabled FROM plugin_settings');
      await app.query('SELECT plugin_id,installed FROM plugin_installations');
      await assert.rejects(app.query("INSERT INTO plugin_settings(plugin_id,enabled) VALUES('board-view',false)"), { code: '42501' });
      await assert.rejects(app.query("CREATE TEMP TABLE denied(id int)"), { code: '42501' });
      await assert.rejects(writer.query("SELECT id FROM users"), { code: '42501' });
    });

    const fullBootstrap = process.env.ORBIT_R6_BOOTSTRAP_API === '1';
    await t.test('real main login, registry, fenced PATCH and board REST lifecycle use the restricted runtime', { skip: !fullBootstrap }, () => {
      sql(database, '-c', `SET ROLE trial_owner; INSERT INTO plugin_settings(plugin_id,enabled)
        VALUES ('ai',false),('planner',false),('delivery',false),('cloudflare-tunnel',false);
        WITH sample AS (
          INSERT INTO cards(list_id,title,position)
          SELECT l.id,'Synthetic stale background run',100 FROM lists l
          JOIN boards b ON b.id=l.board_id WHERE b.is_inbox LIMIT 1
          RETURNING id,card_revision
        )
        INSERT INTO card_runs(card_id,user_id,executor,action,status,input,request_key,heartbeat_at,card_revision)
        SELECT sample.id,u.id,'fixture','fixture','running','{}','r7-stale-fixture',now()-interval '1 hour',sample.card_revision
        FROM sample CROSS JOIN users u WHERE u.is_root`);
      const url = new URL('postgresql://orbit_dev_app@localhost:' + port + '/' + database);
      url.searchParams.set('host', socket);
      const shell = String.raw`
        set -euo pipefail
        /usr/sbin/ip link set lo up
        "$@" > api.log 2>&1 &
        orbit_r6_api_pid=$!
        trap 'kill "$orbit_r6_api_pid" 2>/dev/null || true; wait "$orbit_r6_api_pid" 2>/dev/null || true' EXIT
        for orbit_r6_attempt in {1..40}; do
          if /usr/bin/curl --fail --silent --max-time 1 http://127.0.0.1:43179/health > health.json; then break; fi
          if ! kill -0 "$orbit_r6_api_pid" 2>/dev/null; then exit 9; fi
          sleep .25
        done
        /usr/bin/node -e 'if (require("./health.json").status !== "ok") process.exit(1)'
        /usr/bin/curl --fail --silent --max-time 5 -H 'Content-Type: application/json' \
          --data "$ORBIT_R6_SYNTHETIC_LOGIN" http://127.0.0.1:43179/auth/login > login.json
        orbit_r6_token="$(/usr/bin/node -p 'require("./login.json").token')"
        test -n "$orbit_r6_token"
        /usr/bin/curl --fail --silent --max-time 5 -H "Authorization: Bearer $orbit_r6_token" \
          http://127.0.0.1:43179/auth/me > me.json
        /usr/bin/curl --fail --silent --max-time 5 -H "Authorization: Bearer $orbit_r6_token" \
          http://127.0.0.1:43179/plugins > plugins.json
        /usr/bin/node -e 'if (!require("./plugins.json").plugins.some(p => p.id === "board-view")) process.exit(1)'
        orbit_r6_patch_status="$(/usr/bin/curl --silent --max-time 5 -w '%{http_code}' -o patch.json \
          -X PATCH -H "Authorization: Bearer $orbit_r6_token" -H 'Content-Type: application/json' \
          --data '{"enabled":true}' http://127.0.0.1:43179/plugins/board-view)"
        test "$orbit_r6_patch_status" = 503
        call() {
          local orbit_r7_status
          orbit_r7_status="$(/usr/bin/curl --silent --max-time 5 -w '%{http_code}' -o endpoint.json \
            -X "$1" -H "Authorization: Bearer $orbit_r6_token" -H 'Content-Type: application/json' \
            --data "$3" "http://127.0.0.1:43179$2")"
          if [[ "$orbit_r7_status" != 2?? ]]; then
            printf 'Synthetic HTTP step %s %s failed with %s\n' "$1" "$2" "$orbit_r7_status" >&2
            /usr/bin/node -e 'const m = require("./endpoint.json").message; if (typeof m === "string" && /^(permission denied for |column |relation )/.test(m)) console.error(m)' >&2 || true
            return 1
          fi
          cat endpoint.json
        }
        orbit_r7_board="$(call POST /boards '{"title":"Synthetic HTTP board"}' | /usr/bin/node -pe 'JSON.parse(require("fs").readFileSync(0)).id')"
        orbit_r7_list="$(call POST "/boards/$orbit_r7_board/lists" '{"title":"Synthetic HTTP list"}' | /usr/bin/node -pe 'JSON.parse(require("fs").readFileSync(0)).id')"
        orbit_r7_card="$(call POST "/lists/$orbit_r7_list/cards" '{"title":"Synthetic HTTP card"}' | /usr/bin/node -pe 'JSON.parse(require("fs").readFileSync(0)).id')"
        call GET "/boards/$orbit_r7_board" '{}' > board.json
        /usr/bin/node -e 'if (!require("./board.json").lists.some(l => l.cards.some(c => c.id === process.argv[1]))) process.exit(1)' "$orbit_r7_card"
        call PATCH "/boards/$orbit_r7_board" '{"title":"Renamed board"}' > /dev/null
        call PATCH "/lists/$orbit_r7_list" '{"title":"Renamed list"}' > /dev/null
        call PATCH "/cards/$orbit_r7_card" '{"title":"Renamed card"}' > /dev/null
        call POST "/cards/$orbit_r7_card/archive" '{}' > /dev/null
        call DELETE "/cards/$orbit_r7_card" '{}' > /dev/null
        call POST "/lists/$orbit_r7_list/archive" '{}' > /dev/null
        call DELETE "/lists/$orbit_r7_list" '{}' > /dev/null
        call DELETE "/boards/$orbit_r7_board" '{}' > /dev/null
        # Give the base worker at least one maintenance tick with no queued work.
        sleep 2.2
      `;
      try {
        execFileSync('/usr/bin/unshare', ['--user', '--map-root-user', '--net', '--pid', '--fork', '--kill-child', '/bin/bash', '-c', shell, 'fixture',
          resolve('forge/app/node_modules/.bin/tsx'), '--tsconfig', resolve('forge/app/apps/api/tsconfig.json'),
          resolve('forge/app/apps/api/src/main.ts')], {
          cwd: socket, timeout: 20000, stdio: 'pipe',
          env: { ...env, DATABASE_URL: url.toString(), DOTENV_CONFIG_PATH: join(socket, 'no.env'),
            ORBIT_ENV: 'development', CODEX_BIN: '/usr/bin/false', HOME: socket, CODEX_HOME: join(socket, 'codex'),
            API_HOST: '127.0.0.1', API_PORT: '43179',
            JWT_SECRET: randomBytes(24).toString('hex'), ORBIT_R6_SYNTHETIC_LOGIN: JSON.stringify({ email: demoEmail, password: demoPassword }) },
        });
        assert.doesNotMatch(readFileSync(join(socket, 'api.log'), 'utf8'), /permission denied/);
        assert.equal(sql(database, '-c', "SELECT status,finished_card_revision FROM card_runs WHERE request_key='r7-stale-fixture'").trim(), 'failed|1');
      } catch (error) {
        let transcript = '';
        try { transcript = readFileSync(join(socket, 'api.log'), 'utf8'); } catch {}
        const shell = String((error as { stderr?: Buffer }).stderr ?? '');
        const diagnostic = (transcript + '\n' + shell).split('\n')
          .filter(line => /Synthetic HTTP step|permission denied|ExceptionsHandler|^column |^relation |Error:|error:|can.t resolve|UnknownDependencies|SQLSTATE/.test(line))
          .slice(-6).map(line => line.replace(/postgres(?:ql)?:\/\/[^ ]+/g, '[connection redacted]')).join('\n');
        throw Error('Isolated DEV bootstrap/login failed: ' + diagnostic);
      }
    });

    await t.test('two real API processes activate the verified participant, poll and restart', { skip: !fullBootstrap }, async () => {
      const domain = sql(database, '-c', 'SELECT domain_id FROM public.editorial_authorization_generation').trim();
      assert.match(domain, /^[0-9a-f]{8}-[0-9a-f-]{27}$/);
      const credentialFile = join(socket, 'writer.json');
      const approvalFile = join(socket, 'approval.json');
      await writeFile(credentialFile, JSON.stringify({ host: socket, port: Number(port), database, user: 'trial_writer' }), { mode: 0o600 });
      await writeFile(approvalFile, JSON.stringify({ version: 1, database, generalRole: 'orbit_dev_app', writerRole: 'trial_writer',
        ownerRole: 'trial_owner', generationDomain: domain }), { mode: 0o600 });
      const url = new URL('postgresql://orbit_dev_app@localhost:' + port + '/' + database);
      url.searchParams.set('host', socket);
      const shell = String.raw`
        set -euo pipefail
        /usr/sbin/ip link set lo up
        orbit_r7_a=''
        orbit_r7_b=''
        stop_api_children() {
          for orbit_r7_pid in "$orbit_r7_a" "$orbit_r7_b"; do
            if test -n "$orbit_r7_pid"; then
              kill -TERM "$orbit_r7_pid" 2>/dev/null || true
              wait "$orbit_r7_pid" 2>/dev/null || true
            fi
          done
        }
        trap stop_api_children EXIT
        wait_api() {
          for orbit_r7_attempt in {1..48}; do
            if /usr/bin/curl --fail --silent --max-time 1 "http://127.0.0.1:$1/health" >/dev/null; then return 0; fi
            if ! kill -0 "$2" 2>/dev/null; then return 9; fi
            sleep .25
          done
          return 8
        }
        API_PORT=43178 "$@" > api-a.log 2>&1 &
        orbit_r7_a=$!
        API_PORT=43180 "$@" > api-b.log 2>&1 &
        orbit_r7_b=$!
        wait_api 43178 "$orbit_r7_a"
        wait_api 43180 "$orbit_r7_b"
        /usr/bin/curl --fail --silent --max-time 5 -H 'Content-Type: application/json' \
          --data "$ORBIT_R7_SYNTHETIC_LOGIN" http://127.0.0.1:43178/auth/login > participant-login.json
        orbit_r7_token="$(/usr/bin/node -p 'require("./participant-login.json").token')"
        test -n "$orbit_r7_token"
        plugin_state() {
          /usr/bin/curl --fail --silent --max-time 5 -H "Authorization: Bearer $orbit_r7_token" "http://127.0.0.1:$1/plugins" \
            | /usr/bin/node -pe 'JSON.parse(require("fs").readFileSync(0)).plugins.find(p => p.id === "board-view").configuredEnabled'
        }
        test "$(plugin_state 43178)" = true
        test "$(plugin_state 43180)" = true
        /usr/bin/curl --fail --silent --max-time 5 -X PATCH "http://127.0.0.1:43178/plugins/board-view" \
          -H "Authorization: Bearer $orbit_r7_token" -H 'Content-Type: application/json' --data '{"enabled":false}' > participant-toggle.json
        /usr/bin/node -e 'const r = require("./participant-toggle.json"); if (r.enabled !== false || r.sync !== "synchronized") process.exit(1)'
        for orbit_r7_attempt in {1..30}; do
          if test "$(plugin_state 43180)" = false; then break; fi
          sleep .25
        done
        test "$(plugin_state 43180)" = false
        orbit_r7_last_status="$(/usr/bin/curl --silent --max-time 5 -w '%{http_code}' -o /dev/null \
          -X PATCH "http://127.0.0.1:43180/plugins/structured-view" -H "Authorization: Bearer $orbit_r7_token" \
          -H 'Content-Type: application/json' --data '{"enabled":false}')"
        test "$orbit_r7_last_status" = 409
        kill -TERM "$orbit_r7_b"
        wait "$orbit_r7_b" || true
        API_PORT=43180 "$@" > api-restart.log 2>&1 &
        orbit_r7_b=$!
        wait_api 43180 "$orbit_r7_b"
        test "$(plugin_state 43180)" = false
      `;
      try {
        execFileSync('/usr/bin/unshare', ['--user', '--map-root-user', '--net', '--pid', '--fork', '--kill-child', '/bin/bash', '-c', shell, 'fixture',
          resolve('forge/app/node_modules/.bin/tsx'), '--tsconfig', resolve('forge/app/apps/api/tsconfig.json'),
          resolve('forge/app/apps/api/src/main.ts')], {
          cwd: socket, timeout: 30000, stdio: 'pipe',
          env: { ...env, DATABASE_URL: url.toString(), DOTENV_CONFIG_PATH: join(socket, 'no.env'),
            ORBIT_ENV: 'development', CODEX_BIN: '/usr/bin/false', HOME: socket, CODEX_HOME: join(socket, 'codex'), API_HOST: '127.0.0.1',
            JWT_SECRET: randomBytes(24).toString('hex'), ORBIT_R7_SYNTHETIC_LOGIN: JSON.stringify({ email: demoEmail, password: demoPassword }),
            ORBIT_PLUGIN_SETTINGS_MODE: 'participant', ORBIT_PLUGIN_SETTINGS_WRITER_CREDENTIAL_FILE: credentialFile,
            ORBIT_PLUGIN_SETTINGS_APPROVAL_FILE: approvalFile },
        });
      } catch {
        const diagnostic = ['api-a.log', 'api-b.log', 'api-restart.log'].flatMap(file => {
          try { return readFileSync(join(socket, file), 'utf8').split('\n'); } catch { return []; }
        }).filter(line => /permission denied|Error:|error:|boundary_unverified|SQLSTATE/.test(line))
          .slice(-6).map(line => line.replace(/postgres(?:ql)?:\/\/[^ ]+/g, '[connection redacted]')).join('\n');
        throw Error('Isolated participant bootstrap failed: ' + diagnostic);
      }
      assert.equal(sql(database, '-c', 'SELECT revision FROM public.editorial_authorization_generation').trim(), '1');
      file('r6-validate');
      file('r6-contingency');
    });

    await t.test('administrative backup and restore preserve clone data but require ACL reapplication', () => {
      const archive = join(socket, 'synthetic.dump');
      const connection = ['-h', socket, '-p', port, '-U', 'trial_owner', '--no-password'];
      sql('postgres', '-c', `CREATE DATABASE ${restoreDatabase} OWNER trial_owner`);
      sql(database, '-c', 'SELECT 1');
      run('pg_dump', [...connection, '-Fc', '--no-owner', '--no-acl', '-f', archive, database]);
      sql(restoreDatabase, '-c', 'SELECT 1');
      run('pg_restore', [...connection, '--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges', '-d', restoreDatabase, archive]);
      const sourceUserCount = sql(database, '-c', 'SELECT count(*) FROM users').trim();
      const sourceMigrationCount = sql(database, '-c', 'SELECT count(*) FROM schema_migrations').trim();
      assert.equal(sql(restoreDatabase, '-c', `SELECT (SELECT count(*) FROM users),
        (SELECT count(*) FROM schema_migrations), (SELECT authorization_state FROM editorial_authorization_generation),
        has_table_privilege('orbit_dev_app', 'plugin_settings', 'SELECT')`).trim(), `${sourceUserCount}|${sourceMigrationCount}|unavailable|f`);
      const restoreArgs = [...roleArgs, '-v', 'approval=DISPOSABLE_RESTORE', '-f', join(scripts, 'r6-restore-acl.sql')];
      assert.throws(() => sql(database, ...restoreArgs), /Unexpected target or approval mode/);
      sql(restoreDatabase, ...restoreArgs);
      assert.equal(sql(restoreDatabase, '-c', `SELECT has_table_privilege('orbit_dev_app', 'plugin_settings', 'SELECT'),
        has_any_column_privilege('orbit_dev_app', 'plugin_settings', 'INSERT,UPDATE'),
        has_sequence_privilege('orbit_dev_app','extension_protocol_seq','USAGE')`).trim(), 't|f|t');
    });
  } finally {
    try { await Promise.all(pools.map(pool => pool.end())); }
    finally {
      if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
      await rm(socket, { recursive: true, force: true });
    }
  }
});
