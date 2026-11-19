import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';

const require = createRequire(new URL('../../../dev/app/package.json', import.meta.url));
const { Client } = require('pg');
const { parse } = require('dotenv');
const api = new URL('../../../dev/app/apps/api/', import.meta.url);
const expected = { host: '127.0.0.1', port: 5432, database: 'orbit_native_dev', login: 'orbit_dev_app' };
let stage = 'authorization';

async function inspect() {
  if (process.env.ORBIT_R8_INSPECT_DEV !== '1') throw Error('read-only diagnostics require opt-in');
  stage = 'configuration';
  const env = parse(await readFile(new URL('.env', api)));
  const source = new URL(env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(source.protocol)
    || source.hostname !== expected.host || Number(source.port || 5432) !== expected.port
    || source.pathname !== '/' + expected.database || decodeURIComponent(source.username) !== expected.login
    || source.search || source.hash) throw Error('DEV target does not match the approved local source');

  const versionedDirectory = new URL('sql/migrations/', api);
  const migrationFile = new URL('../../../packages/orbit-core/sql/migrations/212_editorial_authorization_generation.sql', import.meta.url);
  const local = new Map(await Promise.all((await readdir(versionedDirectory))
    .filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort().map(async name =>
      [name, createHash('sha256').update(await readFile(new URL(name, versionedDirectory), 'utf8')).digest('hex')])));
  const generationVersion = '212_editorial_authorization_generation.sql';
  const generationChecksum = createHash('sha256').update(await readFile(migrationFile, 'utf8')).digest('hex');

  stage = 'connection';
  const client = new Client({
    host: expected.host, port: expected.port, database: expected.database, user: expected.login,
    password: decodeURIComponent(source.password), ssl: false,
    application_name: 'orbit-r8-readonly', connectionTimeoutMillis: 3000, query_timeout: 7000,
    options: '-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2500',
  });
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const get = async (sql, values) => (await client.query(sql, values)).rows;
    stage = 'server identity';
    const [id] = await get(`SELECT current_database() database, session_user login, current_user effective_login,
      host(inet_server_addr()) host, inet_server_port() port, current_setting('server_version_num')::int server_version,
      current_setting('transaction_read_only')::boolean read_only`);
    if (Object.entries(expected).some(([key, value]) => id[key] !== value)
      || id.effective_login !== expected.login || Math.floor(id.server_version / 10000) !== 16 || !id.read_only) {
      throw Error('connected DEV identity differs from approved source');
    }

    stage = 'migration inventory';
    const [schema] = await get(`SELECT
      to_regclass('public.schema_migrations') IS NOT NULL AS ledger,
      to_regclass('public.card_revisions') IS NOT NULL AS revisions_table,
      EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.cards') AND attname='card_revision' AND NOT attisdropped) AS cards_revision,
      EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.card_runs') AND attname='worker_id' AND NOT attisdropped) AS run_worker,
      EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.card_ai_runs') AND attname='write_coordination' AND NOT attisdropped) AS ai_coordination,
      to_regclass('public.editorial_authorization_generation') IS NOT NULL AS generation_table,
      to_regprocedure('public.orbit_editorial_generation_guard()') IS NOT NULL AS generation_guard,
      to_regclass('public.orbit_plugin_settings_migration_212') IS NOT NULL AS generation_evidence`);
    const ledger = new Map(schema.ledger ? (await get('SELECT version,checksum FROM public.schema_migrations ORDER BY version')).map(row => [row.version, row.checksum]) : []);
    const trackedMigrations = new Map([...local].filter(([name]) => /^15[78]_/.test(name)));
    trackedMigrations.set(generationVersion, generationChecksum);
    const tracked = [...trackedMigrations].map(([name, sha256]) => ({
      name, sha256, status: !schema.ledger ? 'ledger_missing' : !ledger.has(name) ? 'not_recorded'
        : ledger.get(name) === sha256 ? 'exact' : 'checksum_mismatch',
    }));
    const migrationSummary = {
      localFiles: local.size, recorded: ledger.size, tracked,
      otherLocalFilesPending: [...local.keys()].filter(name => !ledger.has(name) && !trackedMigrations.has(name)),
      localChecksumMismatches: [...local].filter(([name, digest]) => ledger.has(name) && ledger.get(name) !== digest).map(([name]) => name),
      recordedWithoutLocalFileCount: [...ledger.keys()].filter(name => !local.has(name) && name !== generationVersion).length,
    };

    stage = 'role and ownership inventory';
    const [role] = await get(`SELECT r.rolsuper superuser, r.rolcreaterole can_create_role, r.rolcreatedb can_create_database,
      r.rolreplication replication, r.rolbypassrls bypass_rls, r.rolinherit inherits,
      (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid) memberships,
      (SELECT datdba=r.oid FROM pg_database WHERE datname=current_database()) owns_database,
      has_schema_privilege(r.oid,'public','CREATE') can_create_public,
      has_database_privilege(r.oid,current_database(),'TEMP') can_create_temp
      FROM pg_roles r WHERE r.rolname=current_user`);
    const protectedAcl = await get(`SELECT c.relname, c.relowner=current_user::regrole AS owned_by_login,
      has_table_privilege(c.oid,'SELECT') AS read,
      has_any_column_privilege(c.oid,'INSERT') AS insert,
      has_any_column_privilege(c.oid,'UPDATE') AS update,
      has_table_privilege(c.oid,'DELETE') AS delete,
      has_table_privilege(c.oid,'TRUNCATE') AS truncate,
      has_table_privilege(c.oid,'TRIGGER') AS trigger,
      c.relacl IS NOT NULL AS explicit_acl
      FROM pg_class c WHERE c.oid IN (to_regclass('public.plugin_settings'),to_regclass('public.plugin_installations'))
      ORDER BY c.relname`);
    const ownedObjects = await get(`SELECT classid::regclass::text AS object_class, dbid=0 AS shared, count(*)::int AS count
      FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=current_user::regrole AND deptype='o'
      AND dbid IN (0,(SELECT oid FROM pg_database WHERE datname=current_database()))
      GROUP BY 1,2 ORDER BY 1,2`);
    const extensions = await get(`SELECT extname, extversion, extowner=current_user::regrole AS owned_by_login
      FROM pg_extension WHERE extname IN ('pgcrypto','plpgsql') ORDER BY extname`);
    const otherSessions = await get(`SELECT backend_type, usename=session_user AS same_login,
      CASE WHEN client_addr IS NULL THEN 'socket_or_none' WHEN client_addr <<= inet '127.0.0.0/8'
        OR client_addr=inet '::1' THEN 'loopback' ELSE 'non_loopback' END AS origin, count(*)::int AS count
      FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
      GROUP BY 1,2,3 ORDER BY 1,2,3`);

    console.log(JSON.stringify({
      id, schema, migrations: migrationSummary, role, protectedAcl, ownedObjects, extensions, otherSessions,
      hostConfig: {
        mode: ['legacy', 'paused', 'participant'].includes(env.ORBIT_PLUGIN_SETTINGS_MODE) ? env.ORBIT_PLUGIN_SETTINGS_MODE
          : env.ORBIT_PLUGIN_SETTINGS_MODE === undefined ? 'implicit' : 'unrecognized',
        approvalPathSet: Boolean(env.ORBIT_PLUGIN_SETTINGS_APPROVAL_FILE),
        writerCredentialPathSet: Boolean(env.ORBIT_PLUGIN_SETTINGS_WRITER_CREDENTIAL_FILE),
      },
    }, null, 2));
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }
}

inspect().catch(error => {
  const sqlstate = /^[0-9A-Z]{5}$/.test(error?.code ?? '') ? ' (SQLSTATE ' + error.code + ')' : '';
  console.error('DEV read-only diagnostic stopped at ' + stage + sqlstate + '.');
  process.exitCode = 1;
});
