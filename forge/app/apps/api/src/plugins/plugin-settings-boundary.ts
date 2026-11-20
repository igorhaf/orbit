import { randomBytes } from 'node:crypto';
import { Pool, type PoolClient, type PoolConfig } from 'pg';

export type PluginSettingsApproval = Readonly<{
  database: string;
  generalRole: string;
  writerRole: string;
  ownerRole: string;
  generationDomain: string;
  minimumRevision?: string;
}>;

const migrationChecksum = '2619740b0897181d8503f398bc37a16d054b581c83843c9ae4df2bc8dab9d8e9';
const guardBodyChecksum = '6063406f92ed87db74326b01f2bbf48655b0f074cc33c6eaa5260bdbcec91f56';

export function createPluginSettingsPrivatePool(config: PoolConfig) {
  const pool = new Pool({
    ...config, max: 4, connectionTimeoutMillis: 3000, statement_timeout: 5000,
    lock_timeout: 2500, idle_in_transaction_session_timeout: 7000,
  });
  // pg emits idle connection errors on the pool, with connection details in some errors.
  // Suppress those details. Subsequent operations observe unavailability on acquisition.
  pool.on('error', () => undefined);
  return pool;
}

async function identity(client: PoolClient) {
  const { rows: [row] } = await client.query<{ login: string; database: string; restricted: boolean }>(`
    SELECT current_user AS login, current_database() AS database,
      current_user = session_user AND current_setting('search_path') = 'pg_catalog, public'
      AND current_setting('server_version_num')::int / 10000 = 16
      AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
      AND NOT EXISTS (SELECT FROM pg_auth_members WHERE member = r.oid OR roleid = r.oid)
      AND NOT has_database_privilege(current_database(), 'CREATE,TEMP')
      AND NOT EXISTS (SELECT FROM pg_namespace WHERE has_schema_privilege(oid, 'CREATE'))
      AND NOT EXISTS (
        SELECT FROM pg_shdepend
        WHERE dbid IN (0, (SELECT oid FROM pg_database WHERE datname=current_database()))
          AND refclassid='pg_authid'::regclass AND refobjid=r.oid AND deptype='o'
      )
      AND NOT EXISTS (
        SELECT FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
        WHERE p.prosecdef AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
          AND has_schema_privilege(n.oid,'USAGE') AND has_function_privilege(p.oid,'EXECUTE')
      )
      AS restricted
    FROM pg_roles r WHERE rolname = current_user`);
  if (!row?.restricted) throw new Error('plugin_settings_database_boundary_unverified');
  return row;
}

/** Verifies a bounded SQL contract at startup. Host approval and the global
 * inventory of credentials and writers are separate operational gates. */
export async function assertPluginSettingsDatabaseBoundary(general: Pool, writer: Pool, approval?: PluginSettingsApproval) {
  const generalClient = await general.connect();
  try {
    const writerClient = await writer.connect();
    try {
      const [generalIdentity, writerIdentity] = await sameDatabaseAndRoles(generalClient, writerClient);
      const generalRole = generalIdentity.login;
      const writerRole = writerIdentity.login;
      if (approval && (generalIdentity.database !== approval.database
        || generalRole !== approval.generalRole || writerRole !== approval.writerRole)) {
        throw new Error('plugin_settings_database_boundary_unverified');
      }
      const { rows: [boundary] } = await writerClient.query<{
        valid: boolean; migration: string; owner: string; domain: string; revision: string;
      }>(`
        WITH protected AS (
          SELECT 'public.plugin_settings'::regclass AS settings,
            'public.plugin_installations'::regclass AS installations,
            'public.editorial_authorization_generation'::regclass AS generation,
            'public.orbit_editorial_generation_guard()'::regprocedure AS guard,
            'public.schema_migrations'::regclass AS ledger,
            'public.orbit_plugin_settings_migration_212'::regclass AS evidence
        )
        SELECT (SELECT checksum FROM public.orbit_plugin_settings_migration_212) AS migration,
          (SELECT relowner::regrole::text FROM pg_class WHERE oid=generation) AS owner,
          (SELECT domain_id::text FROM public.editorial_authorization_generation WHERE singleton) AS domain,
          (SELECT revision::text FROM public.editorial_authorization_generation WHERE singleton) AS revision,
          (SELECT count(DISTINCT relowner) = 1 AND bool_and(relowner NOT IN ($1::regrole,$2::regrole))
           FROM pg_class WHERE oid IN (settings,installations,generation,ledger,evidence))
          AND (SELECT relkind='v' AND reloptions @> ARRAY['security_barrier=true'] FROM pg_class WHERE oid=evidence)
          AND (SELECT datdba FROM pg_database WHERE datname=current_database()) =
              (SELECT relowner FROM pg_class WHERE oid=generation)
          AND regexp_replace(replace(pg_get_viewdef(evidence, true),'public.',''),'[[:space:]()]','','g') =
              'SELECTchecksumFROMschema_migrationsWHEREversion=''212_editorial_authorization_generation.sql''::text;'
          AND has_table_privilege($2, evidence, 'SELECT')
          AND NOT has_any_column_privilege($1, evidence, 'SELECT')
          AND NOT EXISTS (
            SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND (
              (CASE WHEN c.relkind IN ('r','p','v','m','f') AND c.oid NOT IN (settings,generation,evidence)
                THEN has_any_column_privilege($2,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
                  OR has_table_privilege($2,c.oid,'DELETE,TRUNCATE,TRIGGER') ELSE false END)
              OR CASE WHEN c.relkind='S' THEN has_sequence_privilege($2,c.oid,'USAGE,SELECT,UPDATE') ELSE false END
            )
          )
          AND NOT EXISTS (
            SELECT FROM pg_class c, LATERAL aclexplode(c.relacl) a WHERE c.oid=evidence
              AND a.grantee<>c.relowner AND NOT (a.grantee=$2::regrole AND a.privilege_type='SELECT' AND NOT a.is_grantable)
          )
          AND NOT EXISTS (SELECT FROM pg_attribute WHERE attrelid=evidence AND attacl IS NOT NULL)
          AND NOT EXISTS (
            SELECT FROM unnest(ARRAY[settings,installations,generation,ledger,evidence]) AS objects(relation)
            WHERE has_table_privilege($1, relation, 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
              OR has_any_column_privilege($1, relation, 'INSERT,UPDATE')
              OR has_table_privilege($2, relation, 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
              OR has_any_column_privilege($2, relation, 'INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION')
          )
          AND has_table_privilege($1, settings, 'SELECT')
          AND has_table_privilege($1, installations, 'SELECT')
          AND has_table_privilege($2, generation, 'SELECT')
          AND has_column_privilege($2, generation, 'revision', 'UPDATE')
          AND has_column_privilege($2, settings, 'plugin_id', 'SELECT')
          AND has_column_privilege($2, settings, 'enabled', 'SELECT')
          AND has_column_privilege($2, settings, 'plugin_id', 'INSERT')
          AND has_column_privilege($2, settings, 'enabled', 'INSERT')
          AND has_column_privilege($2, settings, 'enabled', 'UPDATE')
          AND has_column_privilege($2, settings, 'updated_at', 'UPDATE')
          AND NOT EXISTS (
            SELECT FROM pg_attribute a WHERE a.attrelid IN (settings,installations,generation,ledger,evidence)
              AND a.attnum > 0 AND NOT a.attisdropped
              AND ((has_column_privilege($2,a.attrelid,a.attnum,'INSERT')
                AND NOT (a.attrelid=settings AND a.attname IN ('plugin_id','enabled')))
              OR (has_column_privilege($2,a.attrelid,a.attnum,'UPDATE')
                AND NOT ((a.attrelid=settings AND a.attname IN ('enabled','updated_at'))
                  OR (a.attrelid=generation AND a.attname='revision'))))
          )
          AND (SELECT count(*) = 2 FROM pg_trigger WHERE tgrelid=generation AND tgfoid=guard
            AND tgenabled='O' AND ((tgname='editorial_generation_update_guard' AND tgtype=27)
              OR (tgname='editorial_generation_no_truncate' AND tgtype=34)))
          AND EXISTS (SELECT FROM pg_proc p JOIN pg_class c ON c.oid=generation
            WHERE p.oid=guard AND NOT p.prosecdef AND p.proowner=c.relowner
              AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
              AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=$3)
          AND (SELECT count(*) = 1 FROM public.editorial_authorization_generation
            WHERE singleton AND authorization_state='unavailable') AS valid
        FROM protected`, [generalRole, writerRole, guardBodyChecksum]);
      if (!boundary?.valid || boundary.migration !== migrationChecksum || !/^(0|[1-9][0-9]{0,18})$/.test(boundary.revision)
        || (approval && (boundary.owner !== approval.ownerRole || boundary.domain !== approval.generationDomain
          || (approval.minimumRevision !== undefined && BigInt(boundary.revision) < BigInt(approval.minimumRevision))))) {
        throw new Error('plugin_settings_database_boundary_unverified');
      }
      return { domainId: boundary.domain, revision: boundary.revision };
    } finally { writerClient.release(); }
  } catch {
    throw new Error('plugin_settings_database_boundary_unverified');
  } finally { generalClient.release(); }
}

async function sameDatabaseAndRoles(general: PoolClient, writer: PoolClient) {
  // Advisory locks are database-local. A random key held on one connection
  // must be unavailable to the other, even when both use Unix sockets.
  const key = randomBytes(8).readBigInt64BE().toString();
  await general.query('BEGIN');
  try {
    await general.query("SET LOCAL statement_timeout='4s'; SET LOCAL lock_timeout='2s'");
    await writer.query('BEGIN');
    try {
      const [a, b] = await Promise.all([identity(general), identity(writer)]);
      if (a.login === b.login || a.database !== b.database) throw new Error('plugin_settings_database_boundary_unverified');
      await general.query('SELECT pg_advisory_xact_lock($1::bigint)', [key]);
      const { rows: [row] } = await writer.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_xact_lock($1::bigint) AS acquired', [key],
      );
      if (!row || row.acquired) throw new Error('plugin_settings_database_boundary_unverified');
      return [a, b] as const;
    } finally { await writer.query('ROLLBACK'); }
  } finally { await general.query('ROLLBACK'); }
}
